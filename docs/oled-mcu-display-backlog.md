# OLED + MCU display — review, debug UART design & backlog

> **Superseded (2026-08-28):** CM5 firmware no longer ships `luci-app-oled`. See **[mcu-display-migration-backlog.md](mcu-display-migration-backlog.md)** for the active plan.

*Created: 2026-08-28. Was: `luci-app-oled` (r49), `luci-app-mcu-display` (r12).*

**Related docs**

| Doc | Role |
|-----|------|
| [oledd-review-and-improvement-plan.md](oledd-review-and-improvement-plan.md) | OLED deep review (2026-06-25) + P0/P1/P2 tasks |
| [luci-app-mcu-display-system-design.md](luci-app-mcu-display-system-design.md) | RDCP v1, `mcudd`, LuCI, ESP32 phases |
| [cm5-waveshare-oled-hat-wiring.md](cm5-waveshare-oled-hat-wiring.md) | FPC I2C7 + RST harness (OLED only) |
| [oled-menu.md](oled-menu.md) | Original menu design goals |
| [oledd-lifecycle-and-events.md](oledd-lifecycle-and-events.md) | Runtime reference |

---

## 1. Executive summary

The CM5 image ships two **independent** display stacks:

| Display | Bus | Package | Default |
|---------|-----|---------|---------|
| Waveshare 1.3" SH1106 OLED HAT | I2C7 (`/dev/i2c-7`) | `luci-app-oled` / `oledd` | **On** (`menu_mode=1`) |
| ESP32 smart display (LVGL) | Debug UART (`/dev/ttyS2`) | `luci-app-mcu-display` / `mcudd` | **Off** (`enable=0`) |

**OLED (`luci-app-oled`)** is production-ready for the CM5 HAT: config-driven pages, ubus API, LuCI JS view, monotonic boot stages, CM5 button chain. Remaining pain is mostly **integration polish** (button FIFO, restart splash policy, LuCI preview parity) — not hardware.

**MCU display (`luci-app-mcu-display`)** has a Phase 1 daemon + LuCI scaffold. CM5 firmware **reserves the onboard debug UART** for `mcudd` (bootscript drops runtime `console=ttyS2`). Full router metrics, CBOR, and production ESP32 UART firmware are **not done**.

This document adds: (a) a fresh implementation review, (b) a **debug UART solution design** for the MCU module, and (c) a **single backlog** to track both packages through P0 → P2.

---

## 2. OLED package review (current implementation)

### 2.1 Architecture (as shipped)

```text
preinit 80-oled-preinit → /tmp/oled_state
procd START=09 → /etc/init.d/oledd → /usr/sbin/oledd
cm5-button-scripts → /etc/rc.button/wps|BTN_2 → oled-forward → hotplug.d/button/99-oled → oledd-event.sh → FIFO
hotplug.d/net/99-oled → oled-boot-state.sh + ubus oledd event (ubus-first)
oledd loop: ubus poll → FIFO poll → alert → menu_tick → render → ~800 ms sleep
LuCI: oled.js + luci.oled.uc (Services → OLED)
```

### 2.2 Strengths (verified in tree)

| Area | Evidence |
|------|----------|
| Clear package split | Display/menu in `luci-app-oled`; fan/IR/I2C in `luci-app-peripherals`; GPIO scripts in `cm5-button-scripts` |
| Config-driven UI | `/etc/oled/pages.json` + token substitution (`oledd_data.c`) |
| Boot monotonicity | `oled-boot-state.sh` rank; WAN-down does not rewind (`99-oled` net hotplug) |
| Net events ubus-first | `hotplug.d/net/99-oled` calls `ubus call oledd event` before FIFO fallback |
| CM5 defaults | `uci-defaults`, `cm5-apply-config.sh`, `99-oled-cm5-migrate`; I2C7 + RST in DTS |
| Stability fixes | ubus use-after-free (r26), idle-dim (r41), boot stuck WAN down (r47) |
| Partial restart boot | `init.d/oledd` sets `boot` stage when state is not `ready`/`network` |

### 2.3 Gaps vs user requirements (severity)

