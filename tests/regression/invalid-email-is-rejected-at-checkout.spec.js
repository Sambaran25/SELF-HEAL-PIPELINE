import { expect, test } from "@playwright/test";

test("invalid email is rejected at checkout", { annotation: { type: "bug", description: "Expected: The form should reject an invalid email format and show a validation error. Actual: The order was placed successfully with email set to \"not-an-email\"." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("checkout-form").getByTestId("checkout-name").fill("Test User");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").fill("not-an-email");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").press("Enter");
    await expect(page.getByTestId("checkout-message")).toContainText("valid email");
    await expect(page.getByTestId("cart-total")).toHaveText("$12.50");
});
