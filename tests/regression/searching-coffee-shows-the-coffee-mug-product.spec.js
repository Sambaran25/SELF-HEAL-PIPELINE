import { expect, test } from "@playwright/test";

test("searching coffee shows the Coffee Mug product", { annotation: { type: "bug", description: "Expected: Searching for \"coffee\" should show the Coffee Mug product. Actual: The page shows \"No products found.\" and hides Coffee Mug." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("search-form").getByTestId("search-input").fill("coffee");
    await page.getByTestId("search-form").getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("product-list")).toContainText("Coffee Mug");
});