| Requirement | Status | Severity |
|-------------|--------|----------|
| Base-board buttons work | USERKEY/MaskROM work when chain intact; HAT keys **not wired** on 5-wire FPC | P0 (expectation) |
| Button path reliability | `99-oled` button hotplug is **FIFO-only**; net path already ubus-first | P0 |
| FIFO non-blocking | `oledd-event.sh` uses blocking `printf > fifo`; fails silently when no reader | P0 |
| Boot splash on every restart | `service restart` with `stage=ready` skips splash | P0 |
| `set_view boot` coherence | LuCI/ubus boot view can exit immediately if `oled_state` is `ready` | P0 |
| LuCI preview parity | Missing icons, QR, sparkline, boot bar; RX/TX stubbed in ucode | P1 |
| pages.json editor | SSH-only; no LuCI validation/reorder | P1 |
| Legacy vs JSON drift | Fallback to 3-view legacy mode if JSON parse fails | P1 |
| Stub security tokens | `firewall_state`, `blocked_24h`, etc. placeholders | P1 |

### 2.4 Code hotspots (for backlog owners)

| Path | Role |
|------|------|
| `src/oledd/oledd_menu.c` | Screen FSM, boot splash, navigation |
| `src/oledd/oledd_input.c` | FIFO + single-slot ubus event queue |
| `root/etc/hotplug.d/button/99-oled` | **Needs ubus-first** (mirror net hotplug) |
| `root/usr/lib/oled/oledd-event.sh` | **Needs timeout / ubus fallback** |
| `root/etc/init.d/oledd` | Boot stage on start; optional `menu_boot_on_restart` |
| `root/usr/share/rpcd/ucode/luci.oled.uc` | Preview + metrics; extend diagnostics |
| `htdocs/.../oled.js` | LuCI UI; diagnostics tab |

### 2.5 Tests (host)

```sh
cd feeds/luci/luci-app-oled/tests && ./run-tests.sh
```

| Test | Covers |
|------|--------|
| `test-oled-boot-state.sh` | Monotonic boot stages |
| `test_oledd_logic.c` | Event parse, `boot_active`, tokens |
| `oled-helpers.test.mjs` | ucode-style helpers |

**Not host-testable:** SH1106 I2C draw, full procd/hotplug chain, GPIO button events.

---

## 3. Deep analysis — root causes

### 3.1 Why buttons feel broken

1. **Hardware mismatch (most common)** — CM5 FPC harness = power + I2C + RST only. Waveshare KEY1–3 / joystick are **not** connected. Only **USERKEY (`wps`)** and **MaskROM (`BTN_2`)** on the base board drive menu nav.
2. **FIFO-only button path** — Net hotplug uses ubus first; buttons do not. If `oledd` is down or FIFO not open, `oledd-event.sh` can block or drop events.
3. **Auto-rotate default** — `menu_interactive=0`: buttons change page but auto-rotate overwrites within `menu_timeout` seconds.
4. **WPS coupling** — `cm5-button-scripts` runs `hostapd_cli wps_pbc` on every USERKEY press before OLED forward.

### 3.2 Why boot splash behaves inconsistently

| Event | `/tmp/oled_state` | Splash |
|-------|-------------------|--------|
| Cold boot | preinit → boot → network → ready | Yes until stage/timeout/input |
| `oledd` crash + respawn | Often still `ready` | No (by design r47) |
| `/etc/init.d/oledd restart` | Usually `ready` | **No** (user expectation gap) |
| `set_view boot` via ubus | May stay `ready` | Exits on next tick |

**Design tension:** Persistent `/tmp/oled_state` fixes WAN-flap regressions but conflicts with “show splash on every service start.”

### 3.3 Three parallel display modes (OLED)

| Mode | Trigger | User confusion |
|------|---------|----------------|
| `SCREEN_BOOT` | Boot FSM | “Stuck on boot” |
| `SCREEN_PAGES` | JSON OK | Normal dashboard |
| `SCREEN_LEGACY` | JSON fail | Different 3-page UI |
| Legacy `/usr/bin/oled` | `menu_mode=0` | LuCI “Screensaver” tab irrelevant |

### 3.4 MCU display — Phase 1 limits

