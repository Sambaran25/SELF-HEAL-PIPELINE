import { expect, test } from "@playwright/test";

test("searching mug shows Coffee Mug product", { annotation: { type: "bug", description: "Expected: Searching for 'mug' should show the Coffee Mug product. Actual: The page shows 'No products found.' and hides Coffee Mug." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("search-form").getByTestId("search-input").fill("mug");
    await page.getByTestId("search-form").getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("product-list")).toContainText("Coffee Mug");
});
