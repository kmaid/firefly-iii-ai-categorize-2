# Firefly III AI Categorize

AI-powered transaction categorization for Firefly III using OpenRouter.

## How It Works

```mermaid
flowchart TD
    Webhook[Incoming Transaction] --> Queue[Enqueue Job]
    Queue --> CheckCache{Merchant in cache?}

    CheckCache -->|Yes| ValidateCache[Validate cached category exists]
    ValidateCache -->|Invalid| InvalidateCache[Invalidate cache]
    ValidateCache -->|Valid| FetchHistory1[Fetch last N txns from merchant]

    FetchHistory1 --> Compare{Compare categories}
    Compare -->|All match cache| UseCache[Use cached category]
    Compare -->|All differ| UseFirefly[Use Firefly category - manual override detected]
    Compare -->|Mixed/None| UseCache

    CheckCache -->|No| LLMPath[Prepare LLM context]
    InvalidateCache --> LLMPath

    LLMPath --> FetchHistory2[Fetch last N txns from merchant]
    FetchHistory2 --> SearchWeb[Optional: SearXNG merchant search]
    SearchWeb --> CallLLM[Call OpenRouter LLM]
    CallLLM --> SaveCache[Cache result]

    UseCache --> Update[Update transaction category]
    UseFirefly --> UpdateCache[Update cache with override]
    UpdateCache --> Update
    SaveCache --> Update
```

## Setup

```bash
cp .env.example .env
# Edit .env with your credentials

# Development
bun run dev

# Production (Docker)
docker compose up -d
```

## Webhook Configuration

In Firefly III, create a webhook:

- **URL**: `http://your-host:3000/webhook`
- **Trigger**: Store transaction
- **Response**: Transaction

## License

MIT