| Component | Done | Missing |
|-----------|------|---------|
| `mcudd` serial open | termios 8N1, DTR/RTS low | ubus server, uloop production loop |
| RDCP parser | Legacy + v1 JSON | CBOR, push coalescing |
| Metrics | Partial port from `oledd_data` | Full ubus WiFi/security scopes |
| ESP32 firmware | Demo repo separate | UART2 production env, router screens |
| CM5 UART | DTS `uart2` okay; bootscript reserves ttyS2 | End-to-end bench validation doc on hardware |

### 3.5 Coexistence policy (recommended)

**Run both displays concurrently** — no shared bus:

- OLED: I2C7 + GPIO1_B4 RST + base buttons → `oledd`
- MCU: UART2 debug header → `mcudd` (when `mcud.enable=1`)

No auto-pause between daemons. LuCI cross-links: OLED ↔ MCU Display ↔ Peripherals.

---

## 4. Solution design — CM5 debug UART for MCU display

### 4.1 Design goal

Use the **onboard 3-pin debug UART** on the Orange Pi CM5 Base as the **production link** between ImmortalWrt and an ESP32 smart-display module, leaving **J4 FPC exclusively for the OLED HAT** (I2C7 + RST).

### 4.2 Hardware

#### Debug header (CM5 Base)

Per CM5 manual / schematic and ImmortalWrt CM5 DTS (`994-03-*-cm5-base`):

| Pin | Signal | RK3588 | Linux |
|-----|--------|--------|-------|
| 1 | GND | — | — |
| 2 | UART_RX | GPIO0_B6 | SoC **receives** (connect to ESP32 TX) |
| 3 | UART_TX | GPIO0_B5 | SoC **transmits** (connect to ESP32 RX) |

**Device node:** `/dev/ttyS2` (`serial@ff130000`, `uart2m0_xfer`).

**Voltage:** 3.3 V logic only. Common GND required. Do **not** connect CM5 pin 2 to ESP32 TX without level compatibility (both 3.3 V on typical ESP32 modules).

#### ESP32 module (production)

| ESP32 | Connect to CM5 |
|-------|----------------|
| GND | Pin 1 |
| GPIO17 (TX) | Pin 2 (CM5 RX) |
| GPIO16 (RX) | Pin 3 (CM5 TX) |

Use **UART2** (`Serial2`) in firmware — **not** USB-CDC, for field install.

#### Wiring diagram

```text
 CM5 Base debug header          ESP32 smart display
 ┌─────────────────┐            ┌──────────────────┐
 │ 1 GND ──────────┼────────────┤ GND              │
 │ 2 RX  ←─────────┼────────────┤ GPIO17 (TX)      │
 │ 3 TX  ──────────┼───────────→│ GPIO16 (RX)      │
 └─────────────────┘            └──────────────────┘
        │                                  │
   /dev/ttyS2 @ 115200 8N1            UART2 @ 115200 8N1
        │                                  │
        └──────── RDCP v1 (newline) ───────┘
```

#### What stays on J4 FPC (OLED — unchanged)

| FPC pad | Signal | Use |
|--------:|--------|-----|
| 1–2 | 3V3 | OLED power |
| 7–8 | GND | |
| 9 | GPIO1_B4 | OLED RST |
| 11–12 | I2C7 SCL/SDA | `/dev/i2c-7` |

**Explicit non-goal:** UART4 on J4 pads 6/7 was explored (mcud r11) and **removed** — conflicts with expansion GPIO and user wiring clarity.

### 4.3 Firmware / boot — console arbitration

| Layer | Setting | Purpose |
|-------|---------|---------|
| DTS `stdout-path` | `serial2:1500000n8` | Early boot / U-Boot / `earlycon` |
| CM5 bootscript | `console=tty1` only (no `console=ttyS2`) | **Runtime:** ttyS2 free for `mcudd` |
| `mcudd` UCI | `path=/dev/ttyS2`, `baud=115200` | Application link |
| Bench debug | `fw_setenv bootargs` add `console=ttyS2,1500000` | Serial login — **disable mcudd** while active |

**Baud rate split:** U-Boot/earlycon may use **1.5 Mbaud**; `mcudd` and ESP32 use **115200 8N1** after Linux is up. ESP32 must not parse garbage during early boot — implement **link watchdog** (30 s no valid frame → “Waiting for router…” screen).

