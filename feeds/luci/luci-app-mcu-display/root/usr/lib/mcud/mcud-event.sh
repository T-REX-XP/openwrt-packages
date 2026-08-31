#!/bin/sh
# Write control events to the mcudd FIFO.
# Usage: mcud-event.sh <net|refresh|boot|version|ping|echo|help> [arg]
# Page changes (prev/next/screen/ready) are ignored by mcudd — MCU owns paging.
# See docs/mcudd-commands.md

event="${1:-}"
screen_id="${2:-}"

fifo="${MCUDD_FIFO:-/var/run/mcudd.fifo}"
[ -p "$fifo" ] || fifo="${MCUDD_FIFO_FALLBACK:-/tmp/mcudd.fifo}"

log_event() {
	logger -t mcud-event "$*"
}

usage() {
	cat <<'EOF' >&2
Usage: mcud-event.sh <command> [arg]

Commands (written to /var/run/mcudd.fifo, fallback /tmp/mcudd.fifo):
  boot              Push boot splash text (does not change the page)
  version           Query firmware version
  ping              Link probe (req ping)
  echo <text>       Link probe (cmd echo)
  net | refresh     Ignored (MCU owns paging)
  prev | next | screen | ready
                    Ignored (MCU owns paging)
  help              This text

Logs: logger -t mcud-event. Daemon: logread -e mcudd
Docs: openwrt-packages/docs/mcudd-commands.md
EOF
}

case "$event" in
""|-h|--help|help)
	usage
	[ -n "$event" ] || log_event "no command; printed usage"
	exit 0
	;;
esac

if [ ! -p "$fifo" ]; then
	log_event "fifo missing, drop event=${event:-?} screen=${screen_id:-}"
	exit 0
fi

case "$event" in
prev|next|net|refresh|boot|ready|ping)
	if printf '%s\n' "$event" >"$fifo" 2>/dev/null; then
		log_event "fifo write ok event=$event fifo=$fifo"
	else
		log_event "fifo write failed event=$event fifo=$fifo"
	fi
	;;
version)
	if printf 'version\n' >"$fifo" 2>/dev/null; then
		log_event "fifo write ok event=version fifo=$fifo"
	else
		log_event "fifo write failed event=version fifo=$fifo"
	fi
	;;
echo)
	shift
	text="$*"
	if [ -n "$text" ]; then
		if printf 'echo %s\n' "$text" >"$fifo" 2>/dev/null; then
			log_event "fifo write ok event=echo text=$text fifo=$fifo"
		else
			log_event "fifo write failed event=echo fifo=$fifo"
		fi
	else
		log_event "echo event ignored (empty text)"
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
	log_event "ignored unknown event=$event"
	usage
	;;
esac

exit 0
