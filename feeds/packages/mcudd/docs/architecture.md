# mcudd (Go) — Architecture

Replace the C `mcudd` daemon with a single static Go binary optimized for ImmortalWrt on **aarch64** / **musl**, keeping wire compatibility with ESP32 RDCP v1 firmware.

## Goals

| Goal | Rationale |
|------|-----------|
| **Small static binary** | `CGO_ENABLED=0`, `-ldflags="-s -w"`, strip debug — target &lt; 3 MiB on router |
| **Testability** | Pure packages + interfaces; no shelling out in protocol/nav layers |
| **Parity** | Same FIFO paths, `/tmp/mcud_*` sidecars, LuCI rpcd unchanged |
| **Incremental cutover** | POC → metrics → procd; C binary kept until Go passes link-test + soak |

## Layer diagram

```text
┌─────────────────────────────────────────────────────────────┐
│ cmd/mcudd          CLI, signals, flock, UCI load, procd     │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│ internal/daemon    poll loop, startup sequence, dispatch    │
│   ├─ nav           screen ack, rate-limit, pending cmd      │
│   ├─ fifo          prev/next/screen/ping/echo/ready       │
│   └─ state         /tmp/mcud_* writers                      │
└───────┬───────────────────────────────┬─────────────────────┘
        │                               │
┌───────▼────────┐              ┌───────▼────────┐
│ internal/proto │              │ internal/metrics│
│ parse/build    │              │ scope providers │
└───────┬────────┘              └────────────────┘
        │
┌───────▼────────┐     ┌─────────────────┐
│ transport      │     │ internal/pages  │
│ Serial / Mock  │     │ ring + boot id  │
└────────────────┘     └─────────────────┘
```

## Runtime model

1. **Single instance** — `flock` on `/var/run/mcudd.lock`.
2. **Dual input** — `poll(2)` on UART + command FIFO (`/var/run/mcudd.fifo`).
3. **Line protocol** — newline-delimited frames (`wire_format=json` today; `msgpack` reserved), max line from UCI `max_line` (default 4096).
4. **Config** — `/etc/config/mcud` (UCI only); CLI `-config` / `-dump-config`. Host version is baked into the binary (`mcudd -version-json`).
5. **Startup TX sequence** (unchanged from C):
   - `push boot` → `push config` → `push hello` → `req version`
   - `leave_boot` if `/tmp/mcud_state` stage=`ready`
6. **Inbound dispatch**:
   - `req metrics` → scope provider → `res` with same `id`
   - `evt screen` → update active screen + sidecar (LuCI poll)
   - `evt input` → write sidecar immediately (LuCI follows swipe), then `cmd screen` if not rate-limited
   - `evt version` / `res pong` / `evt echo` → link-test sidecars
   - legacy `{"request":"cpu"}` → flat JSON (Phase 2 metrics)
7. **Outbound nav** — FIFO next/prev writes the sidecar immediately; swipe uses `evt input` + `evt screen`.

## Package boundaries

| Package | Responsibility | External deps |
|---------|----------------|-----------------|
| `proto` | Frame parse/build, scope names | none |
| `session` | Outstanding ping/echo IDs | none |
| `pages` | Screen IDs, neighbor ring, pages.json | none |
| `nav` | Pending ack, 450 ms cooldown, 2.5 s timeout | `pages` |
| `fifo` | Parse FIFO command lines | `pages` |
| `metrics` | Scope → JSON payload | `/proc`, ubus (later) |
| `config` | UCI → struct | file parse |
| `transport` | `ReadLine` / `WriteLine` | `termios` on Linux |
| `engine` | Orchestration, capped leave-boot | all above |
| `version` | Stack/release/rdcp constants | compile-time |

## Metrics strategy (post-POC)

| Scope | Source | Go approach |
|-------|--------|-------------|
| system | `/proc`, thermal | `os.ReadFile` + parsers |
| network | ubus, `/proc/net/dev` | `github.com/fullstorydev/goubus` or exec ubus CLI |
| clients | dhcp.leases, iwinfo | file parse + optional exec |
| storage | statvfs | `syscall.Statfs` |
| wifi | `/etc/config/wireless` | UCI parse |
| security | firewall, blocky API | HTTP localhost + UCI |
| alarms | demo fixture | UCI `demo_mode` |

Background ping goroutine writes `/tmp/mcud_wan_ping` (same as C).

## OpenWrt integration

- **Package:** `feeds/packages/mcudd` (Go, `golang-package.mk`)
- **LuCI:** `luci-app-mcu-display` depends on `mcudd`; init script unchanged
- **Install:** `/usr/sbin/mcudd` (Go binary replaces C artifact)
- **Conffiles:** `/etc/config/mcud` (owned by LuCI package)

## Performance targets (CM5)

| Metric | Target |
|--------|--------|
| Idle RSS | &lt; 8 MiB |
| Metrics `network` scope | &lt; 50 ms p99 (cached rates) |
| Nav command → UART TX | &lt; 5 ms (no rate-limit) |
| Binary size (stripped) | &lt; 3 MiB |

## Testing

- **Unit:** `go test ./internal/... -cover` — 100% on logic packages (`scripts/run-tests.sh`)
- **Integration:** mock transport replays RDCP lines; asserts TX frames
- **Hardware:** `mcud-link-test.sh` on CM5 (ping + echo)
- **CI:** `scripts/run-tests.sh` in package + reusable workflow job

## Security

- FIFO mode `0600`, root-only
- No network listeners
- JSON line length capped (`max_line`)
- `poweroff` only on explicit RDCP `req op=poweroff`

## Version sync

Generate `internal/version/version.go` from shared `mcud-version.json` (same script as C/LuCI). Strict match on `stack`, `release`, `rdcp` for firmware sync flag.