### 4.4 Software stack

```text
┌─────────────────────────────────────────────────────────────┐
│ ImmortalWrt CM5                                              │
│  LuCI (mcu-display.js) → rpcd (luci.mcu-display.uc)         │
│       ↓ ubus                                                │
│  mcudd: serial │ RDCP │ metrics │ push │ boot state         │
│       ↓ read/write                                           │
│  /dev/ttyS2 115200 8N1, DTR/RTS low, O_NONBLOCK            │
└──────────────────────────┬──────────────────────────────────┘
                           │ newline-framed RDCP v1
                           │ (MCU→host JSON, host→MCU JSON/CBOR)
┌──────────────────────────┴──────────────────────────────────┐
│ ESP32 + LVGL (esp32-smartdisplay-demo fork)                  │
│  UART2 GPIO16/17 │ rdcp_parser │ router_ui screens           │
└─────────────────────────────────────────────────────────────┘
```

### 4.5 Protocol summary (RDCP v1)

See [luci-app-mcu-display-system-design.md](luci-app-mcu-display-system-design.md) §4. Phase 1 ships **JSON both directions**; Phase 2 adds **CBOR host→MCU**.

| Type | Direction | Example |
|------|-----------|---------|
| `req` | MCU → host | `{"v":1,"t":"req","id":1,"op":"metrics","scope":"system"}` |
| `res` | host → MCU | metrics payload |
| `push` | host → MCU | alerts, boot stage, config |
| `evt` | MCU → host | screen loaded, touch/gesture |
| `cmd` | host → MCU | force screen / nav |

**Legacy shim:** `{"request":"cpu"}` → `metrics/system` (implemented in `mcudd_protocol.c`).

### 4.6 Security & reliability

| Topic | Mitigation |
|-------|------------|
| Untrusted serial input | Max line 4096 B; parse bounds; rate-limit 10 req/s |
| Console vs mcudd conflict | Document mutual exclusion; LuCI warning if `console=ttyS2` detected |
| ESP32 reset on open | DTR/RTS cleared in `mcudd_serial.c` (already) |
| Link loss | ESP32 watchdog UI; `mcudd` logs `link_ok` in status |
| Single writer | Optional `/var/run/mcudd.lock`; one process owns ttyS2 |

### 4.7 Bring-up procedure (bench)

1. Flash CM5 image with `luci-app-mcu-display` (optional package).
2. Wire debug header ↔ ESP32 UART2 (§4.2).
3. `uci set mcud.@mcud[0].enable=1; uci commit mcud`
4. `logread -f -e mcudd` in one SSH session.
5. `/etc/init.d/mcudd start`
6. Verify: `ls -l /dev/ttyS2`, `ubus call mcudd status` (when ubus srv landed), serial hex log with `debug_serial=1`.
7. ESP32: flash `RDCP_TRANSPORT_UART2` build; confirm CPU gauge updates.
8. Enable OLED in parallel — confirm I2C7 OLED still works (independent).

### 4.8 Documentation deliverables (this design)

| Item | Location |
|------|----------|
| User wiring guide | **TODO:** `docs/cm5-debug-uart-mcu-display-wiring.md` |
| LuCI inline help | `mcu-display.js` serial section (partially done r12) |
| AGENTS / skill cross-link | `oled-peripherals-cm5` skill |

---

## 5. Unified backlog

**Legend:** `todo` | `doing` | `done` | `defer`  
**Priority:** P0 (reliability / user-visible) · P1 (consistency) · P2 (polish / hardware)

### 5.1 OLED — P0 reliability

