#!/usr/bin/env ucode

'use strict';

import { readfile, popen, lsdir } from 'fs';

const MCUD_UCI = 'mcud.main';
const MCUD_CONFIG_PATH = '/etc/config/mcud';
const BOOT_STATE = '/tmp/mcud_state';
const ACTIVE_SCREEN = '/tmp/mcud_active_screen';
const FW_VERSION_FILE = '/tmp/mcud_firmware_version.json';
const MCUD_EVENT_SH = '/usr/lib/mcud/mcud-event.sh';
const MCUDD_BIN = '/usr/sbin/mcudd';

/* Keep in sync with feeds/packages/mcudd/internal/config (Go Config / UCI). */
const CONFIG_DEFAULTS = {
	enable: '0',
	path: '/dev/ttyS2',
	baud: '115200',
	wire_format: 'json',
	demo_mode: '0',
	pages: '/etc/mcud/pages.json',
	wan_if: 'wan',
	lan_if: 'br-lan',
	wifi_if: 'wlan0',
	interval_system: '1000',
	interval_network: '2000',
	push_alerts: '1',
	max_line: '4096',
	screen_timeout: '60',
	screen_timeout_mode: 'off',
	log_level: 'info',
	debug: '0',
	debug_serial: '0',
	menu_nav_button: 'BTN_2',
	menu_select_button: 'wps',
	menu_wps: '0',
	path_autodiscover: '1'
};

const FLAG_OPTS = [ 'enable', 'demo_mode', 'push_alerts', 'debug', 'debug_serial', 'menu_wps', 'path_autodiscover' ];
const STRING_OPTS = {
	path: /^\/dev\/[A-Za-z0-9._-]+$/,
	pages: /^\/[ -~]+$/,
	wire_format: /^(json|msgpack)$/,
	wan_if: /^[A-Za-z0-9_.-]+$/,
	lan_if: /^[A-Za-z0-9_.-]+$/,
	wifi_if: /^[A-Za-z0-9_.-]+$/,
	screen_timeout_mode: /^(off|dim|blank)$/,
	log_level: /^(error|warn|info|debug)$/,
	menu_nav_button: /^(BTN_2|wps|none|[A-Za-z0-9_.-]+)$/,
	menu_select_button: /^(BTN_2|wps|none|[A-Za-z0-9_.-]+)$/
};
const UINT_OPTS = [ 'baud', 'interval_system', 'interval_network', 'max_line' ];
const UINT_ZERO_OPTS = [ 'screen_timeout' ];

