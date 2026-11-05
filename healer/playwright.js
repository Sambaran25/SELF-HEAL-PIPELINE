import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const CLI = path.join("node_modules", "@playwright", "test", "cli.js");

export const stripAnsi = (text) => String(text ?? "").replace(/\u001b\[[0-9;]*m/g, "");

export function runPlaywright(targets, { reportFile, repeat = 1, freshServer = false }) {
    rmSync(reportFile, { force: true });
    spawnSync(
        process.execPath,
        [CLI, "test", ...targets.map((target) => target.replaceAll("\\", "/")), "--reporter=json", `--repeat-each=${repeat}`, "--retries=0"],
        {
            env: {
                ...process.env,
                PLAYWRIGHT_JSON_OUTPUT_FILE: reportFile,
                PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile,
                ...(freshServer ? { FRESH_SERVER: "1" } : {}),
            },
            encoding: "utf8",
        },
    );
    if (!existsSync(reportFile)) {
        throw new Error("Playwright produced no report.");
    }
    return JSON.parse(readFileSync(reportFile, "utf8"));
}

export function collectTests(report) {
    const rootDir = report.config?.rootDir || "tests";
    const tests = [];

    const visit = (suite) => {
        for (const spec of suite.specs || []) {
            for (const test of spec.tests || []) {
                tests.push({
                    file: path.relative(process.cwd(), path.join(rootDir, spec.file)),
                    line: spec.line,
                    title: spec.title,
                    annotations: test.annotations || [],
                    results: (test.results || []).map((result) => ({
                        status: result.status,
                        error: stripAnsi((result.errors || []).map((error) => error.message).join("\n")),
                    })),
                });
            }
        }
        (suite.suites || []).forEach(visit);
    };
    (report.suites || []).forEach(visit);

    const byTest = new Map();
    for (const test of tests) {
        const key = `${test.file}:${test.line}`;
        if (byTest.has(key)) {
            byTest.get(key).results.push(...test.results);
        } else {
            byTest.set(key, test);
        }
    }
    return [...byTest.values()];
}

export const isFailure = (result) => result.status === "failed" || result.status === "timedOut";
