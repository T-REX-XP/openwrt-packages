#!/bin/sh
# Orange Pi CM5 Base + Waveshare 1.3" OLED HAT (FPC I2C mode @ 0x3c) diagnostics.
# J4 harness (verified): pad 1 = 3V3; pad 4 = GND; pads 11/12 = I2C7 SCL/SDA;
# pad 9 = RST (GPIO1_B4 → HAT pin 22). Schematic OPI_CM5_BASE V1.2.
# Run on the router: sh /usr/lib/oled/cm5-oled-debug.sh

set -u

board="$(board_name 2>/dev/null || echo unknown)"
echo "=== board: $board ==="

echo
echo "=== I2C devices ==="
ls -l /dev/i2c-* 2>/dev/null || echo "(no /dev/i2c-*)"

echo
echo "=== i2c-7 OF node (expect i2c@fec90000) ==="
if [ -e /sys/class/i2c-dev/i2c-7/device/of_node ]; then
	readlink -f /sys/class/i2c-dev/i2c-7/device/of_node
else
	echo "i2c-7 missing — flash image with patch 998-*-fpc-i2c7"
fi

echo
echo "=== RST: device tree ==="
find /sys/firmware/devicetree/base -name '*oled*' -o -name '*waveshare*' 2>/dev/null | head -20

echo
echo "=== RST: sysfs led (DT gpio-leds patch 999 — drives GPIO4_B4, not pad 9) ==="
if [ -e /sys/class/leds/waveshare-oled-rst/brightness ]; then
	echo "brightness=$(cat /sys/class/leds/waveshare-oled-rst/brightness)"
	echo "(patch 999 targets GPIO4_B4; FPC pad 9 is GPIO1_B4 per schematic)"
else
	echo "(no /sys/class/leds/waveshare-oled-rst — old image or patch 999 not applied)"
fi

echo
echo "=== RST: gpiochip1 line 12 (GPIO1_B4, FPC pad 9 → HAT pin 22) ==="
if command -v gpioinfo >/dev/null 2>&1; then
	gpioinfo -c gpiochip1 2>/dev/null | sed -n '1,3p'
	gpioinfo -c gpiochip1 2>/dev/null | grep -E '^[[:space:]]*line[[:space:]]*12:' || true
else
	echo "install gpiod-tools for GPIO state (apk add gpiod-tools)"
fi

echo
echo "=== I2C probe (prefer i2cget over i2cdetect) ==="
echo "i2cdetect can show a false stuck-bus grid even when the panel answers."
if [ -c /dev/i2c-7 ]; then
	echo "--- i2cget -y 7 0x3c 0x00 b (expect 0x00 or byte, not 'Error') ---"
	i2cget -y 7 0x3c 0x00 b 2>&1 || echo "i2cget failed (RST low, wrong bus, or HAT disconnected)"
else
	echo "(no /dev/i2c-7)"
fi

echo
echo "=== I2C scan (i2cdetect — unreliable on SH1106) ==="
for dev in /dev/i2c-*; do
	[ -c "$dev" ] || continue
	bus="${dev#/dev/i2c-}"
	echo "--- $dev ---"
	i2cdetect -y "$bus" 2>/dev/null || echo "scan failed"
done

echo
echo "=== stuck-bus hint ==="
echo "Healthy: i2cget -y 7 0x3c 0x00 b succeeds; i2cdetect may still look wrong."
echo "Bad: i2cget errors and many hex digits on i2cdetect = SDA/SCL stuck or RST low."
echo "Test with HAT fully disconnected: i2cget -y 7 0x3c 0x00 b should error."

echo
echo "=== dmesg (i2c / gpio) ==="
dmesg 2>/dev/null | grep -iE 'i2c7|gpio1|gpio4|waveshare|oled' | tail -20

echo
echo "=== package (ImmortalWrt apk) ==="
if command -v apk >/dev/null 2>&1; then
	apk info -e luci-app-oled 2>/dev/null && apk info -a luci-app-oled 2>/dev/null | head -5
	apk list -I luci-app-oled 2>/dev/null || true
else
	echo "(apk not found)"
fi

echo
echo "=== UCI / daemon ==="
uci show oled 2>/dev/null || echo "(no oled uci)"
pgrep -af 'oledd|/usr/bin/oled' 2>/dev/null || echo "oled daemon not running"
if [ -f /tmp/oled_state ]; then
	echo "--- /tmp/oled_state ---"
	cat /tmp/oled_state
fi

echo
echo "=== oledd ubus (Phase 4) ==="
if ubus -S list oledd 2>/dev/null | grep -q '^oledd$'; then
	echo "--- ubus call oledd status ---"
	ubus -S call oledd status 2>/dev/null || echo "(ubus call failed)"
else
	echo "  oledd ubus object not registered (start oledd in menu_mode)"
fi

echo
echo "=== oledd input (Phase 3) ==="
menu_interactive="$(uci -q get oled.@oled[0].menu_interactive)"
menu_nav_button="$(uci -q get oled.@oled[0].menu_nav_button)"
menu_select_button="$(uci -q get oled.@oled[0].menu_select_button)"
echo "  menu_interactive=${menu_interactive:-1}"
echo "  menu_nav_button=${menu_nav_button:-BTN_2}"
echo "  menu_select_button=${menu_select_button:-wps}"
for fifo in /var/run/oledd.fifo /tmp/oledd.fifo; do
	if [ -p "$fifo" ]; then
		echo "  fifo: $fifo (exists)"
	else
		echo "  fifo: $fifo (missing — start oledd)"
	fi
done
if [ -f /tmp/oledd_events.log ]; then
	echo "--- last events (/tmp/oledd_events.log) ---"
	tail -8 /tmp/oledd_events.log
else
	echo "  (no /tmp/oledd_events.log yet)"
fi

echo
echo "=== menu mode (oledd) ==="
if [ -x /usr/sbin/oledd ]; then
	echo "  /usr/sbin/oledd installed"
	menu_mode="$(uci -q get oled.@oled[0].menu_mode)"
	echo "  menu_mode=${menu_mode:-0}"
	[ "$menu_mode" = "1" ] && echo "  active init: /etc/init.d/oledd (START=09)" || echo "  active init: /etc/init.d/oled (legacy screensaver)"
else
	echo "(no /usr/sbin/oledd — upgrade luci-app-oled r17+)"
fi

echo
echo "=== one-shot oled init test (SH1106 128×64) ==="
if [ -x /usr/bin/oled ]; then
	echo "  /etc/init.d/oled stop"
	echo "  /usr/bin/oled --needInit --i2cDevPath=/dev/i2c-7 --displayDate --displayIp --displayCpuTemp --displayCpuFreq --ipIfName=br-lan"
	echo "(expect 'Successfully connected' and process stays up; Ctrl+C to stop)"
else
	echo "(no /usr/bin/oled)"
fi

echo
echo "=== manual RST release (FPC pad 9 = GPIO1_B4) ==="
echo "  # ImmortalWrt uses apk (not opkg): apk update && apk add gpiod-tools"
echo "  # libgpiod 2.2+ on ImmortalWrt — no -m flag:"
echo "  gpioset -c gpiochip1 -z 12=1"
echo "  # or background: gpioset -c gpiochip1 12=1 &"
echo "  sleep 1 && gpioget -c gpiochip1 12 && i2cget -y 7 0x3c 0x00 b"
echo "  # i2cdetect is unreliable on SH1106; use i2cget to confirm 0x3c"
echo "  # patch 999 waveshare-oled-rst drives GPIO4_B4 — not the pad 9 net"
