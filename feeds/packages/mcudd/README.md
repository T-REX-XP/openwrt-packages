# mcudd (Go)

Go rewrite of the CM5 MCU display daemon. Speaks **RDCP v1** over UART to ESP32 firmware.

## Configuration

mcudd and **luci-app-mcu-display** share one settings file:

| Layer | Path |
|-------|------|
| LuCI UI | Services → MCU Display → Configuration |
| OpenWrt UCI | `/etc/config/mcud` |
| Optional JSON | `/etc/mcudd/config.json` (CLI / no UCI) |

Load order: `-config PATH` → UCI → JSON → built-in defaults.

```bash
mcudd -dump-config
mcudd -config /etc/config/mcud -dump-config
uci show mcud
```

### Key options

| Option | Values | Purpose |
|--------|--------|---------|
| `enable` | `0`/`1` | Start daemon |
| `path` | device path | UART device (`/dev/ttyS2`, `/dev/ttyUSB0`, …) |
| `baud` | int | Baud rate (default `115200`) |
| `wire_format` | `json` \| `msgpack` | Framing (`msgpack` accepted in config, runtime falls back to JSON until Phase 3) |
| `max_line` | int ≥ 64 | Max RDCP line length |
| `demo_mode` | `0`/`1` | Stub/demo metrics |
| `screen_timeout` | seconds | Idle timeout (`0` = off via mode) |
| `screen_timeout_mode` | `off` \| `dim` \| `blank` | Idle action |
| `wan_if` / `lan_if` / `wifi_if` | interface names | Metrics sources |
| `interval_system` / `interval_network` | ms | Metrics cache TTLs |
| `log_level` | `error`\|`warn`\|`info`\|`debug` | Log verbosity |
| `debug_serial` | `0`/`1` | Log UART TX/RX lines |
| `pages` | path | Page ring JSON |

Example JSON: `files/etc/mcudd/config.json.example`.

UCI example (LuCI **Services → MCU Display** edits the same file):

```text
config mcud 'main'
	option enable '1'
	option path '/dev/ttyS2'
	option baud '115200'
	option wire_format 'json'
	option debug_serial '1'
```

## Dev

```bash
cd feeds/packages/mcudd
./scripts/run-tests.sh
go build -o mcudd ./cmd/mcudd
MCUDD_MOCK=1 ./mcudd -version
MCUDD_MOCK=1 ./mcudd -dump-config
```

## Docs

- [architecture.md](docs/architecture.md)
- [backlog.md](docs/backlog.md)
