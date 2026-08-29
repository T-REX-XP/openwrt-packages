# mcudd Go rewrite — backlog

Track progress here. Update status as phases land.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 0 — Slim POC (current)

Goal: Go binary talks RDCP over UART (or mock), switches pages via FIFO, passes unit tests at 100% coverage on new code.

| ID | Task | Status |
|----|------|--------|
| P0-1 | Architecture doc | [x] |
| P0-2 | Backlog tracker | [x] |
| P0-3 | Go module + OpenWrt Makefile skeleton | [x] |
| P0-4 | `internal/rdcp` parse + build (parity with C) | [x] |
| P0-5 | `internal/pages` ring + boot screen | [x] |
| P0-6 | `internal/nav` rate-limit + pending ack | [x] |
| P0-7 | `internal/fifo` command dispatch | [x] |
| P0-8 | `internal/metrics` stub provider (all scopes) | [x] |
| P0-9 | `internal/daemon` engine + mock transport | [x] |
| P0-10 | `cmd/mcudd` Linux serial transport | [x] |
| P0-11 | Unit tests ≥95% on Phase 0 packages (100% on rdcp/pages/nav/…) | [x] |
| P0-12 | `scripts/run-tests.sh` + coverage gate | [x] |
| P0-13 | Hardware smoke: FIFO `next`/`screen` on CM5 | [ ] |

---

## Phase 1 — Metrics parity

| ID | Task | Status |
|----|------|--------|
| P1-1 | `metrics/system` — CPU, RAM, load, temp, uptime | [ ] |
| P1-2 | `metrics/network` — WAN ubus, rates, ping, ports | [ ] |
| P1-3 | `metrics/clients` — DHCP, Wi-Fi station counts | [ ] |
| P1-4 | `metrics/storage` — root/overlay/emmc/swap | [ ] |
| P1-5 | `metrics/wifi` — SSID, enc, QR string | [ ] |
| P1-6 | `metrics/security` — firewall, blocky, VPN | [ ] |
| P1-7 | `metrics/alarms` — demo_mode fixture | [ ] |
| P1-8 | Legacy `{"request":"…"}` flat responses | [ ] |
| P1-9 | Port C unit tests → Go table tests | [ ] |

---

## Phase 2 — Production cutover

| ID | Task | Status |
|----|------|--------|
| P2-1 | UCI loader (`/etc/config/mcud`) full parity | [x] |
| P2-2 | `transport/serial` termios (DTR/RTS clear, 8N1) | [x] |
| P2-3 | Sidecar files: active_screen, fw version, link_test | [x] |
| P2-4 | Boot state reader + `leave_boot` idle poll | [x] |
| P2-5 | Poweroff on RDCP req | [ ] |
| P2-6 | LuCI package depends on Go `mcudd`; C sources in `mcudd-old` | [x] |
| P2-7 | CI: cross-compile `aarch64` + run unit tests | [ ] |
| P2-8 | Deploy CM5 soak 24 h; link-test in post-flash checklist | [ ] |

---

## Phase 3 — Optimizations

| ID | Task | Status |
|----|------|--------|
| P3-1 | Metrics cache + scope TTL from UCI intervals | [ ] |
| P3-2 | ubus client (no shell) for network/Wi-Fi | [ ] |
| P3-3 | Optional `pages.json` loader (replace hardcoded ring) | [ ] |
| P3-4 | pprof / memory profiling on CM5 | [ ] |
| P3-5 | MessagePack wire_format (if firmware adds support) | [ ] |

---

## Acceptance criteria (release)

- [ ] `mcud-link-test.sh` → `ping_ok` + `echo_ok`
- [ ] LuCI page nav (prev/next/screen) works under load
- [ ] All metric scopes match C daemon JSON shape (snapshot tests)
- [ ] Binary ≤ 3 MiB stripped on `aarch64_generic`
- [ ] No regression on button hotplug → FIFO

---

## Changelog

| Date | Note |
|------|------|
| 2026-08-29 | UART RX debug: [tty-rx-debug-2026-08-29.md](tty-rx-debug-2026-08-29.md) — mcudd **does** read ttyS2; flashed FW is TX-beacon stub (no echo/screen evt); leave-boot storm + `ping_ok` false positive |
| 2026-08-29 | Config: full UCI + JSON loader, `-config` / `-dump-config` |
| 2026-08-28 | Phase 0 started: docs + Go POC scaffold |
