import { expect, test } from "@playwright/test";

test("SAVE10 applies a single 10 percent discount to cart total", { annotation: { type: "bug", description: "Expected: With one Coffee Mug at $12.50 and 10% off, the total should be $11.25. Actual: The page shows Total: $10.00." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("discount-form").getByTestId("discount-input").fill("SAVE10");
    await page.getByTestId("discount-form").getByTestId("discount-input").press("Enter");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await expect(page.getByTestId("cart-total")).toHaveText("$11.25");
});
