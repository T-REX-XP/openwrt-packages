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

function unwrap_net(val) {
	val = trim(`${val}`);
	while (length(val) >= 2 && substr(val, 0, 1) == '[' &&
	       substr(val, length(val) - 1, 1) == ']')
		val = trim(substr(val, 1, length(val) - 2));
	return replace(val, /[ \t]+/g, '');
}

function first_pid(raw) {
	let parts = split(trim(`${raw}`), /[ \n\t]+/);
	let pid = parts[0] || '';
	if (!match(pid, /^[0-9]+$/))
		return '';
	return pid;
}

function parse_rss_kb(pid) {
	if (pid == '')
		return 0;
	let txt = readfile(`/proc/${pid}/status`) || '';
	let m = match(txt, /VmRSS:\s+([0-9]+)/);
	return m ? int(m[1]) : 0;
}

function parse_meminfo() {
	let txt = readfile('/proc/meminfo') || '';
	let tot = match(txt, /MemTotal:\s+([0-9]+)/);
	let avail = match(txt, /MemAvailable:\s+([0-9]+)/);
	let free = match(txt, /MemFree:\s+([0-9]+)/);
	let total_kb = tot ? int(tot[1]) : 0;
	let free_kb = avail ? int(avail[1]) : (free ? int(free[1]) : 0);
	let used_kb = total_kb > free_kb ? total_kb - free_kb : 0;
	let percent = total_kb > 0 ? int(used_kb * 100 / total_kb) : 0;
	return {
		mem_total_kb: total_kb,
		mem_free_kb: free_kb,
		mem_used_kb: used_kb,
		mem_percent: percent
	};
}

const FLAG_OPTS = [ 'enabled', 'manual', 'logging', 'openappid' ];
const STRING_OPTS = {
	interface: /^[A-Za-z0-9_.-]+$/,
	home_net: /^[A-Za-z0-9.\/!$,_-]+$/,
	external_net: /^[A-Za-z0-9.\/!$,_-]+$/,
	mode: /^(ids|ips)$/,
	method: /^(afpacket|nfq)$/,
	action: /^(default|alert|block|drop|reject)$/,
	log_dir: /^\/[ -~]+$/,
	config_dir: /^\/[ -~]+$/,
	temp_dir: /^\/[ -~]+$/,
	oinkcode: /^[A-Za-z0-9]*$/,
	snaplen: /^\d+$/
};

function normalize_flag(v) {
	v = `${v}`;
	if (v == 'true' || v == '1' || v == 'on' || v == 'yes')
		return '1';
	if (v == 'false' || v == '0' || v == 'off' || v == 'no' || v == '')
		return '0';
	return v;
}

function normalize_value(k, v) {
	if (index(FLAG_OPTS, k) >= 0)
		return normalize_flag(v);
	if (k == 'home_net' || k == 'external_net')
		return unwrap_net(v);
	v = trim(`${v}`);
	if (k == 'method' && v == 'pcap')
		return 'afpacket';
	if (k == 'log_dir' && (v == '/var/log' || v == '/var/log/'))
		return '/var/log/snort';
	return v;
}

function validate_field(k, v) {
	v = normalize_value(k, v);
	if (index(FLAG_OPTS, k) >= 0) {
		if (v != '0' && v != '1')
			return `invalid ${k}`;
		return null;
	}
	if (!(k in STRING_OPTS))
		return `invalid ${k}`;
	if (!match(v, STRING_OPTS[k]))
		return `invalid ${k}`;
	if (k == 'snaplen') {
		let n = int(v);
		if (n < 0 || n > 65535)
			return `invalid ${k}`;
	}
	return null;
}

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
		openappid: uci_get('snort', 'openappid', '0'),
		log_dir: uci_get('snort', 'log_dir', '/var/log/snort'),
		config_dir: uci_get('snort', 'config_dir', '/etc/snort'),
		temp_dir: uci_get('snort', 'temp_dir', '/var/snort.d'),
		oinkcode: uci_get('snort', 'oinkcode', ''),
		feeds: list_rulesets()
	};
}

function feed_id_ok(id) {
	if (!match(`${id}`, /^[A-Za-z_][A-Za-z0-9_]*$/))
		return false;
	if (id == 'snort' || id == 'nfq')
		return false;
	return true;
}

const COMMUNITY_RULES_URL = 'https://www.snort.org/downloads/community/snort3-community-rules.tar.gz';
const FEED_URL_RE = /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%{}$-]+$/;

function list_rulesets() {
	let feeds = [];
	let r = run_cmd("uci -q show snort | sed -n 's/^snort\\.\\([^=]*\\)=ruleset$/\\1/p'");
	if (r.output) {
		for (let line in split(r.output, '\n')) {
			if (line == '' || line == 'snort' || line == 'nfq')
				continue;
			let name = run_cmd(`uci -q get snort.${line}.name`).output || line;
			let url = run_cmd(`uci -q get snort.${line}.url`).output;
			let enabled = run_cmd(`uci -q get snort.${line}.enabled`).output;
			let description = run_cmd(`uci -q get snort.${line}.description`).output;
			if (url == '')
				continue;
			push(feeds, {
				id: line,
				name,
				url,
				enabled: enabled == '' ? '1' : enabled,
				description: description || ''
			});
		}
	}
	if (!length(feeds)) {
		push(feeds, {
			id: 'community',
			name: 'Snort 3 community',
			url: COMMUNITY_RULES_URL,
			enabled: '1',
			description: 'Free Snort 3 community ruleset'
		});
	}
	return feeds;
}

