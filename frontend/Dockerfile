# syntax=docker/dockerfile:1

# Stage 1: Install deps + build the Nuxt app
FROM oven/bun:1 AS build

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

# Stage 2: Minimal runtime image with Node to run the Nitro server.
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV NITRO_HOST=0.0.0.0
ENV NITRO_PORT=3000

COPY --from=build /app/.output ./.output

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
