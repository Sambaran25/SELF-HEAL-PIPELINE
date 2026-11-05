const $ = (id) => document.getElementById(id);
const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const titleCase = (id) => id.replace(/-/g, " ").replace(/^\w/, (char) => char.toUpperCase());

const HEAL_LABELS = {
    flaky: "Flaky test",
    "broken-locator": "Broken locator",
    regression: "Real regression",
    "known-bug": "Known bug",
    "bug-fix": "Bug fixed in the app",
};

let state;
let runId;
let cursor = 0;
let pollTimer;
let replayTimer;

function resetState() {
    state = { personas: new Map(), reports: new Map(), order: [], finished: false };
}

function persona(id) {
    if (!state.personas.has(id)) {
        state.personas.set(id, { id, status: "waiting", turns: 0, thought: "", reports: 0, image: null });
    }
    return state.personas.get(id);
}

function apply(event, { live }) {
    if (event.type === "run-started") {
        event.personas.forEach(persona);
    } else if (event.type === "persona-started") {
        const entry = persona(event.persona);
        entry.status = "exploring";
        if (live) {
            entry.image = `/files/${runId}/live/${event.persona}.jpg`;
        }
    } else if (event.type === "decision") {
        const entry = persona(event.persona);
        entry.turns = event.turn;
        entry.thought = event.thought;
    } else if (event.type === "bug-reported") {
        const entry = persona(event.persona);
        entry.reports += 1;
        entry.bugImage = `/files/${runId}/${event.bug.screenshot}`;
        state.reports.set(event.bug.id, { bug: event.bug, verdict: null });
        state.order.unshift(event.bug.id);
    } else if (event.type === "persona-finished") {
        persona(event.persona).status = "finished";
    } else if (event.type === "persona-error") {
        const entry = persona(event.persona);
        entry.status = "stopped";
        entry.thought = event.error;
    } else if (event.type === "bug-verified") {
        const report = state.reports.get(event.bugId);
        if (report) {
            report.verdict = { confirmed: event.confirmed, reason: event.reason };
        }
    } else if (event.type === "run-finished") {
        state.finished = true;
    }
}

function render() {
    $("personas").innerHTML = [...state.personas.values()]
        .map((entry) => {
            const stamp = entry.status === "exploring" ? `?t=${Date.now()}` : "";
            const source = entry.image ? `${entry.image}${stamp}` : entry.bugImage;
            const fallback = entry.image && entry.bugImage ? `this.onerror=null;this.src='${entry.bugImage}'` : "this.replaceWith(Object.assign(document.createElement('div'), { className: 'placeholder', textContent: 'No screenshot yet' }))";
            const image = source
                ? `<img src="${source}" alt="${escape(titleCase(entry.id))}'s browser" onerror="${fallback}">`
                : `<div class="placeholder">${entry.status === "waiting" ? "Waiting to start" : "Exploring…"}</div>`;
            return `<article class="persona">
                ${image}
                <div class="body">
                    <div class="name">${escape(titleCase(entry.id))}<span class="state ${entry.status === "exploring" ? "active" : ""}">${entry.status}</span></div>
                    <p class="thought">${escape(entry.thought)}</p>
                    <div class="stats">${entry.turns} actions · ${entry.reports} bug reports</div>
                </div>
            </article>`;
        })
        .join("");

    const reports = [...state.reports.values()];
    $("count-reported").textContent = reports.length;
    $("count-confirmed").textContent = reports.filter((report) => report.verdict?.confirmed).length;
    $("count-rejected").textContent = reports.filter((report) => report.verdict && !report.verdict.confirmed).length;

    $("verdicts").innerHTML = state.order.length
        ? state.order
              .map((id) => {
                  const { bug, verdict } = state.reports.get(id);
                  const label = verdict ? (verdict.confirmed ? "Confirmed" : "Rejected") : "Reported, waiting for replay";
                  const css = verdict ? (verdict.confirmed ? "good" : "dim") : "";
                  return `<li class="${css}"><strong>${label}:</strong> ${escape(bug.title)}<span class="meta">${escape(titleCase(bug.persona))}${verdict ? ` · ${escape(verdict.reason)}` : ""}</span></li>`;
              })
              .join("")
        : `<li class="muted">No reports yet.</li>`;
}

