import { defineConfig } from "@playwright/test";

const port = 3200;

export default defineConfig({
    testDir: "tests",
    timeout: 20000,
    expect: { timeout: 3000 },
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI
        ? [["github"], ["html", { open: "never" }], ["json", { outputFile: "reports/results.json" }]]
        : "list",
    use: {
        baseURL: `http://localhost:${port}`,
        trace: "retain-on-failure",
        actionTimeout: 5000,
    },
    webServer: {
        command: "node demo-app/server.js",
        url: `http://localhost:${port}/api/health`,
        env: { PORT: String(port) },
        reuseExistingServer: !process.env.CI,
    },
});
