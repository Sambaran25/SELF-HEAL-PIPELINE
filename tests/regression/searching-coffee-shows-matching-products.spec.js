import { expect, test } from "@playwright/test";

test("searching coffee shows matching products", { annotation: { type: "bug", description: "Expected: Searching for a product term like 'coffee' should show matching products in the product list. Actual: The page shows 'No products found.' even after searching for 'coffee'." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("search-form").getByTestId("search-input").fill("coffee");
    await page.getByTestId("search-form").getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("product-list")).not.toBeEmpty();
});