const ALL_SET_OPTS = [
	'enable', 'demo_mode', 'push_alerts', 'debug', 'debug_serial', 'menu_wps', 'path_autodiscover',
	'path', 'pages', 'wire_format', 'wan_if', 'lan_if', 'wifi_if',
	'baud', 'interval_system', 'interval_network', 'max_line',
	'screen_timeout', 'screen_timeout_mode', 'log_level',
	'menu_nav_button', 'menu_select_button'
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

function find_logread() {
	if (file_test('-x', '/sbin/logread'))
		return '/sbin/logread';
	if (file_test('-x', '/bin/logread'))
		return '/bin/logread';
	return '';
}

const MCUDD_LOG_TAGS = [ 'mcudd', 'mcud-event', 'mcudd-boot' ];

function parse_log_limit(req, fallback) {
	let raw = req?.args?.limit ?? req?.limit ?? req?.[0] ?? fallback ?? 200;
	let limit = int(`${raw}`);
	if (!limit || limit < 1)
		limit = fallback ?? 200;
	if (limit > 2000)
		limit = 2000;
	return limit;
}

function build_logread_cmd(logread, limit) {
	let cmd = logread;
	let i;

	for (i = 0; i < length(MCUDD_LOG_TAGS); i++)
		cmd += ` -e ${shell_quote(MCUDD_LOG_TAGS[i])}`;
	cmd += ` | tail -n ${limit}`;
	return cmd;
}

function log_mcud_event(msg) {
	run_cmd(`logger -t mcud-event ${shell_quote(msg)}`);
}

function uci_get(option) {
	let p = popen(`uci -q get ${MCUD_UCI}.${option} 2>/dev/null`, 'r');
	let v = trim(p ? (p.read('all') || '') : '');
	if (p)
		p.close();
	return v;
}

function uci_set(option, value) {
	let val = `${value}`;
	let p = popen(`uci set ${MCUD_UCI}.${option}=${shell_quote(val)} 2>&1`, 'r');
	if (p) {
		p.read('all');
		p.close();
	}
}

function uci_commit() {
	run_cmd('uci commit mcud');
}

function read_boot_state() {
	let out = { stage: '', message: '', pct: null };
	try {
		let text = readfile(BOOT_STATE);
		let lines = split(text, '\n');
		for (let i = 0; i < length(lines); i++) {
			let line = lines[i];
			let eq = index(line, '=');
			if (eq < 0)
				continue;
			let key = substr(line, 0, eq);
			let val = replace(substr(line, eq + 1), /[\r\n]+$/, '');
			if (key == 'stage')
				out.stage = val;
			else if (key == 'message')
				out.message = val;
			else if (key == 'pct')
				out.pct = int(val);
		}
	} catch (e) {}
	return out;
}

function read_active_screen() {
	try {
		return trim(readfile(ACTIVE_SCREEN) || '');
	} catch (e) {
		return '';
	}
}

function read_version_file(path) {
	try {
		let text = readfile(path);
		if (!length(text))
			return null;
		return json(text);
	} catch (e) {
		return null;
	}
}

function read_host_version() {
	let cached = read_version_file('/tmp/mcud_host_version.json');
	if (cached)
		return cached;
	if (!file_test('-x', MCUDD_BIN))
		return null;
	let r = run_cmd(`${MCUDD_BIN} -version-json`);
	if (r.code != 0 || !length(r.output))
		return null;
	try {
		return json(trim(r.output));
	} catch (e) {
		return null;
	}
}

function version_label(info) {
	if (!info || type(info) != 'object')
		return '';
	let stack = info.stack || '';
	let release = info.release;
	if (!length(stack))
		return '';
	if (release != null && release != '')
		return `${stack}+${release}`;
	return stack;
}

function versions_synced(host, fw) {
	if (!host || !fw)
		return false;
	if (host.rdcp != null && fw.rdcp != null && host.rdcp != fw.rdcp)
		return false;
	if (host.stack != fw.stack)
		return false;
	if (host.release != fw.release)
		return false;
	return true;
}

function load_pages_config() {
	let path = uci_get('pages') || '/etc/mcud/pages.json';
	if (!file_test('-f', path))
		return null;
	try {
		return json(readfile(path));
	} catch (e) {
		return null;
	}
}

function enabled_pages(cfg) {
	let out = [];
	if (!cfg || type(cfg.screens) != 'array')
		return out;
	for (let i = 0; i < length(cfg.screens); i++) {
		let p = cfg.screens[i];
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
	return id;
}

function page_summary_list(cfg) {
	let pages = enabled_pages(cfg);
	let out = [];
	for (let i = 0; i < length(pages); i++) {
		push(out, {
			id: pages[i].id,
			title: pages[i].title || pages[i].id,
			scope: pages[i].scope || ''
		});
	}
	return out;
}

function list_serial_ports() {
	let ports = [];

	try {
		if (file_test('-x', '/usr/lib/mcud/mcud-autodiscover.sh')) {
			let p = popen('/usr/lib/mcud/mcud-autodiscover.sh --list 2>/dev/null', 'r');
			if (p) {
				let text = trim(p.read('all') || '');
				p.close();
				if (length(text)) {
					let lines = split(text, '\n');
					for (let i = 0; i < length(lines); i++) {
						let line = trim(lines[i]);
						if (length(line))
							push(ports, line);
					}
				}
			}
		}
	} catch (e) {}

	if (length(ports))
		return ports;

	try {
		let dir = lsdir('/dev');
		for (let i = 0; i < length(dir); i++) {
			let name = dir[i];
			if (match(name, /^ttyUSB[0-9]+$/) ||
			    match(name, /^ttyACM[0-9]+$/) ||
			    match(name, /^ttyS[0-9]+$/))
				push(ports, `/dev/${name}`);
		}
	} catch (e) {}

	return ports;
}

function discover_serial_port() {
	if (!file_test('-x', '/usr/lib/mcud/mcud-autodiscover.sh'))
		return '';
	let p = popen('/usr/lib/mcud/mcud-autodiscover.sh 2>/dev/null', 'r');
	if (!p)
		return '';
	let path = trim(p.read('all') || '');
	p.close();
	return path;
}

function path_is_valid(path) {
	if (!length(path))
		return false;
	return file_test('-c', path);
}

function flag_bool(v) {
	return v == '1' ? 'true' : 'false';
}

function read_uci_cfg() {
	let cfg = {};
	for (let i = 0; i < length(FLAG_OPTS); i++) {
		let k = FLAG_OPTS[i];
		cfg[k] = uci_get(k);
	}
	for (let k in STRING_OPTS)
		cfg[k] = uci_get(k);
	for (let i = 0; i < length(UINT_OPTS); i++) {
		let k = UINT_OPTS[i];
		cfg[k] = uci_get(k);
	}
	for (let i = 0; i < length(UINT_ZERO_OPTS); i++) {
		let k = UINT_ZERO_OPTS[i];
		cfg[k] = uci_get(k);
	}

	/* Fill blanks from shared defaults so LuCI and Go mcudd agree. */
	for (let k in CONFIG_DEFAULTS) {
		if (!length(cfg[k]))
			cfg[k] = CONFIG_DEFAULTS[k];
	}

	cfg.path_autodiscover = cfg.path_autodiscover == '0' ? '0' : '1';
	return cfg;
}

function format_effective_config(cfg) {
	return join('\n', [
		`enable=${flag_bool(cfg.enable)}`,
		`path=${cfg.path}`,
		`baud=${cfg.baud}`,
		`path_autodiscover=${flag_bool(cfg.path_autodiscover)}`,
		`wire_format=${cfg.wire_format}`,
		`max_line=${cfg.max_line}`,
		`pages=${cfg.pages}`,
		`demo_mode=${flag_bool(cfg.demo_mode)}`,
		`screen_timeout=${cfg.screen_timeout}`,
		`screen_timeout_mode=${cfg.screen_timeout_mode}`,
		`push_alerts=${flag_bool(cfg.push_alerts)}`,
		`wan_if=${cfg.wan_if}`,
		`lan_if=${cfg.lan_if}`,
		`wifi_if=${cfg.wifi_if}`,
		`interval_system=${cfg.interval_system}`,
		`interval_network=${cfg.interval_network}`,
		`log_level=${cfg.log_level}`,
		`debug=${flag_bool(cfg.debug)}`,
		`debug_serial=${flag_bool(cfg.debug_serial)}`,
		`menu_nav_button=${cfg.menu_nav_button}`,
		`menu_select_button=${cfg.menu_select_button}`,
		`menu_wps=${flag_bool(cfg.menu_wps)}`
	]) + '\n';
}

function get_config() {
	let cfg = read_uci_cfg();
	cfg.config_backend = 'uci';
	cfg.config_path = MCUD_CONFIG_PATH;
	cfg.serial_ports = list_serial_ports();
	cfg.discovered_path = discover_serial_port();
	cfg.path_valid = path_is_valid(cfg.path);
	cfg.effective_path = cfg.path_valid ? cfg.path :
		(length(cfg.discovered_path) ? cfg.discovered_path : cfg.path);
	/* Format in ucode — exec of Go mcudd from rpcd aborts the ubus method. */
	cfg.effective = format_effective_config(cfg);
	return cfg;
}

function normalize_config(raw) {
	if (type(raw) == 'string' && length(raw))
		raw = json(raw);
	if (type(raw) != 'object')
		return null;
	if (raw.config && type(raw.config) == 'object')
		raw = raw.config;
	else if (raw.config && type(raw.config) == 'string' && length(raw.config))
		raw = json(raw.config);
	return raw;
}

function validate_set(config) {
	config = normalize_config(config);
	if (type(config) != 'object')
		return 'invalid config';
	let count = 0;
	for (let k in config)
		count++;
	if (!count)
		return 'empty config';
	for (let k in config) {
		if (index(ALL_SET_OPTS, k) < 0)
			return `unknown option ${k}`;
		if (index(FLAG_OPTS, k) >= 0) {
			if (config[k] != '0' && config[k] != '1')
				return `${k} must be 0 or 1`;
		} else if (STRING_OPTS[k]) {
			if (!match(`${config[k]}`, STRING_OPTS[k]))
				return `invalid ${k}`;
		} else if (index(UINT_OPTS, k) >= 0) {
			let n = +config[k];
			if (n != config[k] || n <= 0)
				return `invalid ${k}`;
		} else if (index(UINT_ZERO_OPTS, k) >= 0) {
			let n = +config[k];
			if (n != config[k] || n < 0 || n > 3600)
				return `invalid ${k}`;
		}
	}
	return null;
}

function get_status() {
	let running = run_cmd('pidof mcudd').code == 0;
	try {
		let cfg = read_uci_cfg();
		let boot = read_boot_state();
		let pages_cfg = load_pages_config();
		let active = read_active_screen();
		let port_exists = false;
		let fifo_ok = file_test('-p', '/var/run/mcudd.fifo') ||
			file_test('-p', '/tmp/mcudd.fifo');

		if (length(cfg.path)) {
			let t = run_cmd(`test -c ${shell_quote(cfg.path)} && echo yes`);
			port_exists = t.output == 'yes';
		}

		if (!length(active))
			active = boot.stage == 'ready' ? 'router_system' : 'router_boot';
		else if (pages_cfg && active != 'router_boot' &&
			 page_index_by_id(pages_cfg, active) < 0)
			active = boot.stage == 'ready' ? 'router_system' : 'router_boot';

		let page_idx = pages_cfg ? page_index_by_id(pages_cfg, active) : -1;
		let host_version = read_host_version();
		let firmware_version = read_version_file(FW_VERSION_FILE);
		let version_synced = versions_synced(host_version, firmware_version);

		return {
			running,
			port_exists,
			fifo_ok,
			config_complete: length(cfg.path) > 0 && length(cfg.baud) > 0 &&
				length(cfg.wire_format) > 0 && length(cfg.pages) > 0,
			active_screen: active,
			page_id: active,
			page_idx: page_idx >= 0 ? page_idx : null,
			page_title: pages_cfg ? page_title_for_id(pages_cfg, active) : active,
			page_count: pages_cfg ? length(enabled_pages(pages_cfg)) : 0,
			pages: pages_cfg ? page_summary_list(pages_cfg) : [],
			host_version,
			firmware_version,
			host_version_label: version_label(host_version),
			firmware_version_label: version_label(firmware_version),
			version_synced,
			rdcp_version: host_version?.rdcp ?? firmware_version?.rdcp ?? null,
			boot_stage: boot.stage,
			boot_message: boot.message,
			boot_pct: boot.pct,
			updated_at: time()
		};
	} catch (e) {
		return {
			running,
			error: `${e}`,
			updated_at: time()
		};
	}
}

const methods = {
	getConfig: {
		call: function() {
			return get_config();
		}
	},

	setConfig: {
		args: { config: 'config', restart: 'restart' },
		call: function(req) {
			let config = normalize_config(req.args?.config ?? req?.config ?? req?.[0] ?? req);
			let restart = req.args?.restart ?? req?.restart ?? req?.[1] ?? '0';
			let err = validate_set(config);
			if (err)
				return { ok: false, error: err };

			/* Persist full schema so Go mcudd always sees a complete UCI file. */
			for (let k in CONFIG_DEFAULTS) {
				if (config[k] == null || config[k] === '')
					config[k] = CONFIG_DEFAULTS[k];
			}
			for (let i = 0; i < length(ALL_SET_OPTS); i++) {
				let k = ALL_SET_OPTS[i];
				if (config[k] != null)
					uci_set(k, config[k]);
			}
			uci_commit();

			if (restart == '1')
				run_cmd('/etc/init.d/mcudd restart');

			return { ok: true, config: get_config() };
		}
	},

	getStatus: {
		call: function() {
			return get_status();
		}
	},

	getPageList: {
		call: function() {
			let st = get_status();
			return {
				ok: true,
				running: st.running,
				pages: st.pages,
				page_id: st.page_id,
				page_idx: st.page_idx,
				page_title: st.page_title,
				page_count: st.page_count,
				boot_stage: st.boot_stage,
				boot_message: st.boot_message
			};
		}
	},

	pageControl: {
		args: { action: 'action', page_id: 'page_id' },
		call: function(req) {
			let action = req.args?.action ?? req?.action ?? req?.[0] ?? '';
			if (type(action) != 'string' || !length(action)) {
				log_mcud_event('luci pageControl invalid_action (empty)');
				return { error: 'invalid_action' };
			}

			if (!file_test('-x', MCUD_EVENT_SH)) {
				log_mcud_event('luci pageControl event_script_missing');
				return { error: 'event_script_missing', message: 'mcud-event.sh not installed' };
			}

			if (action == 'prev' || action == 'next') {
				log_mcud_event(`luci pageControl ${action}`);
				run_cmd(`${MCUD_EVENT_SH} ${shell_quote(action)}`);
				return { ok: true, action, via: 'fifo' };
			}

			if (action == 'goto') {
				let page_id = trim(`${req.args?.page_id ?? req?.page_id ?? req?.[1] ?? ''}`);
				if (!length(page_id)) {
					log_mcud_event('luci pageControl goto missing_page_id');
					return { error: 'missing_page_id' };
				}
				log_mcud_event(`luci pageControl goto ${page_id}`);
				run_cmd(`${MCUD_EVENT_SH} screen ${shell_quote(page_id)}`);
				return { ok: true, action, page_id, via: 'fifo' };
			}

			if (action == 'boot') {
				log_mcud_event('luci pageControl boot');
				run_cmd(`${MCUD_EVENT_SH} boot`);
				return { ok: true, action, via: 'fifo' };
			}

			if (action == 'version') {
				log_mcud_event('luci pageControl version');
				run_cmd(`${MCUD_EVENT_SH} version`);
				return { ok: true, action, via: 'fifo' };
			}

			log_mcud_event(`luci pageControl invalid_action ${action}`);
			return { error: 'invalid_action' };
		}
	},

	listSerialPorts: {
		call: function() {
			let ports = list_serial_ports();
			let discovered = discover_serial_port();
			return { ports, discovered, default: discovered || (length(ports) ? ports[0] : '') };
		}
	},

	autodiscoverPort: {
		call: function() {
			if (!file_test('-x', '/usr/lib/mcud/mcud-autodiscover.sh'))
				return { error: 'missing_script' };
			run_cmd('/usr/lib/mcud/mcud-autodiscover.sh --apply');
			let cfg = get_config();
			return {
				ok: true,
				path: cfg.path,
				discovered_path: cfg.discovered_path,
				effective_path: cfg.effective_path,
				path_valid: cfg.path_valid
			};
		}
	},

	serviceControl: {
		args: { action: 'action' },
		call: function(req) {
			let action = req.args?.action ?? req?.action ?? req?.[0] ?? '';
			if (!match(action, /^(start|stop|restart|enable|disable)$/))
				return { ok: false, error: 'invalid action' };
			log_mcud_event(`luci serviceControl ${action}`);
			let r = run_cmd(`/etc/init.d/mcudd ${action}`);
			return { ok: r.code == 0, output: r.output };
		}
	},

	getLogs: {
		args: { limit: 'limit' },
		call: function(req) {
			let logread = find_logread();
			if (!length(logread))
				return { error: 'missing_logread', message: 'logread not found' };
			let limit = parse_log_limit(req, 200);
			let res = run_cmd(build_logread_cmd(logread, limit));
			let output = res.output || '';
			let lines = length(output) ? split(output, '\n') : [];
			return {
				ok: true,
				limit,
				line_count: length(lines),
				output
			};
		}
	}
};

return { 'luci.mcu-display': methods };
