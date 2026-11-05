import { expect, test } from "@playwright/test";

test("reapplying SAVE10 keeps total at single 10 percent discount", { annotation: { type: "bug", description: "Expected: Applying the same discount code again should either be rejected or keep the same correctly discounted total based on the current cart. Actual: After clicking Apply multiple times, the page still shows the same total of $26.63 with 'SAVE10 applied: 10% off.'" } }, async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("product-list").getByTestId("product-1").getByTestId("add-to-cart").click();
    await page.getByTestId("discount-form").getByTestId("discount-input").fill("SAVE10");
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await page.getByTestId("discount-form").getByTestId("discount-button").click();
    await expect(page.getByTestId("cart-total")).toHaveText("$11.25");
});
