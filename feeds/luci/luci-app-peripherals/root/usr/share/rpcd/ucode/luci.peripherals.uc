#!/usr/bin/env ucode

'use strict';

import { readfile, writefile, popen, lsdir, basename } from 'fs';

const BTN_DIR = '/etc/rc.button';
const RC_MAPS = '/etc/rc_maps.cfg';
const RC_KEYMAPS = '/etc/rc_keymaps';
const IR_KEYTABLE = '/usr/bin/ir-keytable';
const MAX_SCRIPT = 131072;
const MAX_DEBUG_REPORT = 65536;

const UCI_PKG = 'luci_peripherals';
const UCI_SEC = 'peripherals';
const MODULE_ROOTS = [ '/lib/modules', '/usr/lib/modules' ];

/* Names as in /proc/modules or /sys/module/<name> (underscores). */
const DIAG_MODULES = [
	{ module: 'rc_core', label: 'RC core for external IR receivers (kmod-multimedia-input)', optional: true },
	{ module: 'gpio_ir_recv', label: 'GPIO IR receiver for external receivers (kmod-ir-gpio-cir)', optional: true },
	{ module: 'rockchip_pwm_capture', label: 'Rockchip PWM capture support for onboard IR diagnostics', optional: true },
	{ module: 'pwm_fan', label: 'PWM fan hwmon (kmod-hwmon-pwmfan)', optional: true },
	{ module: 'gpio_button_hotplug', label: 'GPIO button hotplug (/etc/rc.button)', optional: true },
	{ module: 'gpio_keys', label: 'GPIO keys (polled)', optional: true }
];

function uci_get_opt(option, def) {
	let p = popen(`uci -q get ${UCI_PKG}.${UCI_SEC}.${option} 2>/dev/null`, 'r');
	let v = trim(p ? (p.read('all') || '') : '');
	if (p)
		p.close();
	return length(v) ? v : def;
}

function uci_set_opt(option, value) {
	if (!match(option, /^[a-z_]+$/))
		return;
	let val = `${value}`;
	if (!match(val, /^[0-9a-zA-Z_-]+$/))
		return;
	let p = popen(`uci set ${UCI_PKG}.${UCI_SEC}.${option}=${val} && uci commit ${UCI_PKG} 2>&1`, 'r');
	if (p) {
		p.read('all');
		p.close();
	}
}

function uname_release() {
	try {
		let rel = trim(readfile('/proc/sys/kernel/osrelease'));
		if (length(rel))
			return rel;
	} catch (e) {}
	try {
		let rel = trim(readfile('/proc/version'));
		let m = match(rel, /Linux version ([^ ]+)/);
		if (m && length(m) > 1)
			return m[1];
	} catch (e2) {}
	return '';
}

function path_exists(path) {
	try {
		readfile(path);
		return true;
	} catch (e) {}
	try {
		lsdir(path);
		return true;
	} catch (e2) {}
	return false;
}

function dir_exists(path) {
	try {
		lsdir(path);
		return true;
	} catch (e) {}
	return false;
}

function module_root_for_release(rel) {
	if (!length(rel))
		return '';
	for (let i = 0; i < length(MODULE_ROOTS); i++) {
		let p = `${MODULE_ROOTS[i]}/${rel}`;
		if (dir_exists(p))
			return p;
	}
	return '';
}

function module_tree_info() {
	let rel = uname_release();
	let root = module_root_for_release(rel);
	let fallback = '';

	for (let r = 0; r < length(MODULE_ROOTS); r++) {
		try {
			let list = lsdir(MODULE_ROOTS[r]);
			for (let i = 0; i < length(list); i++) {
				let n = list[i];
				if (!length(n) || n == '.' || n == '..')
					continue;
				let p = `${MODULE_ROOTS[r]}/${n}`;
				if (!dir_exists(p))
					continue;
				if (!length(root) && length(rel) && n == rel)
					root = p;
				if (path_exists(`${p}/modules.dep`))
					return { release: n, path: p, exists: true, modules_dep: true };
				if (!length(fallback))
					fallback = p;
			}
		} catch (e) {}
	}

	if (length(root))
		return { release: rel, path: root, exists: true, modules_dep: path_exists(`${root}/modules.dep`) };
	if (length(fallback))
		return { release: basename(fallback), path: fallback, exists: true, modules_dep: path_exists(`${fallback}/modules.dep`) };
	return { release: rel, path: length(rel) ? `/lib/modules/${rel}` : '/lib/modules', exists: false, modules_dep: false };
}

