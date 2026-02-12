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
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.output /app
COPY --from=build /app/server/database/migrations /app/server/database/migrations
EXPOSE 3000/tcp
ENTRYPOINT [ "node", "/app/server/index.mjs" ]