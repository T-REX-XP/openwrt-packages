#!/bin/sh
# Boot progress for mcudd — monotonic stages (mirrors oled-boot-state.sh).
# Usage: mcud-boot-state.sh <stage> [message] [pct]

stage="${1:-boot}"
message="${2:-}"
pct="${3:-}"

STATE="/tmp/mcud_state"

rank() {
	case "$1" in
		preinit) echo 1 ;;
		boot) echo 2 ;;
		network) echo 3 ;;
		ready) echo 4 ;;
		*) echo 0 ;;
	esac
}

prev_stage=""
[ -f "$STATE" ] && prev_stage=$(grep -m1 '^stage=' "$STATE" 2>/dev/null | cut -d= -f2)

new_rank=$(rank "$stage")
old_rank=$(rank "$prev_stage")

if [ "$old_rank" -gt 0 ] && [ "$new_rank" -lt "$old_rank" ]; then
	logger -t mcudd-boot "ignore stage regression $prev_stage -> $stage"
	exit 0
fi

{
	echo "stage=$stage"
	[ -n "$message" ] && echo "message=$message"
	case "$pct" in
		''|*[!0-9]*) ;;
		*) echo "pct=$pct" ;;
	esac
} > "$STATE"

if [ -n "$message" ]; then
	logger -t mcudd-boot "stage=$stage pct=${pct:-?} $message"
else
	logger -t mcudd-boot "stage=$stage"
fi

# Tell mcudd to refresh boot push or leave router_boot when the host stage advances.
mcud_notify_mcudd() {
	[ -x /usr/lib/mcud/mcud-event.sh ] || return 0
	case "$stage" in
	network)
		/usr/lib/mcud/mcud-event.sh boot
		;;
	ready)
		/usr/lib/mcud/mcud-event.sh ready
		;;
	esac
}
mcud_notify_mcudd

exit 0