/* Prefer the running kernel release; fall back to the single available module tree for skew diagnostics. */
function kernel_release_for_modules() {
	return module_tree_info().release;
}

function proc_modules_set() {
	let set = {};
	let count = 0;
	try {
		const t = readfile('/proc/modules');
		const lines = split(t, '\n');
		for (let i = 0; i < length(lines); i++) {
			const line = trim(lines[i]);
			if (!length(line))
				continue;
			const parts = split(line, /\s+/, 2);
			if (length(parts) > 0) {
				set[parts[0]] = true;
				count++;
			}
		}
	} catch (e) {
		try {
			const list = lsdir('/sys/module');
			for (let i = 0; i < length(list); i++) {
				const n = list[i];
				if (!length(n) || n == '.' || n == '..')
					continue;
				set[n] = true;
				count++;
			}
		} catch (e2) {}
	}
	return { set, count };
}

function module_state(name, procset) {
	if (procset[name])
		return 'loaded';
	if (dir_exists(`/sys/module/${name}`))
		return 'builtin';
	return 'missing';
}

function find_fan_hwmon() {
	try {
		let list = lsdir('/sys/class/hwmon');
		for (let i = 0; i < length(list); i++) {
			let h = list[i];
			if (!match(h, /^hwmon[0-9]+$/))
				continue;
			let p = `/sys/class/hwmon/${h}`;
			try {
				if (trim(readfile(`${p}/name`)) == 'pwmfan')
					return p;
			} catch (e) {}
		}
	} catch (e) {}
	return null;
}

function list_hwmon() {
	let items = [];
	try {
		let list = lsdir('/sys/class/hwmon');
		for (let i = 0; i < length(list); i++) {
			let h = list[i];
			if (!match(h, /^hwmon[0-9]+$/))
				continue;
			let name = '';
			try {
				name = trim(readfile(`/sys/class/hwmon/${h}/name`));
			} catch (e) {}
			push(items, { id: h, name, path: `/sys/class/hwmon/${h}` });
		}
	} catch (e) {}
	return items;
}

function dt_has_pwm_fan() {
	try {
		let compat = readfile('/proc/device-tree/fan/compatible');
		return !!match(compat, /pwm-fan/);
	} catch (e) {}
	try {
		let compat = readfile('/proc/device-tree/pwm-fan/compatible');
		return !!match(compat, /pwm-fan/);
	} catch (e) {}
	return false;
}

function device_tree_model() {
	try {
		return trim(readfile('/proc/device-tree/model'));
	} catch (e) {}
	return '';
}

function fan_board_info() {
	return {
		board: 'Orange Pi CM5 Base',
		manual: 'OrangePi_CM5_Base_RK3588S_user-manual_v1.3',
		connector: '5V 2-pin 1.25mm fan socket',
		control: 'PWM speed and switch control',
		dts_node: '/fan compatible=pwm-fan',
		pwm: 'PWM13, pinctrl pwm13m1_pins',
		period_ns: 20000000,
		hwmon_name: 'pwmfan',
		tachometer: 'not exposed by the 2-pin connector',
		enable_modes: {
			'0': 'hard off: PWM disabled and fan supply disabled',
			'1': 'automatic/thermal: PWM disabled at idle, supply kept enabled',
			'2': 'manual PWM: PWM enabled and fan supply enabled',
			'3': 'off with supply disabled when idle'
		}
	};
}

function ir_board_info() {
	return {
		board: 'Orange Pi CM5 Base',
		manual: 'OrangePi_CM5_Base_RK3588S_user-manual_v1.3',
		onboard: 'Infrared receiver',
		implementation: 'PWM input capture',
		rc_device: 'not exposed as /sys/class/rc/rc* by the current upstream RK3588 PWM/IR binding',
		default_support: 'v4l-utils keymap editing for external RC devices plus onboard PWM/counter diagnostics',
		external_receiver: 'gpio-ir-receiver overlays or device-tree nodes still use rc-core and /etc/rc_maps.cfg'
	};
}

