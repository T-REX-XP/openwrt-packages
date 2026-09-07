# Fake OpenWrt /lib/functions.sh for host-side blocky-lists-sync tests.
# BLOCKY_UCI_LISTS lines: id|name|url|enabled

config_load() {
	return 0
}

config_get() {
	local __var="$1"
	local __sec="$2"
	local __opt="$3"
	local __def="${4:-}"
	local _id _name _url _enabled

	if [ "$__sec" = "main" ]; then
		eval "$__var=\"\$__def\""
		return 0
	fi

	[ -n "${BLOCKY_UCI_LISTS:-}" ] && [ -f "$BLOCKY_UCI_LISTS" ] || {
		eval "$__var=\"\$__def\""
		return 0
	}

	while IFS='|' read -r _id _name _url _enabled; do
		case "$_id" in
			''|\#*) continue ;;
		esac
		[ "$_id" = "$__sec" ] || continue
		case "$__opt" in
			name) eval "$__var=\"\$_name\"" ;;
			url) eval "$__var=\"\$_url\"" ;;
			enabled) eval "$__var=\"\$_enabled\"" ;;
			*) eval "$__var=\"\$__def\"" ;;
		esac
		return 0
	done < "$BLOCKY_UCI_LISTS"

	eval "$__var=\"\$__def\""
}

config_foreach() {
	local cb="$1"
	local type="$2"
	local id name url enabled

	[ "$type" = "blocklist" ] || return 0
	[ -n "${BLOCKY_UCI_LISTS:-}" ] && [ -f "$BLOCKY_UCI_LISTS" ] || return 0

	while IFS='|' read -r id name url enabled; do
		case "$id" in
			''|\#*) continue ;;
		esac
		"$cb" "$id"
	done < "$BLOCKY_UCI_LISTS"
}
