import path from "node:path";
import { chatJson, models } from "./llm.js";

const HISTORY_LIMIT = 12;
const MIN_TURNS_FRACTION = 0.6;

const SYSTEM_PROMPT = `You are testing a web shop by acting as a real user. Your job is to find bugs.

Each turn you get the visible page text, what changed after your last action, a numbered list of elements you can use, and any errors seen since your last action.
Reply with a JSON object:
{
  "thought": "one short sentence about what you are checking",
  "action": "click" | "fill" | "report_bug" | "done",
  "ref": <element number, for click and fill>,
  "text": "<text to type, for fill>",
  "submit": true | false (for fill: press Enter after typing),
  "bug": { "title": "...", "expected": "...", "actual": "..." }
}

Rules:
- Only report a bug that is visible on the page right now: wrong numbers, wrong items, missing results, error messages, or the app accepting something it should reject.
- "expected" and "actual" must be different. If what you see is correct, it is not a bug.
- Check the maths yourself. Do not assume the page is right.
- Typing into a field does nothing on its own. Set "submit": true or click the button that submits it, then look at the result before judging.
- Do not report the same problem twice. The same cause with different products or numbers is the same problem.
- Do not report missing features or design opinions.
- After reporting a bug, move on to a different part of the shop.
- When you have tested one part of the shop, move on to another: search, adding and removing cart items, quantities, discount codes, checkout.
- Use "done" only when you have tried every part of the shop.`;

const VERIFY_PROMPT = `You check bug reports from automated testers. You get a bug report, the page as it first loaded, and the page after the report's steps were replayed in a fresh browser.
Decide whether the page clearly shows the reported problem. Reject the report if:
- the page looks correct, or expected and actual mean the same thing;
- the report depends on something the steps never did (typing into a field submits nothing until its button is clicked);
- it is a design opinion or missing feature, such as wanting more detailed messages or a button to be hidden;
- the app rejected bad input with a clear message. An HTTP 400 with an explanation is correct behaviour, not a bug;
- it assumes a product exists that appears neither before nor after the steps, or that a search should match synonyms.
Reply with a JSON object: { "confirmed": true | false, "reason": "one short sentence" }`;

export async function observe(page) {
    return page.evaluate(() => {
        const locatorFor = (element) => {
            const parts = [];
            for (let node = element; node && node !== document.body; node = node.parentElement) {
                if (node.dataset?.testid) {
                    parts.unshift(`[data-testid="${node.dataset.testid}"]`);
                }
            }
            return parts.join(" ");
        };

        const elements = [];
        for (const element of document.querySelectorAll("button, input, select, textarea, a[href]")) {
            if (!element.dataset.testid || !element.checkVisibility()) {
                continue;
            }
            let label =
                element.innerText?.trim() ||
                element.getAttribute("aria-label") ||
                element.getAttribute("placeholder") ||
                element.closest("label")?.innerText.trim() ||
                element.name;
            const row = element.closest("li, tr, article");
            if (row) {
                label += ` (in "${row.innerText.trim().split("\n")[0]}")`;
            }
            elements.push({
                locator: locatorFor(element),
                kind: element.tagName === "INPUT" || element.tagName === "TEXTAREA" ? "text field" : element.tagName.toLowerCase(),
                label,
                value: "value" in element && element.tagName !== "BUTTON" ? element.value : undefined,
            });
        }

        return { text: document.body.innerText.slice(0, 3000), elements };
    });
}

function textChanges(before, after) {
    if (!before) {
        return "first look at the page";
    }
    const lines = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);
    const oldLines = new Set(lines(before));
    const newLines = new Set(lines(after));
    const added = [...newLines].filter((line) => !oldLines.has(line));
    const removed = [...oldLines].filter((line) => !newLines.has(line));
    if (!added.length && !removed.length) {
        return "nothing changed";
    }
    return [...added.map((line) => `+ ${line}`), ...removed.map((line) => `- ${line}`)].join("\n");
}

