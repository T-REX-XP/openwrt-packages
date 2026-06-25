#!/usr/bin/env ucode

'use strict';

import { readfile, popen, lsdir } from 'fs';

const OLED_UCI = 'oled.@oled[0]';
const CM5_RST_LED = '/sys/class/leds/waveshare-oled-rst/brightness';
const BOOT_STATE = '/tmp/oled_state';
const PAGES_JSON = '/etc/oled/pages.json';
const OLEDD_EVENT_SH = '/usr/lib/oled/oledd-event.sh';

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

function ubus_call(object, method, args) {
	let argstr = args != null ? ` ${shell_quote(json(args))}` : '';
	let p = popen(`ubus -S call ${object} ${method}${argstr} 2>/dev/null`, 'r');
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

function ubus_oledd_status() {
	return ubus_call('oledd', 'status');
}

function read_int_file(path, defval) {
	try {
		let v = int(trim(readfile(path)));
		return v ? v : defval;
	} catch (e) {
		return defval;
	}
}

function read_cpu_temp_c() {
	let paths = [
		'/sys/class/hwmon/hwmon0/temp1_input',
		'/sys/class/hwmon/hwmon1/temp1_input',
		'/sys/class/thermal/thermal_zone0/temp'
	];
	for (let i = 0; i < length(paths); i++) {
		let raw = read_int_file(paths[i], 0);
		if (raw > 0)
			return raw > 1000 ? int(raw / 1000) : raw;
	}
	return 0;
}

function count_dhcp_leases() {
	try {
		let text = readfile('/tmp/dhcp.leases');
		let lines = split(text, '\n');
		let n = 0;
		for (let i = 0; i < length(lines); i++) {
			if (length(trim(lines[i])))
				n++;
		}
		return n;
	} catch (e) {
		return 0;
	}
}

function disk_usage_combo(mount) {
	let res = run_cmd(`df -k ${shell_quote(mount)} 2>/dev/null | awk 'NR==2 {print $3,$2}'`);
	if (res.code != 0 || !length(res.output))
		return { combo: '--/--', pct: 0.0 };
	let parts = split(trim(res.output), ' ');
	if (length(parts) < 2)
		return { combo: '--/--', pct: 0.0 };
	let used_kb = int(parts[0]);
	let total_kb = int(parts[1]);
	if (!total_kb)
		return { combo: '--/--', pct: 0.0 };
	let pct = total_kb > 0 ? used_kb / total_kb : 0.0;
	let u_gb = int(used_kb / 1048576);
	let t_gb = int(total_kb / 1048576);
	let combo;
	if (t_gb >= 1) {
		let u_mb = int((used_kb / 1024) % 1024);
		combo = `${u_gb}.${int(u_mb / 100)}/${t_gb}G`;
	} else {
		combo = `${int(used_kb / 1024)}/${int(total_kb / 1024)}M`;
	}
	return { combo, pct };
}

function ping_gateway_ms() {
	let res = run_cmd("ping -c 1 -W 1 $(ip route | awk '/default/ {print $3; exit}') 2>/dev/null | awk -F'/' '/round-trip|rtt/ {print $5; exit}'");
	if (res.code != 0 || !length(res.output))
		return 0;
	return int(res.output);
}

function wan_ipv4() {
	let st = ubus_call('network.interface.wan', 'status');
	if (st?.['ipv4-address'] && length(st['ipv4-address'])) {
		let addr = st['ipv4-address'][0]?.address;
		if (length(addr))
			return addr;
	}
	return '---';
}

function collect_oled_metrics() {
	let sys = ubus_call('system', 'info') || {};
	let load = sys.load || [0.05, 0.05, 0.05];
	let load1 = load[0] != null ? load[0] : 0.05;
	if (load1 > 1.0)
		load1 = 1.0;
	if (load1 < 0.0)
		load1 = 0.0;

	let mem = sys.memory || {};
	let mem_total = mem.total || 0;
	let mem_free = mem.free || 0;
	let mem_used = mem_total > mem_free ? mem_total - mem_free : 0;
	let ram_pct = mem_total > 0 ? mem_used / mem_total : 0.0;
	let ram_mb = int(mem_used / 1024);
	let ram_used;
	if (ram_mb >= 1024)
		ram_used = `${int(ram_mb / 1024)}.${int((ram_mb % 1024) * 10 / 1024)}G`;
	else
		ram_used = `${ram_mb}M`;

	let uptime = int(sys.uptime || 0);
	let uptime_d = int(uptime / 86400);
	let uptime_h = int((uptime % 86400) / 3600);
	let uptime_m = int((uptime % 3600) / 60);
	let uptime_short;
	if (uptime_d > 0)
		uptime_short = `${uptime_d}d${uptime_h}h`;
	else
		uptime_short = `${uptime_h}h${uptime_m}m`;

	let temp = read_cpu_temp_c();
	let root = disk_usage_combo('/');
	let data_mount = file_test('-d', '/overlay') ? '/overlay' : '/mnt';
	let data = disk_usage_combo(data_mount);
	let leases = count_dhcp_leases();
	let ping_ms = ping_gateway_ms();

	let wifi = ubus_call('network.wireless', 'status') || {};
	let wifi_sta = 0;
	let wifi_ssid = 'NO AP';
	let wifi_ap_state = 'NO AP';
	for (let radio in wifi) {
		if (type(wifi[radio]) != 'object')
			continue;
		for (let iface in wifi[radio].interfaces) {
			let info = wifi[radio].interfaces[iface];
			if (info?.config?.mode == 'ap' && length(info?.config?.ssid)) {
				wifi_ssid = info.config.ssid;
				wifi_ap_state = info.up ? 'ACTIVE' : 'NO AP';
			}
			if (info?.iwinfo) {
				if (info.iwinfo.num_sta != null)
					wifi_sta += int(info.iwinfo.num_sta);
				else if (type(info.iwinfo.assoclist) == 'object') {
					for (let _mac in info.iwinfo.assoclist)
						wifi_sta++;
				}
			}
		}
	}

	let time_res = run_cmd('date +%H:%M');
	let time_str = time_res.code == 0 && length(time_res.output) ? time_res.output : '--:--';

	return {
		time: time_str,
		cpu_temp: temp ? `${temp}C` : 'N/A',
		cpu_load: load1,
		ram_used,
		ram_pct,
		temp_short: `${temp}C`,
		load_short: sprintf('%.2f', load1),
		uptime_short,
		wan_ip: wan_ipv4(),
		rx_rate: '0.0 Mb',
		tx_rate: '0.0 Mb',
		ping_ms: ping_ms ? `${ping_ms}ms` : '---',
		clients_total: sprintf('%02d', wifi_sta),
		wifi_24: sprintf('%02d', int(wifi_sta / 2)),
		wifi_5: sprintf('%02d', int(wifi_sta / 2)),
		lan_clients: sprintf('%02d', leases > 2 ? 2 : leases),
		dhcp_leases: `${leases}/250`,
		dhcp_pct: leases > 0 ? leases / 250.0 : 0.0,
		root_usage: root.combo,
		root_pct: root.pct,
		data_usage: data.combo,
		data_pct: data.pct,
		swap_usage: '0/2G',
		wifi_ap_state,
		wifi_ssid,
		firewall_state: 'ACTIVE',
		blocked_24h: '0',
		vpn_tunnels: '0 UP'
	};
}

function load_pages_config() {
	if (!file_test('-f', PAGES_JSON))
		return null;
	try {
		return json(readfile(PAGES_JSON));
	} catch (e) {
		return null;
	}
}

function enabled_pages(cfg) {
	let out = [];
	if (!cfg || type(cfg.pages) != 'array')
		return out;
	for (let i = 0; i < length(cfg.pages); i++) {
		let p = cfg.pages[i];
		if (p && p.enabled != false)
			push(out, p);
	}
	return out;
}

function page_index_by_id(cfg, id) {
	let pages = enabled_pages(cfg);
	for (let i = 0; i < length(pages); i++) {
		if (pages[i].id == id)
			return i;
	}
	return -1;
}

function page_title_for_id(cfg, id) {
	let pages = enabled_pages(cfg);
	for (let i = 0; i < length(pages); i++) {
		if (pages[i].id == id)
			return pages[i].title || pages[i].id;
	}
	return id || '';
}

function token_from_braces(s) {
	if (type(s) != 'string')
		return '';
	let m = match(s, /^\{([^}]+)\}$/);
	return m ? m[1] : s;
}

