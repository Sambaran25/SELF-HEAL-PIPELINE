import path from "node:path";
import { chatJson } from "./llm.js";

const HISTORY_LIMIT = 12;

const SYSTEM_PROMPT = `You are testing a web shop by acting as a real user. Your job is to find bugs.

Each turn you get the visible page text, a numbered list of elements you can use, and any errors seen since your last action.
Reply with a JSON object:
{
  "thought": "one short sentence about what you are checking",
  "action": "click" | "fill" | "report_bug" | "done",
  "ref": <element number, for click and fill>,
  "text": "<text to type, for fill>",
  "bug": { "title": "...", "expected": "...", "actual": "..." }
}

Rules:
- Only report a bug you have seen with your own eyes on this page: wrong numbers, wrong items, missing results, error messages, or the app accepting something it should reject.
- Check the maths yourself. Do not assume the page is right.
- Do not report the same problem twice. Do not report missing features or design opinions.
- Use "done" when you have nothing useful left to try.`;

async function observe(page) {
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

function describe(observation, problems, history, reported) {
    const elements = observation.elements
        .map((element, index) => {
            const value = element.value !== undefined ? ` (current value: "${element.value}")` : "";
            return `${index}: ${element.kind} "${element.label}"${value}`;
        })
        .join("\n");

    return [
        `Page text:\n${observation.text}`,
        `Elements:\n${elements}`,
        `Errors since your last action:\n${problems.length ? problems.join("\n") : "none"}`,
        `Your recent actions:\n${history.length ? history.slice(-HISTORY_LIMIT).join("\n") : "none yet"}`,
        `Bugs you already reported:\n${reported.length ? reported.map((bug) => `- ${bug.title}`).join("\n") : "none"}`,
    ].join("\n\n");
}

export async function runPersona({ browser, baseUrl, persona, maxSteps, runDir, emit }) {
    const context = await browser.newContext();
    const page = await context.newPage();

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

    const steps = [];
    const history = [];
    const bugs = [];

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    emit({ type: "persona-started", persona: persona.id });

    try {
        for (let turn = 1; turn <= maxSteps; turn++) {
            const observation = await observe(page);
            const prompt = describe(observation, problems.splice(0), history, bugs);

            const decision = await chatJson([
                { role: "system", content: `${SYSTEM_PROMPT}\n\nWho you are: ${persona.description}` },
                { role: "user", content: prompt },
            ]);
            emit({ type: "decision", persona: persona.id, turn, thought: decision.thought, action: decision.action });

            if (decision.action === "done") {
                break;
            }

            if (decision.action === "report_bug" && decision.bug?.title) {
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
                emit({ type: "bug-found", persona: persona.id, bug });
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
            }

            try {
                const target = page.locator(element.locator);
                if (step.action === "click") {
                    await target.click({ timeout: 5000 });
                } else {
                    await target.fill(step.text, { timeout: 5000 });
                }
                await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
                steps.push(step);
                history.push(step.action === "fill" ? `Typed "${step.text}" into "${step.label}"` : `Clicked "${step.label}"`);
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
