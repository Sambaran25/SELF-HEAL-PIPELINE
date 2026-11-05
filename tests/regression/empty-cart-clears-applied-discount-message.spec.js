import { expect, test } from "@playwright/test";

test("empty cart clears applied discount message", { annotation: { type: "bug", description: "Expected: An empty cart should show a total of $0.00 without an applied discount message. Actual: The page still shows 'Code SAVE10 applied: 10% off.' even though the cart is empty and the total is $0.00." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("discount-form").getByTestId("discount-input").fill("SAVE10");
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("cart-list").getByTestId("cart-item-1").getByTestId("remove-from-cart").click();
    await expect(page.getByTestId("cart-empty")).toBeVisible();
    await expect(page.getByTestId("cart-total")).toHaveText("$0.00");
    await expect(page.getByTestId("discount-message")).toBeHidden();
});
