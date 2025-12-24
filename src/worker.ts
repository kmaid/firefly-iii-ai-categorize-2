import { config } from "./config";
import { createChildLogger } from "./logger";
import { queueService, type Job } from "./services/queue";
import { cacheService } from "./services/cache";
import { fireflyService, type TransactionInfo } from "./services/firefly";
import { llmService } from "./services/llm";
import { searxngService } from "./services/searxng";

const log = createChildLogger("worker");

const POLL_INTERVAL_MS = 1000;

type CategoryDecision =
  | { source: "cache"; categoryId: string; categoryName: string }
  | { source: "firefly-override"; categoryId: string; categoryName: string }
  | { source: "llm"; categoryId: string; categoryName: string }
  | { source: "skip"; reason: string };

async function processJob(job: Job): Promise<void> {
  const jobLog = log.child({ jobId: job.id, transactionId: job.transactionId });

  jobLog.info({ merchantName: job.merchantName }, "Processing job");

  const decision = await decideCategory(job.merchantName, job.description, job.amount, jobLog);

  if (decision.source === "skip") {
    jobLog.info({ reason: decision.reason }, "Skipping categorization");
    return;
  }

  const tags: string[] = JSON.parse(job.tags);
  await fireflyService.updateTransactionCategory(job.transactionId, decision.categoryId, tags);

  jobLog.info(
    { source: decision.source, categoryName: decision.categoryName },
    "Transaction categorized"
  );
}

async function decideCategory(
  merchantName: string,
  description: string,
  amount: string,
  jobLog: typeof log
): Promise<CategoryDecision> {
  // Always fetch categories first to validate cache
  const categories = await fireflyService.getCategories();

  if (categories.length === 0) {
    return { source: "skip", reason: "No categories configured in Firefly" };
  }

  // Step 1: Check cache
  const cached = cacheService.get(merchantName);

  if (cached) {
    // Validate cached category still exists in Firefly
    const categoryExists = categories.some((c) => c.id === cached.categoryId);

    if (!categoryExists) {
      jobLog.warn(
        { merchantName, categoryName: cached.categoryName },
        "Cached category no longer exists, invalidating"
      );
      cacheService.invalidate(merchantName);
      // Fall through to LLM path
    } else {
      jobLog.debug({ merchantName, cached: cached.categoryName }, "Found in cache");

      // Step 2: Get recent transactions from Firefly to check for manual overrides
      const recentTxns = await fireflyService.getRecentTransactionsByMerchant(
        merchantName,
        config.firefly.historyLimit
      );

      const decision = analyzeHistory(cached, recentTxns, jobLog);

      if (decision.source === "firefly-override") {
        // Validate override category exists too
        const overrideExists = categories.some((c) => c.id === decision.categoryId);
        if (overrideExists) {
          cacheService.updateFromOverride(merchantName, decision.categoryName, decision.categoryId);
          return decision;
        }
        // Override category doesn't exist, fall through to LLM
        jobLog.warn({ categoryName: decision.categoryName }, "Override category no longer exists");
      } else {
        return decision;
      }
    }
  }

  // Step 3: Not in cache or cache invalidated - call LLM
  jobLog.debug({ merchantName }, "Querying LLM for categorization");

  const merchantContext = await searxngService.searchMerchant(merchantName);
  const recentTxns = await fireflyService.getRecentTransactionsByMerchant(
    merchantName,
    config.firefly.historyLimit
  );

  const llmResult = await llmService.categorize(
    categories,
    merchantName,
    description,
    amount,
    recentTxns,
    merchantContext ?? undefined
  );

  if (!llmResult.category) {
    return { source: "skip", reason: "LLM could not determine category" };
  }

  const category = categories.find((c) => c.name === llmResult.category);
  if (!category) {
    return { source: "skip", reason: `Category "${llmResult.category}" not found` };
  }

  cacheService.set(merchantName, category.name, category.id);

  return {
    source: "llm",
    categoryId: category.id,
    categoryName: category.name,
  };
}

function analyzeHistory(
  cached: { categoryName: string; categoryId: string },
  recentTxns: TransactionInfo[],
  jobLog: typeof log
): CategoryDecision {
  const categorized = recentTxns.filter((tx) => tx.categoryId && tx.categoryName);

  if (categorized.length === 0) {
    jobLog.debug("No categorized history, using cache");
    return {
      source: "cache",
      categoryId: cached.categoryId,
      categoryName: cached.categoryName,
    };
  }

  const allMatchCache = categorized.every((tx) => tx.categoryName === cached.categoryName);

  if (allMatchCache) {
    jobLog.debug("All history matches cache");
    return {
      source: "cache",
      categoryId: cached.categoryId,
      categoryName: cached.categoryName,
    };
  }

  const allDiffer = categorized.every((tx) => tx.categoryName !== cached.categoryName);

  if (allDiffer) {
    const mostRecent = categorized[0];
    jobLog.info(
      { cachedCategory: cached.categoryName, overrideCategory: mostRecent.categoryName },
      "Detected manual override"
    );
    return {
      source: "firefly-override",
      categoryId: mostRecent.categoryId!,
      categoryName: mostRecent.categoryName!,
    };
  }

  jobLog.debug("Mixed history, using cache");
  return {
    source: "cache",
    categoryId: cached.categoryId,
    categoryName: cached.categoryName,
  };
}

export function startWorker(): void {
  log.info({ pollInterval: POLL_INTERVAL_MS }, "Starting background worker");

  const poll = async () => {
    const job = queueService.dequeue();

    if (job) {
      try {
        await processJob(job);
        queueService.complete(job.id);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        queueService.fail(job.id, error);
      }
    }

    setTimeout(poll, job ? 0 : POLL_INTERVAL_MS);
  };

  poll();
}
