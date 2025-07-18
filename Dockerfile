FROM golang:1.24 AS development
WORKDIR /app

RUN apt update && apt upgrade -y && \
  apt install -y --no-install-recommends \
  curl \
  unzip \
  build-essential \
  libvips-dev \
  libheif-dev \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.com/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN go install github.com/air-verse/air@latest
RUN go install github.com/swaggo/swag/cmd/swag@latest

COPY go.mod go.sum ./
RUN go mod download

COPY . .
EXPOSE 8080
CMD ["sh", "-c", "rm -rf /app/tmp/main && air"]

FROM development AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN cd web && bun install && bun run build
RUN CGO_ENABLED=1 GOOS=linux go build -a -o main ./cmd/server

FROM debian:bookworm-slim AS dist
RUN apt-get update && apt-get install -y --no-install-recommends \
  libvips-dev \
  libheif-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/main /app/main
COPY --from=builder /app/web /app/web
EXPOSE 8080
CMD ["./main"]