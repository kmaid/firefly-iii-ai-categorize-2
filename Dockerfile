FROM oven/bun:alpine

WORKDIR /app

# Install SQLite CLI for debugging
RUN apk add --no-cache sqlite

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY src ./src

# Create data directory for SQLite
RUN mkdir -p /app/data
VOLUME /app/data

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/cache.db

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