async function loadResults() {
    const { bugs, guard } = await (await fetch(`/api/runs/${runId}/results`)).json();
    if (bugs) {
        $("count-unique").textContent = bugs.bugs.length;
        $("bugs").innerHTML = bugs.bugs
            .map((bug) => {
                const duplicates = bug.duplicates?.length ? ` · merged ${bug.duplicates.length} duplicate reports` : "";
                return `<li class="bad"><strong>${escape(bug.title)}</strong><span class="meta">Expected: ${escape(bug.expected)}<br>Actual: ${escape(bug.actual)}<br>${bug.steps.length} steps to reproduce${duplicates}</span></li>`;
            })
            .join("");
    }
    if (guard) {
        $("guard").innerHTML = guard.outcomes
            .map((outcome) => {
                if (outcome.accepted) {
                    return `<li class="good"><strong>Test written:</strong> ${escape(outcome.title)}<span class="meta"><code>${escape(outcome.file)}</code> · ${outcome.steps} steps · fails on today's code, as it should</span></li>`;
                }
                const label = outcome.dismissed ? "Dismissed in review" : "No test";
                return `<li class="dim"><strong>${label}:</strong> ${escape(outcome.bug?.title || outcome.bugId)}<span class="meta">${escape(outcome.reason)}</span></li>`;
            })
            .join("");
    }
}

async function loadHeal() {
    const { report } = await (await fetch("/api/heal")).json();
    if (!report) {
        return;
    }
    $("heal").querySelector("tbody").innerHTML = report.outcomes.length
        ? report.outcomes
              .map((outcome) => {
                  const details = outcome.status === "fixed" ? `${outcome.reason} ${outcome.note || ""}` : outcome.summary || outcome.reason || "";
                  const cause = outcome.likely_cause ? `<span class="meta">Likely cause: ${escape(outcome.likely_cause)}</span>` : "";
                  return `<tr><td><span class="tag ${outcome.status}">${outcome.status}</span></td><td>${HEAL_LABELS[outcome.kind] || outcome.kind}</td><td>${escape(outcome.title)}<span class="meta">${escape(outcome.reruns || "")}</span></td><td>${escape(details)}${cause}</td></tr>`;
              })
              .join("")
        : `<tr><td colspan="4" class="muted">No failing tests.</td></tr>`;
}

function setMode(mode) {
    $("mode").textContent = { live: "● Live", replay: "▶ Replay", finished: "Finished" }[mode];
    $("mode").className = `badge ${mode}`;
}

async function poll() {
    const { events, next } = await (await fetch(`/api/runs/${runId}/events?from=${cursor}`)).json();
    cursor = next;
    events.forEach((event) => apply(event, { live: true }));
    render();
    if (state.finished) {
        clearInterval(pollTimer);
        setMode("finished");
        loadResults();
    }
}

async function openRun(id) {
    clearInterval(pollTimer);
    clearTimeout(replayTimer);
    replaying = false;
    runId = id;
    cursor = 0;
    resetState();
    $("count-unique").textContent = "–";
    $("bugs").innerHTML = `<li class="muted">Appears when the run finishes.</li>`;
    $("guard").innerHTML = `<li class="muted">Run <code>npm run guard</code> to turn this run's bugs into tests.</li>`;
    await poll();
    if (!state.finished) {
        setMode("live");
        pollTimer = setInterval(poll, 1000);
    }
}

async function replay() {
    clearInterval(pollTimer);
    clearTimeout(replayTimer);
    const { events } = await (await fetch(`/api/runs/${runId}/events`)).json();
    replaying = true;
    resetState();
    $("count-unique").textContent = "–";
    $("bugs").innerHTML = `<li class="muted">Appears when the run finishes.</li>`;
    setMode("replay");
    const speed = Number($("speed").value);

    let index = 0;
    const step = () => {
        const event = events[index];
        apply(event, { live: false });
        render();
        index += 1;
        if (index >= events.length) {
            replaying = false;
            setMode("finished");
            loadResults();
            return;
        }
        const gap = new Date(events[index].time) - new Date(event.time);
        replayTimer = setTimeout(step, Math.min(Math.max(gap / speed, 30), 1500));
    };
    step();
}

let knownRuns = [];
let replaying = false;

function fillRunSelect(runs) {
    knownRuns = runs;
    $("run-select").innerHTML = runs.map((id) => `<option value="${id}"${id === runId ? " selected" : ""}>${id.replace("T", " ").slice(0, 19)}</option>`).join("");
}

async function watchForNewRuns() {
    const runs = await (await fetch("/api/runs")).json();
    if (runs[0] && runs[0] !== knownRuns[0]) {
        fillRunSelect(runs);
        if (!replaying) {
            await openRun(runs[0]);
            fillRunSelect(runs);
        }
    }
}

async function start() {
    const runs = await (await fetch("/api/runs")).json();
    fillRunSelect(runs);
    setInterval(watchForNewRuns, 3000);
    $("run-select").addEventListener("change", (event) => openRun(event.target.value));
    $("replay").addEventListener("click", replay);
    if (runs.length) {
        await openRun(runs[0]);
        fillRunSelect(runs);
    }
    loadHeal();
    setInterval(loadHeal, 3000);
}

start();
