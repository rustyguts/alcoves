FROM golang:1.24-alpine AS dev
RUN apk add --no-cache curl alpine-sdk vips-dev vips-heif

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download
RUN go install github.com/air-verse/air@latest

COPY . .

EXPOSE 3000
CMD ["air", "--build.cmd", "go build -o /tmp/main cmd/server/main.go", "--build.bin", "/tmp/main"]

FROM dev AS build

RUN CGO_ENABLED=1 GOOS=linux go build -o main cmd/server/main.go

FROM alpine AS dist
WORKDIR /app
COPY --from=build /app/main /app/main
EXPOSE 3000
CMD ["./main"]