function metric_lookup(metrics, token) {
	if (!metrics || !length(token))
		return '';
	if (metrics[token] != null)
		return `${metrics[token]}`;
	return '';
}

function metric_float(metrics, token) {
	if (!metrics || !length(token))
		return 0.0;
	let v = metrics[token];
	if (type(v) == 'number')
		return v;
	return v || 0;
}

function subst_tokens(text, metrics) {
	if (type(text) != 'string' || !length(text))
		return text || '';
	let out = '';
	let i = 0;
	while (i < length(text)) {
		if (substr(text, i, 1) != '{') {
			out += substr(text, i, 1);
			i++;
			continue;
		}
		let j = i + 1;
		while (j < length(text) && substr(text, j, 1) != '}')
			j++;
		if (j < length(text)) {
			let tok = substr(text, i + 1, j - i - 1);
			out += metric_lookup(metrics, tok);
			i = j + 1;
		} else {
			out += substr(text, i, 1);
			i++;
		}
	}
	return out;
}

function resolve_page_elements(page, metrics) {
	let out = [];
	if (!page || type(page.elements) != 'array')
		return out;
	for (let i = 0; i < length(page.elements); i++) {
		let el = page.elements[i];
		if (!el || !el.type)
			continue;
		let copy = {
			type: el.type,
			x: el.x, y: el.y, w: el.w, h: el.h,
			x1: el.x1, y1: el.y1, x2: el.x2, y2: el.y2,
			fill: !!el.fill,
			invert: !!el.invert,
			font: el.font || 'xs',
			align: el.align || 'left',
			name: el.name || '',
			size: el.size || 8,
			source: el.source || '',
			data: el.data || ''
		};
		if (el.text != null)
			copy.text = subst_tokens(`${el.text}`, metrics);
		if (el.value != null) {
			let tok = token_from_braces(`${el.value}`);
			copy.value = el.value;
			copy.value_num = metric_float(metrics, tok);
		}
		push(out, copy);
	}
	return out;
}

