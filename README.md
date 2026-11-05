# Antibody

An immune system for your app: AI agents that **find** bugs, **guard** against them with tests, and **heal** failing CI runs.

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

## Dashboard

Run `npm run dashboard` and open http://localhost:4000. It follows the newest swarm run live, with each persona's browser, the verifier's verdicts and the unique bugs, then shows Guard's tests and the healer's latest results. Pick an older run and press **Replay run** to play it back at 5 to 20 times speed.

## Turning bugs into tests

Run `npm run guard`. It reads the newest `runs/*/bugs.json` (or the file given with `--bugs <path>`) and, for each bug:

1. Shortens the steps and replays them to check the bug still shows.
2. Writes a Playwright test in `tests/regression/` that asserts the correct behaviour.
3. Runs the test against the current app. It is kept only if it fails twice in the same way on an assertion, so it really catches the bug.
4. Removes every step the failure does not depend on.

Results go to `guard.json` next to the bugs file. Running Guard again retries only the bugs that have no test yet. To drop a test for good, delete it and set `"dismissed": true` on its entry in `guard.json`. Add `--pr` to commit the new tests on a `guard/<run>` branch and open a pull request for review.

Run the tests with `npm test`. They fail until their bugs are fixed.

## CI

`.github/workflows/ci.yml` runs the tests on every push to `main` and on every pull request, retrying each failing test twice. It then runs the healer, uploads a `playwright-report` artifact (HTML report, traces and `reports/`), and fails the run if any test failed. The healer never turns a red run green.

CI needs an `OPENAI_API_KEY` repository secret, and **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** turned on.

## Healing failing tests

The healer reruns every failing or flaky test 10 times, then decides what kind of failure it is:

| Diagnosis | How it is detected | What the healer does |
|---|---|---|
| Flaky test | Passes on some reruns | Rewrites the waiting logic, then requires 8 passes out of 8 |
| Broken locator | "Element not found", every time | Maps the old test id to the new one using the app's code changes, then reruns |
| Real regression | Fails on a value, every time | Leaves the test alone and explains the likely cause: a pull request comment, or an issue on `main` |
| Known bug | A Guard test still failing on its assertion | Fixes the app code, then runs the whole suite twice: the bug tests must pass and nothing else may break |

Test fixes go to a `heal/<run>` branch with a pull request into the failing branch. A fix may not remove assertions, skip tests or rename them.

App fixes for known bugs are pushed straight to the pull request that added the Guard tests, with a comment showing the diff, and CI runs again on that branch. A second model reviews each app fix and rejects changes to data, prices or copy. The healer never fixes on top of its own fix commit, so it cannot loop.

Pushes made with GitHub's built-in token do not start pull request checks, so add a `HEAL_TOKEN` secret holding a fine-grained personal access token for this repository with read and write access to Contents, Pull requests, Issues and Actions. The healer then pushes as you and the pull request's checks run normally. Without it, the healer falls back to `gh workflow run`, which does not show on the pull request.

Run it locally with `npm run heal` (add `--base <git ref>` to choose what the app's changes are compared with). Results go to `reports/heal.json`.

### Demo scenarios

`npm run scenario -- <name>` creates a branch, applies one change, pushes it and opens a pull request so CI and the healer run on it:

- `locator`: renames the checkout button's test id. The healer should fix the test.
- `flaky`: adds a search test that sleeps instead of waiting. The healer should fix the test.
- `regression`: drops the cents from prices. The healer should flag it and leave the tests alone.
