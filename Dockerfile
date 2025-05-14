FROM golang:1.24 AS dev
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

COPY go.mod go.sum ./
RUN go mod download
RUN go install github.com/air-verse/air@latest

COPY . .

EXPOSE 3000
CMD ["air"]

FROM dev AS build

RUN CGO_ENABLED=1 GOOS=linux go build -o main cmd/server/main.go

FROM debian:bookworm-slim AS dist
RUN apt-get update && apt-get install -y --no-install-recommends \
  libvips-dev \
  libheif-dev \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/main /app/main
COPY --from=build /app/web /app/web
EXPOSE 3000
CMD ["./main"]
