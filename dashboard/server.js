import express from "express";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = path.resolve("runs");
const REPORTS_DIR = path.resolve("reports");
const port = Number(process.env.DASHBOARD_PORT) || 4000;
const app = express();

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
const readLines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
const runDir = (id) => {
    const dir = path.join(RUNS_DIR, path.basename(id));
    return existsSync(dir) ? dir : null;
};

app.use(express.static(path.join(here, "public")));
app.use("/files", express.static(RUNS_DIR, { maxAge: 0 }));

app.get("/api/runs", (req, res) => {
    const runs = existsSync(RUNS_DIR)
        ? readdirSync(RUNS_DIR)
              .filter((name) => existsSync(path.join(RUNS_DIR, name, "events.jsonl")))
              .sort()
              .reverse()
        : [];
    res.json(runs);
});

app.get("/api/runs/:id/events", (req, res) => {
    const dir = runDir(req.params.id);
    if (!dir) {
        return res.status(404).json({ error: "Unknown run." });
    }
    const from = Number(req.query.from) || 0;
    const events = readLines(path.join(dir, "events.jsonl"));
    res.json({ events: events.slice(from), next: events.length });
});

app.get("/api/runs/:id/results", (req, res) => {
    const dir = runDir(req.params.id);
    if (!dir) {
        return res.status(404).json({ error: "Unknown run." });
    }
    res.json({ bugs: readJson(path.join(dir, "bugs.json")), guard: readJson(path.join(dir, "guard.json")) });
});

app.get("/api/heal", (req, res) => {
    res.json({ report: readJson(path.join(REPORTS_DIR, "heal.json")), events: readLines(path.join(REPORTS_DIR, "heal-events.jsonl")) });
});

app.listen(port, () => {
    console.log(`Dashboard running at http://localhost:${port}`);
});