function describe({ observation, changes, problems, history, reported, turnsLeft }) {
    const elements = observation.elements
        .map((element, index) => {
            const value = element.value !== undefined ? ` (current value: "${element.value}")` : "";
            return `${index}: ${element.kind} "${element.label}"${value}`;
        })
        .join("\n");

    return [
        `Page text:\n${observation.text}`,
        `What changed after your last action:\n${changes}`,
        `Elements:\n${elements}`,
        `Errors since your last action:\n${problems.length ? problems.join("\n") : "none"}`,
        `Your recent actions:\n${history.length ? history.slice(-HISTORY_LIMIT).join("\n") : "none yet"}`,
        `Bugs you already reported:\n${reported.length ? reported.map((bug) => `- ${bug.title}`).join("\n") : "none"}`,
        `Actions left: ${turnsLeft}`,
    ].join("\n\n");
}

export function trackRequests(page) {
    let inFlight = 0;
    page.on("request", () => inFlight++);
    page.on("requestfinished", () => inFlight--);
    page.on("requestfailed", () => inFlight--);

    return async function settle() {
        const deadline = Date.now() + 5000;
        await page.waitForTimeout(100);
        while (inFlight > 0 && Date.now() < deadline) {
            await page.waitForTimeout(50);
        }
    };
}

function watchProblems(page) {
    const problems = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            problems.push(`Console error: ${message.text()}`);
        }
    });
    page.on("pageerror", (error) => problems.push(`Page error: ${error.message}`));
    page.on("response", (response) => {
        if (response.status() >= 400) {
            problems.push(`HTTP ${response.status()} from ${response.request().method()} ${new URL(response.url()).pathname}`);
        }
    });
    return problems;
}

export async function perform(page, step, settle) {
    const target = page.locator(step.locator);
    if (step.action === "click") {
        await target.click({ timeout: 5000 });
    } else {
        await target.fill(step.text, { timeout: 5000 });
        if (step.submit) {
            await target.press("Enter");
        }
    }
    await settle();
}

export function narrate(step) {
    if (step.action === "click") {
        return `Clicked "${step.label}"`;
    }
    return `Typed "${step.text}" into "${step.label}"${step.submit ? " and pressed Enter" : " (not submitted)"}`;
}

const GROUP_PROMPT = `You merge duplicate bug reports. Two reports are duplicates when the same underlying fault causes them, even if they mention different products, numbers or steps.
Different faults in the same area are separate bugs. For example, "invalid email accepted" and "crash on empty cart" are two groups, even though both are about checkout.
You get a numbered list of confirmed reports. Reply with a JSON object:
{ "groups": [ { "title": "short name for the underlying bug", "members": [<report numbers>] } ] }
Every report number must appear in exactly one group.`;

export async function groupBugs(bugs) {
    if (bugs.length < 2) {
        return bugs.map((bug) => ({ ...bug, duplicates: [] }));
    }

    const list = bugs.map((bug, index) => `${index}: ${bug.title}. Expected: ${bug.expected}. Actual: ${bug.actual}`).join("\n");
    const { groups = [] } = await chatJson(
        [
            { role: "system", content: GROUP_PROMPT },
            { role: "user", content: list },
        ],
        { model: models.verify },
    );

    const seen = new Set();
    const unique = [];
    for (const group of groups) {
        const members = (group.members || []).filter((index) => bugs[index] && !seen.has(index));
        if (!members.length) {
            continue;
        }
        members.forEach((index) => seen.add(index));
        const shortest = members.reduce((best, index) => (bugs[index].steps.length < bugs[best].steps.length ? index : best));
        unique.push({
            ...bugs[shortest],
            title: group.title || bugs[shortest].title,
            duplicates: members.filter((index) => index !== shortest).map((index) => bugs[index].id),
        });
    }
    bugs.forEach((bug, index) => {
        if (!seen.has(index)) {
            unique.push({ ...bug, duplicates: [] });
        }
    });
    return unique;
}

const sameMeaning = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

