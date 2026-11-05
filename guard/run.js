import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { startDemoApp } from "../demo-app/start.js";
import { checkFailsOnBug, minimizeSteps, renderTest, shrinkSteps, writeAssertions } from "./guard.js";

const { values: args } = parseArgs({
    options: {
        bugs: { type: "string" },
        pr: { type: "boolean", default: false },
        skip: { type: "string", default: "" },
    },
});

const DEMO_PORT = 3200;
const TEST_DIR = path.join("tests", "regression");
const MAX_ATTEMPTS = 2;

function latestBugsFile() {
    const runs = existsSync("runs") ? readdirSync("runs").filter((name) => existsSync(path.join("runs", name, "bugs.json"))) : [];
    if (!runs.length) {
        throw new Error("No swarm results found. Run `npm run swarm` first, or pass --bugs <path>.");
    }
    return path.join("runs", runs.sort().at(-1), "bugs.json");
}

function fileNameFor(title) {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "bug";
    let name = `${slug}.spec.js`;
    for (let n = 2; existsSync(path.join(TEST_DIR, name)); n++) {
        name = `${slug}-${n}.spec.js`;
    }
    return name;
}

function git(...gitArgs) {
    return execFileSync("git", gitArgs, { encoding: "utf8" }).trim();
}

function openPullRequest(runId, accepted) {
    const original = git("rev-parse", "--abbrev-ref", "HEAD");
    const branch = `guard/${runId}`;
    const files = accepted.map((entry) => entry.file);

    git("switch", "-c", branch);
    try {
        git("add", ...files);
        git("commit", "-m", `Add ${accepted.length} regression test(s) for bugs found by the swarm`);
        git("push", "-u", "origin", branch);

        const body = [
            "These tests were written by the Guard step from bugs the swarm confirmed. Each one fails on the current code and should pass once its bug is fixed.",
            "",
            ...accepted.map((entry) => `- \`${entry.file.replaceAll("\\", "/")}\`: ${entry.title} (expected: ${entry.bug.expected}; actual: ${entry.bug.actual})`),
        ].join("\n");
        const url = execFileSync("gh", ["pr", "create", "--base", original, "--head", branch, "--title", `Regression tests for ${accepted.length} swarm bug(s)`, "--body", body], {
            encoding: "utf8",
        }).trim();
        return url;
    } finally {
        git("switch", original);
    }
}

const bugsFile = args.bugs || latestBugsFile();
const runDir = path.dirname(bugsFile);
const guardFile = path.join(runDir, "guard.json");
const { runId, bugs } = JSON.parse(readFileSync(bugsFile, "utf8"));

const previous = existsSync(guardFile) ? JSON.parse(readFileSync(guardFile, "utf8")).outcomes : [];
const alreadyGuarded = previous.filter((outcome) => outcome.accepted && existsSync(outcome.file));
const skipIds = args.skip
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => (/^\d+$/.test(token) ? bugs[Number(token) - 1]?.id : token));
const dismissed = [
    ...previous.filter((outcome) => outcome.dismissed),
    ...bugs
        .filter((bug) => skipIds.includes(bug.id) && !previous.some((outcome) => outcome.bugId === bug.id && outcome.dismissed))
        .map((bug) => ({ bugId: bug.id, bug, dismissed: true, reason: "Skipped in review." })),
];
const settled = [...alreadyGuarded, ...dismissed];
const todo = bugs.filter((bug) => !settled.some((outcome) => outcome.bugId === bug.id));
console.log(`Guarding ${todo.length} bug(s) from ${bugsFile} (${alreadyGuarded.length} already have a test, ${dismissed.length} dismissed in review)\n`);

mkdirSync(TEST_DIR, { recursive: true });
const demo = todo.length ? await startDemoApp(DEMO_PORT) : null;
const browser = todo.length ? await chromium.launch() : null;
const outcomes = [...settled];

try {
    for (const bug of todo) {
        console.log(`- ${bug.title}`);
        const outcome = { bugId: bug.id, bug };
        let unfinished;
        try {
            const steps = await minimizeSteps({ browser, baseUrl: demo.baseUrl, bug });
            console.log(`    steps: ${bug.steps.length} -> ${steps.length}`);

            let feedback;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                const { title, assertions } = await writeAssertions({ browser, baseUrl: demo.baseUrl, bug, steps, feedback });
                const file = path.join(TEST_DIR, fileNameFor(title));
                writeFileSync(file, renderTest({ bug, steps, title, assertions }));
                unfinished = file;

                const reportFile = path.join(runDir, "guard-check.json");
                const check = checkFailsOnBug(file, reportFile);
                if (check.ok) {
                    const shrunk = await shrinkSteps({ browser, baseUrl: demo.baseUrl, file, reportFile, bug, steps, title, assertions, signature: check.signature });
                    const final = checkFailsOnBug(file, reportFile);
                    if (!final.ok) {
                        writeFileSync(file, renderTest({ bug, steps, title, assertions }));
                    }
                    const kept = final.ok ? shrunk : steps;
                    Object.assign(outcome, { accepted: true, file, title, steps: kept.length, failure: (final.ok ? final : check).failure });
                    console.log(`    accepted with ${kept.length} step(s): ${file}`);
                    unfinished = null;
                    break;
                }

                rmSync(file);
                unfinished = null;
                Object.assign(outcome, { accepted: false, reason: check.reason });
                console.log(`    attempt ${attempt} rejected: ${check.reason.split("\n")[0]}`);
                if (!check.retry) {
                    break;
                }
                feedback = `${check.reason} Your assertions were:\n${assertions.join("\n")}`;
            }
        } catch (error) {
            if (unfinished) {
                rmSync(unfinished, { force: true });
            }
            Object.assign(outcome, { accepted: false, reason: error.message });
            console.log(`    skipped: ${error.message.split("\n")[0]}`);
        }
        outcomes.push(outcome);
    }
} finally {
    await browser?.close();
    demo?.server.kill();
    rmSync(path.join(runDir, "guard-check.json"), { force: true });
}

const accepted = outcomes.filter((outcome) => outcome.accepted);
writeFileSync(guardFile, `${JSON.stringify({ runId, outcomes }, null, 4)}\n`);
console.log(`\n${accepted.length} of ${bugs.length} bug(s) now have a regression test. Details in ${guardFile}`);

if (args.pr && accepted.length) {
    console.log(`Pull request: ${openPullRequest(runId, accepted)}`);
}
