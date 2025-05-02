FROM golang:1.24-alpine AS build
RUN apk add --no-cache curl alpine-sdk

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download
RUN go install github.com/air-verse/air@latest

COPY . .

RUN CGO_ENABLED=1 GOOS=linux go build -o main cmd/api/main.go

CMD ["air", "--build.cmd", "CGO_ENABLED=1 GOOS=linux go build -o main cmd/api/main.go", "--build.bin", "./main"]

FROM alpine AS prod
WORKDIR /app
COPY --from=build /app/main /app/main
EXPOSE ${PORT}
CMD ["./main"]