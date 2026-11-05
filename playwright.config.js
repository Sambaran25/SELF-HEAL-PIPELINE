import { defineConfig } from "@playwright/test";

const port = 3200;

export default defineConfig({
    testDir: "tests",
    timeout: 20000,
    expect: { timeout: 3000 },
    reporter: process.env.CI ? "github" : "list",
    use: {
        baseURL: `http://localhost:${port}`,
    },
    webServer: {
        command: "node demo-app/server.js",
        url: `http://localhost:${port}/api/health`,
        env: { PORT: String(port) },
        reuseExistingServer: !process.env.CI,
    },
});
