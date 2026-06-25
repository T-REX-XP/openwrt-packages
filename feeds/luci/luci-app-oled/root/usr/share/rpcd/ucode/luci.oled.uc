#!/usr/bin/env ucode

'use strict';

import { readfile, popen, lsdir } from 'fs';

const OLED_UCI = 'oled.@oled[0]';
const CM5_RST_LED = '/sys/class/leds/waveshare-oled-rst/brightness';
const BOOT_STATE = '/tmp/oled_state';

const FLAG_OPTS = [
	'enable', 'rotate', 'menu_mode', 'menu_wifi', 'menu_interactive', 'menu_alerts',
	'autoswitch', 'date', 'lanip', 'cputemp', 'cpufreq', 'netspeed', 'scroll',
	'drawline', 'drawrect', 'fillrect', 'drawcircle', 'drawroundrect', 'fillroundrect',
	'drawtriangle', 'filltriangle', 'displaybitmap', 'displayinvertnormal', 'drawbitmapeg'
];

const STRING_OPTS = {
	path: /^\/dev\/i2c-[0-9]+$/,
	ipifname: /^[A-Za-z0-9_.-]+$/,
	netsource: /^[A-Za-z0-9_.-]+$/,
	menu_nav_button: /^(BTN_2|wps)$/,
	menu_select_button: /^(BTN_2|wps|none)$/,
	text: /^[ -~]{0,64}$/
};

const UINT_OPTS = [ 'menu_timeout', 'menu_idle_dim', 'time', 'from', 'to' ];

const ALL_SET_OPTS = [
	'enable', 'rotate', 'menu_mode', 'menu_wifi', 'menu_interactive', 'menu_alerts',
	'autoswitch', 'date', 'lanip', 'cputemp', 'cpufreq', 'netspeed', 'scroll',
	'drawline', 'drawrect', 'fillrect', 'drawcircle', 'drawroundrect', 'fillroundrect',
	'drawtriangle', 'filltriangle', 'displaybitmap', 'displayinvertnormal', 'drawbitmapeg',
	'menu_timeout', 'menu_idle_dim', 'time', 'from', 'to',
	'path', 'ipifname', 'netsource', 'menu_nav_button', 'menu_select_button', 'text'
];

function shell_quote(val) {
	val = `${val}`;
	let out = "'";
	for (let i = 0; i < length(val); i++) {
		let c = substr(val, i, 1);
		out += c == "'" ? "'\\''" : c;
	}
	out += "'";
	return out;
}

function run_cmd(cmd) {
	let p = popen(`${cmd} 2>&1`, 'r');
	if (!p)
		return { code: 1, output: 'popen failed' };
	let output = trim(p.read('all') || '');
	let code = p.close();
	return { code, output };
}

function file_test(flag, path) {
	let p = popen(`test ${flag} ${shell_quote(path)} && echo yes`, 'r');
	let ok = trim(p ? (p.read('all') || '') : '') == 'yes';
	if (p)
		p.close();
	return ok;
}

function uci_get(option, def) {
	let p = popen(`uci -q get ${OLED_UCI}.${option} 2>/dev/null`, 'r');
	let v = trim(p ? (p.read('all') || '') : '');
	if (p)
		p.close();
	return length(v) ? v : def;
}

function uci_set(option, value) {
	let val = `${value}`;
	let p = popen(`uci set ${OLED_UCI}.${option}=${shell_quote(val)} 2>&1`, 'r');
	if (p) {
		p.read('all');
		p.close();
	}
}

function uci_commit() {
	run_cmd('uci commit oled');
}

function list_i2c_devices() {
	let devices = [];
	let p = popen('ls -1 /dev/i2c-[0-9]* 2>/dev/null', 'r');
	if (p) {
		let raw = trim(p.read('all') || '');
		p.close();
		let lines = split(raw, '\n');
		for (let i = 0; i < length(lines); i++) {
			let line = trim(lines[i]);
			if (length(line))
				push(devices, line);
		}
	}
	if (length(devices))
		return devices;
	try {
		for (let n in lsdir('/dev')) {
			if (match(n, /^i2c-[0-9]+$/))
				push(devices, `/dev/${n}`);
		}
	} catch (e) {}
	return devices;
}

function ensure_i2c_path_list(path, devices) {
	let list = [];
	for (let i = 0; i < length(devices); i++)
		push(list, devices[i]);
	if (length(path)) {
		let found = false;
		for (let i = 0; i < length(list); i++) {
			if (list[i] == path) {
				found = true;
				break;
			}
		}
		if (!found)
			push(list, path);
	}
	if (!length(list) && length(path))
		push(list, path);
	return list;
}

function find_i2cdetect() {
	if (file_test('-x', '/usr/sbin/i2cdetect'))
		return '/usr/sbin/i2cdetect';
	if (file_test('-x', '/usr/bin/i2cdetect'))
		return '/usr/bin/i2cdetect';
	return '';
}

