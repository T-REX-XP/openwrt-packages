---
name: mcu-display-cm5
description: >-
  CM5 MCU display host stack: orig C mcudd, luci-app-mcu-display, RDCP UART on
  ttyS2, LuCI active-page sidecar. Use when deploying mcudd, debugging swipe vs
  LuCI page, link test, or editing luci-app-mcu-display / mcudd-old (not OLED).
---

# MCU display on CM5 (host)

Panel firmware lives in **esp32-smartdisplay-demo**. This skill is the **router** side.

Live daemon that works with swipe → LuCI: **orig C** `feeds/packages/mcudd-old` installed as `/usr/sbin/mcudd`. Go `feeds/packages/mcudd` is a rewrite — do not replace the live C binary unless the user asks.

**Frozen:** swipe → `/tmp/mcud_active_screen` → LuCI. Do not change that path.

## Ownership

| Concern | Package | LuCI |
|---------|---------|------|
| Display, pages, splash, UART daemon | **luci-app-mcu-display** + **mcudd** | **Services → MCU Display** |
| Fan / IR / I2C scan | **luci-app-peripherals** | **System → Peripherals** |
| Physical buttons | **cm5-button-scripts** | SSH `/etc/rc.button/` |

## UART

| Item | Value |
|------|--------|
| Device | `/dev/ttyS2` @ 115200 8N1 |
| ESP32 | UART2 GPIO3 RX / GPIO1 TX (P1 JST) |
| Sidecar | `/tmp/mcud_active_screen` |
| FIFO | `/var/run/mcudd.fifo` (dummy write fd required — no `POLLHUP` spin) |

CM5 bootscript must **not** put a runtime console on `ttyS2`.

## Deploy orig C (macOS → aarch64 musl)

Router has no `sftp-server` — **do not `scp`**. Pipe:

```sh
# build
docker run --rm --platform linux/arm64 \
  -v /Users/t-rex-xp/Documents/openwrt-packages/feeds/packages/mcudd-old:/src \
  -w /src/src alpine:3.20 \
  sh -c 'apk add --no-cache build-base linux-headers >/dev/null && gcc -O2 -Wall -Wextra -std=c99 -D_GNU_SOURCE -I mcudd \
    mcudd/mcudd.c mcudd/mcudd_pages.c mcudd/mcudd_config.c mcudd/mcudd_log.c \
    mcudd/mcudd_serial.c mcudd/mcudd_protocol.c mcudd/mcudd_metrics.c mcudd/mcud_version.c \
    -static -o /src/src/mcudd-bin'

ssh root@192.168.8.1 '/etc/init.d/mcudd stop'
ssh root@192.168.8.1 'cat > /tmp/mcudd.new && chmod 755 /tmp/mcudd.new && mv /tmp/mcudd.new /usr/sbin/mcudd && /etc/init.d/mcudd start' \
  < feeds/packages/mcudd-old/src/mcudd-bin
```

CLI: `mcudd -V` and `mcudd -version-json` (LuCI). Tests: `feeds/packages/mcudd-old/tests/run-tests.sh`.

## Debug

```sh
logread -e mcudd | tail -40          # want: uart rx:, screen evt ack, gesture
cat /tmp/mcud_active_screen
grep '^2:' /proc/tty/driver/serial   # rx must climb
/usr/lib/mcud/mcud-link-test.sh
```

Stuck `router_boot` + no `uart rx:` → USB still on GPIO1/3, or tap panel RST after unplug.

**ESP32 USB flash:** stop mcudd first; skill `esp32-cm5-router-fw` in the firmware repo.

## Do not

- Echo `cmd screen` from `handle_gesture` (yanks the panel; LuCI desyncs)
- Change LuCI `read_active_screen` / `get_status` page fields for this feature
- Use `scp` to the CM5
