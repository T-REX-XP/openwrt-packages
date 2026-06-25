#!/bin/sh
# Waveshare 1.3" OLED HAT RST on Orange Pi CM5 Base FPC pad 9 (GPIO1_B4).
# Raspberry Pi equivalent: GPIO25 (40-pin header pin 22) held high.
#
# ImmortalWrt patch 999 may drive GPIO4_B4 via gpio-leds (wrong net for pad 9);
# this script releases RST on the verified pad 9 net (GPIO1_B4).

[ "$(board_name 2>/dev/null)" = "xunlong,orangepi-cm5-base" ] || exit 0

# DT gpio-leds (patch 999): /sys/class/leds/waveshare-oled-rst — GPIO4_B4, not pad 9
if [ -e /sys/class/leds/waveshare-oled-rst/brightness ]; then
	echo 1 > /sys/class/leds/waveshare-oled-rst/brightness 2>/dev/null || true
fi

# RK3588: GPIO1_B4 = line 12 on gpiochip1 (FPC J4 pad 9)
if gpioinfo -c gpiochip1 2>/dev/null | grep -qE '^[[:space:]]*line[[:space:]]+12:.*output'; then
	gpioget -c gpiochip1 12 2>/dev/null | grep -q '=active' && exit 0
fi

command -v gpioset >/dev/null 2>&1 || exit 0
[ -c /dev/gpiochip1 ] || exit 0

# libgpiod 2.2+ (ImmortalWrt): no -m flag; -z daemonizes and holds the line
gpioset -c gpiochip1 -z 12=1 2>/dev/null && exit 0
# libgpiod 2.2+ foreground hold in background job
gpioset -c gpiochip1 12=1 2>/dev/null &
exit 0
