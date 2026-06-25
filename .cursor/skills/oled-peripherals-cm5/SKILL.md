---
name: oled-peripherals-cm5
description: >-
  OLED display (oledd menu) and peripherals LuCI on Orange Pi CM5 Base — package
  ownership, oledd daemon, I2C/RST, LuCI JS+rpcd layout, CM5 defaults, and
  troubleshooting. Use when editing luci-app-oled, luci-app-peripherals, oledd
  sources, or debugging blank display / menu crashes.
---

# OLED & peripherals on CM5 (openwrt-packages)

## Package ownership (do not overlap)

| Concern | Package | LuCI path |
|---------|---------|-----------|
| Display enable, menu, button mapping, boot splash, service control | **luci-app-oled** | **Services → OLED** |
| Fan PWM, IR keymaps, I2C bus scan, kernel module diagnostics | **luci-app-peripherals** | **System → Peripherals** |
| Physical button hotplug scripts (WPS, MaskROM logging) | **cm5-button-scripts** | (no LuCI on CM5 image; `/etc/rc.button/`) |

**Optional (feed only, not CM5 image):** **luci-app-buttons** — script editor + polled live status; overlaps OLED mapping and SSH editing.

**LuCI rule:** no hardcoded board/wiring tables in views. Hardware harness notes live in `docs/cm5-waveshare-oled-hat-wiring.md` only. UI shows **runtime** state (I2C devices, hwmon, daemon status).

## CM5 Waveshare 1.3" SH1106 HAT (runtime defaults)

| Setting | Value |
|---------|-------|
| I2C bus | `/dev/i2c-7` (`i2c@fec90000`, FPC pads 11/12) |
| Address | `0x3c` |
| RST | GPIO1_B4 — kernel `waveshare-oled-rst` LED (DTS patch 999); LuCI can `echo 1` to sysfs |
| Menu daemon | `/usr/sbin/oledd` when `menu_mode=1` |
| Nav button default | `BTN_2` (MaskROM) → `menu_nav_button` |
| Auto-rotate default | `menu_interactive=0` |

Shipped UCI: `feeds/luci/luci-app-oled/root/etc/config/oled` + `uci-defaults/oled` + `99-oled-cm5-migrate` (sysupgrade).

## luci-app-oled architecture

```text
htdocs/luci-static/resources/view/services/oled.js   # tabbed JS view
htdocs/luci-static/resources/oled-theme.css
root/usr/share/rpcd/ucode/luci.oled.uc                 # getConfig, setConfig, getStatus, …
root/usr/share/luci/menu.d/luci-app-oled.json          # admin/services/oled
root/usr/share/rpcd/acl.d/luci-app-oled.json
src/oledd/*.c → oledd-bin → /usr/sbin/oledd
root/etc/init.d/oledd   # must be INSTALL_BIN + executable in repo
```

**Legacy removed:** `luasrc/controller`, CBI `setting.lua` — do not reintroduce.

**LuCI tabs:** Overview (status + service), Display (I2C, RST), Menu & buttons, Advanced (legacy screensaver).

## luci-app-peripherals architecture

```text
htdocs/.../view/system/peripherals.js
htdocs/.../peripherals-theme.css
root/usr/share/rpcd/ucode/luci.peripherals.uc
po/en/peripherals.po
```

OLED tab: read-only status + `i2cdetect` scan only. Cross-link to **Services → OLED**.

## Known failure modes (fixed in r26+)

| Symptom | Cause | Fix |
|---------|-------|-----|
| Menu ~2s then black | r24 `oledd` ubus use-after-free | Flash **r26+** (`blob_memdup` in `oledd_ubus.c`) |
| `Permission denied` on init | `/etc/init.d/oledd` not executable | **r26+** `INSTALL_BIN`; router: `chmod +x` |
| Legacy screensaver after sysupgrade | Preserved UCI | `99-oled-cm5-migrate` |
| r24 band-aid | — | `uci set oled.@oled[0].menu_alerts=0` |

## Router diagnostics

```sh
opkg info luci-app-oled | grep Release
logread -e oledd | tail -20
ps w | grep oledd
ubus call oledd status
cat /tmp/oled_state
i2cget -y 7 0x3c 0x00 b    # expect 0x16
```

## Build

```sh
make package/luci-app-oled/compile V=s
make package/luci-app-peripherals/compile V=s
```

macOS: `build-immortalwrt-macos.sh --custom-feed …/openwrt-packages/feeds`

## DTS (immortalwrt tree, not this feed)

Kernel patches under `target/linux/rockchip/patches-6.18/`: **998** (i2c7), **999** (RST gpio-led), **9999** (SoC pull-ups). Wiring doc: `docs/cm5-waveshare-oled-hat-wiring.md`.

## Related skills

- `openwrt-feed-packages` — Makefile, init, PKG_RELEASE
- `luci-bootstrap-theming` — scoped CSS, responsive grids, `_()` strings
- `rockchip-kernel-dts` (immortalwrt) — I2C/RST patches
- `cm5-device-image` (build_immortalwrt) — DEVICE_PACKAGES manifest
