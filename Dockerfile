# Stage 1: Build frontend
FROM oven/bun:1 AS frontend-build

WORKDIR /frontend
COPY frontend/package.json frontend/bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts
COPY frontend/ .
RUN bun run build

# Stage 2: Build Go binary with embedded frontend
FROM golang:1.25-bookworm AS backend-build

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    wget \
    build-essential \
    pkg-config \
    libvips-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then \
      ONNX_ARCH="aarch64"; \
    else \
      ONNX_ARCH="x64"; \
    fi && \
    wget -q https://github.com/microsoft/onnxruntime/releases/download/v1.24.1/onnxruntime-linux-${ONNX_ARCH}-1.24.1.tgz && \
    tar -xzf onnxruntime-linux-${ONNX_ARCH}-1.24.1.tgz && \
    cp -r onnxruntime-linux-${ONNX_ARCH}-1.24.1/lib/* /usr/local/lib/ && \
    cp -r onnxruntime-linux-${ONNX_ARCH}-1.24.1/include/* /usr/local/include/ && \
    strip --strip-unneeded /usr/local/lib/libonnxruntime*.so* || true && \
    ldconfig && \
    rm -rf onnxruntime-linux-${ONNX_ARCH}-1.24.1*

WORKDIR /backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .

# Copy the built frontend dist into the spa package for embedding
COPY --from=frontend-build /frontend/dist ./internal/spa/dist

RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w" -o /alcoves ./cmd/server

# Stage 3: Minimal production image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    libvips42 \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* /usr/share/locale/*

COPY --from=backend-build /usr/local/lib/libonnxruntime* /usr/local/lib/
RUN ldconfig

WORKDIR /app
COPY --from=backend-build /alcoves ./alcoves

EXPOSE 3001

ENTRYPOINT ["/app/alcoves"]
