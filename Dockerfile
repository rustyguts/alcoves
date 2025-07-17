FROM golang:1.24 AS development
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  curl \
  unzip \
  build-essential \
  libvips-dev \
  libheif-dev \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN go install github.com/air-verse/air@latest
RUN go install github.com/swaggo/swag/cmd/swag@latest

COPY go.mod go.sum ./
RUN go mod download

COPY . .
EXPOSE 8080
CMD ["sh", "-c", "rm -rf /app/tmp/main && air"]

FROM golang:1.24 AS builder
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential \
  libvips-dev \
  libheif-dev \
  && rm -rf /var/lib/apt/lists/*

COPY go.mod go.sum ./
RUN go mod download
COPY . .
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