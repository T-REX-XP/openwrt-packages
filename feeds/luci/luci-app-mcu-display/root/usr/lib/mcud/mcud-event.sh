#!/bin/sh
# Write navigation / control events to the mcudd FIFO.
# Usage: mcud-event.sh <prev|next|net|refresh|boot|ready|screen> [screen_id]

event="${1:-}"
screen_id="${2:-}"

fifo="${MCUDD_FIFO:-/var/run/mcudd.fifo}"
[ -p "$fifo" ] || fifo="${MCUDD_FIFO_FALLBACK:-/tmp/mcudd.fifo}"

log_event() {
	logger -t mcud-event "$*"
}

if [ ! -p "$fifo" ]; then
	log_event "fifo missing, drop event=${event:-?} screen=${screen_id:-}"
	exit 0
fi

case "$event" in
prev|next|net|refresh|boot|ready)
	if printf '%s\n' "$event" >"$fifo" 2>/dev/null; then
		log_event "fifo write ok event=$event fifo=$fifo"
	else
		log_event "fifo write failed event=$event fifo=$fifo"
	fi
	;;
screen)
	if [ -n "$screen_id" ]; then
		if printf 'screen %s\n' "$screen_id" >"$fifo" 2>/dev/null; then
			log_event "fifo write ok event=screen screen=$screen_id fifo=$fifo"
		else
			log_event "fifo write failed event=screen screen=$screen_id fifo=$fifo"
		fi
	else
		log_event "screen event ignored (empty screen_id)"
	fi
	;;
*)
	[ -n "$event" ] && log_event "ignored unknown event=$event"
	;;
esac

exit 0