function shell_quote(val) {
	val = `${val}`;
	let out = "'";
	let i;

	for (i = 0; i < length(val); i++) {
		let c = substr(val, i, 1);

		if (c == "'")
			out += "'\\''";
		else
			out += c;
	}

	out += "'";
	return out;
}

function file_test(flag, path) {
	let p = popen(`test ${flag} ${shell_quote(path)} && echo yes`, 'r');
	let ok = trim(p ? (p.read('all') || '') : '') == 'yes';

	if (p)
		p.close();

	return ok;
}

function find_i2cdetect() {
	if (file_test('-x', '/usr/sbin/i2cdetect'))
		return '/usr/sbin/i2cdetect';
	if (file_test('-x', '/usr/bin/i2cdetect'))
		return '/usr/bin/i2cdetect';
	return '';
}

function oled_board_info() {
	return {
		board: 'Orange Pi CM5 Base',
		manual: 'OrangePi_CM5_Base_RK3588S_user-manual_v1.3',
		panel: 'SH1106 128×64 (Waveshare 1.3" HAT)',
		default_bus: '/dev/i2c-7',
		default_address: '0x3c',
		shared_bus: 'FPC expansion: i2c7m3 (GPIO4_B2/B3); onboard RTC stays on i2c1 @ 0x51',
		lan_interface: 'br-lan',
		daemon: 'luci-app-oled userspace (/usr/bin/oled)',
		kernel: 'CONFIG_I2C + CONFIG_I2C_CHARDEV + CONFIG_I2C_RK3X (built-in on CM5)'
	};
}

function list_i2c_devices() {
	let devices = [];
	let p = popen('ls -1 /dev/i2c-[0-9]* 2>/dev/null', 'r');

	if (p) {
		let raw = trim(p.read('all') || '');
		p.close();
		let lines = split(raw, '\n');

		for (let i = 0; i < length(lines); i++) {
			let line = trim(lines[i]);

			if (length(line))
				push(devices, line);
		}
	}

	if (length(devices))
		return devices;

	try {
		const list = lsdir('/dev');
		for (let i = 0; i < length(list); i++) {
			const n = list[i];
			if (match(n, /^i2c-[0-9]+$/))
				push(devices, `/dev/${n}`);
		}
	} catch (e) {}

	return devices;
}

function oled_config_present() {
	return file_test('-f', '/etc/config/oled');
}

function oled_daemon_present() {
	return file_test('-x', '/usr/bin/oled');
}

function oled_uci_get(option, def) {
	if (!oled_config_present())
		return def;
	let p = popen(`uci -q get oled.@oled[0].${option} 2>/dev/null`, 'r');
	let v = trim(p ? (p.read('all') || '') : '');
	if (p)
		p.close();
	return length(v) ? v : def;
}

function proc_running(pattern) {
	let p = popen(`pgrep -f ${shell_quote(pattern)} >/dev/null 2>&1; echo $?`, 'r');
	let code = trim(p ? (p.read('all') || '1') : '1');
	if (p)
		p.close();
	return code == '0';
}

function oled_running() {
	let menu_mode = oled_uci_get('menu_mode', '1');
	if (menu_mode == '1')
		return proc_running('/usr/sbin/oledd');
	return proc_running('/usr/bin/oled');
}

function oled_get_config() {
	return {
		installed: oled_daemon_present() || file_test('-x', '/usr/sbin/oledd'),
		config_present: oled_config_present(),
		running: oled_running(),
		menu_mode: oled_uci_get('menu_mode', '1'),
		enable: oled_uci_get('enable', '0'),
		path: oled_uci_get('path', '/dev/i2c-7'),
		i2c_devices: list_i2c_devices(),
		board_info: oled_board_info()
	};
}

function fan_diag(base, procset) {
	const mt = module_tree_info();
	const lib_path = mt.path;
	return {
		hwmon: list_hwmon(),
		module_state: module_state('pwm_fan', procset),
		module_file: path_exists(`${lib_path}/pwm-fan.ko`),
		autoload: path_exists('/etc/modules.d/60-hwmon-pwmfan'),
		dt_pwm_fan: dt_has_pwm_fan(),
		device_tree_model: device_tree_model(),
		path: base || '',
		board_info: fan_board_info()
	};
}