function find_logread() {
	if (file_test('-x', '/sbin/logread'))
		return '/sbin/logread';
	if (file_test('-x', '/bin/logread'))
		return '/bin/logread';
	return '';
}

const OLED_LOG_PATTERN = 'oledd|oled-cm5|oledd-boot|cm5-oled|oled-cm5-migrate';

function proc_running(pattern) {
	let p = popen(`pgrep -f ${shell_quote(pattern)} >/dev/null 2>&1; echo $?`, 'r');
	let code = trim(p ? (p.read('all') || '1') : '1');
	if (p)
		p.close();
	return code == '0';
}

function read_boot_state() {
	let out = { stage: '', message: '' };
	try {
		let text = readfile(BOOT_STATE);
		let lines = split(text, '\n');
		for (let i = 0; i < length(lines); i++) {
			let line = lines[i];
			let eq = index(line, '=');
			if (eq < 0)
				continue;
			let key = substr(line, 0, eq);
			let val = substr(line, eq + 1);
			val = replace(val, /[\r\n]+$/, '');
			if (key == 'stage')
				out.stage = val;
			else if (key == 'message')
				out.message = val;
		}
	} catch (e) {}
	return out;
}

function ubus_oledd_status() {
	let p = popen('ubus -S call oledd status 2>/dev/null', 'r');
	if (!p)
		return null;
	let raw = trim(p.read('all') || '');
	p.close();
	if (!length(raw))
		return null;
	try {
		return json(raw);
	} catch (e) {
		return null;
	}
}

function get_config() {
	let path = uci_get('path', '/dev/i2c-7');
	let cfg = {
		showmenu: uci_get('showmenu', '1'),
		enable: uci_get('enable', '1'),
		path,
		rotate: uci_get('rotate', '0'),
		menu_mode: uci_get('menu_mode', '1'),
		menu_timeout: uci_get('menu_timeout', '5'),
		menu_idle_dim: uci_get('menu_idle_dim', '0'),
		menu_wifi: uci_get('menu_wifi', '1'),
		menu_interactive: uci_get('menu_interactive', '0'),
		menu_nav_button: uci_get('menu_nav_button', 'BTN_2'),
		menu_select_button: uci_get('menu_select_button', 'wps'),
		menu_alerts: uci_get('menu_alerts', '1'),
		autoswitch: uci_get('autoswitch', '0'),
		from: uci_get('from', '0'),
		to: uci_get('to', '1440'),
		date: uci_get('date', '0'),
		lanip: uci_get('lanip', '0'),
		ipifname: uci_get('ipifname', 'br-lan'),
		cputemp: uci_get('cputemp', '0'),
		cpufreq: uci_get('cpufreq', '0'),
		netspeed: uci_get('netspeed', '0'),
		netsource: uci_get('netsource', 'br-lan'),
		time: uci_get('time', '60'),
		scroll: uci_get('scroll', '0'),
		text: uci_get('text', 'CM5'),
		drawline: uci_get('drawline', '0'),
		drawrect: uci_get('drawrect', '0'),
		fillrect: uci_get('fillrect', '0'),
		drawcircle: uci_get('drawcircle', '0'),
		drawroundrect: uci_get('drawroundrect', '0'),
		fillroundrect: uci_get('fillroundrect', '0'),
		drawtriangle: uci_get('drawtriangle', '0'),
		filltriangle: uci_get('filltriangle', '0'),
		displaybitmap: uci_get('displaybitmap', '0'),
		displayinvertnormal: uci_get('displayinvertnormal', '0'),
		drawbitmapeg: uci_get('drawbitmapeg', '0'),
		i2c_devices: ensure_i2c_path_list(path, list_i2c_devices())
	};
	return cfg;
}

function is_flag_opt(key) {
	for (let i = 0; i < length(FLAG_OPTS); i++)
		if (FLAG_OPTS[i] == key)
			return true;
	return false;
}

function is_uint_opt(key) {
	for (let i = 0; i < length(UINT_OPTS); i++)
		if (UINT_OPTS[i] == key)
			return true;
	return false;
}

function validate_option(key, value) {
	let val = `${value}`;
	if (is_flag_opt(key))
		return match(val, /^[01]$/) ? val : null;
	if (is_uint_opt(key))
		return match(val, /^[0-9]+$/) ? val : null;
	let re = STRING_OPTS[key];
	if (re)
		return match(val, re) ? val : null;
	return null;
}

function apply_service_state(restart) {
	run_cmd('. /usr/lib/oled/cm5-apply-config.sh 2>/dev/null; cm5_oled_sync_service 2>/dev/null');
	let enable = uci_get('enable', '0');
	let menu_mode = uci_get('menu_mode', '1');
	if (enable == '1') {
		if (menu_mode == '1')
			run_cmd('/etc/init.d/oledd enable');
		else
			run_cmd('/etc/init.d/oled enable');
	} else {
		run_cmd('/etc/init.d/oledd disable; /etc/init.d/oled disable');
	}
	if (!restart)
		return;
	run_cmd('/etc/init.d/oledd stop; /etc/init.d/oled stop');
	if (enable == '1')
		run_cmd('. /usr/lib/oled/cm5-apply-config.sh 2>/dev/null; oled_start_enabled');
}

