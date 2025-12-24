import { client } from "../generated/client.gen";
import { listCategory, searchTransactions, updateTransaction } from "../generated/sdk.gen";
import { config } from "../config";
import { createChildLogger } from "../logger";

const log = createChildLogger("firefly");

// Configure the client
client.setConfig({
  baseUrl: `${config.firefly.url}/api`,
  headers: {
    Authorization: `Bearer ${config.firefly.token}`,
  },
});

export interface Category {
  id: string;
  name: string;
}

export interface TransactionInfo {
  id: string;
  description: string;
  destinationName: string;
  categoryId: string | null;
  categoryName: string | null;
  amount: string;
  date: string;
}

class FireflyService {
  private categoryCache: Category[] | null = null;
  private categoryCacheTime: number = 0;

  async getCategories(): Promise<Category[]> {
    const now = Date.now();
    const ttlMs = config.firefly.categoryCacheTtl * 1000;

    // Return cached if still valid
    if (this.categoryCache && now - this.categoryCacheTime < ttlMs) {
      log.debug({ count: this.categoryCache.length }, "Using cached categories");
      return this.categoryCache;
    }

    log.debug("Fetching categories from Firefly");

    const response = await listCategory({
      client,
    });

    if (response.error) {
      log.error({ error: response.error }, "Failed to fetch categories");
      throw new Error("Failed to fetch categories");
    }

    const categories =
      response.data?.data?.map((cat) => ({
        id: cat.id,
        name: cat.attributes?.name ?? "",
      })) ?? [];

    // Update cache
    this.categoryCache = categories;
    this.categoryCacheTime = now;

    log.info(
      { count: categories.length, ttl: config.firefly.categoryCacheTtl },
      "Fetched categories"
    );
    return categories;
  }

  invalidateCategoryCache(): void {
    this.categoryCache = null;
    this.categoryCacheTime = 0;
    log.debug("Category cache invalidated");
  }

  async getRecentTransactionsByMerchant(
    merchantName: string,
    limit = 5
  ): Promise<TransactionInfo[]> {
    log.debug({ merchantName, limit }, "Searching recent transactions");

    const response = await searchTransactions({
      client,
      query: {
        query: `destination_is:"${merchantName}"`,
        limit,
      },
    });

    if (response.error) {
      log.error({ error: response.error, merchantName }, "Failed to search transactions");
      throw new Error("Failed to search transactions");
    }

    const transactions: TransactionInfo[] = [];

    for (const txGroup of response.data?.data ?? []) {
      const tx = txGroup.attributes?.transactions?.[0];
      if (tx) {
        transactions.push({
          id: txGroup.id,
          description: tx.description ?? "",
          destinationName: tx.destination_name ?? "",
          categoryId: tx.category_id ?? null,
          categoryName: tx.category_name ?? null,
          amount: tx.amount ?? "0",
          date: tx.date ?? "",
        });
      }
    }

    log.info({ merchantName, count: transactions.length }, "Found recent transactions");
    return transactions;
  }

  async updateTransactionCategory(
    transactionId: string,
    categoryId: string,
    existingTags: string[] = []
  ): Promise<void> {
    const tags = [...existingTags];
    if (!tags.includes(config.firefly.tag)) {
      tags.push(config.firefly.tag);
    }

    log.debug({ transactionId, categoryId, tags }, "Updating transaction");

    const response = await updateTransaction({
      client,
      path: { id: transactionId },
      body: {
        apply_rules: false,
        fire_webhooks: false,
        transactions: [
          {
            category_id: categoryId,
            tags,
          },
        ],
      },
    });

    if (response.error) {
      log.error({ error: response.error, transactionId }, "Failed to update transaction");
      throw new Error("Failed to update transaction");
    }

    log.info({ transactionId, categoryId }, "Transaction updated");
  }
}

export const fireflyService = new FireflyService();
