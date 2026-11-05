const DISCOUNT_CODES = { SAVE10: 10 };

let cart = [];
let discountPercent = 0;

const productList = document.getElementById("product-list");
const noResults = document.getElementById("no-results");
const searching = document.getElementById("searching");
const cartList = document.getElementById("cart-list");
const cartEmpty = document.getElementById("cart-empty");
const cartTotal = document.getElementById("cart-total");
const discountMessage = document.getElementById("discount-message");
const checkoutMessage = document.getElementById("checkout-message");

function formatPrice(amount) {
    return `$${amount.toFixed(2)}`;
}

function setMessage(element, text, kind) {
    element.textContent = text;
    element.className = kind;
}

async function loadProducts(query = "") {
    productList.innerHTML = "";
    noResults.hidden = true;
    searching.hidden = false;
    const response = await fetch(`/api/products?q=${encodeURIComponent(query)}`);
    const products = await response.json();
    searching.hidden = true;
    renderProducts(products);
}

function renderProducts(products) {
    productList.innerHTML = "";
    noResults.hidden = products.length > 0;

    for (const product of products) {
        const inStock = product.stock > 0;
        const item = document.createElement("li");
        item.className = "product";
        item.dataset.testid = `product-${product.id}`;
        item.innerHTML = `
            <h3>${product.name}</h3>
            <p data-testid="product-price">${formatPrice(product.price)}</p>
            <button type="button" data-testid="add-to-cart" class="${inStock ? "" : "out-of-stock"}">
                ${inStock ? "Add to cart" : "Out of stock"}
            </button>
        `;
        item.querySelector("button").addEventListener("click", () => addToCart(product));
        productList.appendChild(item);
    }
}

function addToCart(product) {
    const existing = cart.find((line) => line.id === product.id);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({ id: product.id, name: product.name, price: product.price, quantity: 1 });
    }
    renderCart();
}

function removeFromCart(index) {
    cart.splice(index - 1, 1);
    renderCart();
}

function cartSubtotal() {
    return cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
}

function renderCart() {
    cartList.innerHTML = "";
    cartEmpty.hidden = cart.length > 0;

    cart.forEach((line, index) => {
        const item = document.createElement("li");
        item.className = "cart-item";
        item.dataset.testid = `cart-item-${line.id}`;
        item.innerHTML = `
            <span data-testid="cart-item-name">${line.name}</span>
            <span data-testid="cart-item-quantity">x${line.quantity}</span>
            <span data-testid="cart-item-subtotal">${formatPrice(line.price * line.quantity)}</span>
            <button type="button" data-testid="remove-from-cart">Remove</button>
        `;
        item.querySelector("button").addEventListener("click", () => removeFromCart(index));
        cartList.appendChild(item);
    });

    const total = Math.max(0, cartSubtotal() * (1 - discountPercent / 100));
    cartTotal.textContent = formatPrice(total);
}

document.getElementById("search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    loadProducts(document.getElementById("search-input").value);
});

document.getElementById("discount-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const code = document.getElementById("discount-input").value.trim().toUpperCase();
    const percent = DISCOUNT_CODES[code];

    if (!percent) {
        setMessage(discountMessage, "That code is not valid.", "error");
        return;
    }

    discountPercent = percent;
    setMessage(discountMessage, `Code ${code} applied: ${percent}% off.`, "success");
    renderCart();
});

document.getElementById("checkout-form").addEventListener("submit", async (event) => {
    event.preventDefault();

    const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            name: document.getElementById("checkout-name").value.trim(),
            email: document.getElementById("checkout-email").value.trim(),
            items: cart.map((line) => ({ id: line.id, quantity: line.quantity })),
            discountPercent,
        }),
    });
    const result = await response.json();

    if (!response.ok) {
        setMessage(checkoutMessage, result.error, "error");
        return;
    }

    setMessage(checkoutMessage, `Order ${result.orderId} placed. Total charged: ${formatPrice(result.total)}.`, "success");
    cart = [];
    discountPercent = 0;
    renderCart();
});

loadProducts();
renderCart();