function clamp_pwm(v) {
	let s = trim(`${v}`);
	let n = 0;
	if (match(s, /^[0-9]+$/))
		n = +s;
	else
		n = 192;
	if (n < 0)
		n = 0;
	if (n > 255)
		n = 255;
	return n;
}

/* pwm-fan hwmon: 0 hard-off, 1 automatic/thermal idle, 2 manual PWM. */
function fan_apply_hw(base, mode, pwmval) {
	if (!base)
		return { error: 'no_fan' };
	if (mode == 'off') {
		try {
			if (path_exists(`${base}/pwm1_enable`))
				writefile(`${base}/pwm1_enable`, '0\n');
		} catch (e) {
			return { error: 'fan_off', message: `${e}` };
		}
		return { ok: true };
	}
	if (mode == 'manual') {
		try {
			writefile(`${base}/pwm1`, `${pwmval}\n`);
			if (path_exists(`${base}/pwm1_enable`))
				writefile(`${base}/pwm1_enable`, '2\n');
		} catch (e) {
			return { error: 'fan_manual', message: `${e}` };
		}
		return { ok: true };
	}
	try {
		if (path_exists(`${base}/pwm1_enable`))
			writefile(`${base}/pwm1_enable`, '1\n');
	} catch (e) {
		return { error: 'fan_auto', message: `${e}` };
	}
	return { ok: true };
}

function list_counter_devices() {
	let devices = [];
	try {
		let list = lsdir('/sys/bus/counter/devices');
		for (let i = 0; i < length(list); i++) {
			let n = list[i];
			if (!match(n, /^counter[0-9]+$/))
				continue;
			let p = `/sys/bus/counter/devices/${n}`;
			let counts = [];
			try {
				let files = lsdir(p);
				for (let j = 0; j < length(files); j++) {
					let f = files[j];
					if (!match(f, /^count[0-9]+$/))
						continue;
					push(counts, {
						id: f,
						name: read_optional(`${p}/${f}/name`),
						count: read_optional(`${p}/${f}/count`),
						enable: read_optional(`${p}/${f}/enable`)
					});
				}
			} catch (e2) {}
			push(devices, {
				id: n,
				path: p,
				name: read_optional(`${p}/name`),
				counts
			});
		}
	} catch (e) {}
	return devices;
}

function append_line(lines, text) {
	push(lines, text != null ? `${text}` : '');
}

function append_block(lines, title, body) {
	append_line(lines, '');
	append_line(lines, `## ${title}`);
	append_line(lines, length(trim(body || '')) ? trim(body) : '(empty)');
}

function limit_text(text, max) {
	text = `${text || ''}`;
	if (length(text) <= max)
		return text;
	return `${substr(text, 0, max)}\n... truncated ${length(text) - max} bytes ...`;
}

function read_optional(path) {
	try {
		return trim(readfile(path));
	} catch (e) {}
	return '';
}

function run_cmd(cmd) {
	let p = popen(`${cmd} 2>&1`, 'r');
	if (!p)
		return 'popen failed';
	let out = p.read('all') || '';
	let code = p.close();
	if (code != 0 && !length(trim(out)))
		out = `exit code ${code}`;
	return limit_text(trim(out), 12000);
}

