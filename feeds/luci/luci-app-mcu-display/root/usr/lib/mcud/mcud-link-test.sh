#!/bin/sh
# UART link test: ping/pong + echo over RDCP (requires mcudd + updated ESP32 firmware).
# Usage: mcud-link-test.sh [echo_text]
# Exit 0 only when ESP32 replies (ping_ok and echo_ok in /tmp/mcud_link_test.json).

echo_text="${1:-mcud-link-test}"

if ! pgrep -x mcudd >/dev/null 2>&1; then
	echo "mcudd is not running" >&2
	exit 1
fi

rm -f /tmp/mcud_link_test.json

/usr/lib/mcud/mcud-event.sh ping
sleep 2
/usr/lib/mcud/mcud-event.sh echo "$echo_text"
sleep 2

if [ ! -s /tmp/mcud_link_test.json ]; then
	echo '{"ping_ok":false,"echo_ok":false,"error":"no_reply"}' >&2
	logread -e mcudd | grep -E "link ping|link echo|req ping|cmd echo|uart" | tail -8 >&2
	exit 1
fi

cat /tmp/mcud_link_test.json
echo

ping_ok=$(grep -o '"ping_ok":true' /tmp/mcud_link_test.json || true)
echo_ok=$(grep -o '"echo_ok":true' /tmp/mcud_link_test.json || true)

logread -e mcudd | grep -E "link ping|link echo" | tail -4

if [ -z "$ping_ok" ] || [ -z "$echo_ok" ]; then
	echo "link test FAILED (need ping_ok and echo_ok)" >&2
	exit 1
fi

echo "link test OK"
exit 0
