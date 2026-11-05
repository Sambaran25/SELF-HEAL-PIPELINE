import { expect, test } from "@playwright/test";

test("searching mug shows Coffee Mug result", { annotation: { type: "bug", description: "Expected: Searching for 'mug' should show the Coffee Mug product result. Actual: The page shows 'No products found.' and hides the Coffee Mug item even though it matches the search term." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("search-form").getByTestId("search-input").fill("mug");
    await page.getByTestId("search-form").getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("product-list")).toContainText("Coffee Mug");
    await expect(page.getByTestId("no-results")).toBeHidden();
});
