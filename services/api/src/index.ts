import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`super-mcp API + MCP listening on http://${HOST}:${PORT} (MCP at /mcp)`);
  void import("./services/search/queryEmbedding.js").then((m) =>
    m.getQueryEmbedding("warmup").catch(() => undefined),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutting down");
    try {
      // Triggers onClose → PostHog flush.
      await app.close();
    } catch (err) {
      app.log.error({ err }, "error during shutdown");
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
