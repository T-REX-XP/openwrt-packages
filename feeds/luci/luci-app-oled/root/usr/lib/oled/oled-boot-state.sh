#!/bin/sh
# Write boot progress for oledd (Phase 1). Called from init scripts and hotplug.
# Usage: oled-boot-state.sh <stage> [message]
# Stages: preinit | boot | network | ready

stage="${1:-boot}"
message="${2:-}"
prev_stage=""

[ -f /tmp/oled_state ] && prev_stage=$(grep -m1 '^stage=' /tmp/oled_state 2>/dev/null | cut -d= -f2)

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
