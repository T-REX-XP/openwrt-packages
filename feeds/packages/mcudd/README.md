# mcudd (Go)

Go rewrite of the CM5 MCU display daemon. Speaks **RDCP v1** JSON over UART to ESP32 firmware.

## Phase 0 (POC)

- RDCP parse/build (`internal/rdcp`)
- Page ring + nav rate-limit (`internal/pages`, `internal/nav`)
- FIFO commands: `prev`, `next`, `screen`, `ping`, `echo`, `ready`, …
- Daemon engine with mock transport (`internal/daemon`)
- Stub metrics for all scopes (`internal/metrics`)
- Linux serial transport (`internal/transport`, build tag `linux`)

## Dev

```bash
cd feeds/packages/mcudd
./scripts/run-tests.sh          # unit tests, ≥95% coverage gate
go build -o mcudd ./cmd/mcudd   # host build (serial needs linux or MCUDD_MOCK=1)
MCUDD_MOCK=1 ./mcudd --version
```

## Docs

- [architecture.md](docs/architecture.md)
- [backlog.md](docs/backlog.md)

## Router deploy (after OpenWrt package integration)

Replace C binary from `luci-app-mcu-display` with this package’s `/usr/sbin/mcudd`. LuCI, init, FIFO, and `/tmp/mcud_*` sidecars stay unchanged.
