# Demo video script

Target length: about 6 minutes. Slide numbers refer to `self-heal-pipeline.pptx`, whose speaker notes hold the voiceover for each slide.

## Before recording

- [ ] Close pull request #1 and any other open `guard/` pull requests. Keep #4 open as backup footage.
- [ ] Check that the OpenAI account has credits. A full run uses the swarm, Guard and the healer.
- [ ] `git switch main` and `git pull`. `git status` should be clean, with no files in `tests/regression/`.
- [ ] Nothing running on ports 3000, 3100, 3200 or 4000.
- [ ] Open three terminals in the repo, and a browser with tabs for http://localhost:3000, http://localhost:4000 and the repository's pull requests page.
- [ ] Record pull request #4 (comment, diff, green check) once now, in case a live run misbehaves.
- [ ] If an earlier take or practice run was merged, reset `main` first (see "After each take").

## After each take

Merging puts the fixes on `main`, so the next take would have no bugs to find. Undo the merge before every new take, practice included:

```powershell
git switch main
git pull
git log --oneline -3              # the top line should be "Merge pull request #<number> ..."
git revert -m 1 HEAD --no-edit
git push
```

This brings back the planted bugs and removes that take's tests.

## Chapters

The video goes one stage at a time. Each chapter follows the same pattern: explain the stage on its slide, run it live, show what it produced, then move on. Each stage is a separate command, so you can also record each chapter as its own clip and join them afterwards. A failed take then only costs that chapter.

| Chapter | Time | Slide | Live part | What it hands to the next chapter |
|---|---|---|---|---|
| Intro | 0:00 | 1 to 4 | None | The idea and the architecture |
| 1. The bugs | 1:15 | None | Click through the shop by hand | Four bugs the audience has seen |
| 2. Find | 2:00 | 5 | Swarm on the dashboard | `bugs.json` with the unique bugs |
| 3. Guard | 3:00 | 6 | Guard opens a pull request | A pull request with failing tests |
| 4. Heal | 4:00 | 7 | CI red, healer fixes, CI green | A green pull request |
| Close | 5:15 | 8 to 11 | None | Guardrails, results, thank you |

### Intro: slides 1 to 4

Read the speaker notes. On slide 4, point at the three stages you are about to show, one at a time.

### Chapter 1: the bugs, by hand

Terminal 1: `npm run demo`, then open http://localhost:3000.

1. Search for `mug` and press Enter. "No products found", although Coffee Mug exists.
2. Clear the search. Click **Add to cart** on Coffee Mug twice. The line says $25.00, the total says $12.50.
3. Type `SAVE10` and click **Apply** twice. The discount doubles.
4. Enter a name and the email `not-an-email`, then place the order. It goes through.

Say: "Four bugs a real user would hit. Nobody told the agents about them. Let's see if they find them, one stage at a time."

### Chapter 2: Find

1. **Explain** on slide 5: the four personas, and how every report is replayed and judged.
2. **Run.** Terminal 2: `npm run dashboard`, then show http://localhost:4000. Terminal 3: `npm run swarm`.
3. **Watch.** Show the persona screenshots updating, and a few confirmed and rejected verdicts. Speed up the middle. It takes about 2 minutes.
4. **Result.** End on the funnel and read out the unique bugs. Say which ones match what you showed by hand.

If it found fewer than 4 unique bugs, run it again before moving on.

### Chapter 3: Guard

1. **Explain** on slide 6: the five steps, and why a test must fail before it is kept.
2. **Run.** Terminal 3: `npm run guard -- --pr`.
3. **Watch.** Show the first "accepted with N step(s)" line, then cut to the end. It takes about 7 minutes. This is the best place to talk over slide 6 while it runs.
4. **Result.** Open the pull request link it prints. On **Files changed**, show one test and point at the `bug` annotation and the `expect` line.

Say: "Every one of these tests failed twice against the buggy app before Guard accepted it."

### Chapter 4: Heal

1. **Explain** on slide 7: rerun 10 times, then diagnose. For a known bug, fix the app.
2. **Red.** On the pull request, open **Checks**. Cut the wait, about 3 minutes. Show the failing tests, then the **Self-heal report** table in the run summary.
3. **Fix.** On **Conversation**, show the bot comment "The healer fixed N bug(s) in the app". Expand **Code change** and point at one line, for example `line.price * line.quantity`. On **Commits**, show the commit from `self-heal-bot`.
4. **Green.** Show the new check run starting by itself, then passing in under a minute.

Say: "It changed logic only. Before pushing, the whole suite passed twice and a second model reviewed the change."

5. **Merge.** `gh pr merge <number> --merge`. Use `--merge`, not `--squash`, so the reset below works.
6. **Show the fixed shop.** In terminal 1, press Ctrl+C, then `git pull` and `npm run demo`. Repeat the four bugs from chapter 1: `mug` finds Coffee Mug, two mugs total $25.00, SAVE10 stays at 10%, and `not-an-email` is rejected.

Say: "Same shop, same clicks. The agents found it, tested it and fixed it."

### Close: slides 8 to 11

On slide 8, tell the rehearsal story: an early version changed a price to make a broken test pass, and that is why the reviewer exists. Then results, next steps, thank you.

## If something goes wrong

| Problem | What to do |
|---|---|
| Swarm finds fewer than 4 bugs | Run `npm run swarm` again. Each run explores differently. |
| Guard skips a bug | Fine to leave out; say each test must prove itself first. |
| Healer step fails or OpenAI runs out of credits | Use the pull request #4 footage. |
| CI does not rerun after the healer's push | Check the `HEAL_TOKEN` secret, or rerun the job from the Checks tab. |
