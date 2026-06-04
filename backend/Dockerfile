FROM golang:1.26-bookworm

# Install build dependencies including libvips for image processing and ffmpeg for video transcoding
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    libvips-dev \
    ffmpeg \
    cmake \
    git \
    build-essential \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Download and install ONNX Runtime (detect architecture)
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then \
        ONNX_ARCH="aarch64"; \
    else \
        ONNX_ARCH="x64"; \
    fi && \
    wget https://github.com/microsoft/onnxruntime/releases/download/v1.26.0/onnxruntime-linux-${ONNX_ARCH}-1.26.0.tgz && \
    tar -xzf onnxruntime-linux-${ONNX_ARCH}-1.26.0.tgz && \
    cp -r onnxruntime-linux-${ONNX_ARCH}-1.26.0/lib/* /usr/local/lib/ && \
    cp -r onnxruntime-linux-${ONNX_ARCH}-1.26.0/include/* /usr/local/include/ && \
    ln -sf /usr/local/lib/libonnxruntime.so /usr/local/lib/onnxruntime.so && \
    ldconfig && \
    rm -rf onnxruntime-linux-${ONNX_ARCH}-1.26.0*

# Build whisper.cpp (whisper-cli) for transcription. Models are downloaded at runtime.
#
# On aarch64 (Apple Silicon under Docker Desktop's arm64 VM), ggml's default
# native detection does NOT enable the +fp16 target feature, so the ggml-cpu
# fp16 NEON intrinsics (e.g. vfmaq_f16) fail to inline with a "target specific
# option mismatch" error. Pin the ARM baseline to armv8.2-a+fp16 — the first
# arch level with FP16 vector arithmetic, and well below every Apple Silicon
# generation (M-series are armv8.4-a or newer), so the resulting binary runs on
# any host that can run this image. x86_64 keeps ggml's default native path.
ARG WHISPER_VERSION=v1.8.4
RUN ARCH=$(dpkg --print-architecture) && \
    if [ "$ARCH" = "arm64" ]; then \
        WHISPER_CMAKE_FLAGS="-DGGML_NATIVE=OFF -DGGML_CPU_ARM_ARCH=armv8.2-a+fp16"; \
    else \
        WHISPER_CMAKE_FLAGS=""; \
    fi && \
    git clone --depth 1 --branch ${WHISPER_VERSION} https://github.com/ggerganov/whisper.cpp.git /tmp/whisper.cpp && \
    cd /tmp/whisper.cpp && \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON ${WHISPER_CMAKE_FLAGS} && \
    cmake --build build -j --config Release && \
    install -m 0755 build/bin/whisper-cli /usr/local/bin/whisper-cli && \
    find build -name 'libwhisper.so*' -exec cp -a {} /usr/local/lib/ \; && \
    find build -name 'libggml*.so*' -exec cp -a {} /usr/local/lib/ \; && \
    ldconfig && \
    rm -rf /tmp/whisper.cpp

# Install Air for hot reload
RUN go install github.com/air-verse/air@latest

WORKDIR /app

# Allow `go build`'s VCS detection to read /app/.git when bind-mounted by
# docker compose (host UID rarely matches the container, so git would
# otherwise refuse with a "dubious ownership" error and the version
# endpoint would return an empty commit SHA).
RUN git config --global --add safe.directory /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

CMD ["air"]