| ID | Task | Status | Owner files | Notes |
|----|------|--------|-------------|-------|
| OLED-P0-1 | Button hotplug **ubus-first** (mirror `99-oled` net) | todo | `hotplug.d/button/99-oled` | `ubus call oledd event '{"type":"next"}'` |
| OLED-P0-2 | **Non-blocking FIFO** — timeout or ubus-only when ubus up | todo | `oledd-event.sh` | Avoid hang when oledd down |
| OLED-P0-3 | Boot splash on **service restart** — UCI `menu_boot_on_restart` | todo | `init.d/oledd`, `oled-boot-state.sh` | Partial: boot only if stage not ready/network |
| OLED-P0-4 | **`set_view boot` coherence** — sync or override `oled_state` | todo | `oledd_menu.c`, `oledd_ubus_srv.c` | |
| OLED-P0-5 | LuCI **diagnostics** — last events, hotplug chain, HAT-not-wired callout | todo | `luci.oled.uc`, `oled.js` | Extend `cm5-oled-debug.sh` |
| OLED-P0-6 | **WPS decouple** — UCI `menu_wps_hostapd` or move PBC to optional action | todo | `cm5-button-scripts`, `99-oled` | |

### 5.2 OLED — P1 consistency

| ID | Task | Status | Notes |
|----|------|--------|-------|
| OLED-P1-1 | Unified renderer / retire legacy JSON-fail path | defer | Large refactor |
| OLED-P1-2 | UCI button action map (`next`/`prev`/`none`/custom) | todo | |
| OLED-P1-3 | LuCI **pages.json** editor + validation | todo | |
| OLED-P1-4 | **Preview parity** — icons, QR, sparkline, boot bar, RX/TX | todo | |
| OLED-P1-5 | Reload `pages.json` without full restart (ubus/inotify) | todo | |
| OLED-P1-6 | Rename/hide legacy Screensaver tab when `menu_mode=1` | todo | |
| OLED-P1-7 | Real security tokens (blocky/banIP when present) | todo | Cross-link blocky |

### 5.3 OLED — P2 hardware / polish

| ID | Task | Status | Notes |
|----|------|--------|-------|
| OLED-P2-1 | Waveshare HAT GPIO keys via extra wires | defer | Needs harness v2 |
| OLED-P2-2 | oledd screensaver mode (clock vs blank dim) | defer | |
| OLED-P2-3 | CM5 port list in UCI (not hardcoded eth0–2) | todo | |
| OLED-P2-4 | po / i18n cleanup | todo | |

### 5.4 MCU display — firmware & DTS (CM5)

| ID | Task | Status | Notes |
|----|------|--------|-------|
| MCU-P0-1 | **User wiring doc** for debug UART | todo | `docs/cm5-debug-uart-mcu-display-wiring.md` |
| MCU-P0-2 | Bench **E2E checklist** on real CM5 + ESP32 | todo | §4.7 |
| MCU-P0-3 | LuCI warning when kernel **console on ttyS2** | todo | Parse `/proc/cmdline` |
| MCU-FW-1 | CM5 bootscript: no runtime `console=ttyS2` | done | `orangepi-cm5-base.bootscript` |
| MCU-FW-2 | DTS `uart2` enabled (`uart2m0`) | done | `994-03-*-cm5-base` |
| MCU-FW-3 | Remove FPC UART4 (`9981-*-fpc-uart4`) | done | CHANGELOG r12 |
| MCU-UCI-1 | Default `path=/dev/ttyS2`, migrate USB/FPC paths | done | `99-mcud-cm5-uart-migrate` |

### 5.5 MCU display — mcudd daemon

| ID | Task | Status | Notes |
|----|------|--------|-------|
| MCU-P1-1 | **ubus object `mcudd`** — status, event, set_screen, reload | todo | Mirror `oledd_ubus_srv.c` |
| MCU-P1-2 | **uloop** main loop — serial fd + periodic metrics push | todo | Replace Phase 1 poll loop |
| MCU-P1-3 | Full **metrics scopes** (network, clients, wifi, security) | doing | `mcudd_metrics.c` partial |
| MCU-P1-4 | **CBOR** host→MCU (Phase 2 wire_format) | todo | |
| MCU-P1-5 | Hotplug **WAN push** alerts | todo | `hotplug.d/net/99-mcud` |
| MCU-P1-6 | Shared **`librouter-metrics`** with oledd | defer | Phase 5 DRY |
| MCU-P1-7 | Frame ring buffer + LuCI debug viewer | doing | `debug`/`debug_serial` UCI exist |

### 5.6 MCU display — ESP32 firmware (external repo)

