import { expect, test } from "@playwright/test";

test("valid checkout does not show server error", { annotation: { type: "bug", description: "Expected: The order should be placed successfully when name and email are filled in. Actual: Clicking Place order shows 'Something went wrong.' instead of completing checkout." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("discount-form").getByTestId("discount-input").fill("SAVE10");
    await page.getByTestId("discount-form").getByTestId("discount-input").press("Enter");
    await page.getByTestId("checkout-form").getByTestId("checkout-name").fill("Test User");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").fill("test@example.com");
    await page.getByTestId("checkout-form").getByTestId("checkout-button").click();
    await page.getByTestId("checkout-form").getByTestId("checkout-button").click();
    await page.getByTestId("search-form").getByTestId("search-input").fill("lamp");
    await page.getByTestId("search-form").getByTestId("search-input").press("Enter");
    await expect(page.getByTestId("checkout-message")).not.toBeEmpty();
    await expect(page.getByTestId("checkout-message")).not.toHaveText("Something went wrong.");
});
