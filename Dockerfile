FROM golang:1.25 AS development
WORKDIR /app

ARG TAILWIND_CSS_BINARY=tailwindcss-linux-x64

RUN apt update && apt upgrade -y && \
  apt install -y --no-install-recommends \
  curl \
  unzip \
  build-essential \
  libvips-dev \
  libheif-dev \
  && rm -rf /var/lib/apt/lists/*

RUN curl -sLO https://github.com/tailwindlabs/tailwindcss/releases/latest/download/$TAILWIND_CSS_BINARY && \
  chmod +x $TAILWIND_CSS_BINARY && \
  mv $TAILWIND_CSS_BINARY /usr/local/bin/tailwindcss

RUN go install github.com/air-verse/air@latest
RUN go install github.com/a-h/templ/cmd/templ@latest
RUN go install github.com/swaggo/swag/cmd/swag@latest

COPY go.mod go.sum ./
RUN go mod download

COPY . .
EXPOSE 8080
RUN go generate ./cmd/server/main.go
CMD ["air"]

FROM development AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go generate ./cmd/server/main.go
RUN CGO_ENABLED=1 GOOS=linux go build -a -o main ./cmd/server

FROM debian:bookworm-slim AS dist
RUN apt-get update && apt-get install -y --no-install-recommends \
  libvips-dev \
  libheif-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/main /app/main
COPY --from=builder /app/static /app/static
EXPOSE 8080
CMD ["./main"]