| ID | Task | Status | Notes |
|----|------|--------|-------|
| ESP-P0-1 | **RDCP_TRANSPORT_UART2** PlatformIO env | todo | GPIO16/17 |
| ESP-P0-2 | RDCP parser + **evt** on screen load | todo | |
| ESP-P0-3 | Router LVGL screens (6 scopes + boot) | todo | EEZ project |
| ESP-P1-1 | Link watchdog (30 s no host) | todo | |
| ESP-P1-2 | Fix `esp32_simulator.py` msgpack | todo | Appendix B in system design |
| ESP-P2-1 | OTA partition | defer | |

### 5.7 Cross-cutting / CI / image

| ID | Task | Status | Notes |
|----|------|--------|-------|
| X-P1-1 | Add `luci-app-mcu-display` to CI workflow paths | todo | Like blocky/oled |
| X-P1-2 | CM5 `DEVICE_PACKAGES`: keep `luci-app-oled`; **mcu-display optional** | done | User opt-in |
| X-P2-1 | ImmortalWrt AGENTS: link this backlog | todo | |
| X-P2-2 | Playwright/LuCI integration tests (oled + mcu) | defer | See blocky backlog pattern |

---

## 6. Recommended execution order

### Sprint A — OLED P0 (1–2 weeks)

1. OLED-P0-1 + P0-2 (ubus-first buttons + safe FIFO)
2. OLED-P0-5 (LuCI diagnostics — highest support value)
3. OLED-P0-3 + P0-4 (restart splash + set_view boot)
4. OLED-P0-6 (WPS decouple)

**Exit:** USERKEY/MaskROM nav reliable; LuCI shows why HAT keys silent; restart policy documented and configurable.

### Sprint B — MCU UART production path (2–3 weeks)

1. MCU-P0-1 wiring doc
2. MCU-P1-1 + P1-2 (ubus + uloop mcudd)
3. MCU-P0-2 bench E2E with ESP32 UART2
4. ESP-P0-1 + P0-2 (UART2 + RDCP evt)

**Exit:** Live CPU/network on ESP32 over debug header @ 115200; OLED still on I2C7.

### Sprint C — Parity & polish (ongoing)

1. OLED-P1-4 preview parity
2. MCU-P1-3 full metrics scopes
3. ESP-P0-3 router screens
4. OLED-P1-7 + MCU security scope (blocky integration)

---

## 7. Verification checklists

### OLED (on CM5)

```sh
opkg info luci-app-oled | grep Release
logread -e oledd | tail -30
cat /tmp/oled_state
tail -5 /tmp/oledd_events.log
ubus call oledd event '{"type":"next"}'
# Press USERKEY / MaskROM — not HAT keys
/etc/init.d/oledd restart   # after P0-3: confirm splash policy
```

### MCU display (on CM5)

```sh
opkg info luci-app-mcu-display | grep Release
grep console= /proc/cmdline          # must NOT include ttyS2 for mcudd
ls -l /dev/ttyS2
uci show mcud
logread -e mcudd | tail -30
/etc/init.d/mcudd restart
# Scope logic analyzer / second USB-serial on ESP32 if needed
```

---

## 8. Progress log

| Date | Item | Note |
|------|------|------|
| 2026-08-28 | Backlog created | Unified OLED review + debug UART design |
| 2026-07-06 | MCU r12 | Debug UART `/dev/ttyS2` default; FPC UART4 removed |
| 2026-06-25 | OLED review doc | P0–P2 plan in `oledd-review-and-improvement-plan.md` |

*Update this table when closing backlog IDs.*

---

## Appendix — File map (quick reference)

| OLED | MCU display |
|------|-------------|
| `feeds/luci/luci-app-oled/src/oledd/` | `feeds/luci/luci-app-mcu-display/src/mcudd/` |
| `feeds/luci/luci-app-oled/htdocs/.../oled.js` | `.../mcu-display.js` |
| `feeds/luci/luci-app-oled/root/usr/share/rpcd/ucode/luci.oled.uc` | `luci.mcu-display.uc` |
| `feeds/packages/cm5-button-scripts/` | — |
| `immortalwrt/.../994-03-*-cm5-base.dts` (uart2) | same |
| `immortalwrt/.../orangepi-cm5-base.bootscript` | same |
