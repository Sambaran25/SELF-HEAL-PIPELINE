import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
    await page.goto("/");
});

test("lists every product", async ({ page }) => {
    await expect(page.getByTestId("product-list").getByRole("listitem")).toHaveCount(6);
});

test("adding a product puts it in the cart", async ({ page }) => {
    await page.getByTestId("product-2").getByTestId("add-to-cart").click();
    await expect(page.getByTestId("cart-item-2").getByTestId("cart-item-name")).toHaveText("Desk Lamp");
    await expect(page.getByTestId("cart-empty")).toBeHidden();
    await expect(page.getByTestId("cart-total")).toHaveText("$34.00");
});

test("searching by full name finds the product", async ({ page }) => {
    await page.getByTestId("search-input").fill("Desk Lamp");
    await page.getByTestId("search-button").click();
    await expect(page.getByTestId("product-list").getByRole("listitem")).toHaveCount(1);
    await expect(page.getByTestId("product-2")).toBeVisible();
});

test("an unknown discount code is rejected", async ({ page }) => {
    await page.getByTestId("discount-input").fill("NOPE");
    await page.getByTestId("discount-button").click();
    await expect(page.getByTestId("discount-message")).toHaveText("That code is not valid.");
});

test("a valid checkout places the order", async ({ page }) => {
    await page.getByTestId("product-2").getByTestId("add-to-cart").click();
    await page.getByTestId("checkout-name").fill("Ada Lovelace");
    await page.getByTestId("checkout-email").fill("ada@example.com");
    await page.getByTestId("checkout-button").click();
    await expect(page.getByTestId("checkout-message")).toContainText("Total charged: $34.00.");
    await expect(page.getByTestId("cart-empty")).toBeVisible();
});