const methods = {
	getConfig: {
		call: function() {
			if (!file_test('-f', '/etc/config/oled'))
				return { error: 'no_config' };
			return { config: get_config() };
		}
	},

	setConfig: {
		args: { config: 'config', restart: 'restart' },
		call: function(req) {
			if (!file_test('-f', '/etc/config/oled'))
				return { error: 'no_config' };
			let cfg = req.args?.config;
			if (type(cfg) != 'object')
				return { error: 'invalid_config' };
			let applied = 0;
			for (let i = 0; i < length(ALL_SET_OPTS); i++) {
				let key = ALL_SET_OPTS[i];
				if (cfg[key] == null)
					continue;
				let val = validate_option(key, cfg[key]);
				if (val == null)
					continue;
				uci_set(key, val);
				applied++;
			}
			uci_set('showmenu', '1');
			applied++;
			if (!applied)
				return { error: 'no_valid_options' };
			uci_commit();
			apply_service_state(!!req.args?.restart);
			return { ok: true, config: get_config() };
		}
	},

	getStatus: {
		call: function() {
			let menu_mode = uci_get('menu_mode', '1');
			let legacy = proc_running('/usr/bin/oled');
			let oledd = proc_running('/usr/sbin/oledd');
			let boot = read_boot_state();
			let ubus = ubus_oledd_status();
			let daemon = menu_mode == '1' ? 'oledd' : 'oled';
			let running = menu_mode == '1' ? oledd : legacy;
			return {
				config_present: file_test('-f', '/etc/config/oled'),
				menu_mode,
				daemon,
				running,
				legacy_running: legacy,
				oledd_running: oledd,
				enable: uci_get('enable', '0'),
				path: uci_get('path', '/dev/i2c-7'),
				view: ubus?.view || '',
				dimmed: ubus?.dimmed ? true : false,
				menu_interactive: ubus?.menu_interactive ? true : false,
				boot_stage: boot.stage || ubus?.boot_stage || '',
				boot_message: boot.message || '',
				ubus_available: ubus != null,
				rst_led: file_test('-f', CM5_RST_LED),
				preinit_hook: file_test('-f', '/lib/preinit/80-oled-preinit') ? '/lib/preinit/80-oled-preinit' : ''
			};
		}
	},

	detectI2c: {
		args: { bus: 'bus' },
		call: function(req) {
			let bus = trim(`${req.args?.bus || ''}`);
			if (!match(bus, /^[0-9]+$/))
				return { error: 'invalid_bus' };
			let dev = `/dev/i2c-${bus}`;
			if (!file_test('-c', dev))
				return { error: 'no_device', path: dev };
			let i2cdetect = find_i2cdetect();
			if (!length(i2cdetect))
				return { error: 'missing_i2cdetect', message: 'Install i2c-tools.' };
			let res = run_cmd(`${i2cdetect} -y ${bus}`);
			return { ok: true, path: dev, output: res.output };
		}
	},

	releaseRst: {
		call: function() {
			if (!file_test('-f', CM5_RST_LED))
				return { error: 'no_rst_led', message: 'Kernel waveshare-oled-rst LED missing (CM5 DTS patch 999).' };
			let res = run_cmd(`echo 1 > ${shell_quote(CM5_RST_LED)}`);
			if (res.code != 0)
				return {
					error: 'rst_failed',
					message: res.output || 'Failed to write waveshare-oled-rst brightness'
				};
			return { ok: true, output: res.output };
		}
	},

	serviceControl: {
		args: { action: 'action' },
		call: function(req) {
			let action = req.args?.action;
			if (type(action) != 'string' || !match(action, /^(start|stop|restart|enable|disable|status)$/))
				return { error: 'invalid_action' };
			let menu_mode = uci_get('menu_mode', '1');
			let init = menu_mode == '1' ? 'oledd' : 'oled';
			if (!file_test('-x', `/etc/init.d/${init}`))
				return { error: 'no_init', message: `Missing /etc/init.d/${init}` };
			let res = run_cmd(`/etc/init.d/${init} ${action}`);
			return {
				ok: res.code == 0,
				action,
				init,
				output: res.output,
				running: menu_mode == '1' ? proc_running('/usr/sbin/oledd') : proc_running('/usr/bin/oled')
			};
		}
	},

	getLogs: {
		args: { limit: 'limit' },
		call: function(req) {
			let logread = find_logread();
			if (!length(logread))
				return { error: 'missing_logread', message: 'logread not found' };
			let limit = int(req.args?.limit);
			if (!limit || limit < 1)
				limit = 200;
			if (limit > 2000)
				limit = 2000;
			let res = run_cmd(`${logread} -l ${limit} -e ${shell_quote(OLED_LOG_PATTERN)}`);
			return {
				ok: true,
				limit,
				output: res.output || ''
			};
		}
	}
};

return { 'luci.oled': methods };
