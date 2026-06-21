#!/usr/bin/env ucode

'use strict';

import { access, lsdir, readfile, popen } from 'fs';

const SYNC = '/usr/sbin/blocky-lists-sync';
const REFRESH = '/usr/sbin/blocky-lists-refresh';
const HTTP = '/usr/sbin/blocky-http-api';
const BLOCKY_BIN = '/usr/bin/blocky';
const QUERY_LOG_ALLOW = '/tmp/blocky-logs';
const MAX_LOG_BYTES = 524288;

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
	if (!match(path, /^[A-Za-z0-9_\/.\-]+$/))
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
			return {
				ok: res.ok,
				code: res.code,
				stdout: res.ok ? res.output : '',
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
	}
};

return { 'luci.blocky': methods };
