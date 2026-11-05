import { expect, test } from "@playwright/test";

test("invalid email is rejected instead of submitting checkout", { annotation: { type: "bug", description: "Expected: The checkout form should reject an invalid email and show a validation message instead of submitting. Actual: The form submitted with 'not-an-email' and returned a server error: 'Something went wrong.' / HTTP 500 from POST /api/checkout." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("checkout-form").getByTestId("checkout-name").fill("Alice");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").fill("not-an-email");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").press("Enter");
    await expect(page.getByTestId("checkout-message")).not.toBeEmpty();
    await expect(page.getByTestId("checkout-message")).not.toContainText("Order");
});
