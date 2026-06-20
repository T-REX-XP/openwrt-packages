#!/usr/bin/env ucode

'use strict';

import { readfile, writefile, popen, lsdir, basename, access, unlink } from 'fs';

const BTN_DIR = '/etc/rc.button';
const MAX_SCRIPT = 131072;
const STATE_DIR = '/var/run';
const EVENT_LOG = '/var/log/button-events.log';
const PROTECTED = {
	failsafe: true,
	power: true,
	reboot: true,
	reset: true,
	rfkill: true,
	wps: true,
	BTN_2: true
};

const CM5_BUTTONS = [
	{ id: 'wps', label: 'USERKEY', hotplug: 'wps', driver: 'gpio-keys' },
	{ id: 'BTN_2', label: 'MaskROM', hotplug: 'BTN_2', driver: 'adc-keys' }
];

function safe_name(name) {
	return type(name) == 'string' && length(name) > 0 && length(name) <= 64 &&
		name != '.' && name != '..' && match(name, /^[A-Za-z0-9._-]+$/);
}

function run(cmd) {
	let p = popen(`${cmd} 2>/dev/null`, 'r');
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

function read_state(name) {
	try {
		let state = trim(readfile(`${STATE_DIR}/button-${name}.state`));
		if (state == 'pressed' || state == 'released')
			return state;
	} catch (e) {}
	return 'unknown';
}

function read_adc_maskrom_pressed() {
	let r = run('/bin/sh -c "for d in /sys/bus/iio/devices/iio\\:device*; do [ -f \"$d/in_voltage0_raw\" ] && cat \"$d/in_voltage0_raw\" && break; done"');
	if (r.code != 0 || r.out == '')
		return null;
	let raw = int(r.out);
	if (raw == null)
		return null;
	/* adc-keys: pressed when below ~1.75V on 1.8V ref (~4095 full scale) */
	return raw < 3600;
}

function parse_input_devices() {
	let found = { wps: false, BTN_2: false };
	try {
		let text = readfile('/proc/bus/input/devices');
		if (match(text, /USERKEY/i))
			found.wps = true;
		if (match(text, /maskrom/i))
			found.BTN_2 = true;
	} catch (e) {}
	return found;
}

function read_events(max) {
	max = max || 12;
	let lines = [];
	try {
		let text = readfile(EVENT_LOG);
		let all = split(text, '\n');
		for (let i = max(0, length(all) - max); i < length(all); i++) {
			let line = trim(all[i]);
			if (line != '')
				push(lines, line);
		}
	} catch (e) {
		let r = run(`/bin/logread -l ${max} -e button`);
		if (r.out != '')
			lines = filter(split(r.out, '\n'), (l) => trim(l) != '');
	}
	return lines;
}

function button_state_snippet() {
	return [
		'state="/var/run/button-${BUTTON}.state"',
		'log="/var/log/button-events.log"',
		'case "$ACTION" in',
		'pressed) echo pressed > "$state" ;;',
		'released) echo released > "$state" ;;',
		'esac',
		'echo "$(date \'+%Y-%m-%d %H:%M:%S\') $BUTTON $ACTION seen=${SEEN:-0}" >> "$log"'
	].join('\n');
}

function template_for(name, preset) {
	let header = `#!/bin/sh\n\n# Managed by LuCI Buttons. Hotplug provides ACTION, BUTTON and SEEN.\n\n`;
	let state = button_state_snippet();
	if (preset == 'logger') {
		return `${header}${state}\nlogger -t button \"button=$BUTTON action=$ACTION seen=$SEEN\"\n\nreturn 0\n`;
	}
	if (preset == 'reboot') {
		return `${header}${state}\ncase \"$ACTION\" in\nreleased)\n\tlogger -t button \"reboot requested by $BUTTON\"\n\treboot\n\t;;\nesac\n\nreturn 0\n`;
	}
	if (preset == 'wps' || name == 'wps') {
		return `${header}${state}\ncase \"$ACTION\" in\npressed)\n\tlogger -t button \"USERKEY/WPS pressed button=$BUTTON seen=$SEEN\"\n\tfor dir in /var/run/hostapd-*; do\n\t\t[ -d \"$dir\" ] || continue\n\t\tfor iface in \"$dir\"/*; do\n\t\t\t[ -S \"$iface\" ] || continue\n\t\t\thostapd_cli -p \"$dir\" -i \"\${iface##*/}\" wps_pbc 2>/dev/null &\n\t\t\tdone\n\t\tdone\n\t;;\nreleased)\n\tlogger -t button \"USERKEY/WPS released button=$BUTTON seen=$SEEN\"\n\t;;\nesac\n\nreturn 0\n`;
	}
	if (preset == 'maskrom' || name == 'BTN_2') {
		return `${header}${state}\ncase \"$ACTION\" in\npressed)\n\tlogger -t button \"MaskROM pressed button=$BUTTON seen=$SEEN\"\n\t;;\nreleased)\n\tlogger -t button \"MaskROM released button=$BUTTON seen=$SEEN\"\n\t;;\nesac\n\nreturn 0\n`;
	}
	return `${header}${state}\ncase \"$ACTION\" in\npressed)\n\tlogger -t button \"pressed $BUTTON\"\n\t;;\nreleased)\n\tlogger -t button \"released $BUTTON after $SEEN seconds\"\n\t;;\nesac\n\nreturn 0\n`;
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
				common: [ 'wps', 'BTN_2', 'reset', 'reboot', 'power', 'rfkill', 'failsafe' ],
				protected: [ 'failsafe', 'power', 'reboot', 'reset', 'rfkill', 'wps', 'BTN_2' ],
				cm5_buttons: CM5_BUTTONS
			};
		}
	},

	status: {
		call: function() {
			let inputs = parse_input_devices();
			let adc_pressed = read_adc_maskrom_pressed();
			let buttons = [];

			for (let i = 0; i < length(CM5_BUTTONS); i++) {
				let def = CM5_BUTTONS[i];
				let state = read_state(def.hotplug);
				let detected = def.id == 'wps' ? inputs.wps : inputs.BTN_2;
				if (def.id == 'BTN_2' && adc_pressed != null) {
					if (adc_pressed)
						state = 'pressed';
					else if (state == 'unknown')
						state = 'released';
				}
				push(buttons, {
					id: def.id,
					label: def.label,
					hotplug: def.hotplug,
					driver: def.driver,
					state: state,
					detected: detected,
					script: access(`${BTN_DIR}/${def.hotplug}`) ? true : false
				});
			}

			return {
				buttons,
				events: read_events(15),
				event_log: EVENT_LOG
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
