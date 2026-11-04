import { existsSync } from "node:fs";

if (existsSync(".env")) {
    process.loadEnvFile(".env");
}

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

export async function chatJson(messages) {
    if (!apiKey || apiKey === "your-key-here") {
        throw new Error("OPENAI_API_KEY is not set. Copy .env.example to .env and add your key.");
    }

    for (let attempt = 1; ; attempt++) {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages,
                temperature: 0.7,
                response_format: { type: "json_object" },
            }),
        });

        if (response.ok) {
            const data = await response.json();
            return JSON.parse(data.choices[0].message.content);
        }

        const body = await response.text();
        const outOfQuota = body.includes("insufficient_quota");
        const retryable = !outOfQuota && (response.status === 429 || response.status >= 500);
        if (!retryable || attempt >= 3) {
            throw new Error(`OpenAI request failed (${response.status}): ${body}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
}
