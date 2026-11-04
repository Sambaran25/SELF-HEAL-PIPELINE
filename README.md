# SELF-HEAL-PIPELINE

AI agents that **find** bugs, **guard** against them with tests, and **heal** failing CI runs.

1. **Find:** a swarm of AI "users" explores a web app with Playwright and records any bugs it finds.
2. **Guard:** each bug becomes a Playwright regression test, added to CI through a pull request.
3. **Heal:** when CI fails, an AI healer decides whether the failure is a flaky test, a broken locator, or a real regression. It fixes the first two and flags the third.

## Project layout

| Folder | What lives there |
|---|---|
| `demo-app/` | A small web shop with deliberately planted bugs |
| `swarm/` | The bug-hunting agents |
| `healer/` | The CI failure healer |
| `dashboard/` | The live view of hunting and healing |
| `.github/workflows/` | The CI pipeline |

## Setup

1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env` and add your OpenAI API key.
3. Run `npm install`, then `npx playwright install chromium`.
4. Run `npm run demo` and open http://localhost:3000 to see the demo shop. Set `PORT` to use a different port.

## Hunting for bugs

Run `npm run swarm`. It starts the demo shop on port 3100 and sends every persona in `swarm/personas.js` to explore it in parallel. When they finish, every report is replayed in a fresh browser and checked by a stronger model, and duplicates are merged. `OPENAI_MODEL` picks the exploring model and `OPENAI_VERIFY_MODEL` picks the checking model.

Each run writes to `runs/<time>/`:

- `bugs.json` lists each confirmed, unique bug with the shortest steps that reproduce it, plus the rejected reports and why they were rejected.
- `events.jsonl` logs every decision the agents made.
- One screenshot per bug.

Options: `--personas searcher,bulk-buyer` runs only some personas, `--steps 40` changes how many actions each persona takes (default 25), `--headed` shows the browser, and `--url http://...` tests an app that is already running.
