import { expect, test } from "@playwright/test";

test("applies SAVE10 once to a single Coffee Mug total", { annotation: { type: "bug", description: "Expected: With one Coffee Mug at $12.50 and 10% off, the total should be $11.25. Actual: The cart shows Total: $6.25." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("discount-form").getByTestId("discount-input").fill("SAVE10");
    await page.getByTestId("discount-form").getByTestId("discount-input").press("Enter");
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await expect(page.getByTestId("cart-total")).toHaveText("$11.25");
});
