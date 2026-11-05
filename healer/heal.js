import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chatJson, models } from "../swarm/llm.js";
import { collectTests, isFailure, runPlaywright } from "./playwright.js";

const RERUNS = 10;
const FLAKY_PROOF_RUNS = 8;

const LOCATOR_PROMPT = `You repair Playwright tests whose locators broke because the app's markup changed.
You get the test file, the error, every data-testid that exists in the app's source now, and the app's code changes.
If the element still exists under a new test id, map the old locator to the new one. If it was removed, it cannot be fixed.
Reply with a JSON object:
{ "fixable": true | false, "reason": "one sentence", "replacements": [ { "from": "exact text in the test file", "to": "replacement text" } ] }
Only change locators. Never change actions, assertions, expected values or test names.`;

const FLAKY_PROMPT = `You repair flaky Playwright tests. The test passed on some reruns and failed on others without any code change.
Typical causes are fixed sleeps, reading values before the page updates, and non-retrying checks such as expect(await locator.count()).
Rewrite the test file so it waits for the right state using web-first assertions like await expect(locator).toHaveCount(n).
Keep every test, its name, its steps, and what it checks. Do not add skips, retries or longer timeouts.
Reply with a JSON object: { "reason": "one sentence on the cause", "source": "the complete new test file" }`;

const REGRESSION_PROMPT = `A Playwright test fails every time with the same assertion error. Explain the most likely cause using the app's code changes.
Reply with a JSON object: { "summary": "one sentence describing what broke for users", "likely_cause": "which change caused it, naming the file", "suggested_fix": "one sentence" }`;

const BUG_FIX_PROMPT = `You fix bugs in a web app. Each bug comes with a Playwright test that reproduces it and fails today.
You get the bug reports, the failing tests with their errors, and the app's complete source.
Make the smallest correct change to the app so the tests pass. Fix the root cause for every user, not only for the inputs the tests use.
Never special-case test values, never remove features, and keep the existing code style.
Fix logic only. Never change product data, prices, stock, discount codes or copy to make a number come out right.
A test may depend on several bugs at once. If a test only passes by changing data, its expectation is wrong: leave it out.
Reply with a JSON object:
{ "fixes": [ { "test": "exact test title", "cause": "one sentence on the root cause, naming the file", "change": "one sentence on the fix" } ],
  "replacements": [ { "file": "path exactly as given", "from": "exact text that appears once in that file", "to": "replacement text" } ] }
Leave a bug out of "fixes" if you cannot fix it safely.`;

const REVIEW_PROMPT = `You review a code change that claims to fix reported bugs in a web app. The tests already pass with it.
Approve only if every change fixes faulty logic in a way that is right for all users.
Reject it if it changes existing product data, prices, stock or discount codes, special-cases test inputs, hides errors, or removes behaviour.
New validation or error messages are fine. Judge only whether the change is a correct fix, not whether a different design would be nicer.
Reply with a JSON object: { "approved": true | false, "reason": "one sentence" }`;

const BUG_FIX_ATTEMPTS = 3;

function sourceFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) {
            return name === "node_modules" ? [] : sourceFiles(full);
        }
        return /\.(html|jsx?|tsx?|vue)$/.test(name) ? [full] : [];
    });
}

