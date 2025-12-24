import type { Request, Response } from "express";
import { createChildLogger } from "./logger";
import { queueService } from "./services/queue";

const log = createChildLogger("webhook");

interface WebhookPayload {
  trigger: string;
  response: string;
  content: {
    id: string;
    transactions: Array<{
      transaction_journal_id: string;
      type: string;
      description: string;
      destination_name: string;
      category_id: string | null;
      category_name: string | null;
      amount: string;
      tags: string[];
    }>;
  };
}

export async function handleWebhook(req: Request, res: Response) {
  const requestId = crypto.randomUUID().slice(0, 8);
  const reqLog = log.child({ requestId });

  try {
    const payload = req.body as WebhookPayload;

    // Validate webhook
    const validation = validatePayload(payload);
    if (!validation.valid) {
      reqLog.warn({ reason: validation.reason }, "Invalid webhook payload");
      res.status(400).json({ error: validation.reason });
      return;
    }

    const transaction = payload.content.transactions[0];
    const merchantName = transaction.destination_name;
    const transactionId = payload.content.id;

    reqLog.info(
      {
        transactionId,
        merchantName,
        description: transaction.description,
        amount: transaction.amount,
      },
      "Received transaction"
    );

    // Enqueue for background processing
    const jobId = queueService.enqueue(
      transactionId,
      merchantName,
      transaction.description,
      transaction.amount,
      transaction.tags
    );

    res.status(202).json({
      status: "accepted",
      jobId,
      message: "Transaction queued for categorization",
    });
  } catch (err) {
    reqLog.error({ err }, "Webhook processing failed");
    res.status(500).json({ error: "Internal server error" });
  }
}

function validatePayload(
  payload: WebhookPayload
): { valid: true } | { valid: false; reason: string } {
  if (payload?.trigger !== "STORE_TRANSACTION") {
    return { valid: false, reason: "Trigger is not STORE_TRANSACTION" };
  }

  if (payload?.response !== "TRANSACTIONS") {
    return { valid: false, reason: "Response is not TRANSACTIONS" };
  }

  if (!payload?.content?.id) {
    return { valid: false, reason: "Missing content.id" };
  }

  if (!payload?.content?.transactions?.length) {
    return { valid: false, reason: "No transactions in payload" };
  }

  const tx = payload.content.transactions[0];

  if (tx.type !== "withdrawal") {
    return { valid: false, reason: "Transaction type is not withdrawal" };
  }

  if (tx.category_id !== null) {
    return { valid: false, reason: "Transaction already has a category" };
  }

  if (!tx.destination_name) {
    return { valid: false, reason: "Missing destination_name" };
  }

  return { valid: true };
}
