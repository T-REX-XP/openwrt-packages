#!/bin/sh
# Test dnsmasq upstream string format used by blocky-dnsmasq-sync (no UCI).
set -eu

upstream_for_port() {
	printf '%s\n' "127.0.0.1#$1"
}

validate_port() {
	case "$1" in
		''|*[!0-9]*) return 1 ;;
	esac
	if [ "$1" -lt 1 ] || [ "$1" -gt 65535 ]; then
		return 1
	fi
	return 0
}

up="$(upstream_for_port 5353)"
[ "$up" = "127.0.0.1#5353" ] || {
	echo "upstream_for_port: expected 127.0.0.1#5353, got $up"
	exit 1
}

validate_port 5353 || exit 1
validate_port 0 && exit 1
validate_port 70000 && exit 1
validate_port abc && exit 1

echo "blocky-dnsmasq-sync upstream format OK"
