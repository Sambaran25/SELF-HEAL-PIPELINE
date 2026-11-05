import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.js");

export async function startDemoApp(port) {
    const server = spawn(process.execPath, [serverFile], {
        env: { ...process.env, PORT: String(port) },
        stdio: "ignore",
    });
    const baseUrl = `http://localhost:${port}`;

    for (let attempt = 0; attempt < 50; attempt++) {
        try {
            if ((await fetch(`${baseUrl}/api/health`)).ok) {
                return { server, baseUrl };
            }
        } catch {
            // Not listening yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    server.kill();
    throw new Error("The demo app did not start.");
}
