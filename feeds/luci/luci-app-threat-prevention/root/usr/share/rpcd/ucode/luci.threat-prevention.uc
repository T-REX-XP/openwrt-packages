#!/usr/bin/env ucode

'use strict';

import { readfile, popen } from 'fs';

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

function read_json_file(path) {
	if (!file_test('-f', path))
		return {};
	let raw = readfile(path);
	if (!raw)
		return {};
	try {
		return json(raw);
	} catch (e) {
		return {};
	}
}

function sqlite3_bin() {
	if (file_test('-x', '/usr/bin/sqlite3'))
		return '/usr/bin/sqlite3';
	if (file_test('-x', '/usr/sbin/sqlite3'))
		return '/usr/sbin/sqlite3';
	return 'sqlite3';
}

const const_defaults = {
	enabled: '0',
	mode: 'ids',
	interface: 'br-lan',
	home_net: '[192.168.8.0/24]',
	eve_path: '/var/log/suricata/eve.json',
	rule_dir: '/etc/suricata/rules',
	rule_profile: 'small',
	fail_open: '1',
	etopen_url: 'https://rules.emergingthreats.net/open/suricata-8.0/emerging.rules.tar.gz'
};

const FLAG_OPTS = [ 'enabled', 'fail_open' ];
const STRING_OPTS = {
	mode: /^(ids|ips)$/,
	interface: /^[A-Za-z0-9_.-]+$/,
	home_net: /^\[.*\]$/,
	eve_path: /^\/[ -~]+$/,
	rule_dir: /^\/[ -~]+$/,
	rule_profile: /^(small|full)$/,
	etopen_url: /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/
};

function uci_get(opt, fallback) {
	let r = run_cmd(`uci -q get suricata.main.${opt}`);
	if (r.code != 0 || r.output == '')
		return fallback;
	return r.output;
}

function get_config() {
	let cfg = {};
	for (let k in const_defaults)
		cfg[k] = uci_get(k, const_defaults[k]);
	let classes = [];
	let idx = run_cmd("uci -q show suricata | sed -n 's/^suricata\\.@classtype\\[\\([0-9]*\\)\\]=classtype/\\1/p'");
	if (idx.output) {
		for (let line in split(idx.output, '\n')) {
			if (line == '')
				continue;
			let name = run_cmd(`uci -q get suricata.@classtype[${line}].name`).output;
			let action = run_cmd(`uci -q get suricata.@classtype[${line}].action`).output;
			push(classes, { name, action: action || 'alert' });
		}
	}
	cfg.classtypes = classes;
	return cfg;
}

const methods = {
	getStatus: {
		call: function() {
			let st = read_json_file('/tmp/tp_status.json');
			let et = read_json_file('/tmp/tp_etopen.json');
			for (let k in et)
				st[k] = et[k];
			let running = run_cmd('pidof suricata >/dev/null && echo 1 || echo 0').output == '1';
			st.suricata_running = running;
			st.suricata_present = file_test('-x', '/usr/bin/suricata');
			st.etopen_present = file_test('-x', '/usr/sbin/suricata-etopen-fetch');
			st.mode = uci_get('mode', 'ids');
			st.interface = uci_get('interface', 'br-lan');
			st.enabled = uci_get('enabled', '0');
			st.rule_profile = uci_get('rule_profile', 'small');
			return st;
		}
	},

	getEvents: {
		args: { limit: 50 },
		call: function(req) {
			let limit = int(req.args?.limit) || 50;
			if (limit < 1)
				limit = 1;
			if (limit > 200)
				limit = 200;
			let db = '/var/lib/threat-prevention/events.sqlite';
			if (!file_test('-f', db))
				return { events: [] };
			let bin = sqlite3_bin();
			let sql = `SELECT id, ts, sid, msg, classtype, src, dst, sport, dport, proto, severity FROM events ORDER BY id DESC LIMIT ${limit};`;
			let r = run_cmd(`${bin} -separator '|' ${shell_quote(db)} ${shell_quote(sql)}`);
			let events = [];
			if (r.code == 0 && r.output) {
				for (let line in split(r.output, '\n')) {
					if (line == '')
						continue;
					let p = split(line, '|');
					push(events, {
						id: p[0],
						ts: p[1],
						sid: p[2],
						msg: p[3],
						classtype: p[4],
						src: p[5],
						dst: p[6],
						sport: p[7],
						dport: p[8],
						proto: p[9],
						severity: p[10]
					});
				}
			}
			return { events };
		}
	},

	getConfig: {
		call: function() {
			return get_config();
		}
	},

	setConfig: {
		args: { config: {} },
		call: function(req) {
			let cfg = req.args?.config;
			if (type(cfg) != 'object')
				return { error: 'invalid config' };
			run_cmd('uci -q get suricata.main >/dev/null || uci set suricata.main=suricata');
			for (let k in const_defaults) {
				if (!(k in cfg))
					continue;
				let v = `${cfg[k]}`;
				if (index(FLAG_OPTS, k) >= 0) {
					if (v != '0' && v != '1')
						continue;
				} else if (k in STRING_OPTS) {
					if (!match(v, STRING_OPTS[k]))
						continue;
				}
				run_cmd(`uci set suricata.main.${k}=${shell_quote(v)}`);
			}
			run_cmd('uci commit suricata');
			return { ok: true, config: get_config() };
		}
	},

	serviceControl: {
		args: { action: '' },
		call: function(req) {
			let action = req.args?.action || '';
			if (action != 'start' && action != 'stop' && action != 'reload' && action != 'restart')
				return { error: 'invalid action' };
			let r = run_cmd(`/etc/init.d/suricata ${action}`);
			run_cmd(`/etc/init.d/tp-eventd ${action == 'stop' ? 'stop' : 'restart'}`);
			return { ok: r.code == 0, output: r.output };
		}
	},

	fetchRules: {
		call: function() {
			if (!file_test('-x', '/usr/sbin/suricata-etopen-fetch'))
				return { error: 'suricata-etopen not installed' };
			let r = run_cmd('/usr/sbin/suricata-etopen-fetch');
			return { ok: r.code == 0, output: r.output };
		}
	}
};

return { 'luci.threat-prevention': { methods } };
