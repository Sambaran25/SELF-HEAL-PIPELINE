import { expect, test } from "@playwright/test";

test("Empty cart checkout shows validation instead of server error", { annotation: { type: "bug", description: "Expected: The page should block checkout or show validation errors for an empty cart instead of sending the order. Actual: Clicking Place order results in a server error: 'Something went wrong.' and HTTP 500 from POST /api/checkout." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("checkout-form").getByTestId("checkout-name").fill("Test User");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").fill("test@example.com");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").press("Enter");
    await expect(page.getByTestId("checkout-message")).not.toBeEmpty();
    await expect(page.getByTestId("checkout-message")).not.toHaveText("Something went wrong.");
});
