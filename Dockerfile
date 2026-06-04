# syntax=docker/dockerfile:1

# Root Dockerfile builds the Go backend only. The Nuxt frontend ships as a
# separate image (see frontend/Dockerfile) and runs as its own service.

FROM golang:1.26-bookworm AS backend-build

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

# Embed the source git commit + build time + app semver so the running
# binary can surface them at /api/version (rendered by the admin panel as
# a link back to GitHub). CI passes these as --build-arg; if missing the
# version endpoint returns "dev" / "" and the UI hides the link.
ARG COMMIT_SHA=""
ARG BUILD_TIME=""
ARG APP_VERSION=""
RUN CGO_ENABLED=1 GOOS=linux go build \
    -buildvcs=false \
    -ldflags="-s -w \
      -X github.com/alcoves/alcoves-backend/internal/version.commit=${COMMIT_SHA} \
      -X github.com/alcoves/alcoves-backend/internal/version.buildTime=${BUILD_TIME} \
      -X github.com/alcoves/alcoves-backend/internal/version.appVersion=${APP_VERSION}" \
    -o /alcoves ./cmd/server

# alcoves-mcp: the stdio Model Context Protocol server. Shares the same native
# deps as the main binary (onnxruntime/libvips, linked transitively), so it
# runs inside this same image.
RUN CGO_ENABLED=1 GOOS=linux go build \
    -buildvcs=false \
    -ldflags="-s -w \
      -X github.com/alcoves/alcoves-backend/internal/version.appVersion=${APP_VERSION}" \
    -o /alcoves-mcp ./cmd/mcp

# whisper.cpp build stage — produces whisper-cli. Models are not bundled;
# they are fetched on demand by the transcribe worker.
FROM debian:bookworm-slim AS whisper-build

ARG WHISPER_VERSION=v1.8.4

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    git \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone --depth 1 --branch ${WHISPER_VERSION} https://github.com/ggerganov/whisper.cpp.git .
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON \
    -DWHISPER_NATIVE=OFF -DGGML_NATIVE=OFF \
    -DWHISPER_AVX=ON -DWHISPER_AVX2=ON -DWHISPER_FMA=ON -DWHISPER_F16C=ON \
    -DWHISPER_AVX512=OFF -DWHISPER_AVX512_VBMI=OFF -DWHISPER_AVX512_VNNI=OFF \
    -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
    -DGGML_AVX512=OFF -DGGML_AVX512_VBMI=OFF -DGGML_AVX512_VNNI=OFF \
    -DCMAKE_C_FLAGS="-march=x86-64-v3" -DCMAKE_CXX_FLAGS="-march=x86-64-v3" \
    && cmake --build build -j --config Release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    libvips42 \
    ffmpeg \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* /usr/share/locale/*

COPY --from=backend-build /usr/local/lib/libonnxruntime* /usr/local/lib/
COPY --from=whisper-build /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-build /src/build/src/ /tmp/whisper-src/
COPY --from=whisper-build /src/build/ggml/src/ /tmp/whisper-ggml/
RUN find /tmp/whisper-src -name 'libwhisper.so*' -exec cp -a {} /usr/local/lib/ \; && \
    find /tmp/whisper-ggml -name 'libggml*.so*' -exec cp -a {} /usr/local/lib/ \; && \
    rm -rf /tmp/whisper-src /tmp/whisper-ggml && \
    ln -sf /usr/local/lib/libonnxruntime.so /usr/local/lib/onnxruntime.so && \
    ldconfig

# The Go ONNX bindings call dlopen("onnxruntime.so", ...) without an
# absolute path. Resolution order is LD_LIBRARY_PATH -> ld.so.cache ->
# /lib(64) and /usr/lib(64). The ldconfig cache keys are SONAMEs (e.g.
# libonnxruntime.so.1), so the bare onnxruntime.so symlink we created
# above is invisible to it. /usr/local/lib is not in dlopen's default
# fallback set either. Setting LD_LIBRARY_PATH lets dlopen find the
# symlink without us having to maintain a SONAME-shaped wrapper.
# docker-compose.yml sets the same value for the dev image; this ENV
# makes the published prod image self-contained.
ENV LD_LIBRARY_PATH=/usr/local/lib

WORKDIR /app
COPY --from=backend-build /alcoves ./alcoves
COPY --from=backend-build /alcoves-mcp ./alcoves-mcp

EXPOSE 3001

ENTRYPOINT ["/app/alcoves"]
