FROM oven/bun:latest AS development
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
ENTRYPOINT ["./entrypoint.sh"]
CMD ["bun", "run", "dev", "--host"]

FROM oven/bun:latest AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun run build

FROM node:24 AS dist
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.output /app
COPY --from=build /app/server/database/migrations /app/server/database/migrations
EXPOSE 3000/tcp
# Set ALCOVES_MODE to "api" or "worker" to run in split mode.
# Default is "all" (API + workers in one process).
ENV ALCOVES_MODE=all
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1
ENTRYPOINT [ "node", "/app/server/index.mjs" ]