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
    wget https://github.com/microsoft/onnxruntime/releases/download/v1.24.1/onnxruntime-linux-${ONNX_ARCH}-1.24.1.tgz && \
    tar -xzf onnxruntime-linux-${ONNX_ARCH}-1.24.1.tgz && \
    cp -r onnxruntime-linux-${ONNX_ARCH}-1.24.1/lib/* /usr/local/lib/ && \
    cp -r onnxruntime-linux-${ONNX_ARCH}-1.24.1/include/* /usr/local/include/ && \
    ln -sf /usr/local/lib/libonnxruntime.so /usr/local/lib/onnxruntime.so && \
    ldconfig && \
    rm -rf onnxruntime-linux-${ONNX_ARCH}-1.24.1*

# Build whisper.cpp (whisper-cli) for transcription. Models are downloaded at runtime.
ARG WHISPER_VERSION=v1.8.4
RUN git clone --depth 1 --branch ${WHISPER_VERSION} https://github.com/ggerganov/whisper.cpp.git /tmp/whisper.cpp && \
    cd /tmp/whisper.cpp && \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON && \
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
