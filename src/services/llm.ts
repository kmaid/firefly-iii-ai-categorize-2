import { OpenRouter } from "@openrouter/sdk";
import { config } from "../config";
import { createChildLogger } from "../logger";
import type { Category, TransactionInfo } from "./firefly";

const log = createChildLogger("llm");

interface LLMResponse {
  category: string | null;
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

const openrouter = new OpenRouter({
  apiKey: config.openrouter.apiKey,
});

class LLMService {
  async categorize(
    categories: Category[],
    destinationName: string,
    description: string,
    amount: string,
    recentTransactions: TransactionInfo[],
    merchantContext?: string
  ): Promise<LLMResponse> {
    const categoryNames = categories.map((c) => c.name);

    const systemPrompt = this.buildSystemPrompt(categoryNames);
    const userPrompt = this.buildUserPrompt(
      destinationName,
      description,
      amount,
      recentTransactions,
      merchantContext
    );

    log.debug(
      { destinationName, model: config.openrouter.model },
      "Calling LLM for categorization"
    );

    try {
      const completion = await openrouter.chat.send({
        model: config.openrouter.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        maxTokens: 200,
      });

      const rawContent = completion.choices?.[0]?.message?.content;
      const content = typeof rawContent === "string" ? rawContent : "";

      log.debug({ response: content }, "LLM response received");

      return this.parseResponse(content, categoryNames);
    } catch (err) {
      log.error({ err }, "LLM request failed");
      throw err;
    }
  }

  private buildSystemPrompt(categories: string[]): string {
    return `You are a financial transaction categorizer. Your job is to assign transactions to the most appropriate category.

Available categories:
${categories.map((c) => `- ${c}`).join("\n")}

Rules:
1. ONLY respond with a category name from the list above
2. If you're unsure, pick the closest match
3. Response format: Just the category name, nothing else
4. Be consistent - similar merchants should have the same category`;
  }

  private buildUserPrompt(
    destinationName: string,
    description: string,
    amount: string,
    recentTransactions: TransactionInfo[],
    merchantContext?: string
  ): string {
    let prompt = `Categorize this transaction:
- Merchant: ${destinationName}
- Description: ${description}
- Amount: ${amount}`;

    if (merchantContext) {
      prompt += `\n\nMerchant context from web search:\n${merchantContext}`;
    }

    if (recentTransactions.length > 0) {
      const categorized = recentTransactions.filter((t) => t.categoryName);
      if (categorized.length > 0) {
        prompt += `\n\nPrevious transactions from this merchant:`;
        for (const tx of categorized.slice(0, 3)) {
          prompt += `\n- "${tx.description}" → ${tx.categoryName}`;
        }
      }
    }

    prompt += "\n\nCategory:";
    return prompt;
  }

  private parseResponse(content: string, validCategories: string[]): LLMResponse {
    const cleaned = content.trim().replace(/^["']|["']$/g, "");

    // Try exact match first
    const exactMatch = validCategories.find((c) => c.toLowerCase() === cleaned.toLowerCase());

    if (exactMatch) {
      log.info({ category: exactMatch }, "LLM categorization result");
      return {
        category: exactMatch,
        confidence: "high",
        reasoning: "Exact match from LLM",
      };
    }

    // Try partial match
    const partialMatch = validCategories.find(
      (c) =>
        c.toLowerCase().includes(cleaned.toLowerCase()) ||
        cleaned.toLowerCase().includes(c.toLowerCase())
    );

    if (partialMatch) {
      log.info({ category: partialMatch, original: cleaned }, "LLM partial match");
      return {
        category: partialMatch,
        confidence: "medium",
        reasoning: `Partial match: "${cleaned}" → "${partialMatch}"`,
      };
    }

    log.warn({ response: cleaned, validCategories }, "LLM returned invalid category");
    return {
      category: null,
      confidence: "low",
      reasoning: `Invalid response: "${cleaned}"`,
    };
  }
}

export const llmService = new LLMService();
