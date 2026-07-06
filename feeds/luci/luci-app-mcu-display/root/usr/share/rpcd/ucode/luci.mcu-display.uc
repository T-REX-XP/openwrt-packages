#!/usr/bin/env ucode

'use strict';

import { readfile, popen, lsdir } from 'fs';

const MCUD_UCI = 'mcud.main';

const FLAG_OPTS = [ 'enable', 'demo_mode', 'push_alerts' ];
const STRING_OPTS = {
	path: /^\/dev\/[A-Za-z0-9._-]+$/,
	pages: /^\/[ -~]+$/,
	wire_format: /^(json|msgpack)$/,
	wan_if: /^[A-Za-z0-9_.-]+$/,
	lan_if: /^[A-Za-z0-9_.-]+$/,
	wifi_if: /^[A-Za-z0-9_.-]+$/
};
const UINT_OPTS = [ 'baud', 'interval_system', 'interval_network', 'max_line' ];

const ALL_SET_OPTS = [
	'enable', 'demo_mode', 'push_alerts',
	'path', 'pages', 'wire_format', 'wan_if', 'lan_if', 'wifi_if',
	'baud', 'interval_system', 'interval_network', 'max_line'
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

function list_serial_ports() {
	let ports = [];
	let patterns = [ '/dev/ttyUSB', '/dev/ttyACM', '/dev/ttyS' ];

	for (let p = 0; p < length(patterns); p++) {
		let prefix = patterns[p];
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
	}

	return ports;
}

function get_config() {
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
	cfg.serial_ports = list_serial_ports();
	return cfg;
}

function validate_set(config) {
	if (type(config) != 'object')
		return 'invalid config';
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
		}
	}
	return null;
}

function get_status() {
	let cfg = get_config();
	let running = run_cmd('pidof mcudd').code == 0;
	let port_exists = false;

	if (length(cfg.path)) {
		let t = run_cmd(`test -c ${shell_quote(cfg.path)} && echo yes`);
		port_exists = t.output == 'yes';
	}

	return {
		running,
		port_exists,
		config_complete: length(cfg.path) > 0 && length(cfg.baud) > 0 &&
			length(cfg.wire_format) > 0 && length(cfg.pages) > 0
	};
}

return {
	getConfig: function() {
		return get_config();
	},

	setConfig: function(req) {
		let config = req?.config ?? req?.[0] ?? req;
		let restart = req?.restart ?? req?.[1] ?? '0';
		let err = validate_set(config);
		if (err)
			return { ok: false, error: err };

		for (let k in config)
			uci_set(k, config[k]);
		uci_commit();

		if (restart == '1')
			run_cmd('/etc/init.d/mcudd restart');

		return { ok: true };
	},

	getStatus: function() {
		return get_status();
	},

	listSerialPorts: function() {
		return { ports: list_serial_ports() };
	},

	serviceControl: function(req) {
		let action = req?.action ?? req?.[0] ?? '';
		if (!match(action, /^(start|stop|restart|enable|disable)$/))
			return { ok: false, error: 'invalid action' };
		let r = run_cmd(`/etc/init.d/mcudd ${action}`);
		return { ok: r.code == 0, output: r.output };
	},

	getLogs: function(req) {
		let limit = +(req?.limit ?? req?.[0] ?? 50);
		if (limit < 1 || limit > 500)
			limit = 50;
		let r = run_cmd(`logread -e mcudd | tail -n ${limit}`);
		return { lines: split(r.output, '\n') };
	}
};
