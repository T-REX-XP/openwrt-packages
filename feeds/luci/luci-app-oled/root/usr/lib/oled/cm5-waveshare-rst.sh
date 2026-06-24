#!/bin/sh
# Waveshare 1.3" OLED HAT RST on Orange Pi CM5 Base FPC pad 9 (GPIO4_B4).
# Raspberry Pi equivalent: GPIO25 (40-pin header pin 22) held high.
#
# ImmortalWrt images with DT patch 999 drive this line at boot via gpio-leds;
# this script is a userspace fallback when the line is not yet an output.

[ "$(board_name 2>/dev/null)" = "xunlong,orangepi-cm5-base" ] || exit 0

# DT gpio-leds (patch 999): /sys/class/leds/waveshare-oled-rst
if [ -e /sys/class/leds/waveshare-oled-rst/brightness ]; then
	[ "$(cat /sys/class/leds/waveshare-oled-rst/brightness 2>/dev/null)" = "1" ] && exit 0
	echo 1 > /sys/class/leds/waveshare-oled-rst/brightness 2>/dev/null && exit 0
fi

# RK3588: GPIO4_B4 = line 12 on gpiochip4
if gpioinfo -c gpiochip4 2>/dev/null | grep -q 'waveshare-oled-rst.*output'; then
	exit 0
fi

command -v gpioset >/dev/null 2>&1 || exit 0
[ -c /dev/gpiochip4 ] || exit 0

# libgpiod 2.2+ (ImmortalWrt): no -m flag; -z daemonizes and holds the line
gpioset -c gpiochip4 -z 12=1 2>/dev/null && exit 0
# libgpiod 2.2+ foreground hold in background job
gpioset -c gpiochip4 12=1 2>/dev/null &
exit 0