export async function verifyBug({ browser, baseUrl, bug }) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const problems = watchProblems(page);
    const settle = trackRequests(page);

    try {
        await page.goto(baseUrl, { waitUntil: "networkidle" });
        const start = await observe(page);
        for (const step of bug.steps) {
            await perform(page, step, settle);
        }
        const observation = await observe(page);
        const verdict = await chatJson([
            { role: "system", content: VERIFY_PROMPT },
            {
                role: "user",
                content: [
                    `Bug report: ${bug.title}`,
                    `Expected: ${bug.expected}`,
                    `Actual: ${bug.actual}`,
                    `Steps replayed:\n${bug.steps.map(narrate).join("\n")}`,
                    `Page text before the steps:\n${start.text}`,
                    `Page text now:\n${observation.text}`,
                    `Errors during replay:\n${problems.length ? problems.join("\n") : "none"}`,
                ].join("\n\n"),
            },
        ], { model: models.verify });
        return { confirmed: verdict.confirmed === true, reason: verdict.reason };
    } catch (error) {
        return { confirmed: false, reason: `Replay failed: ${error.message.split("\n")[0]}` };
    } finally {
        await context.close();
    }
}

export async function runPersona({ browser, baseUrl, persona, maxSteps, runDir, emit }) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const problems = watchProblems(page);
    const settle = trackRequests(page);

    const steps = [];
    const history = [];
    const bugs = [];
    let previousText = null;

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    emit({ type: "persona-started", persona: persona.id });

    try {
        for (let turn = 1; turn <= maxSteps; turn++) {
            const observation = await observe(page);
            const prompt = describe({
                observation,
                changes: textChanges(previousText, observation.text),
                problems: problems.splice(0),
                history,
                reported: bugs,
                turnsLeft: maxSteps - turn + 1,
            });
            previousText = observation.text;

            const decision = await chatJson([
                { role: "system", content: `${SYSTEM_PROMPT}\n\nWho you are: ${persona.description}` },
                { role: "user", content: prompt },
            ]);
            emit({ type: "decision", persona: persona.id, turn, thought: decision.thought, action: decision.action });

            if (decision.action === "done") {
                if (turn >= maxSteps * MIN_TURNS_FRACTION) {
                    break;
                }
                history.push("Tried to stop early. There is still time: test a part of the shop you have not tried yet.");
                continue;
            }

            if (decision.action === "report_bug" && decision.bug?.title) {
                if (sameMeaning(decision.bug.expected, decision.bug.actual)) {
                    history.push(`Report "${decision.bug.title}" was rejected: expected and actual are the same, so it is not a bug.`);
                    continue;
                }
                const bug = {
                    id: `${persona.id}-${bugs.length + 1}`,
                    persona: persona.id,
                    title: decision.bug.title,
                    expected: decision.bug.expected,
                    actual: decision.bug.actual,
                    steps: [...steps],
                    screenshot: `${persona.id}-${bugs.length + 1}.png`,
                };
                await page.screenshot({ path: path.join(runDir, bug.screenshot), fullPage: true });
                bugs.push(bug);
                history.push(`Reported bug: ${bug.title}`);
                emit({ type: "bug-reported", persona: persona.id, bug });
                continue;
            }

            const element = observation.elements[decision.ref];
            if (!element || !["click", "fill"].includes(decision.action)) {
                history.push(`Invalid reply ${JSON.stringify(decision)}. Use a listed element number.`);
                continue;
            }

            const step = { action: decision.action, locator: element.locator, label: element.label };
            if (decision.action === "fill") {
                step.text = String(decision.text ?? "");
                step.submit = decision.submit === true;
            }

            try {
                await perform(page, step, settle);
                steps.push(step);
                history.push(narrate(step));
            } catch (error) {
                history.push(`Could not ${step.action} "${step.label}": ${error.message.split("\n")[0]}`);
            }
        }
    } catch (error) {
        emit({ type: "persona-error", persona: persona.id, error: error.message });
    } finally {
        await context.close();
    }

    emit({ type: "persona-finished", persona: persona.id, steps: steps.length, bugs: bugs.length });
    return bugs;
}