function replace_rulesets(feeds) {
	if (type(feeds) != 'array')
		return 'invalid feeds';
	let seen = {};
	let i = 0;
	for (let feed in feeds) {
		if (type(feed) != 'object')
			return 'invalid feed';
		let name = trim(`${feed.name || ''}`);
		let url = trim(`${feed.url || ''}`);
		if (name == '' || !match(url, FEED_URL_RE))
			return 'invalid feed';
		let id = trim(`${feed.id || ''}`);
		if (!feed_id_ok(id) || id == 'snort' || id == 'nfq')
			id = 'ruleset' + i;
		if (seen[id])
			return 'duplicate feed id';
		seen[id] = 1;
		i++;
	}
	let cur = run_cmd("uci -q show snort | sed -n 's/^snort\\.\\([^=]*\\)=ruleset$/\\1/p'");
	if (cur.output) {
		for (let line in split(cur.output, '\n')) {
			if (line != '' && line != 'snort' && line != 'nfq')
				run_cmd(`uci -q delete snort.${line}`);
		}
	}
	i = 0;
	for (let feed in feeds) {
		let id = trim(`${feed.id || ''}`);
		if (!feed_id_ok(id) || id == 'snort' || id == 'nfq')
			id = 'ruleset' + i;
		let enabled = `${feed.enabled}`;
		if (enabled == 'true' || enabled == '1' || enabled == 'on' || enabled == 'yes')
			enabled = '1';
		else
			enabled = '0';
		run_cmd(`uci set snort.${id}=ruleset`);
		run_cmd(`uci set snort.${id}.name=${shell_quote(trim(`${feed.name}`))}`);
		run_cmd(`uci set snort.${id}.url=${shell_quote(trim(`${feed.url}`))}`);
		run_cmd(`uci set snort.${id}.enabled=${enabled}`);
		run_cmd(`uci set snort.${id}.description=${shell_quote(trim(`${feed.description || ''}`))}`);
		i++;
	}
	return null;
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
			let pid = running ? first_pid(run_cmd('pidof snort').output) : '';
			let log_dir = uci_get('snort', 'log_dir', '/var/log');
			let alert = `${log_dir}/alert_fast.txt`;
			let alert_count = 0;
			if (file_test('-f', alert))
				alert_count = int(run_cmd(`wc -l < ${shell_quote(alert)}`).output) || 0;
			let enabled_boot = run_cmd('/etc/init.d/snort enabled && echo 1 || echo 0').output == '1';
			let mem = parse_meminfo();
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
				mem_rss_kb: parse_rss_kb(pid),
				mem_total_kb: mem.mem_total_kb,
				mem_used_kb: mem.mem_used_kb,
				mem_free_kb: mem.mem_free_kb,
				mem_percent: mem.mem_percent,
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
			let keys = [];
			for (let k in cfg)
				push(keys, k);
			if (length(keys) == 0)
				return { error: 'invalid config' };
			run_cmd('uci -q get snort.snort >/dev/null || uci set snort.snort=snort');
			if ('feeds' in cfg) {
				let ferr = replace_rulesets(cfg.feeds);
				if (ferr)
					return { error: ferr };
			}
			for (let k in cfg) {
				if (k == 'feeds')
					continue;
				let err = validate_field(k, cfg[k]);
				if (err)
					return { error: err };
				let v = normalize_value(k, cfg[k]);
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
			if ((action == 'start' || action == 'restart') &&
			    uci_get('snort', 'enabled', '0') != '1')
				return {
					ok: false,
					output: 'snort.snort.enabled is 0; enable the service in Settings first'
				};
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
			let logs = run_cmd(`logread -e snort | tail -n 20`).output;
			return { alerts, logs };
		}
	},

	updateRules: {
		call: function() {
			if (!file_test('-x', '/usr/bin/snort-rules'))
				return { error: 'snort-rules not installed' };
			if (file_test('-f', '/tmp/snort_rules_update.lock'))
				return { ok: false, running: true, error: 'update already in progress' };
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
	},

	cleanupTemp: {
		call: function() {
			if (file_test('-f', '/tmp/snort_rules_update.lock'))
				return { ok: false, error: 'update already in progress' };
			run_cmd('rm -f /var/snort.d/*.tar.gz /tmp/snort*.tar.gz /var/snort.d/rules/*.tar.gz');
			run_cmd('rm -f /tmp/snort_rules_update.lock');
			return { ok: true };
		}
	}
};

return { 'luci.snort3': methods };
