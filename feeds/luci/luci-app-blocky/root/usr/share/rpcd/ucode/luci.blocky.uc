#!/usr/bin/env ucode

'use strict';

import { access, popen } from 'fs';

const SYNC = '/usr/sbin/blocky-lists-sync';
const REFRESH = '/usr/sbin/blocky-lists-refresh';
const HTTP = '/usr/sbin/blocky-http-api';

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
	}
};

return { 'luci.blocky': methods };
