import { expect, test } from "@playwright/test";

test("cart total includes item quantities", { annotation: { type: "bug", description: "Expected: With Coffee Mug x2 at $25.00, the cart total should also be $25.00. Actual: The cart shows Total: $12.50 even though the Coffee Mug line subtotal is $25.00." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await expect(page.getByTestId("cart-total")).toHaveText("$25.00");
});