function page_summary_list(cfg) {
	let pages = enabled_pages(cfg);
	let out = [];
	for (let i = 0; i < length(pages); i++) {
		push(out, {
			id: pages[i].id || '',
			title: pages[i].title || pages[i].id || '',
			tabIcon: pages[i].tabIcon || ''
		});
	}
	return out;
}

function current_page_snapshot(cfg, view, metrics) {
	let pages = enabled_pages(cfg);
	let page_idx = page_index_by_id(cfg, view);
	let page = page_idx >= 0 ? pages[page_idx] : null;
	return {
		page_idx: page_idx >= 0 ? page_idx : 0,
		page_id: page?.id || view || '',
		page_title: page?.title || page_title_for_id(cfg, view) || view || '',
		page_count: length(pages),
		pages: page_summary_list(cfg),
		elements: page ? resolve_page_elements(page, metrics) : [],
		width: cfg?.width || 128,
		height: cfg?.height || 64
	};
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
			let pages_cfg = load_pages_config();
			let view = ubus?.view || '';
			let page_idx = pages_cfg ? page_index_by_id(pages_cfg, view) : -1;
			return {
				config_present: file_test('-f', '/etc/config/oled'),
				menu_mode,
				daemon,
				running,
				legacy_running: legacy,
				oledd_running: oledd,
				enable: uci_get('enable', '0'),
				path: uci_get('path', '/dev/i2c-7'),
				view,
				page_id: view,
				page_idx: page_idx >= 0 ? page_idx : null,
				page_title: pages_cfg ? page_title_for_id(pages_cfg, view) : view,
				page_count: pages_cfg ? length(enabled_pages(pages_cfg)) : 0,
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

	getPagePreview: {
		call: function() {
			let ubus = ubus_oledd_status();
			let boot = read_boot_state();
			let pages_cfg = load_pages_config();
			let metrics = collect_oled_metrics();
			let view = ubus?.view || '';
			let snap;
			if (view == 'boot') {
				let boot_msg = boot.message || 'Booting…';
				snap = {
					page_idx: -1,
					page_id: 'boot',
					page_title: 'BOOT',
					page_count: pages_cfg ? length(enabled_pages(pages_cfg)) : 0,
					pages: pages_cfg ? page_summary_list(pages_cfg) : [],
					elements: [{
						type: 'text',
						x: 4,
						y: 24,
						text: boot_msg,
						font: 'sm',
						align: 'left'
					}],
					width: pages_cfg?.width || 128,
					height: pages_cfg?.height || 64
				};
			} else {
				snap = pages_cfg ?
					current_page_snapshot(pages_cfg, view, metrics) :
					{ page_idx: 0, page_id: view, page_title: view, page_count: 0, pages: [], elements: [], width: 128, height: 64 };
			}
			return {
				ok: true,
				running: proc_running('/usr/sbin/oledd'),
				view,
				dimmed: ubus?.dimmed ? true : false,
				menu_interactive: ubus?.menu_interactive ? true : false,
				metrics,
				page_idx: snap.page_idx,
				page_id: snap.page_id,
				page_title: snap.page_title,
				page_count: snap.page_count,
				pages: snap.pages,
				elements: snap.elements,
				width: snap.width,
				height: snap.height
			};
		}
	},

	pageControl: {
		args: { action: 'action', page_id: 'page_id' },
		call: function(req) {
			let action = req.args?.action;
			if (type(action) != 'string')
				return { error: 'invalid_action' };

			if (action == 'prev' || action == 'next') {
				let ev = action == 'prev' ? 'prev' : 'next';
				let ubus = ubus_call('oledd', 'event', { type: ev });
				if (ubus?.ok)
					return { ok: true, action, via: 'ubus' };
				if (file_test('-x', OLEDD_EVENT_SH)) {
					run_cmd(`${OLEDD_EVENT_SH} ${shell_quote(ev)}`);
					return { ok: true, action, via: 'fifo' };
				}
				return { error: 'oledd_unavailable', message: 'oledd ubus event and FIFO script unavailable' };
			}

			if (action == 'goto') {
				let page_id = trim(`${req.args?.page_id || ''}`);
				if (!length(page_id))
					return { error: 'missing_page_id' };
				let ubus = ubus_call('oledd', 'set_view', { view: page_id });
				if (ubus?.ok)
					return { ok: true, action, page_id, via: 'ubus' };
				return { error: 'set_view_failed', message: 'oledd rejected page id or daemon not running' };
			}

			return { error: 'invalid_action' };
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
