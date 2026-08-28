#!/usr/bin/env ucode

'use strict';

import { access, lsdir, readfile, popen, writefile, unlink } from 'fs';

const SYNC = '/usr/sbin/blocky-lists-sync';
const REFRESH = '/usr/sbin/blocky-lists-refresh';
const HTTP = '/usr/sbin/blocky-http-api';
const BLOCKY_BIN = '/usr/bin/blocky';
const CONFIG = '/etc/blocky/config.yml';
const DNSMASQ_SYNC = '/usr/sbin/blocky-dnsmasq-sync';
const QUERY_LOG_ALLOW = '/tmp/blocky-logs';
const VALIDATE_TMP = '/tmp/blocky-luci-validate.yml';
const MAX_LOG_BYTES = 524288;
const MAX_SYSLOG_BYTES = 204800;
const MAX_HTTP_UBUS_OUT = 16384;
const BLOCKY_LOG_PATTERN = 'blocky';

function run_cmd(cmd) {
	let p = popen(`${cmd} 2>&1`, 'r');
	if (!p)
		return { code: 1, output: 'popen failed' };

	let output = p.read('all') || '';
	let code = p.close();

	return { code, output };
}

function file_test(flag, path) {
	let p = popen(`test ${flag} ${shellquote(path)} && echo yes`, 'r');
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

function read_config() {
	try {
		return readfile(CONFIG) || '';
	} catch (e) {
		return '';
	}
}

function parse_log_level(yaml) {
	let lines = split(yaml, '\n');
	let in_log = false;

	for (let i = 0; i < length(lines); i++) {
		let line = lines[i];
		if (match(line, /^log:\s*$/)) {
			in_log = true;
			continue;
		}
		if (!in_log)
			continue;
		if (match(line, /^[^#\s]/) && !match(line, /^  /))
			break;
		if (match(line, /^  level:\s*(.+)$/)) {
			let val = trim(replace(line, /^  level:\s*/, ''));
			return replace(replace(val, /['"]/g, ''), /#.*$/, '');
		}
	}
	return 'warn';
}

function parse_port_value(raw, default_port) {
	raw = trim(replace(replace(raw, /['"]/g, ''), /#.*$/, ''));
	if (match(raw, /^:\d+$/))
		return int(replace(raw, ':', '')) || default_port;
	if (match(raw, /^[0-9]+$/))
		return int(raw) || default_port;
	let m = match(raw, /^(\[[^\]]+\]|[^:\s]+):(\d+)$/);
	if (m)
		return int(m[2]) || default_port;
	return default_port;
}

function parse_port_from_config(yaml, key, default_port) {
	let lines = split(yaml, '\n');
	let in_ports = false;
	let prefix = `  ${key}:`;

	for (let i = 0; i < length(lines); i++) {
		let line = lines[i];
		if (match(line, /^ports:\s*$/)) {
			in_ports = true;
			continue;
		}
		if (!in_ports)
			continue;
		if (match(line, /^[^#\s]/) && !match(line, /^  /))
			break;
		if (index(line, prefix) != 0)
			continue;
		return parse_port_value(replace(line, prefix, ''), default_port);
	}
	return default_port;
}

function service_running() {
	let res = run_bin('/etc/init.d/blocky', [ 'status' ]);
	return res.ok || index(lower(res.output), 'running') >= 0;
}

function parse_blocking_status(text) {
	text = trim(text || '');
	if (!length(text))
		return { enabled: false, autoEnableInSec: 0 };

	let enabled = match(text, /"enabled"\s*:\s*true/) != null;
	let auto = 0;
	let m = match(text, /"autoEnableInSec"\s*:\s*([0-9]+)/);
	if (m)
		auto = int(m[1]) || 0;

	return { enabled: enabled, autoEnableInSec: auto };
}

function stats_state(text) {
	text = trim(text || '');
	if (!length(text))
		return { ok: false, disabled: false };

	if (match(text, /statistics are disabled/i))
		return { ok: false, disabled: true };

	if (match(text, /"summary"/) || match(text, /"lists"/))
		return { ok: true, disabled: false, json: text };

	return { ok: false, disabled: false };
}

function shellquote(s) {
	return `'${replace(s, "'", "'\\''")}'`;
}

function run_bin(path, args) {
	if (!access(path))
		return { ok: false, code: 127, output: `${path} is missing` };

	let cmd = shellquote(path);
	for (let i = 0; i < length(args); i++)
		cmd += ` ${shellquote(args[i])}`;

	let p = popen(`${cmd} 2>&1`, 'r');
	if (!p)
		return { ok: false, code: 1, output: 'popen failed' };

	let output = p.read('all') || '';
	let code = p.close();

	return { ok: code == 0, code, output };
}

function validate_http(method, path, body) {
	method = upper(method || 'GET');
	if (method != 'GET' && method != 'POST')
		return null;

	path = trim(path || 'metrics');
	if (!match(path, /^[A-Za-z0-9_\/.\-]+$/) || index(path, '..') >= 0)
		return null;

	if (body != null)
		body = String(body);

	return [ method, path, body ];
}

function allowed_log_dir(target) {
	target = replace(trim(target || QUERY_LOG_ALLOW), /\/+$/, '');

	if (target != QUERY_LOG_ALLOW)
		return null;

	return target;
}

function find_latest_log_file(dir) {
	let best = null;

	try {
		let entries = lsdir(dir);

		for (let i = 0; i < length(entries); i++) {
			let name = entries[i];

			if (!length(name) || name == '.' || name == '..')
				continue;

			if (!match(name, /^[0-9]{4}-[0-9]{2}-[0-9]{2}_.*\.log$/))
				continue;

			if (!best || name > best)
				best = name;
		}
	} catch (e) {}

	return best ? `${dir}/${best}` : null;
}

const methods = {
	sync_lists: {
		call: function() {
			return run_bin(SYNC, []);
		}
	},

	refresh_lists: {
		call: function() {
			return run_bin(REFRESH, []);
		}
	},

	http_request: {
		args: { method: 'method', path: 'path', body: 'body' },
		call: function(req) {
			let args = validate_http(req.args?.method, req.args?.path, req.args?.body);
			if (!args)
				return { ok: false, code: 22, stdout: '', stderr: 'invalid http_request arguments' };

			let run_args = [ args[0], args[1] ];
			if (args[2] != null && length(args[2]))
				run_args.push(args[2]);

			let res = run_bin(HTTP, run_args);
			let stdout = res.ok ? res.output : '';

			if (length(stdout) > MAX_HTTP_UBUS_OUT)
				stdout = substr(stdout, 0, MAX_HTTP_UBUS_OUT);

			return {
				ok: res.ok,
				code: res.code,
				stdout: stdout,
				stderr: res.ok ? '' : res.output
			};
		}
	},

	read_query_log: {
		args: { target: 'target', max_bytes: 'max_bytes' },
		call: function(req) {
			let dir = allowed_log_dir(req.args?.target);
			if (!dir)
				return { ok: false, error: 'invalid log directory (allowed: /tmp/blocky-logs)' };

			if (access(dir))
				return { ok: false, error: `log directory not found: ${dir}` };

			let max_bytes = int(req.args?.max_bytes) || MAX_LOG_BYTES;
			if (max_bytes < 1 || max_bytes > MAX_LOG_BYTES)
				max_bytes = MAX_LOG_BYTES;

			let path = find_latest_log_file(dir);
			if (!path)
				return { ok: false, error: `no query log files found in ${dir}` };

			let content = '';
			let truncated = false;

			try {
				content = readfile(path) || '';
			} catch (e) {
				return { ok: false, error: `failed to read ${path}` };
			}

			if (length(content) > max_bytes) {
				content = substr(content, length(content) - max_bytes);
				truncated = true;
			}

			return {
				ok: true,
				path: path,
				content: content,
				truncated: truncated,
				max_bytes: max_bytes
			};
		}
	},

	get_version: {
		call: function() {
			let res = run_bin(BLOCKY_BIN, [ 'version' ]);
			let version = trim(split(res.output, '\n')[0] || '');

			return {
				ok: res.ok && length(version) > 0,
				version: version,
				output: res.output
			};
		}
	},

	getStatus: {
		call: function() {
			let yaml = read_config();
			let config_present = length(yaml) > 0;
			let dns_res = run_bin(DNSMASQ_SYNC, [ 'status' ]);
			let dnsmasq_forward = trim(dns_res.output) == '1';
			let blocking_raw = run_bin(HTTP, [ 'GET', 'api/blocking/status' ]);
			let blocking = parse_blocking_status(blocking_raw.ok ? blocking_raw.output : '');
			let stats_raw = run_bin(HTTP, [ 'GET', 'api/stats' ]);
			let stats = stats_state(stats_raw.ok ? stats_raw.output : stats_raw.output);
			let version_res = run_bin(BLOCKY_BIN, [ 'version' ]);
			let version = trim(split(version_res.output, '\n')[0] || '');
			let log_level = parse_log_level(yaml);

			return {
				ok: true,
				service_running: service_running(),
				dnsmasq_forward: dnsmasq_forward,
				blocking: blocking,
				api_ok: blocking_raw.ok && length(blocking_raw.output) > 0,
				stats_ok: stats.ok,
				stats_disabled: stats.disabled,
				stats_json: stats.json || '',
				version: version,
				ports: {
					dns: parse_port_from_config(yaml, 'dns', 5353),
					http: parse_port_from_config(yaml, 'http', 4000)
				},
				config_present: config_present,
				log_level: log_level
			};
		}
	},

	validate_config: {
		args: { yaml: 'yaml' },
		call: function(req) {
			let path = CONFIG;
			let yaml = req.args?.yaml;

			if (yaml != null && length(String(yaml))) {
				try {
					writefile(VALIDATE_TMP, String(yaml));
				} catch (e) {
					return { ok: false, output: 'failed to write temporary config for validation' };
				}
				path = VALIDATE_TMP;
			}
			else if (!access(CONFIG)) {
				return { ok: false, output: `config not found: ${CONFIG}` };
			}

			let res = run_bin(BLOCKY_BIN, [ 'validate', '--config', path ]);

			if (path == VALIDATE_TMP) {
				try {
					unlink(VALIDATE_TMP);
				} catch (e) {}
			}

			return {
				ok: res.ok,
				output: res.output
			};
		}
	},

	getLogs: {
		args: { limit: 'limit', max_bytes: 'max_bytes' },
		call: function(req) {
			let logread = find_logread();
			if (!length(logread))
				return { ok: false, error: 'missing_logread', message: 'logread not found' };

			let limit = int(req.args?.limit);
			if (!limit || limit < 1)
				limit = 200;
			if (limit > 2000)
				limit = 2000;

			let max_bytes = int(req.args?.max_bytes) || MAX_SYSLOG_BYTES;
			if (max_bytes < 1 || max_bytes > MAX_SYSLOG_BYTES)
				max_bytes = MAX_SYSLOG_BYTES;

			let res = run_cmd(`${logread} -l ${limit} -e ${shellquote(BLOCKY_LOG_PATTERN)}`);
			let output = res.output || '';
			let truncated = false;

			if (length(output) > max_bytes) {
				output = substr(output, length(output) - max_bytes);
				truncated = true;
			}

			return {
				ok: true,
				limit: limit,
				max_bytes: max_bytes,
				truncated: truncated,
				output: output
			};
		}
	}
};

return { 'luci.blocky': methods };
