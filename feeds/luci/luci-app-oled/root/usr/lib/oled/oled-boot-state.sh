#!/bin/sh
# Write boot progress for oledd (Phase 1). Called from init scripts and hotplug.
# Usage: oled-boot-state.sh <stage> [message]
# Stages: preinit | boot | network | ready

stage="${1:-boot}"
message="${2:-}"

{
	echo "stage=$stage"
	[ -n "$message" ] && echo "message=$message"
} > /tmp/oled_state

case "$stage" in
ready)
	# Phase 1: no ubus object yet; touch net tick so Ports view refreshes
	touch /tmp/oled_net_changed 2>/dev/null || true
	;;
esac

exit 0
