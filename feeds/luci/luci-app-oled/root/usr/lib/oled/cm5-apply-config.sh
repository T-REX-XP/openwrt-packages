#!/bin/sh
# CM5 Waveshare OLED menu-mode defaults (sourced by uci-defaults and migration).

cm5_apply_oled_config() {
	local path="${1:-/dev/i2c-7}"
	uci -q batch <<-EOF >/dev/null
		set oled.@oled[0].showmenu="1"
		set oled.@oled[0].enable="1"
		set oled.@oled[0].menu_mode="1"
		set oled.@oled[0].path="$path"
		set oled.@oled[0].ipifname="br-lan"
		set oled.@oled[0].netsource="br-lan"
		set oled.@oled[0].menu_timeout="5"
		set oled.@oled[0].menu_wifi="1"
		set oled.@oled[0].menu_interactive="0"
		set oled.@oled[0].menu_nav_button="BTN_2"
		set oled.@oled[0].menu_select_button="wps"
		set oled.@oled[0].menu_alerts="1"
		set oled.@oled[0].cm5_menu_migrated="1"
		set oled.@oled[0].rotate="0"
		set oled.@oled[0].netspeed="0"
		set oled.@oled[0].autoswitch="0"
		set oled.@oled[0].scroll="0"
		set oled.@oled[0].date="0"
		set oled.@oled[0].lanip="0"
		set oled.@oled[0].cpufreq="0"
		set oled.@oled[0].cputemp="0"
		set oled.@oled[0].drawline="0"
		set oled.@oled[0].drawrect="0"
		set oled.@oled[0].fillrect="0"
		set oled.@oled[0].drawcircle="0"
		set oled.@oled[0].drawroundrect="0"
		set oled.@oled[0].fillroundrect="0"
		set oled.@oled[0].drawtriangle="0"
		set oled.@oled[0].filltriangle="0"
		set oled.@oled[0].displaybitmap="0"
		set oled.@oled[0].displayinvertnormal="0"
		set oled.@oled[0].drawbitmapeg="0"
		commit oled
EOF
}

cm5_oled_legacy_flags_active() {
	local opt val
	for opt in drawline drawrect fillrect drawcircle drawroundrect fillroundrect \
		drawtriangle filltriangle displaybitmap displayinvertnormal drawbitmapeg \
		scroll date netspeed lanip cpufreq cputemp autoswitch; do
		val="$(uci -q get oled.@oled[0].$opt)"
		[ "$val" = "1" ] && return 0
	done
	return 1
}

cm5_oled_needs_menu_migration() {
	local menu_mode
	menu_mode="$(uci -q get oled.@oled[0].menu_mode)"
	[ "$menu_mode" = "1" ] || return 0
	cm5_oled_legacy_flags_active && return 0
	return 1
}

oled_start_enabled() {
	local menu_mode
	menu_mode="$(uci -q get oled.@oled[0].menu_mode)"
	[ "$menu_mode" = "1" ] && /etc/init.d/oledd enable && /etc/init.d/oledd start && return
	/etc/init.d/oled enable
	/etc/init.d/oled start
}

oled_ucitrack_init() {
	local menu_mode initscript
	menu_mode="$(uci -q get oled.@oled[0].menu_mode)"
	if [ "$menu_mode" = "1" ]; then
		initscript="oledd"
	else
		initscript="oled"
	fi
	uci -q batch <<-EOF >/dev/null
		delete ucitrack.@oled[-1]
		add ucitrack oled
		set ucitrack.@oled[-1].init=$initscript
		commit ucitrack
EOF
}
