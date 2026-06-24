#!/bin/sh
# Orange Pi CM5 Base + Waveshare 1.3" OLED HAT (FPC I2C mode @ 0x3c) diagnostics.
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
echo "=== RST: sysfs led (DT gpio-leds patch 999) ==="
if [ -e /sys/class/leds/waveshare-oled-rst/brightness ]; then
	echo "brightness=$(cat /sys/class/leds/waveshare-oled-rst/brightness)"
else
	echo "(no /sys/class/leds/waveshare-oled-rst — old image or patch 999 not applied)"
fi

echo
echo "=== RST: gpiochip4 line 12 (GPIO4_B4, FPC pad 9) ==="
if command -v gpioinfo >/dev/null 2>&1; then
	gpioinfo -c gpiochip4 2>/dev/null | sed -n '1,3p'
	gpioinfo -c gpiochip4 2>/dev/null | grep -E '^[[:space:]]*line[[:space:]]*12:' || true
else
	echo "install gpiod-tools for GPIO state (opkg install gpiod-tools)"
fi

echo
echo "=== I2C scan (HAT connected, RST should be high) ==="
for dev in /dev/i2c-*; do
	[ -c "$dev" ] || continue
	bus="${dev#/dev/i2c-}"
	echo "--- $dev ---"
	i2cdetect -y "$bus" 2>/dev/null || echo "scan failed"
done

echo
echo "=== stuck-bus hint ==="
echo "Healthy: almost all '--', single '3c' on i2c-7."
echo "Bad: many addresses show hex digits (08-77 grid) = SDA/SCL stuck or RST low."
echo "Test with HAT fully disconnected: i2cdetect -y 7 should be all '--'."

echo
echo "=== dmesg (i2c / gpio) ==="
dmesg 2>/dev/null | grep -iE 'i2c7|gpio4|waveshare|oled' | tail -20

echo
echo "=== UCI / daemon ==="
uci show oled 2>/dev/null || echo "(no oled uci)"
pgrep -af oled 2>/dev/null || echo "oled daemon not running"

echo
echo "=== manual RST release ==="
echo "  # ImmortalWrt uses apk (not opkg): apk update && apk add gpiod-tools"
echo "  # libgpiod 2.2+ on ImmortalWrt — no -m flag:"
echo "  gpioset -c gpiochip4 -z 12=1"
echo "  # or background: gpioset -c gpiochip4 12=1 &"
echo "  sleep 1 && gpioget -c gpiochip4 12 && i2cdetect -y 7"
echo "  # if DT gpio-leds present:"
echo "  echo 1 > /sys/class/leds/waveshare-oled-rst/brightness"
