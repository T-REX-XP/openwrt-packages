#!/bin/sh
# Write navigation / control events to the mcudd FIFO.
# Usage: mcud-event.sh <prev|next|net|refresh|boot|ready|screen> [screen_id]

event="${1:-}"
screen_id="${2:-}"

fifo="${MCUDD_FIFO:-/var/run/mcudd.fifo}"
[ -p "$fifo" ] || fifo="${MCUDD_FIFO_FALLBACK:-/tmp/mcudd.fifo}"
[ -p "$fifo" ] || exit 0

case "$event" in
prev|next|net|refresh|boot|ready)
	printf '%s\n' "$event" >"$fifo" 2>/dev/null || true
	;;
screen)
	[ -n "$screen_id" ] && printf 'screen %s\n' "$screen_id" >"$fifo" 2>/dev/null || true
	;;
esac

exit 0