function debug_report() {
	const pm = proc_modules_set();
	const base = find_fan_hwmon();
	let lines = [];

	append_line(lines, 'Orange Pi CM5 Base peripheral debug report');
	append_line(lines, 'Generated by luci-app-peripherals.');
	append_line(lines, 'This report is read-only; no GPIO/PWM/button state was changed.');

	append_block(lines, 'System', run_cmd('date; uname -a; uptime; cat /etc/openwrt_release 2>/dev/null'));
	append_block(lines, 'Device tree model', `${device_tree_model() || '(unknown)'}\ncompatible=${run_cmd("tr '\\0' ' ' </proc/device-tree/compatible")}`);
	append_block(lines, 'Board fan reference', sprintf(
		'board=%s\nmanual=%s\nconnector=%s\ncontrol=%s\ndts=%s\npwm=%s\nperiod_ns=%d\ntachometer=%s',
		fan_board_info().board,
		fan_board_info().manual,
		fan_board_info().connector,
		fan_board_info().control,
		fan_board_info().dts_node,
		fan_board_info().pwm,
		fan_board_info().period_ns,
		fan_board_info().tachometer
	));
	append_block(lines, 'Board IR reference', sprintf(
		'board=%s\nmanual=%s\nonboard=%s\nimplementation=%s\nrc_device=%s\ndefault_support=%s\nexternal_receiver=%s',
		ir_board_info().board,
		ir_board_info().manual,
		ir_board_info().onboard,
		ir_board_info().implementation,
		ir_board_info().rc_device,
		ir_board_info().default_support,
		ir_board_info().external_receiver
	));

	append_block(lines, 'UCI peripherals config', run_cmd(`uci -q show ${UCI_PKG}`));
	append_block(lines, 'Button scripts', run_cmd(`ls -la ${BTN_DIR}; for f in ${BTN_DIR}/*; do [ -f "$f" ] || continue; echo "--- $f"; sed -n '1,120p' "$f"; done`));
	append_block(lines, 'Button and key modules', sprintf(
		'gpio_button_hotplug=%s\ngpio_keys=%s\n/proc/modules count=%d',
		module_state('gpio_button_hotplug', pm.set),
		module_state('gpio_keys', pm.set),
		pm.count
	));
	append_block(lines, 'GPIO key device tree hints', run_cmd("for d in /proc/device-tree/gpio-keys* /proc/device-tree/*/gpio-keys*; do [ -e \"$d\" ] || continue; echo \"--- $d\"; find \"$d\" -maxdepth 2 -type f -print 2>/dev/null | while read f; do printf '%s: ' \"$f\"; if command -v hexdump >/dev/null 2>&1; then hexdump -v -e '1/1 \"%02x\"' \"$f\" 2>/dev/null; else od -An -tx1 -v \"$f\" 2>/dev/null | tr -d ' \\n'; fi; echo; done; done"));

	append_block(lines, 'Fan hwmon state', sprintf(
		'present=%s\npath=%s\npwm1=%s\npwm1_enable=%s\nfan1_input=%s\ndt_pwm_fan=%s\nmodule_state=%s\nautoload=%s',
		base ? 'yes' : 'no',
		base || '',
		base ? read_optional(`${base}/pwm1`) : '',
		base ? read_optional(`${base}/pwm1_enable`) : '',
		base ? read_optional(`${base}/fan1_input`) : '',
		dt_has_pwm_fan() ? 'yes' : 'no',
		module_state('pwm_fan', pm.set),
		path_exists('/etc/modules.d/60-hwmon-pwmfan') ? 'yes' : 'no'
	));
	append_block(lines, 'All hwmon devices', run_cmd("for d in /sys/class/hwmon/hwmon*; do [ -e \"$d\" ] || continue; printf '%s name=' \"$d\"; cat \"$d/name\" 2>/dev/null; for f in \"$d\"/pwm* \"$d\"/fan*_input \"$d\"/temp*_input; do [ -e \"$f\" ] && printf '  %s=%s\\n' \"$f\" \"$(cat \"$f\" 2>/dev/null)\"; done; done"));
	append_block(lines, 'Thermal zones', run_cmd("for z in /sys/class/thermal/thermal_zone*; do [ -e \"$z\" ] || continue; printf '%s type=%s temp=%s\\n' \"$z\" \"$(cat \"$z/type\" 2>/dev/null)\" \"$(cat \"$z/temp\" 2>/dev/null)\"; done"));
	append_block(lines, 'Kernel PWM debug', run_cmd("cat /sys/kernel/debug/pwm 2>/dev/null || echo 'debugfs PWM information unavailable; mount debugfs or enable kernel debugfs to inspect raw PWM state'"));

	append_block(lines, 'IR devices', run_cmd("ls -la /sys/class/rc 2>/dev/null; for d in /sys/class/rc/rc*; do [ -e \"$d\" ] || continue; echo \"--- $d\"; cat \"$d/uevent\" 2>/dev/null; done; [ -x /usr/bin/ir-keytable ] && /usr/bin/ir-keytable 2>&1 || true"));
	append_block(lines, 'IR maps', run_cmd(`ls -la ${RC_KEYMAPS} 2>/dev/null; echo '--- rc_maps.cfg (first 80 lines)'; sed -n '1,80p' ${RC_MAPS} 2>/dev/null`));
	append_block(lines, 'PWM/counter capture devices', run_cmd("ls -la /sys/bus/counter/devices 2>/dev/null; for d in /sys/bus/counter/devices/counter*; do [ -e \"$d\" ] || continue; echo \"--- $d\"; find \"$d\" -maxdepth 2 -type f -print 2>/dev/null | while read f; do printf '%s=' \"$f\"; cat \"$f\" 2>/dev/null; done; done"));

	append_block(lines, 'I2C buses', run_cmd('ls -l /dev/i2c-* 2>/dev/null || echo "no /dev/i2c-*"'));
	append_block(lines, 'I2C scan (detected buses)', run_cmd('for b in /dev/i2c-*; do [ -c "$b" ] || continue; n=${b#/dev/i2c-}; echo "--- i2cdetect -y $n"; i2cdetect -y "$n" 2>&1 || true; done'));
	append_block(lines, 'OLED UCI and service', run_cmd('uci -q show oled 2>/dev/null; pgrep -af "/usr/bin/oled" 2>/dev/null || true; /etc/init.d/oled status 2>&1 || true'));

	append_block(lines, 'Relevant kernel log', run_cmd("dmesg | grep -Ei 'pwm|fan|thermal|gpio|button|keys|ir|rc-core|r8125|eth|gmac|i2c|ssd1306|oled' | tail -n 100"));
	append_block(lines, 'Relevant system log', run_cmd("logread 2>/dev/null | grep -Ei 'button|gpio|fan|pwm|thermal|ir|rc-core|peripheral' | tail -n 100 || true"));

	return limit_text(join('\n', lines), MAX_DEBUG_REPORT);
}

