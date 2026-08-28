#!/bin/sh
# UART link test: ping/pong + echo over RDCP (requires mcudd + updated ESP32 firmware).
# Usage: mcud-link-test.sh [echo_text]

echo_text="${1:-mcud-link-test}"

if ! pgrep -x mcudd >/dev/null 2>&1; then
	echo "mcudd is not running" >&2
	exit 1
fi

: > /tmp/mcud_link_test.json 2>/dev/null || true

/usr/lib/mcud/mcud-event.sh ping
sleep 2
/usr/lib/mcud/mcud-event.sh echo "$echo_text"
sleep 2

if [ -f /tmp/mcud_link_test.json ]; then
	cat /tmp/mcud_link_test.json
else
	echo '{"ping_ok":false,"echo_ok":false}' >&2
fi

logread -e mcudd | grep -E "link ping|link echo|req ping|cmd echo" | tail -6
