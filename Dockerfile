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
CMD ["air"]

FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o main .

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