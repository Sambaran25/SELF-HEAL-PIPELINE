import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const FLAKY_TEST = `import { expect, test } from "@playwright/test";

test("search narrows the list to one product", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("search-input").fill("Notebook");
    await page.getByTestId("search-button").click();
    await page.waitForTimeout(200);
    const count = await page.getByTestId("product-list").getByRole("listitem").count();
    expect(count).toBe(1);
});
`;

function replaceIn(file, from, to) {
    const text = readFileSync(file, "utf8");
    if (!text.includes(from)) {
        throw new Error(`Could not find "${from}" in ${file}. Is this branch up to date with main?`);
    }
    writeFileSync(file, text.replace(from, to));
}

const scenarios = {
    locator: {
        title: "Rename the checkout button",
        body: "UI refactor: the checkout button gets a clearer test id. Nothing changes for users, but the smoke test still looks for the old id.",
        apply: () => replaceIn("demo-app/public/index.html", 'data-testid="checkout-button"', 'data-testid="place-order-button"'),
        files: ["demo-app/public/index.html"],
    },
    flaky: {
        title: "Add a search test",
        body: "Adds a test for search. It waits a fixed 200 ms for results, but search takes up to 600 ms, so it only passes sometimes.",
        apply: () => writeFileSync("tests/smoke/search.spec.js", FLAKY_TEST),
        files: ["tests/smoke/search.spec.js"],
    },
    regression: {
        title: "Simplify price formatting",
        body: "Simplifies formatPrice. This drops the cents, so $34.00 shows as $34: a real bug that the tests should catch.",
        apply: () => replaceIn("demo-app/public/app.js", "return `$${amount.toFixed(2)}`;", "return `$${amount}`;"),
        files: ["demo-app/public/app.js"],
    },
};

const name = process.argv[2];
const scenario = scenarios[name];
if (!scenario) {
    console.error(`Usage: npm run scenario -- <${Object.keys(scenarios).join("|")}>`);
    process.exit(1);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--untracked-files=no")) {
    console.error("Commit or stash your changes first.");
    process.exit(1);
}

const original = git("rev-parse", "--abbrev-ref", "HEAD");
const branch = `demo/${name}-${Date.now()}`;
git("switch", "-c", branch);
try {
    scenario.apply();
    git("add", ...scenario.files);
    git("commit", "-m", scenario.title);
    git("push", "-u", "origin", branch);
    const url = execFileSync("gh", ["pr", "create", "--base", "main", "--head", branch, "--title", scenario.title, "--body", scenario.body], { encoding: "utf8" }).trim();
    console.log(`Opened ${url}`);
} finally {
    git("switch", original);
}