const methods = {
	irMapsGet: {
		call: function() {
			try {
				return { content: readfile(RC_MAPS) };
			} catch (e) {
				return { content: '', missing: true };
			}
		}
	},

	irMapsSet: {
		args: { content: 'content' },
		call: function(req) {
			const content = req.args?.content;
			if (type(content) != 'string' || length(content) > MAX_SCRIPT)
				return { error: 'invalid_content' };
			try {
				writefile(RC_MAPS, content);
			} catch (e) {
				return { error: 'write_failed', message: `${e}` };
			}
			return { ok: true };
		}
	},

	irKeymapsList: {
		call: function() {
			let files = [];
			try {
				const list = lsdir(RC_KEYMAPS);
				for (let i = 0; i < length(list); i++)
					push(files, list[i]);
				sort(files);
			} catch (e) {
				return { files: [], missing: true };
			}
			return { files };
		}
	},

	irDevices: {
		call: function() {
			const devices = [];
			let ls = popen('ls -1d /sys/class/rc/rc* 2>/dev/null', 'r');
			const raw = trim(ls ? (ls.read('all') || '') : '');
			if (ls)
				ls.close();
			const lines = split(raw, '\n');
			for (let i = 0; i < length(lines); i++) {
				const p = trim(lines[i]);
				if (!length(p))
					continue;
				let uevent = '';
				try {
					uevent = readfile(`${p}/uevent`);
				} catch (e) {
					try {
						uevent = readfile(`${p}/device/uevent`);
					} catch (e2) {}
				}
				push(devices, { id: basename(p), uevent: trim(uevent) });
			}
			return {
				devices,
				board_info: ir_board_info(),
				counter_devices: list_counter_devices(),
				onboard_rc_expected: false
			};
		}
	},

	irApply: {
		call: function() {
			if (!path_exists(IR_KEYTABLE))
				return { ok: false, output: 'ir-keytable missing; install v4l-utils' };
			const proc = popen(`${IR_KEYTABLE} -a 2>&1`, 'r');
			if (!proc)
				return { ok: false, output: 'popen failed' };
			const output = trim(proc.read('all') || '');
			const code = proc.close();
			return { ok: code == 0, output, code };
		}
	},

	moduleDiagnostics: {
		call: function() {
			const mt = module_tree_info();
			const uname_r = uname_release();
			const mod_r = mt.release;
			const pm = proc_modules_set();
			const procset = pm.set;
			const proc_count = pm.count;

			const lib_path = mt.path;
			const lib_exists = mt.exists;
			let items = [];
			let required_ok = true;
			let ir_ok = true;

			for (let i = 0; i < length(DIAG_MODULES); i++) {
				const row = DIAG_MODULES[i];
				const st = module_state(row.module, procset);
				const miss = st == 'missing';
				if (!row.optional && miss)
					required_ok = false;
				push(items, {
					module: row.module,
					label: row.label,
					optional: row.optional,
					state: st
				});
			}

			const modules_dep = mt.modules_dep;

			return {
				uname_r,
				modules_release: mod_r,
				lib_modules_path: lib_path,
				lib_modules_exists: lib_exists,
				proc_modules_count: proc_count,
				modules_dep,
				items,
				required_ok,
				ir_stack_ok: ir_ok
			};
		}
	},

	debugReport: {
		call: function() {
			return { report: debug_report() };
		}
	},

	fanGet: {
		call: function() {
			let mode = uci_get_opt('fan_mode', 'auto');
			let pwm_uci = clamp_pwm(uci_get_opt('fan_pwm', '192'));
			let base = find_fan_hwmon();
			const pm = proc_modules_set();
			const diag = fan_diag(base, pm.set);
			if (!base)
				return { present: false, mode, pwm_uci, diagnostics: diag };
			let pwm1 = '', en = '', rpm = '';
			try {
				pwm1 = trim(readfile(`${base}/pwm1`));
			} catch (e) {}
			try {
				en = trim(readfile(`${base}/pwm1_enable`));
			} catch (e) {}
			try {
				rpm = trim(readfile(`${base}/fan1_input`));
			} catch (e) {}
			return {
				present: true,
				path: base,
				pwm1,
				pwm1_enable: en,
				rpm,
				mode,
				pwm_uci,
				diagnostics: diag
			};
		}
	},

	fanSet: {
		args: { mode: 'mode', pwm: 'pwm' },
		call: function(req) {
			let mode = req.args?.mode;
			let pwm_arg = req.args?.pwm;
			if (type(mode) != 'string' || !match(mode, /^(auto|manual|off)$/))
				return { error: 'invalid_mode' };
			let pwmv = clamp_pwm(pwm_arg != null ? pwm_arg : uci_get_opt('fan_pwm', '192'));
			uci_set_opt('fan_mode', mode);
			uci_set_opt('fan_pwm', `${pwmv}`);
			let base = find_fan_hwmon();
			return fan_apply_hw(base, mode, pwmv);
		}
	},

	fanTest: {
		args: { pwm: 'pwm', mode: 'mode' },
		call: function(req) {
			let pwmv = clamp_pwm(req.args?.pwm != null ? req.args.pwm : '255');
			let mode = req.args?.mode || (pwmv > 0 ? 'manual' : 'off');
			if (type(mode) != 'string' || !match(mode, /^(manual|off)$/))
				return { error: 'invalid_mode' };
			let base = find_fan_hwmon();
			let res = fan_apply_hw(base, mode, pwmv);
			if (res.error)
				return res;
			return { ok: true, pwm: pwmv, mode, path: base || '' };
		}
	},

	oledGet: {
		call: function() {
			return oled_get_config();
		}
	},

	oledDetect: {
		args: { bus: 'bus' },
		call: function(req) {
			let bus = trim(`${req.args?.bus || ''}`);
			if (!match(bus, /^[0-9]+$/))
				return { error: 'invalid_bus' };
			let dev = `/dev/i2c-${bus}`;
			let devices = list_i2c_devices();
			let found = false;

			for (let i = 0; i < length(devices); i++) {
				if (devices[i] == dev)
					found = true;
			}

			if (!found && !file_test('-c', dev))
				return { error: 'no_device', path: dev };
			let i2cdetect = find_i2cdetect();
			if (!length(i2cdetect))
				return { error: 'missing_i2cdetect', message: 'Install i2c-tools.' };
			return {
				ok: true,
				path: dev,
				output: run_cmd(`${i2cdetect} -y ${bus}`)
			};
		}
	}
};

return { 'luci.peripherals': methods };
