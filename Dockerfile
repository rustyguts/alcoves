# syntax=docker/dockerfile:1

# =============================================================================
# Alcoves unified production image
#
# A single image that runs the ENTIRE stack — the Go API, the async worker, and
# the SvelteKit (adapter-node) frontend including SSR share pages. The container
# entrypoint (docker/entrypoint.sh) supervises both runtimes. The entrypoint role
# argument (default "all") lets the SAME image run the whole stack or a single
# role (web | api | worker) for split Kubernetes deployments.
#
#   docker run -p 3000:3000 ghcr.io/rustyguts/alcoves      # whole stack, one port
#
# The SvelteKit server (:3000) serves the UI, SSRs /s/**, and proxies /api/** to
# the co-located Go API (:3001). In production, also publish :3001 and set
# PUBLIC_API_ORIGIN so browsers stream video/large files (and the activity
# WebSocket) directly from the API, bypassing the in-process proxy.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — Go binaries (API/worker + MCP) with native deps (ONNX Runtime).
# -----------------------------------------------------------------------------
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
    wget -q https://github.com/microsoft/onnxruntime/releases/download/v1.26.0/onnxruntime-linux-${ONNX_ARCH}-1.26.0.tgz && \
    tar -xzf onnxruntime-linux-${ONNX_ARCH}-1.26.0.tgz && \
    cp -r onnxruntime-linux-${ONNX_ARCH}-1.26.0/lib/* /usr/local/lib/ && \
    cp -r onnxruntime-linux-${ONNX_ARCH}-1.26.0/include/* /usr/local/include/ && \
    strip --strip-unneeded /usr/local/lib/libonnxruntime*.so* || true && \
    ldconfig && \
    rm -rf onnxruntime-linux-${ONNX_ARCH}-1.26.0*

WORKDIR /backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .

# Embed the source git commit + build time + app semver so the running binary
# can surface them at /api/version. CI passes these as --build-arg; if missing
# the version endpoint returns "dev" / "" and the UI hides the link.
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
# deps as the main binary, so it ships inside this same image.
RUN CGO_ENABLED=1 GOOS=linux go build \
    -buildvcs=false \
    -ldflags="-s -w \
      -X github.com/alcoves/alcoves-backend/internal/version.appVersion=${APP_VERSION}" \
    -o /alcoves-mcp ./cmd/mcp

# -----------------------------------------------------------------------------
# Stage 2 — whisper.cpp (whisper-cli). Models are fetched on demand at runtime.
# -----------------------------------------------------------------------------
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

# Portable CPU baselines, chosen per build architecture:
#   amd64 — AVX/AVX2/FMA/F16C + x86-64-v3 (AVX-512 explicitly OFF) so the binary
#           runs on any modern x86-64 host, not just the CI builder's CPU.
#   arm64 — armv8.2-a+fp16, the first ARM level with FP16 vector arithmetic and
#           below every Apple Silicon / Graviton generation; also avoids ggml's
#           fp16 NEON inline failure under Docker's arm64 VM.
# (The published CI image is amd64; the arm64 branch lets self-hosters and local
# builds work natively on ARM hardware.)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then \
      WHISPER_CMAKE_FLAGS="-DGGML_NATIVE=OFF -DGGML_CPU_ARM_ARCH=armv8.2-a+fp16"; \
    else \
      WHISPER_CMAKE_FLAGS="-DWHISPER_NATIVE=OFF -DGGML_NATIVE=OFF \
        -DWHISPER_AVX=ON -DWHISPER_AVX2=ON -DWHISPER_FMA=ON -DWHISPER_F16C=ON \
        -DWHISPER_AVX512=OFF -DWHISPER_AVX512_VBMI=OFF -DWHISPER_AVX512_VNNI=OFF \
        -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON \
        -DGGML_AVX512=OFF -DGGML_AVX512_VBMI=OFF -DGGML_AVX512_VNNI=OFF \
        -DCMAKE_C_FLAGS=-march=x86-64-v3 -DCMAKE_CXX_FLAGS=-march=x86-64-v3"; \
    fi && \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON ${WHISPER_CMAKE_FLAGS} && \
    cmake --build build -j --config Release

# -----------------------------------------------------------------------------
# Stage 3 — SvelteKit client (adapter-node → build/) + pruned prod node_modules.
# -----------------------------------------------------------------------------
FROM oven/bun:1 AS frontend-build

WORKDIR /app
COPY client/package.json client/bun.lock* ./
RUN bun install --frozen-lockfile

COPY client/ .
RUN bun run build

# adapter-node externalizes runtime deps (svelte, @sveltejs/kit, skeleton, …)
# from build/, so they must ship — but vite/eslint/playwright/etc. must not.
# Prune to production deps, leaving a lean (~150MB) node_modules.
RUN bun install --frozen-lockfile --production

# -----------------------------------------------------------------------------
# Stage 4 — final runtime: Debian slim + native libs + Bun + both apps.
# -----------------------------------------------------------------------------
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    tzdata \
    tini \
    libvips42 \
    ffmpeg \
    libgomp1 \
    libstdc++6 \
    libgcc-s1 \
    && rm -rf /var/lib/apt/lists/* /usr/share/doc/* /usr/share/man/* /usr/share/locale/*

# Native shared libs: ONNX Runtime (face/object detection) + whisper.cpp.
COPY --from=backend-build /usr/local/lib/libonnxruntime* /usr/local/lib/
COPY --from=whisper-build /src/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=whisper-build /src/build/src/ /tmp/whisper-src/
COPY --from=whisper-build /src/build/ggml/src/ /tmp/whisper-ggml/
RUN find /tmp/whisper-src -name 'libwhisper.so*' -exec cp -a {} /usr/local/lib/ \; && \
    find /tmp/whisper-ggml -name 'libggml*.so*' -exec cp -a {} /usr/local/lib/ \; && \
    rm -rf /tmp/whisper-src /tmp/whisper-ggml && \
    ln -sf /usr/local/lib/libonnxruntime.so /usr/local/lib/onnxruntime.so && \
    ldconfig

# Bun runtime for the Nitro server — copy just the static binary (no node/npm).
COPY --from=frontend-build /usr/local/bin/bun /usr/local/bin/bun

# The Go ONNX bindings call dlopen("onnxruntime.so") without an absolute path,
# and the bare symlink we created above is invisible to the ldconfig cache (it
# keys on SONAMEs). /usr/local/lib is not in dlopen's default fallback set
# either, so LD_LIBRARY_PATH is how dlopen resolves the symlink.
ENV LD_LIBRARY_PATH=/usr/local/lib

# Runtime defaults. The SvelteKit server (adapter-node) reads FRONTEND_* (svelte
# config envPrefix) so its PORT doesn't collide with the Go API's PORT in `all`
# mode. INTERNAL_API_URL points the SvelteKit /api proxy + SSR load at the
# co-located Go API. FRONTEND_PROTOCOL_HEADER/HOST_HEADER let adapter-node derive
# the request origin from the reverse proxy (no fixed ORIGIN needed).
# FRONTEND_BODY_SIZE_LIMIT must be unbounded or TUS chunk PATCHes are rejected.
ENV NODE_ENV=production \
    FRONTEND_HOST=0.0.0.0 \
    FRONTEND_PORT=3000 \
    FRONTEND_PROTOCOL_HEADER=x-forwarded-proto \
    FRONTEND_HOST_HEADER=x-forwarded-host \
    FRONTEND_BODY_SIZE_LIMIT=Infinity \
    PORT=3001 \
    ALCOVES_MODE=all \
    INTERNAL_API_URL=http://127.0.0.1:3001

WORKDIR /app
COPY --from=backend-build /alcoves ./alcoves
COPY --from=backend-build /alcoves-mcp ./alcoves-mcp
# SvelteKit adapter-node output + its pruned production node_modules + manifest.
COPY --from=frontend-build /app/build ./build
COPY --from=frontend-build /app/node_modules ./node_modules
COPY --from=frontend-build /app/package.json ./package.json
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# 3000 = SvelteKit (UI + SSR + /api proxy); 3001 = Go API (direct binary streaming).
EXPOSE 3000 3001

# No image-level HEALTHCHECK: the right probe depends on the role this container
# runs (SvelteKit on :3000 for all/web, the Go API on :3001 for api/worker), and a
# fixed :3000 check would wrongly mark api/worker-only containers unhealthy.
# Kubernetes uses its own per-workload probes; docker-compose.prod.yml defines a
# role-appropriate healthcheck for the default `all` service.

# tini as PID 1: reap zombies + deliver signals to the supervisor.
ENTRYPOINT ["/usr/bin/tini", "--", "/app/entrypoint.sh"]
CMD ["all"]
