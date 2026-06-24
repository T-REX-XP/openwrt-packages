#!/bin/sh
# Waveshare 1.3" OLED HAT RST on Orange Pi CM5 Base FPC pad 9 (GPIO4_B4).
# Raspberry Pi equivalent: GPIO25 (40-pin header pin 22) held high, e.g.:
#   gpioset $(gpiofind GPIO25)=1
#
# ImmortalWrt images with DT patch 999 hog this line at boot; this script is
# a fallback when gpiod-tools is installed and the hog is not present yet.

[ "$(board_name 2>/dev/null)" = "xunlong,orangepi-cm5-base" ] || exit 0

# Already hogged in device tree (patch 999)
if gpioinfo 2>/dev/null | grep -q 'waveshare-oled-rst'; then
	exit 0
fi

command -v gpioset >/dev/null 2>&1 || exit 0

# RK3588: GPIO4_B4 is typically offset 12 on gpiochip128 (4 * 32)
for chip in gpiochip128 gpiochip132; do
	[ -c "/dev/$chip" ] || continue
	gpioset -c "$chip" 12=1 -m signal 2>/dev/null &
	exit 0
done

exit 0
