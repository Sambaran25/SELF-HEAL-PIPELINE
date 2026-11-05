import { expect, test } from "@playwright/test";

test("empty cart checkout does not show server error", { annotation: { type: "bug", description: "Expected: The shop should reject checkout gracefully or show a validation message for an empty cart. Actual: Clicking Place order sends the request and returns HTTP 500 / Something went wrong." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("discount-form").getByTestId("discount-input").fill("SAVE10");
    await page.getByTestId("search-form").getByTestId("search-input").fill("mug");
    await page.getByTestId("search-form").getByTestId("search-input").press("Enter");
    await page.getByTestId("checkout-form").getByTestId("checkout-name").fill("Alex");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").fill("not-an-email");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").press("Enter");
    await page.getByTestId("checkout-form").getByTestId("checkout-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await expect(page.getByTestId("checkout-message")).not.toBeEmpty();
    await expect(page.getByTestId("checkout-message")).not.toHaveText("Something went wrong.");
});
