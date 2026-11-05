import { expect, test } from "@playwright/test";

test("SAVE10 applies 10 percent discount to cart total", { annotation: { type: "bug", description: "Expected: 10% off $12.50 should make the total $11.25. Actual: The page shows Total: $10.00 after applying SAVE10." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("discount-form").getByTestId("discount-input").fill("SAVE10");
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await expect(page.getByTestId("cart-total")).toHaveText("$11.25");
});