export function appContext({ appDir, base }) {
    const ids = new Set();
    for (const file of sourceFiles(appDir)) {
        const text = readFileSync(file, "utf8");
        for (const match of text.matchAll(/data-testid=["']([^"']+)["']|testid\s*=\s*[`"']([^`"']+)[`"']/g)) {
            ids.add(match[1] || match[2]);
        }
    }

    let diff = "";
    try {
        diff = execFileSync("git", ["diff", base, "--", appDir], { encoding: "utf8" }).slice(0, 8000);
    } catch {
        diff = "(no diff available)";
    }
    return { testIds: [...ids].sort(), diff: diff || "(no changes to the app)", base };
}

function classifyError(message) {
    if (/element\(s\) not found|strict mode violation|resolved to 0 elements/.test(message)) {
        return "locator";
    }
    if (/^\w*Error: locator\.\w+: (Timeout|Test timeout)/m.test(message) && !/locator resolved to/.test(message)) {
        return "locator";
    }
    if (/^Error: expect\(/m.test(message)) {
        return "assertion";
    }
    return "other";
}

const titlesIn = (source) => [...source.matchAll(/\btest\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)].map((match) => match[1]).sort().join("\n");
const count = (source, pattern) => (source.match(pattern) || []).length;

function guardrailProblem(before, after) {
    if (count(after, /expect\(/g) < count(before, /expect\(/g)) {
        return "the fix removed assertions";
    }
    if (count(after, /\.(skip|fixme|fail|only)\(/g) > count(before, /\.(skip|fixme|fail|only)\(/g)) {
        return "the fix skipped or disabled tests";
    }
    if (titlesIn(before) !== titlesIn(after)) {
        return "the fix renamed or removed tests";
    }
    return null;
}

function rerun(test, reportFile, repeat) {
    const report = runPlaywright([`${test.file}:${test.line}`], { reportFile, repeat });
    return collectTests(report).find((candidate) => candidate.title === test.title)?.results || [];
}

function rerunByTitle(file, title, reportFile, repeat) {
    const report = runPlaywright([file], { reportFile, repeat });
    return collectTests(report).find((candidate) => candidate.title === title)?.results || [];
}

async function fixLocator({ test, source, error, context, reportFile }) {
    const reply = await chatJson(
        [
            { role: "system", content: LOCATOR_PROMPT },
            {
                role: "user",
                content: [
                    `Test file ${test.file}:\n${source}`,
                    `Failing test: ${test.title}`,
                    `Error:\n${error.slice(0, 2000)}`,
                    `Test ids in the app now:\n${context.testIds.join("\n")}`,
                    `App changes since ${context.base}:\n${context.diff}`,
                ].join("\n\n"),
            },
        ],
        { model: models.verify },
    );
    if (!reply.fixable || !reply.replacements?.length) {
        return { fixed: false, reason: reply.reason || "No equivalent element found." };
    }

    let patched = source;
    for (const { from, to } of reply.replacements) {
        if (!from || !patched.includes(from)) {
            return { fixed: false, reason: `Proposed change does not match the test file: ${from}` };
        }
        patched = patched.replaceAll(from, to);
    }
    const problem = guardrailProblem(source, patched);
    if (problem) {
        return { fixed: false, reason: `Rejected because ${problem}.` };
    }

    writeFileSync(test.file, patched);
    const results = rerun(test, reportFile, 3);
    const stillBroken = !results.length || results.some((result) => isFailure(result) && classifyError(result.error) === "locator");
    if (stillBroken) {
        writeFileSync(test.file, source);
        return { fixed: false, reason: "The repaired locator still did not find the element." };
    }
    const stillFailing = results.some(isFailure);
    return {
        fixed: true,
        reason: reply.reason,
        replacements: reply.replacements,
        note: stillFailing ? "The locator now works, but the test still fails on its assertion." : "The test passes again.",
        patched,
    };
}

async function fixFlaky({ test, source, results, reportFile }) {
    const passes = results.filter((result) => result.status === "passed").length;
    const errors = [...new Set(results.filter(isFailure).map((result) => result.error.split("\n").slice(0, 8).join("\n")))];
    const reply = await chatJson(
        [
            { role: "system", content: FLAKY_PROMPT },
            {
                role: "user",
                content: [
                    `Test file ${test.file}:\n${source}`,
                    `Flaky test: ${test.title}`,
                    `It passed ${passes} of ${results.length} reruns. Errors seen:\n${errors.join("\n---\n").slice(0, 3000)}`,
                ].join("\n\n"),
            },
        ],
        { model: models.verify },
    );
    const patched = String(reply.source || "");
    if (!patched.includes("@playwright/test")) {
        return { fixed: false, reason: "The model did not return a usable test file." };
    }
    const problem = guardrailProblem(source, patched);
    if (problem) {
        return { fixed: false, reason: `Rejected because ${problem}.` };
    }

    writeFileSync(test.file, patched);
    const proof = rerunByTitle(test.file, test.title, reportFile, FLAKY_PROOF_RUNS);
    if (proof.length < FLAKY_PROOF_RUNS || proof.some(isFailure)) {
        writeFileSync(test.file, source);
        return { fixed: false, reason: `The rewrite still failed ${proof.filter(isFailure).length} of ${proof.length} runs.` };
    }
    return { fixed: true, reason: reply.reason, note: `Passed ${FLAKY_PROOF_RUNS} of ${FLAKY_PROOF_RUNS} runs after the fix.`, patched };
}

async function explainRegression({ test, source, error, context }) {
    return chatJson(
        [
            { role: "system", content: REGRESSION_PROMPT },
            {
                role: "user",
                content: [
                    `Test file ${test.file}:\n${source}`,
                    `Failing test: ${test.title}`,
                    `Error:\n${error.slice(0, 2000)}`,
                    `App changes since ${context.base}:\n${context.diff}`,
                ].join("\n\n"),
            },
        ],
        { model: models.verify },
    );
}

export async function healTest({ test, context, reportFile, emit }) {
    const source = readFileSync(test.file, "utf8");
    const results = rerun(test, reportFile, RERUNS);
    const passes = results.filter((result) => result.status === "passed").length;
    const firstError = results.find(isFailure)?.error || test.results.find(isFailure)?.error || "";
    const outcome = { file: test.file, title: test.title, reruns: `${passes} of ${results.length} reruns passed` };
    emit({ type: "heal-rerun", title: test.title, passes, runs: results.length });

    if (passes > 0) {
        outcome.kind = "flaky";
        if (passes === results.length) {
            return { ...outcome, status: "unfixed", reason: "Failed in CI but passed every rerun. Not enough evidence to change it." };
        }
        const fix = await fixFlaky({ test, source, results, reportFile });
        return { ...outcome, status: fix.fixed ? "fixed" : "unfixed", ...fix };
    }

    const errorKind = classifyError(firstError);
    if (errorKind === "locator") {
        outcome.kind = "broken-locator";
        const fix = await fixLocator({ test, source, error: firstError, context, reportFile });
        if (fix.fixed) {
            return { ...outcome, status: "fixed", ...fix };
        }
        const explanation = await explainRegression({ test, source, error: firstError, context });
        return { ...outcome, kind: "regression", status: "flagged", reason: fix.reason, error: firstError.split("\n").slice(0, 8).join("\n"), ...explanation };
    }

    const isKnownBug = test.annotations.some((annotation) => annotation.type === "bug");
    if (isKnownBug && errorKind === "assertion") {
        const bug = test.annotations.find((annotation) => annotation.type === "bug");
        return {
            ...outcome,
            kind: "known-bug",
            status: "flagged",
            reason: "Guard test for a bug that is not fixed yet.",
            details: bug.description,
            error: firstError.split("\n").slice(0, 12).join("\n"),
        };
    }

    const explanation = await explainRegression({ test, source, error: firstError, context });
    return { ...outcome, kind: "regression", status: "flagged", error: firstError.split("\n").slice(0, 8).join("\n"), ...explanation };
}

const testKey = (test) => `${path.normalize(test.file)}|${test.title}`;

function applyReplacements(sources, replacements) {
    const patched = new Map(sources);
    for (const { file, from, to } of replacements) {
        const name = String(file || "").replaceAll("\\", "/");
        if (!patched.has(name)) {
            return { problem: `${file} is not one of the app's source files` };
        }
        if (!from || patched.get(name).split(from).length !== 2) {
            return { problem: `the text to replace does not appear exactly once in ${name}` };
        }
        patched.set(name, patched.get(name).replace(from, () => String(to ?? "")));
    }
    return { patched };
}

function bugFixRequest(bugs, sources, feedback) {
    const bugText = bugs.map((bug) =>
        [`### ${bug.title}`, `Bug report: ${bug.details}`, `Test ${bug.file}:\n${readFileSync(bug.file, "utf8")}`, `Error:\n${(bug.error || "").slice(0, 1500)}`].join("\n"),
    );
    const sourceText = [...sources].map(([file, text]) => `--- ${file}\n${text}`);
    return [`Bugs to fix:\n\n${bugText.join("\n\n")}`, `App source:\n\n${sourceText.join("\n\n")}`, feedback].filter(Boolean).join("\n\n");
}

async function reviewBugFix({ appDir, bugs }) {
    const diff = execFileSync("git", ["diff", "--", appDir], { encoding: "utf8" }).slice(0, 8000);
    return chatJson(
        [
            { role: "system", content: REVIEW_PROMPT },
            { role: "user", content: `Bug reports:\n${bugs.map((bug) => `- ${bug.title}: ${bug.details}`).join("\n")}\n\nChange:\n${diff}` },
        ],
        { model: models.verify },
    );
}

export async function fixBugs({ bugs, appDir, reportFile, allowedFailures, emit }) {
    const files = sourceFiles(appDir).map((file) => file.replaceAll("\\", "/"));
    const original = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
    let remaining = [...bugs];
    const fixes = [];
    let feedback = "";

    for (let attempt = 1; attempt <= BUG_FIX_ATTEMPTS && remaining.length; attempt += 1) {
        const sources = new Map(files.map((file) => [file, readFileSync(file, "utf8")]));
        let reply;
        try {
            reply = await chatJson(
                [
                    { role: "system", content: BUG_FIX_PROMPT },
                    { role: "user", content: bugFixRequest(remaining, sources, feedback) },
                ],
                { model: models.verify },
            );
        } catch (error) {
            emit({ type: "bug-fix-attempt", attempt, accepted: false, reason: error.message.split("\n")[0] });
            break;
        }
        const replacements = reply.replacements || [];
        const { patched, problem } = replacements.length ? applyReplacements(sources, replacements) : { problem: "it proposed no changes" };
        if (problem) {
            feedback = `Your previous answer was rejected because ${problem}. Try again.`;
            emit({ type: "bug-fix-attempt", attempt, accepted: false, reason: problem });
            continue;
        }

        for (const [file, text] of patched) {
            if (text !== sources.get(file)) {
                writeFileSync(file, text);
            }
        }
        const failingNow = collectTests(runPlaywright([], { reportFile, repeat: 2, freshServer: true })).filter((test) => test.results.some(isFailure));
        const failingKeys = new Set(failingNow.map(testKey));
        const fixedKeys = new Set(fixes.map(testKey));
        const broken = failingNow.filter((test) => !allowedFailures.has(testKey(test)) || fixedKeys.has(testKey(test)));
        const nowPassing = remaining.filter((bug) => !failingKeys.has(testKey(bug)));

        const review =
            broken.length || !nowPassing.length
                ? null
                : await reviewBugFix({ appDir, bugs: remaining }).catch((error) => ({ approved: false, failed: true, reason: error.message.split("\n")[0] }));
        if (broken.length || !nowPassing.length || !review.approved) {
            for (const [file, text] of sources) {
                writeFileSync(file, text);
            }
            const why = broken.length
                ? `it broke tests that passed before:\n${broken.map((test) => `${test.title}: ${test.results.find(isFailure).error.slice(0, 600)}`).join("\n")}`
                : review
                  ? `a code review rejected it: ${review.reason}`
                  : "none of the bug tests passed afterwards";
            feedback = `Your previous change was reverted because ${why}`;
            emit({ type: "bug-fix-attempt", attempt, accepted: false, reason: why.split("\n")[0] });
            if (review?.failed) {
                break;
            }
            continue;
        }

        for (const bug of nowPassing) {
            const explanation = (reply.fixes || []).find((fix) => fix.test === bug.title) || {};
            fixes.push({ file: bug.file, title: bug.title, cause: explanation.cause || "", change: explanation.change || "" });
        }
        remaining = remaining.filter((bug) => failingKeys.has(testKey(bug)));
        emit({ type: "bug-fix-attempt", attempt, accepted: true, fixed: nowPassing.length, remaining: remaining.length });
        feedback = remaining.length
            ? `Your change was kept. These tests still fail:\n${failingNow
                  .filter((test) => remaining.some((bug) => testKey(bug) === testKey(test)))
                  .map((test) => `${test.title}: ${test.results.find(isFailure).error.slice(0, 600)}`)
                  .join("\n")}`
            : "";
    }

    const changedFiles = files.filter((file) => readFileSync(file, "utf8") !== original.get(file));
    return { fixes, changedFiles };
}
