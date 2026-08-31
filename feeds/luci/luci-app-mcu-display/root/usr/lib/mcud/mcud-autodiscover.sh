#!/bin/sh
# Rank and pick a UART device for mcudd.
# Usage: mcud-autodiscover.sh [--list] [--apply]

. /lib/functions/system.sh 2>/dev/null

board="$(board_name 2>/dev/null)"

port_exists() {
	[ -n "$1" ] && [ -c "$1" ]
}

# CM5 Base: onboard debug UART first, then USB adapters, then other ttyS.
# Generic: USB/ACM first, then ttyS2, then other ttyS.
discover_candidates() {
	local p

	if [ "$board" = "xunlong,orangepi-cm5-base" ]; then
		port_exists /dev/ttyS2 && echo /dev/ttyS2
		for p in /dev/ttyUSB*; do port_exists "$p" && echo "$p"; done
		for p in /dev/ttyACM*; do port_exists "$p" && echo "$p"; done
		for p in /dev/ttyS[0-9]*; do
			[ "$p" = /dev/ttyS2 ] && continue
			port_exists "$p" && echo "$p"
		done
		return 0
	fi

	for p in /dev/ttyUSB*; do port_exists "$p" && echo "$p"; done
	for p in /dev/ttyACM*; do port_exists "$p" && echo "$p"; done
	port_exists /dev/ttyS2 && echo /dev/ttyS2
	for p in /dev/ttyS[0-9]*; do
		[ "$p" = /dev/ttyS2 ] && continue
		port_exists "$p" && echo "$p"
	done
}

discover_best() {
	discover_candidates | head -n1
}

apply_discovered() {
	local cur auto best

	cur="$(uci -q get mcud.@mcud[0].path)"
	auto="$(uci -q get mcud.@mcud[0].path_autodiscover)"
	[ -z "$auto" ] && auto=1
	[ "$auto" = "0" ] && port_exists "$cur" && return 0

	best="$(discover_best)"
	[ -n "$best" ] || return 1

	if [ -z "$cur" ] || ! port_exists "$cur"; then
		logger -t mcud-autodiscover "set path $best (was '${cur:-empty}')"
		uci -q set "mcud.@mcud[0].path=$best"
		uci -q set mcud.@mcud[0].path_autodiscover='1'
		uci -q commit mcud
		return 0
	fi

	return 0
}

case "${1:-}" in
--list|-l)
	discover_candidates
	;;
--apply|-a)
	apply_discovered
	;;
*)
	discover_best
	;;
esac
