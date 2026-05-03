#!/usr/bin/env ucode

'use strict';

import { readfile, writefile, popen, lsdir, basename, access, unlink } from 'fs';

const BTN_DIR = '/etc/rc.button';
const MAX_SCRIPT = 131072;
const PROTECTED = {
	failsafe: true,
	power: true,
	reboot: true,
	reset: true,
	rfkill: true,
	wps: true
};

function safe_name(name) {
	return type(name) == 'string' && length(name) > 0 && length(name) <= 64 &&
		name != '.' && name != '..' && match(name, /^[A-Za-z0-9._-]+$/);
}

function run(cmd) {
	let p = popen(`${cmd} 2>&1`, 'r');
	let out = trim(p ? (p.read('all') || '') : '');
	let code = p ? p.close() : 1;
	return { code, out };
}

function ensure_dir() {
	if (access(BTN_DIR))
		return true;
	let r = run('/bin/mkdir -p /etc/rc.button');
	return r.code == 0;
}

function chmod_script(name) {
	run(`/bin/chmod 0755 '${BTN_DIR}/${name}'`);
}

function template_for(name, preset) {
	let header = `#!/bin/sh\n\n# Managed by LuCI Buttons. Hotplug provides ACTION, BUTTON and SEEN.\n\n`;
	if (preset == 'logger') {
		return `${header}logger -t button \"button=$BUTTON action=$ACTION seen=$SEEN\"\n\nreturn 0\n`;
	}
	if (preset == 'reboot') {
		return `${header}case \"$ACTION\" in\nreleased)\n\tlogger -t button \"reboot requested by $BUTTON\"\n\treboot\n\t;;\nesac\n\nreturn 0\n`;
	}
	if (preset == 'wps' || name == 'wps') {
		return `${header}case \"$ACTION\" in\npressed)\n\tlogger -t button \"USERKEY/WPS pressed button=$BUTTON seen=$SEEN\"\n\tfor dir in /var/run/hostapd-*; do\n\t\t[ -d \"$dir\" ] || continue\n\t\tfor iface in \"$dir\"/*; do\n\t\t\t[ -S \"$iface\" ] || continue\n\t\t\thostapd_cli -p \"$dir\" -i \"\${iface##*/}\" wps_pbc 2>/dev/null &\n\t\tdone\n\tdone\n\t;;\nesac\n\nreturn 0\n`;
	}
	return `${header}case \"$ACTION\" in\npressed)\n\tlogger -t button \"pressed $BUTTON\"\n\t;;\nreleased)\n\tlogger -t button \"released $BUTTON after $SEEN seconds\"\n\t;;\nesac\n\nreturn 0\n`;
}

const methods = {
	list: {
		call: function() {
			let names = [];
			let missing = false;
			try {
				const list = lsdir(BTN_DIR);
				for (let i = 0; i < length(list); i++) {
					const n = list[i];
					if (safe_name(n))
						push(names, n);
				}
			} catch (e) {
				missing = true;
			}
			sort(names);
			return {
				names,
				missing,
				directory: BTN_DIR,
				common: [ 'wps', 'reset', 'reboot', 'power', 'rfkill', 'failsafe' ],
				protected: [ 'failsafe', 'power', 'reboot', 'reset', 'rfkill', 'wps' ]
			};
		}
	},

	get: {
		args: { name: 'name' },
		call: function(req) {
			const name = req.args?.name;
			if (!safe_name(name))
				return { error: 'invalid_name' };
			try {
				return {
					name,
					content: readfile(`${BTN_DIR}/${name}`),
					protected: !!PROTECTED[name]
				};
			} catch (e) {
				return {
					name,
					content: template_for(name, name),
					missing: true,
					protected: !!PROTECTED[name]
				};
			}
		}
	},

	set: {
		args: { name: 'name', content: 'content', preset: 'preset' },
		call: function(req) {
			const name = req.args?.name;
			let content = req.args?.content;
			const preset = req.args?.preset || '';
			if (!safe_name(name))
				return { error: 'invalid_name' };
			if (content == null || content == '')
				content = template_for(name, preset);
			if (type(content) != 'string' || length(content) > MAX_SCRIPT)
				return { error: 'invalid_content' };
			if (!ensure_dir())
				return { error: 'mkdir_failed' };
			try {
				writefile(`${BTN_DIR}/${name}`, content);
				chmod_script(name);
			} catch (e) {
				return { error: 'write_failed', message: `${e}` };
			}
			return { ok: true, name };
		}
	},

	delete: {
		args: { name: 'name' },
		call: function(req) {
			const name = req.args?.name;
			if (!safe_name(name))
				return { error: 'invalid_name' };
			if (PROTECTED[name])
				return { error: 'protected_name' };
			try {
				unlink(`${BTN_DIR}/${name}`);
			} catch (e) {
				return { error: 'delete_failed', message: `${e}` };
			}
			return { ok: true };
		}
	}
};

return { 'luci.buttons': methods };
