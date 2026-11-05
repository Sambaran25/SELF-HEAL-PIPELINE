import { expect, test } from "@playwright/test";

test("reject invalid email at checkout without placing order", { annotation: { type: "bug", description: "Expected: The checkout form should reject an invalid email format and show an error before placing the order. Actual: The page placed order ORD-1793877691050 and charged $30.60 even though the email field contains 'not-an-email'." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("search-form").getByTestId("search-input").fill("Lamp");
    await page.getByTestId("search-form").getByTestId("search-input").press("Enter");
    await page.getByTestId("product-list").getByTestId("product-2").getByTestId("add-to-cart").click();
    await page.getByTestId("checkout-form").getByTestId("checkout-name").fill("Alex");
    await page.getByTestId("checkout-form").getByTestId("checkout-email").fill("not-an-email");
    await page.getByTestId("checkout-form").getByTestId("checkout-button").click();
    await expect(page.getByTestId("checkout-message")).not.toBeEmpty();
    await expect(page.getByTestId("checkout-message")).not.toContainText("placed");
    await expect(page.getByTestId("checkout-message")).not.toContainText("Total charged");
});
