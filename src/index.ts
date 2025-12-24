import express from "express";
import { config } from "./config";
import { logger } from "./logger";
import { handleWebhook } from "./webhook";
import { startWorker } from "./worker";
import { queueService } from "./services/queue";

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    pendingJobs: queueService.getPendingCount(),
  });
});

// Webhook endpoint
app.post("/webhook", handleWebhook);

// Start background worker
startWorker();

app.listen(config.port, () => {
  logger.info(
    {
      port: config.port,
      fireflyUrl: config.firefly.url,
      llmModel: config.openrouter.model,
      searxngEnabled: !!config.searxng.url,
    },
    "Firefly III AI Categorize started"
  );
});
