#!/bin/sh
# Write a typed event line to the oledd FIFO (Phase 3).
# Usage: oledd-event.sh <net|up|down|prev|ok|back|next|refresh>

event="${1:-}"
[ -n "$event" ] || exit 1

fifo="/var/run/oledd.fifo"
[ -p "$fifo" ] || fifo="/tmp/oledd.fifo"
[ -p "$fifo" ] || exit 0

printf '%s\n' "$event" >"$fifo" 2>/dev/null || true
exit 0
