import { expect, test } from "@playwright/test";

test("checkout does not show server error for completed customer details", { annotation: { type: "bug", description: "Expected: Placing an order with a name and email should either succeed or show a validation message only if something is still missing. Actual: After entering a name and email and clicking Place order, the page still shows 'Something went wrong.'" } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("checkout-form").getByTestId("checkout-name").fill("Test User");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").fill("test@example.com");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").press("Enter");
    await expect(page.getByTestId("checkout-message")).not.toBeEmpty();
    await expect(page.getByTestId("checkout-message")).not.toHaveText("Something went wrong.");
});
