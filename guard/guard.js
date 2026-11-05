import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { narrate, perform, trackRequests, verifyBug } from "../swarm/agent.js";
import { chatJson, models } from "../swarm/llm.js";

const MINIMIZE_PROMPT = `You shorten bug reproductions. You get a bug report and the numbered steps that reproduced it from a fresh page load.
Pick the fewest steps that still reproduce the bug, keeping their original order. Drop anything unrelated, such as searches or form typing that has nothing to do with the bug.
Reply with a JSON object: { "keep": [<step numbers>] }`;

const ASSERT_PROMPT = `You write the assertions for a Playwright regression test. The test replays steps that trigger a bug.
Your assertions must describe the correct behaviour, so the test fails while the bug exists and passes once it is fixed.

You get the bug report, the steps, and every visible element with a data-testid after the steps, with its current (buggy) text.
Reply with a JSON object:
{ "title": "short test name that states the correct behaviour", "assertions": ["await expect(...)...;"] }

Rules:
- Write 1 to 3 assertions, each on one line, starting with: await expect(page.getByTestId("...")
- Chain getByTestId calls to reach nested elements, using only ids from the list. You may add .first(), .last() or .nth(n).
- Use only these matchers, optionally with .not: toHaveText, toContainText, toHaveCount, toBeVisible, toBeHidden, toHaveValue, toBeEmpty.
- Arguments must be plain string or number literals.
- Negative assertions (.not, toBeHidden) pass instantly if the page has not updated yet. If the last step triggers a server request, first assert that its result has appeared, for example: await expect(page.getByTestId("checkout-message")).not.toBeEmpty();
- Work out correct values yourself from the prices and quantities on the page. Never copy the buggy value as the expectation.
- If the correct text is unknown (for example the wording of an error message), assert that the buggy text is not shown instead.
- Assert only what the bug report is about.`;

const ASSERTION_PATTERN =
    /^await expect\(page(\.getByTestId\("[\w-]+"\))+(\.(first|last)\(\)|\.nth\(\d+\))?\)(\.not)?\.(toHaveText|toContainText|toHaveCount|toBeVisible|toBeHidden|toHaveValue|toBeEmpty)\(("([^"\\]|\\.)*"|\d+(\.\d+)?)?\);?$/;

export async function minimizeSteps({ browser, baseUrl, bug }) {
    if (bug.steps.length <= 2) {
        return bug.steps;
    }

    const { keep = [] } = await chatJson(
        [
            { role: "system", content: MINIMIZE_PROMPT },
            {
                role: "user",
                content: [
                    `Bug: ${bug.title}`,
                    `Expected: ${bug.expected}`,
                    `Actual: ${bug.actual}`,
                    `Steps:\n${bug.steps.map((step, index) => `${index}: ${narrate(step)}`).join("\n")}`,
                ].join("\n\n"),
            },
        ],
        { model: models.verify },
    );

    const indexes = [...new Set(keep)].filter((index) => Number.isInteger(index) && bug.steps[index]).sort((a, b) => a - b);
    if (!indexes.length || indexes.length >= bug.steps.length) {
        return bug.steps;
    }

    const shorter = indexes.map((index) => bug.steps[index]);
    const verdict = await verifyBug({ browser, baseUrl, bug: { ...bug, steps: shorter } });
    return verdict.confirmed ? shorter : bug.steps;
}

