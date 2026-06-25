#!/bin/sh
# Host-runnable tests for oled-boot-state.sh monotonic stage logic.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/root/usr/lib/oled/oled-boot-state.sh"
TMPROOT=""
FAIL=0
PASS=0

cleanup() {
	[ -n "$TMPROOT" ] && rm -rf "$TMPROOT"
}
trap cleanup EXIT INT HUP

assert_eq() {
	_field="$1"
	_want="$2"
	_got="$3"
	if [ "$_want" = "$_got" ]; then
		PASS=$((PASS + 1))
	else
		echo "FAIL: $_field expected '$_want' got '$_got'"
		FAIL=$((FAIL + 1))
	fi
}

setup_harness() {
	TMPROOT="$(mktemp -d)"
	STATE="$TMPROOT/oled_state"
	SCRIPT="$TMPROOT/oled-boot-state.sh"
	sed "s|/tmp/oled_state|$STATE|g" "$SRC" > "$SCRIPT"
	chmod +x "$SCRIPT"
	# logger is optional on host; script still writes state file
}

run_stage() {
	_stage="$1"
	_msg="${2:-}"
	if [ -n "$_msg" ]; then
		"$SCRIPT" "$_stage" "$_msg" 2>/dev/null || true
	else
		"$SCRIPT" "$_stage" 2>/dev/null || true
	fi
}

read_stage() {
	grep -m1 '^stage=' "$STATE" 2>/dev/null | cut -d= -f2 || echo ""
}

read_message() {
	grep -m1 '^message=' "$STATE" 2>/dev/null | cut -d= -f2- || echo ""
}

echo "=== oled-boot-state.sh monotonic stage tests ==="
setup_harness

run_stage preinit "BOOTING..."
assert_eq "initial stage" "preinit" "$(read_stage)"

run_stage boot "Starting oledd..."
assert_eq "boot advance" "boot" "$(read_stage)"

run_stage network "ifup eth0"
assert_eq "network advance" "network" "$(read_stage)"

run_stage ready "LAN up"
assert_eq "ready advance" "ready" "$(read_stage)"

# Regression must not rewind ready -> network
run_stage network "ifup eth0"
assert_eq "no regression to network" "ready" "$(read_stage)"

run_stage boot "should ignore"
assert_eq "no regression to boot" "ready" "$(read_stage)"

run_stage preinit "should ignore"
assert_eq "no regression to preinit" "ready" "$(read_stage)"

# Message update at same rank is allowed (rewrite file)
run_stage ready "System ready"
assert_eq "ready message update" "ready" "$(read_stage)"
assert_eq "ready message text" "System ready" "$(read_message)"

# Fresh file: boot from empty
rm -f "$STATE"
run_stage boot "cold start"
assert_eq "cold boot stage" "boot" "$(read_stage)"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
