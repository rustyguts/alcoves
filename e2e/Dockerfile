FROM golang:1.25

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install libvips (required by govips for image processing)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips-dev \
    libheif-dev \
    && rm -rf /var/lib/apt/lists/*

# Download Go dependencies (cached layer)
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

# Copy project (generated _templ.go and CSS files are committed to git)
COPY . .

# Install Playwright test deps + Chromium browser
WORKDIR /app/e2e
RUN npm ci && npx playwright install --with-deps chromium

ENV CI=true
CMD ["npx", "playwright", "test"]
