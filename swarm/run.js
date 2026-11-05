import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { startDemoApp } from "../demo-app/start.js";
import { groupBugs, runPersona, verifyBug } from "./agent.js";
import { personas } from "./personas.js";

const { values: args } = parseArgs({
    options: {
        url: { type: "string" },
        personas: { type: "string" },
        steps: { type: "string", default: "25" },
        headed: { type: "boolean", default: false },
    },
});

const DEMO_PORT = 3100;

function pickPersonas() {
    if (!args.personas) {
        return personas;
    }
    const wanted = args.personas.split(",").map((id) => id.trim());
    const unknown = wanted.filter((id) => !personas.some((persona) => persona.id === id));
    if (unknown.length) {
        throw new Error(`Unknown persona(s): ${unknown.join(", ")}. Choose from: ${personas.map((p) => p.id).join(", ")}.`);
    }
    return personas.filter((persona) => wanted.includes(persona.id));
}

const chosen = pickPersonas();
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const runDir = path.join("runs", runId);
mkdirSync(runDir, { recursive: true });

const eventsFile = path.join(runDir, "events.jsonl");
function emit(event) {
    const entry = { time: new Date().toISOString(), ...event };
    appendFileSync(eventsFile, `${JSON.stringify(entry)}\n`);

    if (event.type === "decision") {
        console.log(`[${event.persona}] ${event.turn}. ${event.action}: ${event.thought}`);
    } else if (event.type === "bug-reported") {
        console.log(`[${event.persona}] reported: ${event.bug.title}`);
    } else if (event.type === "bug-verified") {
        console.log(`[verify] ${event.confirmed ? "CONFIRMED" : "rejected"} ${event.bugId}: ${event.reason}`);
    } else if (event.type === "persona-error") {
        console.error(`[${event.persona}] stopped: ${event.error}`);
    }
}

const demo = args.url ? null : await startDemoApp(DEMO_PORT);
const baseUrl = args.url || demo.baseUrl;
const browser = await chromium.launch({ headless: !args.headed });

try {
    emit({ type: "run-started", runId, baseUrl, personas: chosen.map((persona) => persona.id) });

    const results = await Promise.all(
        chosen.map((persona) =>
            runPersona({ browser, baseUrl, persona, maxSteps: Number(args.steps), runDir, emit }),
        ),
    );
    const reports = results.flat();

    console.log(`\nReplaying ${reports.length} report(s) in a fresh browser to confirm them...`);
    const verdicts = await Promise.all(
        reports.map(async (bug) => {
            const verdict = await verifyBug({ browser, baseUrl, bug });
            emit({ type: "bug-verified", bugId: bug.id, ...verdict });
            return { ...bug, verification: verdict.reason, confirmed: verdict.confirmed };
        }),
    );
    const confirmed = verdicts.filter((bug) => bug.confirmed);
    const rejected = verdicts.filter((bug) => !bug.confirmed);
    const bugs = await groupBugs(confirmed);

    writeFileSync(path.join(runDir, "bugs.json"), `${JSON.stringify({ runId, baseUrl, bugs, rejected }, null, 4)}\n`);
    emit({ type: "run-finished", runId, bugs: bugs.length, confirmed: confirmed.length, rejected: rejected.length });

    console.log(`\n${confirmed.length} confirmed, ${rejected.length} rejected, ${bugs.length} unique bug(s). Saved to ${path.join(runDir, "bugs.json")}`);
    for (const [index, bug] of bugs.entries()) {
        const extra = bug.duplicates.length ? ` (+${bug.duplicates.length} duplicate reports)` : "";
        console.log(`${index + 1}. ${bug.title}: ${bug.steps.length} step(s)${extra}`);
    }
    console.log("\nTo leave bugs out of Guard, pass their numbers: npm run guard -- --pr --skip 2,5");
} finally {
    await browser.close();
    demo?.server.kill();
}
