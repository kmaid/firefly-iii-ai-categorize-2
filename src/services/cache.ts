import { Database } from "bun:sqlite";
import { config } from "../config";
import { createChildLogger } from "../logger";
import { mkdirSync } from "fs";
import { dirname } from "path";

const log = createChildLogger("cache");

interface CachedCategory {
  merchantName: string;
  categoryName: string;
  categoryId: string;
  createdAt: string;
  updatedAt: string;
}

class CacheService {
  private db: Database;

  constructor() {
    mkdirSync(dirname(config.database.path), { recursive: true });
    this.db = new Database(config.database.path, { create: true });
    this.init();
  }

  private init() {
    log.info({ path: config.database.path }, "Initializing SQLite cache");

    this.db.run(`
      CREATE TABLE IF NOT EXISTS merchant_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        merchant_name TEXT UNIQUE NOT NULL,
        category_name TEXT NOT NULL,
        category_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    this.db.run(
      `CREATE INDEX IF NOT EXISTS idx_merchant_name ON merchant_categories(merchant_name)`
    );

    const count = this.db
      .query<{ count: number }, []>("SELECT COUNT(*) as count FROM merchant_categories")
      .get();

    log.info({ cachedMerchants: count?.count ?? 0 }, "Cache initialized");
  }

  get(merchantName: string): CachedCategory | null {
    const row = this.db
      .query<
        {
          merchant_name: string;
          category_name: string;
          category_id: string;
          created_at: string;
          updated_at: string;
        },
        [string]
      >(
        `SELECT merchant_name, category_name, category_id, created_at, updated_at
         FROM merchant_categories WHERE merchant_name = ?`
      )
      .get(merchantName);

    if (!row) {
      log.debug({ merchantName }, "Cache miss");
      return null;
    }

    log.debug({ merchantName, categoryName: row.category_name }, "Cache hit");

    return {
      merchantName: row.merchant_name,
      categoryName: row.category_name,
      categoryId: row.category_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  set(merchantName: string, categoryName: string, categoryId: string): void {
    this.db.run(
      `INSERT INTO merchant_categories (merchant_name, category_name, category_id)
       VALUES (?, ?, ?)
       ON CONFLICT(merchant_name) DO UPDATE SET
         category_name = excluded.category_name,
         category_id = excluded.category_id,
         updated_at = CURRENT_TIMESTAMP`,
      [merchantName, categoryName, categoryId]
    );

    log.info({ merchantName, categoryName }, "Cached merchant category");
  }

  updateFromOverride(merchantName: string, categoryName: string, categoryId: string): void {
    this.db.run(
      `UPDATE merchant_categories
       SET category_name = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE merchant_name = ?`,
      [categoryName, categoryId, merchantName]
    );

    log.info({ merchantName, categoryName }, "Updated cache from manual override");
  }

  invalidate(merchantName: string): void {
    this.db.run(`DELETE FROM merchant_categories WHERE merchant_name = ?`, [merchantName]);

    log.info({ merchantName }, "Invalidated cache entry");
  }
}

export const cacheService = new CacheService();
