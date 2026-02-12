FROM oven/bun:latest AS development
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
ENTRYPOINT ["./entrypoint.sh"]
CMD ["bun", "--bun", "dev", "--host"]

FROM oven/bun:latest AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile --ignore-scripts
RUN bun --bun run build

FROM oven/bun:latest AS dist
WORKDIR /app
COPY --from=build /app/.output /app
COPY --from=build /app/server/database/migrations /app/server/database/migrations
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "--bun", "run", "/app/server/index.mjs" ]