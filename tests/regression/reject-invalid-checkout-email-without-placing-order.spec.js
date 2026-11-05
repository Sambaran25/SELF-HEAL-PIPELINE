import { expect, test } from "@playwright/test";

test("reject invalid checkout email without placing order", { annotation: { type: "bug", description: "Expected: The form should reject 'not-an-email' and show a validation message instead of placing the order. Actual: The order was placed successfully with email set to 'not-an-email' and a charged total of $41.85." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("checkout-form").getByTestId("checkout-name").fill("Alex");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").fill("not-an-email");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").press("Enter");
    await expect(page.getByTestId("checkout-message")).not.toBeEmpty();
    await expect(page.getByTestId("checkout-message")).not.toContainText("Total charged");
    await expect(page.getByTestId("cart-total")).toHaveText("$12.50");
});
