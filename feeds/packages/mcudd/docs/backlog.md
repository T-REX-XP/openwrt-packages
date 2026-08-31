# mcudd + firmware COM rewrite — backlog

Track progress here. Shared IDs with `esp32-smartdisplay-demo/docs/REWRITE_BACKLOG.md`.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done

---

## R0 — Contract

| ID | Task | Status |
|----|------|--------|
| R0-1 | Golden RDCP traces (`testdata/rdcp/*.jsonl`) | [x] |
| R0-2 | Host backlog tracker | [x] |
| R0-3 | Firmware backlog tracker | [x] |
| R0-4 | `check-rdcp-fixtures.sh` sibling sync | [x] |

---

## R1 — Host (mcudd)

| ID | Task | Status |
|----|------|--------|
| R1-1 | `internal/proto` parse/build + golden replay | [x] |
| R1-2 | `internal/session` ping/echo ID matching | [x] |
| R1-3 | `internal/engine` startup, FIFO, leave-boot cap | [x] |
| R1-4 | pages.json loader + stub metrics | [x] |
| R1-5 | Mock COM + 100% `go test ./internal/...` | [x] |
| R1-6 | cmd wiring (lock, FIFO, serial, signals) | [x] |

---

## R2 — Firmware

| ID | Task | Status |
|----|------|--------|
| R2-1 | `src/proto` host-testable C parse/build | [x] |
| R2-2 | `src/app` swipe emits `evt screen` only (no `evt input`) | [x] |
| R2-3 | Host gcc tests 100% of proto+app | [x] |
| R2-4 | Rebind LVGL / UART2 / BOOT | [x] |
| R2-5 | Remove txbeacon env | [x] |

---

## R3 — Hardware

| ID | Task | Status |
|----|------|--------|
| R3-1 | Flash `esp32-2432S022C-router` | [x] |
| R3-2 | Deploy aarch64 `mcudd` to CM5 | [x] |
| R3-3 | RDCP ping+echo+screen on COM (USB verify) | [x] |
| R3-4 | FIFO `next`/`screen` on CM5 (ack pending USB unplug) | [x] |
| R3-5 | `mcud-link-test.sh` on ttyS2 after USB unplug | [ ] |

---

## Changelog

| Date | Note |
|------|------|
| 2026-08-29 | Flashed panel + deployed mcudd; USB RDCP ping/echo/screen OK; ttyS2 blocked while USB holds GPIO1/3 |
| 2026-08-29 | Host + firmware engines rewritten; unit gates at 100% |
| 2026-08-29 | Rewrite started: shared RDCP fixtures + dual backlogs |
