#!/bin/sh
# List feed package names (directory = PKG_NAME) under feeds/packages and feeds/luci.
# Used by GitHub Actions so CI/release cannot drift from the tree.
set -eu
root="${1:-.}"
names=""
for mk in "$root"/feeds/packages/*/Makefile "$root"/feeds/luci/*/Makefile; do
	[ -f "$mk" ] || continue
	names="$names $(basename "$(dirname "$mk")")"
done
if [ -z "$names" ]; then
	echo "discover-feed-packages: no Makefiles under $root/feeds/{packages,luci}" >&2
	exit 1
fi
# shellcheck disable=SC2086
printf '%s\n' $names | sort -u
