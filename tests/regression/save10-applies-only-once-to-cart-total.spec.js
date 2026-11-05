import { expect, test } from "@playwright/test";

test("SAVE10 applies only once to cart total", { annotation: { type: "bug", description: "Expected: Applying SAVE10 multiple times should either be rejected or keep the discount at 10% off once. Actual: The cart total drops to $6.25 after repeated applies, which is more than a single 10% discount on 2 Coffee Mugs at $25.00." } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("discount-form").getByTestId("discount-input").fill("SAVE10");
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await expect(page.getByTestId("cart-total")).toHaveText("$22.50");
});
