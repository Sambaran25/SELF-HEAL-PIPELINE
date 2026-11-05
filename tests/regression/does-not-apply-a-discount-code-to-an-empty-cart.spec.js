import { expect, test } from "@playwright/test";

test("does not apply a discount code to an empty cart", { annotation: { type: "bug", description: "Expected: An empty cart should not accept or apply a discount code, or it should show an error until there are items to discount. Actual: The page shows 'Code SAVE10 applied: 10% off.' even though the cart is empty and total is $0.00." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("discount-form").getByTestId("discount-input").fill("SAVE10");
    await page.getByTestId("discount-form").getByTestId("discount-input").press("Enter");
    await expect(page.getByTestId("discount-message")).not.toHaveText("Code SAVE10 applied: 10% off.");
});
