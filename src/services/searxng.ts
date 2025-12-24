import { config } from "../config";
import { createChildLogger } from "../logger";

const log = createChildLogger("searxng");

interface SearXNGResult {
  title: string;
  content: string;
  url: string;
}

class SearXNGService {
  async searchMerchant(merchantName: string): Promise<string | null> {
    if (!config.searxng.url) {
      log.debug("SearXNG not configured, skipping");
      return null;
    }

    log.debug({ merchantName }, "Searching for merchant context");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.searxng.timeout);

    try {
      const url = new URL("/search", config.searxng.url);
      url.searchParams.set("q", `${merchantName} company business`);
      url.searchParams.set("format", "json");
      url.searchParams.set("categories", "general");
      url.searchParams.set("language", "en");

      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        log.warn({ status: response.status }, "SearXNG request failed");
        return null;
      }

      const data = await response.json();
      const results: SearXNGResult[] = data.results?.slice(0, 3) ?? [];

      if (results.length === 0) {
        log.debug({ merchantName }, "No search results found");
        return null;
      }

      // Build a concise summary
      const summary = results
        .map((r) => `${r.title}: ${r.content}`)
        .join("\n")
        .slice(0, 500);

      log.info({ merchantName, resultCount: results.length }, "Found merchant context");
      return summary;
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        log.warn({ merchantName }, "SearXNG request timed out");
      } else {
        log.error({ err, merchantName }, "SearXNG request error");
      }
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const searxngService = new SearXNGService();
