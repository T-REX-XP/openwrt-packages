#!/bin/sh
# Write boot progress for oledd (Phase 1). Called from init scripts and hotplug.
# Usage: oled-boot-state.sh <stage> [message]
# Stages (monotonic): preinit | boot | network | ready

stage="${1:-boot}"
message="${2:-}"
prev_stage=""

[ -f /tmp/oled_state ] && prev_stage=$(grep -m1 '^stage=' /tmp/oled_state 2>/dev/null | cut -d= -f2)

# Never regress boot stage (e.g. WAN ifdown must not undo ready).
stage_rank() {
	case "$1" in
	preinit) echo 1 ;;
	boot) echo 2 ;;
	network) echo 3 ;;
	ready) echo 4 ;;
	*) echo 0 ;;
	esac
}

if [ -n "$prev_stage" ]; then
	prev_rank=$(stage_rank "$prev_stage")
	new_rank=$(stage_rank "$stage")
	if [ "$new_rank" -lt "$prev_rank" ]; then
		logger -t oledd-boot "ignore stage regression $prev_stage -> $stage"
		exit 0
	fi
fi

{
	echo "stage=$stage"
	[ -n "$message" ] && echo "message=$message"
} > /tmp/oled_state

if [ "$stage" != "$prev_stage" ]; then
	if [ -n "$message" ]; then
		logger -t oledd-boot "stage=$stage $message"
	else
		logger -t oledd-boot "stage=$stage"
	fi
fi

case "$stage" in
ready)
	# Phase 1: no ubus object yet; touch net tick so Ports view refreshes
	touch /tmp/oled_net_changed 2>/dev/null || true
	;;
esac

exit 0
