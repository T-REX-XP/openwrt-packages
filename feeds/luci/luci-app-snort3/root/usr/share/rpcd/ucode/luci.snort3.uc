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

function uci_get(sect, opt, fallback) {
	let r = run_cmd(`uci -q get snort.${sect}.${opt}`);
	if (r.code != 0 || r.output == '')
		return fallback;
	return r.output;
}

const FLAG_OPTS = [ 'enabled', 'manual', 'logging', 'openappid' ];
const STRING_OPTS = {
	interface: /^[A-Za-z0-9_.-]+$/,
	home_net: /^[A-Za-z0-9.\/!$,_-]+$/,
	external_net: /^[A-Za-z0-9.\/!$,_-]+$/,
	mode: /^(ids|ips)$/,
	method: /^(pcap|afpacket|nfq)$/,
	action: /^(default|alert|block|drop|reject)$/,
	log_dir: /^\/[ -~]+$/,
	config_dir: /^\/[ -~]+$/,
	temp_dir: /^\/[ -~]+$/,
	oinkcode: /^[A-Za-z0-9]*$/,
	snaplen: /^\d+$/
};

function get_config() {
	return {
		enabled: uci_get('snort', 'enabled', '0'),
		manual: uci_get('snort', 'manual', '0'),
		interface: uci_get('snort', 'interface', 'br-lan'),
		home_net: uci_get('snort', 'home_net', '192.168.8.0/24'),
		external_net: uci_get('snort', 'external_net', 'any'),
		mode: uci_get('snort', 'mode', 'ids'),
		method: uci_get('snort', 'method', 'afpacket'),
		action: uci_get('snort', 'action', 'alert'),
		snaplen: uci_get('snort', 'snaplen', '1518'),
		logging: uci_get('snort', 'logging', '1'),
		log_dir: uci_get('snort', 'log_dir', '/var/log'),
		config_dir: uci_get('snort', 'config_dir', '/etc/snort'),
		temp_dir: uci_get('snort', 'temp_dir', '/var/snort.d'),
		oinkcode: uci_get('snort', 'oinkcode', '')
	};
}

function rules_info() {
	let config_rules = '/etc/snort/rules';
	let temp_rules = '/var/snort.d/rules';
	let symlink = file_test('-L', config_rules);
	let target = '';
	if (symlink)
		target = run_cmd(`readlink ${shell_quote(config_rules)}`).output;
	let count = run_cmd("find /etc/snort/rules -name '*.rules' 2>/dev/null | wc -l").output;
	return {
		symlink,
		target,
		temp_exists: file_test('-d', temp_rules),
		config_exists: file_test('-d', config_rules) || symlink,
		rule_files: int(count) || 0
	};
}

const methods = {
	getStatus: {
		call: function() {
			let running = run_cmd('pidof snort >/dev/null && echo 1 || echo 0').output == '1';
			let pid = running ? run_cmd('pidof snort').output : '';
			let log_dir = uci_get('snort', 'log_dir', '/var/log');
			let alert = `${log_dir}/alert_fast.txt`;
			let alert_count = 0;
			if (file_test('-f', alert))
				alert_count = int(run_cmd(`wc -l < ${shell_quote(alert)}`).output) || 0;
			let enabled_boot = run_cmd('/etc/init.d/snort enabled && echo 1 || echo 0').output == '1';
			return {
				running,
				pid,
				alert_count,
				enabled_boot,
				present: file_test('-x', '/usr/bin/snort'),
				interface: uci_get('snort', 'interface', 'br-lan'),
				mode: uci_get('snort', 'mode', 'ids'),
				method: uci_get('snort', 'method', 'afpacket'),
				enabled: uci_get('snort', 'enabled', '0'),
				rules: rules_info()
			};
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
			run_cmd('uci -q get snort.snort >/dev/null || uci set snort.snort=snort');
			for (let k in cfg) {
				let v = `${cfg[k]}`;
				if (index(FLAG_OPTS, k) >= 0) {
					if (v != '0' && v != '1')
						continue;
				} else if (k in STRING_OPTS) {
					if (!match(v, STRING_OPTS[k]))
						continue;
				} else {
					continue;
				}
				run_cmd(`uci set snort.snort.${k}=${shell_quote(v)}`);
			}
			run_cmd('uci commit snort');
			return { ok: true, config: get_config() };
		}
	},

	serviceControl: {
		args: { action: '' },
		call: function(req) {
			let action = req.args?.action || '';
			if (action != 'start' && action != 'stop' && action != 'restart' &&
			    action != 'enable' && action != 'disable')
				return { error: 'invalid action' };
			let r = run_cmd(`/etc/init.d/snort ${action}`);
			return { ok: r.code == 0, output: r.output };
		}
	},

	getAlerts: {
		args: { limit: 50 },
		call: function(req) {
			let limit = int(req.args?.limit) || 50;
			if (limit < 1)
				limit = 1;
			if (limit > 200)
				limit = 200;
			let log_dir = uci_get('snort', 'log_dir', '/var/log');
			let alert = `${log_dir}/alert_fast.txt`;
			let alerts = '';
			if (file_test('-f', alert))
				alerts = run_cmd(`tail -n ${limit} ${shell_quote(alert)}`).output;
			let logs = run_cmd(`logread -e snort | tail -n ${limit}`).output;
			return { alerts, logs };
		}
	},

	updateRules: {
		call: function() {
			if (!file_test('-x', '/usr/bin/snort-rules'))
				return { error: 'snort-rules not installed' };
			if (file_test('-f', '/tmp/snort_rules_update.lock'))
				return { ok: true, running: true, message: 'update already in progress' };
			run_cmd('touch /tmp/snort_rules_update.lock');
			run_cmd("( /usr/bin/snort-rules > /tmp/snort_rules_update.log 2>&1; rm -f /var/snort.d/*.tar.gz /tmp/snort*.tar.gz /var/snort.d/rules/*.tar.gz; rm -f /tmp/snort_rules_update.lock; echo FINISHED >> /tmp/snort_rules_update.log ) >/dev/null 2>&1 &");
			return { ok: true, running: true };
		}
	},

	updateStatus: {
		call: function() {
			let running = file_test('-f', '/tmp/snort_rules_update.lock');
			let log = '';
			let finished = false;
			if (file_test('-f', '/tmp/snort_rules_update.log')) {
				log = run_cmd('tail -n 20 /tmp/snort_rules_update.log').output;
				finished = index(log, 'FINISHED') >= 0;
			}
			return { running: running && !finished, finished, log };
		}
	},

	fixRules: {
		call: function() {
			let config_rules = '/etc/snort/rules';
			let temp_rules = '/var/snort.d/rules';
			if (!file_test('-d', temp_rules))
				return { ok: false, error: 'missing /var/snort.d/rules' };
			if (file_test('-d', config_rules) && !file_test('-L', config_rules))
				run_cmd(`mv ${shell_quote(config_rules)} ${shell_quote(config_rules)}.backup`);
			else if (file_test('-L', config_rules))
				run_cmd(`rm -f ${shell_quote(config_rules)}`);
			let r = run_cmd(`ln -sf ${shell_quote(temp_rules)} ${shell_quote(config_rules)}`);
			return { ok: r.code == 0, output: r.output, rules: rules_info() };
		}
	}
};

return { 'luci.snort3': methods };
