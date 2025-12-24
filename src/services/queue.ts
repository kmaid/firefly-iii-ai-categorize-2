import { Database } from "bun:sqlite";
import { config } from "../config";
import { createChildLogger } from "../logger";
import { mkdirSync } from "fs";
import { dirname } from "path";

const log = createChildLogger("queue");

export interface Job {
  id: number;
  transactionId: string;
  merchantName: string;
  description: string;
  amount: string;
  tags: string;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

class QueueService {
  private db: Database;

  constructor() {
    mkdirSync(dirname(config.database.path), { recursive: true });
    this.db = new Database(config.database.path, { create: true });
    this.init();
  }

  private init() {
    log.info("Initializing job queue");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_id TEXT NOT NULL,
        merchant_name TEXT NOT NULL,
        description TEXT NOT NULL,
        amount TEXT NOT NULL,
        tags TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        error TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_job_status ON jobs(status)`);

    // Reset any jobs stuck in processing (from previous crash)
    const reset = this.db.run(
      `UPDATE jobs SET status = 'pending', updated_at = CURRENT_TIMESTAMP 
       WHERE status = 'processing'`
    );
    if (reset.changes > 0) {
      log.warn({ count: reset.changes }, "Reset stuck jobs to pending");
    }

    const pending = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'")
      .get();
    log.info({ pendingJobs: pending?.count ?? 0 }, "Queue initialized");
  }

  enqueue(
    transactionId: string,
    merchantName: string,
    description: string,
    amount: string,
    tags: string[]
  ): number {
    const result = this.db.run(
      `INSERT INTO jobs (transaction_id, merchant_name, description, amount, tags)
       VALUES (?, ?, ?, ?, ?)`,
      [transactionId, merchantName, description, amount, JSON.stringify(tags)]
    );

    const jobId = Number(result.lastInsertRowid);
    log.info({ jobId, transactionId, merchantName }, "Job enqueued");
    return jobId;
  }

  dequeue(): Job | null {
    // Get and lock oldest pending job
    const row = this.db
      .query<
        {
          id: number;
          transaction_id: string;
          merchant_name: string;
          description: string;
          amount: string;
          tags: string;
          status: string;
          attempts: number;
          error: string | null;
          created_at: string;
          updated_at: string;
        },
        []
      >(
        `SELECT * FROM jobs 
         WHERE status = 'pending' 
         ORDER BY created_at ASC 
         LIMIT 1`
      )
      .get();

    if (!row) return null;

    // Mark as processing
    this.db.run(
      `UPDATE jobs SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = ?`,
      [row.id]
    );

    log.debug({ jobId: row.id }, "Job dequeued");

    return {
      id: row.id,
      transactionId: row.transaction_id,
      merchantName: row.merchant_name,
      description: row.description,
      amount: row.amount,
      tags: row.tags,
      status: row.status as Job["status"],
      attempts: row.attempts + 1,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  complete(jobId: number): void {
    this.db.run(
      `UPDATE jobs SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [jobId]
    );
    log.info({ jobId }, "Job completed");
  }

  fail(jobId: number, error: string, maxRetries = 3): void {
    const job = this.db
      .query<{ attempts: number }, [number]>("SELECT attempts FROM jobs WHERE id = ?")
      .get(jobId);

    const attempts = job?.attempts ?? 0;

    if (attempts < maxRetries) {
      // Retry later
      this.db.run(
        `UPDATE jobs SET status = 'pending', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [error, jobId]
      );
      log.warn({ jobId, attempts, maxRetries, error }, "Job failed, will retry");
    } else {
      // Max retries exceeded
      this.db.run(
        `UPDATE jobs SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [error, jobId]
      );
      log.error({ jobId, attempts, error }, "Job failed permanently");
    }
  }

  getPendingCount(): number {
    const result = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM jobs WHERE status = 'pending'")
      .get();
    return result?.count ?? 0;
  }
}

export const queueService = new QueueService();
