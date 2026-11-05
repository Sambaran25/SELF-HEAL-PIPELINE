import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { products } from "./products.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json());
app.use(express.static(path.join(here, "public")));

app.get("/api/health", (req, res) => {
    res.json({ ok: true });
});

app.get("/api/products", async (req, res) => {
    const query = String(req.query.q || "").trim();
    if (query) {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 600));
    }
    const normalizedQuery = query.toLowerCase();
    const results = normalizedQuery ? products.filter((p) => p.name.toLowerCase().includes(normalizedQuery)) : products;
    res.json(results);
});

app.post("/api/checkout", (req, res) => {
    const { name, email, items = [], discountPercent = 0 } = req.body || {};

    if (!name || !email) {
        return res.status(400).json({ error: "Name and email are required." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: "Enter a valid email address." });
    }

    if (!Array.isArray(items)) {
        return res.status(400).json({ error: "Cart items are invalid." });
    }

    let firstItem = null;
    let subtotal = 0;
    for (const item of items) {
        const product = products.find((p) => p.id === item.id);
        if (!product) {
            return res.status(400).json({ error: `Unknown product ${item.id}.` });
        }
        if (!Number.isInteger(item.quantity) || item.quantity < 1) {
            return res.status(400).json({ error: "Cart item quantities are invalid." });
        }
        if (!firstItem) {
            firstItem = product;
        }
        subtotal += product.price * item.quantity;
    }

    const total = Math.max(0, subtotal * (1 - discountPercent / 100));
    res.json({
        orderId: `ORD-${Date.now()}`,
        firstItem: firstItem ? firstItem.name : null,
        total: Number(total.toFixed(2)),
    });
});

app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
});

app.listen(port, () => {
    console.log(`Demo shop running at http://localhost:${port}`);
});