async function snapshotAfter({ browser, baseUrl, steps }) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const settle = trackRequests(page);
    try {
        await page.goto(baseUrl, { waitUntil: "networkidle" });
        for (const step of steps) {
            await perform(page, step, settle);
        }
        return await page.evaluate(() => {
            const chainFor = (element) => {
                const ids = [];
                for (let node = element; node && node !== document.body; node = node.parentElement) {
                    if (node.dataset?.testid) {
                        ids.unshift(node.dataset.testid);
                    }
                }
                return ids;
            };
            return [...document.querySelectorAll("[data-testid]")]
                .filter((element) => element.checkVisibility())
                .map((element) => ({
                    chain: chainFor(element),
                    text: (["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) ? element.value : element.innerText).trim().replace(/\s+/g, " ").slice(0, 120),
                }));
        });
    } finally {
        await context.close();
    }
}

function locatorCode(locator) {
    const ids = [...locator.matchAll(/\[data-testid="([^"]+)"\]/g)].map((match) => match[1]);
    return `page${ids.map((id) => `.getByTestId(${JSON.stringify(id)})`).join("")}`;
}

function stepCode(step) {
    const target = locatorCode(step.locator);
    if (step.action === "click") {
        return [`await ${target}.click();`];
    }
    const lines = [`await ${target}.fill(${JSON.stringify(step.text)});`];
    if (step.submit) {
        lines.push(`await ${target}.press("Enter");`);
    }
    return lines;
}

export async function writeAssertions({ browser, baseUrl, bug, steps, feedback }) {
    const elements = await snapshotAfter({ browser, baseUrl, steps });
    const list = elements.map((element) => `${element.chain.map((id) => `getByTestId("${id}")`).join(".")}: "${element.text}"`).join("\n");

    const messages = [
        { role: "system", content: ASSERT_PROMPT },
        {
            role: "user",
            content: [
                `Bug: ${bug.title}`,
                `Expected: ${bug.expected}`,
                `Actual: ${bug.actual}`,
                `Steps:\n${steps.map(narrate).join("\n")}`,
                `Elements after the steps:\n${list}`,
                feedback ? `Your previous attempt was rejected: ${feedback}` : "",
            ]
                .filter(Boolean)
                .join("\n\n"),
        },
    ];
    const reply = await chatJson(messages, { model: models.verify });

    const assertions = (reply.assertions || []).map((line) => String(line).trim()).filter((line) => ASSERTION_PATTERN.test(line));
    if (!assertions.length) {
        throw new Error(`No usable assertions in reply: ${JSON.stringify(reply.assertions)}`);
    }
    return { title: String(reply.title || bug.title), assertions: assertions.map((line) => (line.endsWith(";") ? line : `${line};`)) };
}

export function renderTest({ bug, steps, title, assertions }) {
    const annotation = `Expected: ${bug.expected} Actual: ${bug.actual}`;
    const body = [`await page.goto("/");`, ...steps.flatMap(stepCode), ...assertions].map((line) => `    ${line}`).join("\n");
    return `import { expect, test } from "@playwright/test";

test(${JSON.stringify(title)}, { annotation: { type: "bug", description: ${JSON.stringify(annotation)} } }, async ({ page }) => {
${body}
});
`;
}

function collectResults(suite) {
    const own = (suite.specs || []).flatMap((spec) => spec.tests.flatMap((test) => test.results));
    return [...own, ...(suite.suites || []).flatMap(collectResults)];
}

function failureSignature(message) {
    return message
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^(Error:|Locator:|Expected|Received)/.test(line))
        .join("\n")
        .replace(/\d{6,}/g, "#");
}

export function checkFailsOnBug(testFile, reportFile, { repeat = 2 } = {}) {
    rmSync(reportFile, { force: true });
    spawnSync(
        process.execPath,
        [path.join("node_modules", "@playwright", "test", "cli.js"), "test", testFile.replaceAll("\\", "/"), "--reporter=json", `--repeat-each=${repeat}`, "--retries=0", "--workers=1"],
        {
            env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile, PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
            encoding: "utf8",
        },
    );

    let report;
    try {
        report = JSON.parse(readFileSync(reportFile, "utf8"));
    } catch {
        return { ok: false, reason: "The test runner produced no report." };
    }

    const results = (report.suites || []).flatMap(collectResults);
    if (!results.length) {
        return { ok: false, reason: "No test ran. The file may not compile." };
    }
    if (results.some((result) => result.status === "passed")) {
        return { ok: false, reason: "The test passed, so it does not catch the bug.", retry: true };
    }

    const messages = results.map((result) =>
        (result.errors || [])
            .map((error) => error.message || "")
            .join("\n")
            .replace(/\u001b\[[0-9;]*m/g, ""),
    );
    if (messages.some((message) => /locator\.(click|fill|press)/.test(message) || !/expect\(/.test(message))) {
        return { ok: false, reason: `The test broke before reaching its assertions:\n${messages[0].slice(0, 400)}` };
    }
    const signatures = new Set(messages.map(failureSignature));
    if (signatures.size > 1) {
        return { ok: false, reason: "The test failed differently on each run, so it is flaky." };
    }
    return { ok: true, failure: messages[0].split("\n").slice(0, 6).join("\n"), signature: [...signatures][0] };
}

export async function shrinkSteps({ browser, baseUrl, file, reportFile, bug, steps, title, assertions, signature }) {
    const pageAfter = async (candidate) => JSON.stringify(await snapshotAfter({ browser, baseUrl, steps: candidate })).replace(/\d{6,}/g, "#");
    const target = await pageAfter(steps);
    let kept = [...steps];
    for (let index = kept.length - 1; index >= 0; index--) {
        const candidate = kept.filter((_, position) => position !== index);
        if ((await pageAfter(candidate)) !== target) {
            continue;
        }
        writeFileSync(file, renderTest({ bug, steps: candidate, title, assertions }));
        const check = checkFailsOnBug(file, reportFile, { repeat: 1 });
        if (check.ok && check.signature === signature) {
            kept = candidate;
        }
    }
    writeFileSync(file, renderTest({ bug, steps: kept, title, assertions }));
    return kept;
}
