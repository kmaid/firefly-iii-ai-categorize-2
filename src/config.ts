import { logger } from "./logger";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    logger.fatal({ env: name }, "Missing required environment variable");
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

export const config = {
  port: parseInt(optionalEnv("PORT", "3000"), 10),
  logLevel: optionalEnv("LOG_LEVEL", "info"),

  firefly: {
    url: requireEnv("FIREFLY_URL").replace(/\/$/, ""),
    token: requireEnv("FIREFLY_PERSONAL_TOKEN"),
    tag: optionalEnv("FIREFLY_TAG", "AI categorized"),
    historyLimit: parseInt(optionalEnv("FIREFLY_HISTORY_LIMIT", "5"), 10),
    categoryCacheTtl: parseInt(optionalEnv("FIREFLY_CATEGORY_CACHE_TTL", "300"), 10), // seconds
  },

  openrouter: {
    apiKey: requireEnv("OPENROUTER_API_KEY"),
    model: optionalEnv("LLM_MODEL", "anthropic/claude-haiku-4.5"),
  },

  searxng: {
    url: process.env["SEARXNG_URL"] || null,
    timeout: parseInt(optionalEnv("SEARXNG_TIMEOUT", "3000"), 10),
  },

  database: {
    path: optionalEnv("DATABASE_PATH", "./data/cache.db"),
  },
} as const;
