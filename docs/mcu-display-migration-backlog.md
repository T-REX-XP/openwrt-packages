# MCU display — migration backlog (OLED removed)

*Updated: 2026-08-28. CM5 image ships **luci-app-mcu-display** only; **luci-app-oled** removed from feed and `DEVICE_PACKAGES`.*

**Hardware:** ESP32 yellow board on serial — CM5 debug UART `/dev/ttyS2` @ 115200 8N1, or USB `/dev/ttyUSB0`.

**Related docs**

| Doc | Role |
|-----|------|
| [luci-app-mcu-display-system-design.md](luci-app-mcu-display-system-design.md) | RDCP v1, `mcudd`, ESP32 phases |
| [oled-mcu-display-backlog.md](oled-mcu-display-backlog.md) | Archived dual-stack backlog (historical) |
| [oledd-review-and-improvement-plan.md](oledd-review-and-improvement-plan.md) | Archived OLED review (reference only) |

---

## 1. Executive summary

The CM5 ImmortalWrt image uses a **single display stack**:

| Component | Path | Role |
|-----------|------|------|
| `mcudd` | `/usr/sbin/mcudd` | UART bridge, RDCP/legacy JSON, metrics |
| LuCI | **Services → MCU Display** | Config, status, page nav, debug logs |
| Pages | `/etc/mcud/pages.json` | Screen list + scopes |
| Buttons | `cm5-button-scripts` → `99-mcud` | USERKEY=next, MaskROM=prev |
| Boot state | `/tmp/mcud_state` | Monotonic boot stages |

**Removed (2026-08-28):** `luci-app-oled`, `oledd`, I2C OLED menu, `99-oled` hotplug, `oled-forward`. Kernel I2C7 / RST DTS patches remain for optional HAT hardware but are not used by default firmware.

---

## 2. Feature migration (OLED → MCU)

| OLED feature | MCU status (r13) | Notes |
|--------------|------------------|-------|
| Config-driven pages | **Done** | `/etc/mcud/pages.json` |
| Boot splash / stages | **Done** | `mcud-boot-state.sh`, RDCP boot push |
| Physical button nav | **Done** | UCI `menu_nav_button` / `menu_select_button`, `99-mcud` |
| LuCI page prev/next/goto | **Done** | `pageControl` RPC + FIFO |
| Net hotplug → refresh | **Done** | `99-mcud` net hotplug |
| Screen timeout / dim | **Done** | UCI → RDCP config push |
| Service control | **Done** | LuCI Status tab |
| Debug logs | **Done** | LuCI Debug tab |
| LuCI preview canvas | **Not ported** | ESP32 renders UI; LuCI shows page list + active screen |
| ubus `mcudd` object | **Pending** | FIFO used instead of ubus (Phase 2) |
| Full metrics (wifi/security) | **Partial** | Some scopes return `scope_unavailable` |
| MessagePack wire format | **Pending** | UCI option exists; daemon logs warning |
| Auto-rotate pages | **Pending** | ESP32 firmware or mcudd timer |
| pages.json LuCI editor | **Pending** | SSH edit `/etc/mcud/pages.json` |

---

## 3. Fixed bugs

### P0 — LuCI Configuration tab crash (r13)

**Symptom:**

```text
mcu-display.js: Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'value')
  at renderConfigForm
```

**Cause:** `form.JSONMap` + chained `form.ListValue.value()` — option object was undefined in LuCI 26 JS views.

**Fix:** Replaced JSONMap with manual HTML form (same pattern as former `oled.js`). All selects use native `<select>` elements.

---

## 4. Architecture (current)

```text
preinit / init.d/mcudd → mcud-boot-state.sh → /tmp/mcud_state
procd START=12 → /usr/sbin/mcudd (UART + /var/run/mcudd.fifo)
cm5-button-scripts → mcud-forward → hotplug.d/button/99-mcud → mcud-event.sh → FIFO
hotplug.d/net/99-mcud → boot ready + mcud-event.sh net
ESP32 ↔ RDCP JSON lines on /dev/ttyS2
LuCI: mcu-display.js + luci.mcu-display.uc
```

---

## 5. Backlog (priority order)

### P0 — ship on CM5

| ID | Task | Status |
|----|------|--------|
| P0-1 | Remove `luci-app-oled` from feed + `DEVICE_PACKAGES` | **Done** |
| P0-2 | Fix LuCI `renderConfigForm` crash | **Done** (r13) |
| P0-3 | Button chain → mcudd FIFO | **Done** |
| P0-4 | LuCI page navigation tab | **Done** |
| P0-5 | CM5 first-boot defaults (`enable=1`, ttyS2) | **Done** |

### P1 — reliability & parity

| ID | Task | Status |
|----|------|--------|
| P1-1 | Non-blocking FIFO write in `mcud-event.sh` (`timeout 1`) | Open |
| P1-2 | Boot splash on `mcudd restart` (reset stage or `boot` cmd) | Open |
| P1-3 | ubus `mcudd` (`status`, `event`, `set_screen`) | Open |
| P1-4 | Complete `mcudd_metrics` wifi/security scopes | Open |
| P1-5 | Dynamic page list from `pages.json` in daemon (not hardcoded 6 IDs) | Open |
| P1-6 | LuCI: poll active screen after nav (auto-refresh Status/Pages) | Open |

### P2 — ESP32 / polish

| ID | Task | Status |
|----|------|--------|
| P2-1 | ESP32 firmware: RDCP touch gestures ↔ router scopes | Open |
| P2-2 | MessagePack / CBOR wire format | Open |
| P2-3 | pages.json LuCI editor + validation | Open |
| P2-4 | Auto-rotate idle pages (UCI interval) | Open |
| P2-5 | Shared `librouter-metrics` (DRY with archived oledd) | Open |

---

## 6. CM5 wiring (debug UART)

| CM5 J3 pin | Signal | ESP32 |
|------------|--------|-------|
| 1 | GND | GND |
| 2 | RX (GPIO0_B6) | ESP32 TX |
| 3 | TX (GPIO0_B5) | ESP32 RX |

3.3 V logic only. Bootscript disables runtime kernel console on `ttyS2` so `mcudd` owns the port.

---

## 7. Build & deploy

```sh
make package/feeds/openwrt_packages/luci-app-mcu-display/compile V=s
make package/feeds/openwrt_packages/cm5-button-scripts/compile V=s
```

**Expected packages:** `luci-app-mcu-display`, `cm5-button-scripts` — **not** `luci-app-oled`.

---

## 8. Verification checklist

- [ ] **Services → MCU Display** loads all tabs without JS errors
- [ ] Configuration **Save & Apply** restarts `mcudd`
- [ ] Status shows FIFO ready when daemon running
- [ ] Pages tab: Previous / Next / Jump sends commands (syslog `mcudd`)
- [ ] USERKEY advances page; MaskROM goes back
- [ ] Boot stages advance through `network` → `ready`
- [ ] ESP32 shows boot then router pages with live metrics
