FROM golang:1.25-bookworm

# Install build dependencies including libvips for image processing and ffmpeg for video transcoding
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    libvips-dev \
    ffmpeg \
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

# Install Air for hot reload
RUN go install github.com/air-verse/air@latest

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

CMD ["air"]
