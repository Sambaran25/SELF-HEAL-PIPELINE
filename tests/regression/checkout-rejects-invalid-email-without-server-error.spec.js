import { expect, test } from "@playwright/test";

test("Checkout rejects invalid email without server error", { annotation: { type: "bug", description: "Expected: The checkout should reject an invalid email address and show a validation message without submitting the order. Actual: The page allows placing the order with 'not-an-email' entered and then shows 'Something went wrong.' with an HTTP 500 from POST /api/checkout." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("search-form").getByTestId("search-input").fill("mug");
    await page.getByTestId("search-form").getByTestId("search-input").press("Enter");
    await page.getByTestId("checkout-form").getByTestId("checkout-name").fill("A");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").fill("not-an-email");
    await page.getByTestId("checkout-form").getByTestId("checkout-button").click();
    await expect(page.getByTestId("checkout-message")).not.toBeEmpty();
    await expect(page.getByTestId("checkout-message")).not.toHaveText("Something went wrong.");
});
