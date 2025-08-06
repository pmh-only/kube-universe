FROM golang:1.24.5 AS builder

WORKDIR /workspace

COPY go.mod go.sum .

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg \
    go mod download

COPY cmd/ cmd/
COPY pkg/ pkg/
COPY web/ web/
COPY main.go .

RUN --mount=type=cache,target=/root/.cache/go-build \
    --mount=type=cache,target=/go/pkg \
    CGO_ENABLED=0 go build -ldflags="-s -w" .

FROM scratch AS final

USER 1000:1000

WORKDIR /app

COPY --from=builder /workspace/kube-universe .

ENTRYPOINT ["/app/kube-universe"]
CMD ["serve"]
