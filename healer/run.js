import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { appContext, healTest } from "./heal.js";
import { collectTests, isFailure, runPlaywright } from "./playwright.js";

const { values: args } = parseArgs({
    options: {
        results: { type: "string" },
        base: { type: "string" },
        app: { type: "string", default: "demo-app" },
        publish: { type: "boolean", default: false },
    },
});

const REPORT_DIR = "reports";
mkdirSync(REPORT_DIR, { recursive: true });
const reportFile = path.join(REPORT_DIR, "heal-rerun.json");
const eventsFile = path.join(REPORT_DIR, "heal-events.jsonl");
writeFileSync(eventsFile, "");

function emit(event) {
    appendFileSync(eventsFile, `${JSON.stringify({ time: new Date().toISOString(), ...event })}\n`);
}

const run = (command, commandArgs) => execFileSync(command, commandArgs, { encoding: "utf8" }).trim();
const currentBranch = () => process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const defaultBase = () => (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1");

function pullRequestNumber() {
    if (!process.env.GITHUB_EVENT_PATH) {
        return null;
    }
    return JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")).pull_request?.number ?? null;
}

const LABELS = {
    flaky: "Flaky test",
    "broken-locator": "Broken locator",
    regression: "Real regression",
    "known-bug": "Known bug, not fixed yet",
};

function summaryMarkdown(outcomes, links) {
    const icon = { fixed: "✅", flagged: "🚩", unfixed: "⚠️" };
    const rows = outcomes.map((outcome) => {
        const detail = outcome.status === "fixed" ? `${outcome.reason} ${outcome.note || ""}` : outcome.summary || outcome.reason || "";
        return `| ${icon[outcome.status]} ${outcome.status} | ${LABELS[outcome.kind]} | ${outcome.title} | ${detail.replace(/\|/g, "\\|").replace(/\n/g, " ")} |`;
    });
    return [
        "## Self-heal report",
        "",
        outcomes.length ? "| Result | Diagnosis | Test | Details |\n|---|---|---|---|\n" + rows.join("\n") : "No failing tests.",
        "",
        ...links,
    ].join("\n");
}

function regressionMarkdown(outcome) {
    return [
        `**${LABELS[outcome.kind]}:** \`${outcome.title}\` in \`${outcome.file.replaceAll("\\", "/")}\``,
        "",
        outcome.summary ? `- **What broke:** ${outcome.summary}` : "",
        outcome.likely_cause ? `- **Likely cause:** ${outcome.likely_cause}` : "",
        outcome.suggested_fix ? `- **Suggested fix:** ${outcome.suggested_fix}` : "",
        `- **Reruns:** ${outcome.reruns}, so this is not flakiness.`,
        outcome.error ? `\n\`\`\`\n${outcome.error}\n\`\`\`` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

function publishFixes(fixes) {
    const branch = currentBranch();
    const healBranch = `heal/${process.env.GITHUB_RUN_ID || Date.now()}`;
    run("git", ["config", "user.name", "self-heal-bot"]);
    run("git", ["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"]);
    run("git", ["switch", "-c", healBranch]);
    run("git", ["add", ...new Set(fixes.map((fix) => fix.file))]);
    run("git", ["commit", "-m", `Heal ${fixes.length} failing test(s)`]);
    run("git", ["push", "-u", "origin", healBranch]);

    const body = [
        `The healer repaired ${fixes.length} test(s) that failed for reasons other than a real bug. Each fix was verified by rerunning the test before this pull request was opened.`,
        "",
        ...fixes.map((fix) => `- **${LABELS[fix.kind]}:** \`${fix.title}\`. ${fix.reason} ${fix.note || ""}`),
        "",
        "The healer is not allowed to remove assertions, skip tests or rename them.",
    ].join("\n");
    const url = run("gh", ["pr", "create", "--base", branch, "--head", healBranch, "--title", `Heal ${fixes.length} failing test(s)`, "--body", body]);
    try {
        run("gh", ["workflow", "run", "ci.yml", "--ref", healBranch]);
    } catch (error) {
        console.log(`Could not start CI on ${healBranch}: ${error.message.split("\n")[0]}`);
    }
    return url;
}

function publishRegressions(regressions) {
    const number = pullRequestNumber();
    const body = regressions.map(regressionMarkdown).join("\n\n---\n\n");
    if (number) {
        run("gh", ["pr", "comment", String(number), "--body", `## 🚩 The healer found real regressions\n\nThese failures are consistent and were not changed.\n\n${body}`]);
        return `Commented on pull request #${number}`;
    }

    const links = [];
    for (const regression of regressions) {
        const title = `Regression: ${regression.title}`;
        const open = run("gh", ["issue", "list", "--state", "open", "--search", `"${title}" in:title`, "--json", "number"]);
        if (JSON.parse(open).length) {
            continue;
        }
        links.push(run("gh", ["issue", "create", "--title", title, "--body", regressionMarkdown(regression)]));
    }
    return links.length ? `Opened ${links.join(", ")}` : "Matching issues are already open.";
}

if (args.publish && currentBranch().startsWith("heal/")) {
    console.log("Skipping: this branch was created by the healer.");
    process.exit(0);
}

const report = args.results && existsSync(args.results) ? JSON.parse(readFileSync(args.results, "utf8")) : runPlaywright([], { reportFile });
const failing = collectTests(report).filter((test) => test.results.some(isFailure));
console.log(`${failing.length} failing test(s).`);
emit({ type: "heal-started", failing: failing.length });

const context = appContext({ appDir: args.app, base: args.base || defaultBase() });
const outcomes = [];
const patchedFiles = new Map();

for (const test of failing) {
    console.log(`\n- ${test.title} (${test.file})`);
    let outcome;
    if (patchedFiles.has(test.file)) {
        const recheck = collectTests(runPlaywright([`${test.file}:${test.line}`], { reportFile })).find((candidate) => candidate.title === test.title);
        if (recheck && !recheck.results.some(isFailure)) {
            const earlier = patchedFiles.get(test.file);
            outcome = { file: test.file, title: test.title, kind: earlier.kind, status: "fixed", reason: "Fixed by the change already made to this file.", note: "The test passes again." };
        }
    }
    outcome ??= await healTest({ test, context, reportFile, emit });
    if (outcome.status === "fixed") {
        patchedFiles.set(test.file, outcome);
    }
    delete outcome.patched;
    outcomes.push(outcome);
    emit({ type: "heal-outcome", ...outcome });
    console.log(`  ${outcome.status}: ${LABELS[outcome.kind]}. ${outcome.reason || outcome.summary || ""}`);
}

const links = [];
if (args.publish) {
    const fixes = outcomes.filter((outcome) => outcome.status === "fixed");
    const regressions = outcomes.filter((outcome) => outcome.kind === "regression");
    if (fixes.length) {
        links.push(`Fix pull request: ${publishFixes(fixes)}`);
    }
    if (regressions.length) {
        links.push(publishRegressions(regressions));
    }
}

writeFileSync(path.join(REPORT_DIR, "heal.json"), `${JSON.stringify({ outcomes, links }, null, 4)}\n`);
const summary = summaryMarkdown(outcomes, links);
if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
}
emit({ type: "heal-finished", outcomes: outcomes.length });
console.log(`\n${summary}`);
