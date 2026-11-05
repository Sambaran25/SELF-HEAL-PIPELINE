import { expect, test } from "@playwright/test";

test("cart total includes quantity for duplicate Coffee Mug items", { annotation: { type: "bug", description: "Expected: Two Coffee Mugs at $12.50 each should show a line subtotal of $25.00 and a cart total of $25.00. Actual: The Coffee Mug line shows $25.00, but the cart total shows $12.50." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await expect(page.getByTestId("cart-list").getByTestId("cart-item-1").getByTestId("cart-item-subtotal")).toHaveText("$25.00");
    await expect(page.getByTestId("cart-total")).toHaveText("$25.00");
});
