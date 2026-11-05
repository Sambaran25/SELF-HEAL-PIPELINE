import { expect, test } from "@playwright/test";

test("cart total includes item quantities", { annotation: { type: "bug", description: "Expected: With Coffee Mug x2 at $12.50 each, the line subtotal should be $25.00 and the cart total should also be $25.00. Actual: The cart shows Coffee Mug x2 with a line subtotal of $25.00, but the cart total is $12.50." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await expect(page.getByTestId("cart-list").getByTestId("cart-item-1").getByTestId("cart-item-subtotal")).toHaveText("$25.00");
    await expect(page.getByTestId("cart-total")).toHaveText("$25.00");
});
