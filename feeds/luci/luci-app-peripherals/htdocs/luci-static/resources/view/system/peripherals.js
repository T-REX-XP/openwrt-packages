'use strict';
'require view';
'require rpc';
'require ui';

var callIrMapsGet = rpc.declare({
	object: 'luci.peripherals',
	method: 'irMapsGet'
});

var callIrMapsSet = rpc.declare({
	object: 'luci.peripherals',
	method: 'irMapsSet',
	params: ['content']
});

var callIrKeymapsList = rpc.declare({
	object: 'luci.peripherals',
	method: 'irKeymapsList'
});

var callIrDevices = rpc.declare({
	object: 'luci.peripherals',
	method: 'irDevices'
});

var callIrApply = rpc.declare({
	object: 'luci.peripherals',
	method: 'irApply'
});

var callModuleDiagnostics = rpc.declare({
	object: 'luci.peripherals',
	method: 'moduleDiagnostics'
});

var callDebugReport = rpc.declare({
	object: 'luci.peripherals',
	method: 'debugReport'
});

var callFanGet = rpc.declare({
	object: 'luci.peripherals',
	method: 'fanGet'
});

var callFanSet = rpc.declare({
	object: 'luci.peripherals',
	method: 'fanSet',
	params: ['mode', 'pwm']
});

var callFanTest = rpc.declare({
	object: 'luci.peripherals',
	method: 'fanTest',
	params: ['pwm', 'mode']
});

var callOledGet = rpc.declare({
	object: 'luci.peripherals',
	method: 'oledGet'
});

var callOledSet = rpc.declare({
	object: 'luci.peripherals',
	method: 'oledSet',
	params: ['config']
});

var callOledDetect = rpc.declare({
	object: 'luci.peripherals',
	method: 'oledDetect',
	params: ['bus']
});

var callOledService = rpc.declare({
	object: 'luci.peripherals',
	method: 'oledService',
	params: ['action']
});

var isReadonlyView = !L.hasViewPermission() || null;

function rpcData(data, fallback) {
	if (Array.isArray(data)) {
		if (data.length > 1 && data[0] === 0 && data[1] != null)
			return data[1];
		if (data.length && data[0] != null && typeof data[0] === 'object')
			return data[0];
		return fallback || {};
	}
	if (data && data.result != null)
		return rpcData(data.result, fallback);
	return data || fallback || {};
}

function cbiSection(title, descrNodes, bodyNodes) {
	var parts = [];
	if (title)
		parts.push(E('h3', {}, [ title ]));
	if (descrNodes && descrNodes.length)
		parts.push(E('p', { 'class': 'cbi-section-descr' }, descrNodes));
	for (var i = 0; i < (bodyNodes || []).length; i++)
		parts.push(bodyNodes[i]);
	return E('div', { 'class': 'cbi-section' }, parts);
}

function tableTitles(headers) {
	return E('tr', { 'class': 'tr table-titles' }, headers.map(function(h) {
		return E('th', { 'class': 'th' }, [ h ]);
	}));
}

function fanEnableModeLabel(mode) {
	var labels = {
		'0': _('0 - hard off'),
		'1': _('1 - automatic/thermal idle'),
		'2': _('2 - manual PWM'),
		'3': _('3 - off while idle')
	};
	var key = mode != null ? String(mode) : '';
	return labels[key] || (key || _('unknown'));
}

function fanBoardInfoBlock(fan) {
	var info = (((fan || {}).diagnostics || {}).board_info) || {};
	var modes = info.enable_modes || {};
	var rows = [
		[ _('Manual reference'), info.manual || 'OrangePi_CM5_Base_RK3588S_user-manual_v1.3' ],
		[ _('Fan connector'), info.connector || _('5V 2-pin 1.25mm fan socket') ],
		[ _('Board control'), info.control || _('PWM speed and switch control') ],
		[ _('Device tree'), '%s, %s'.format(info.dts_node || '/fan compatible=pwm-fan', info.pwm || 'PWM13') ],
		[ _('PWM period'), info.period_ns ? _('%d ns').format(info.period_ns) : _('unknown') ],
		[ _('RPM feedback'), info.tachometer || _('not exposed by the 2-pin connector') ],
		[ _('Polarity test'), _('Use Full-speed test first. If the fan does not spin, use Inverted full-speed test before changing DTS polarity.') ],
		[ _('pwm1_enable=0'), modes['0'] || _('hard off') ],
		[ _('pwm1_enable=1'), modes['1'] || _('automatic/thermal idle') ],
		[ _('pwm1_enable=2'), modes['2'] || _('manual PWM') ]
	];

	return E('table', { 'class': 'table' }, [
		tableTitles([ _('Property'), _('Value') ]),
		E('tbody', {}, rows.map(function(row) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ row[0] ]),
				E('td', { 'class': 'td' }, [ row[1] ])
			]);
		}))
	]);
}

function fanMetaBlock(fan) {
	var diag = (fan || {}).diagnostics || {};
	if (!fan || !fan.present) {
		var hwmon = diag.hwmon || [];
		var rows = [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Device tree pwm-fan node') ]),
				E('td', { 'class': 'td' }, [ diag.dt_pwm_fan ? _('present') : _('missing') ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('pwm_fan module') ]),
				E('td', { 'class': 'td' }, [ diag.module_state || _('unknown') ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('pwm-fan.ko') ]),
				E('td', { 'class': 'td' }, [ diag.module_file ? _('present') : _('missing') ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Autoload file') ]),
				E('td', { 'class': 'td' }, [ diag.autoload ? _('present') : _('missing') ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Detected hwmon devices') ]),
				E('td', { 'class': 'td' }, [
					hwmon.length ? hwmon.map(function(h) {
						return '%s=%s'.format(h.id || '?', h.name || _('unnamed'));
					}).join(', ') : _('none')
				])
			])
		];

		return E('div', {}, [
			E('p', { 'class': 'alert-message warning' }, [
				_('No pwmfan device was found. If the device tree node is missing, the board is likely booting an older DTB/image. If the node exists but the module is missing or not loaded, reinstall/sysupgrade with the generated image or run %s and check %s.').format('modprobe pwm-fan', 'dmesg')
			]),
			E('table', { 'class': 'table' }, [
				tableTitles([ _('Check'), _('State') ]),
				E('tbody', {}, rows)
			])
		]);
	}
	return E('div', {}, [
		E('p', {}, [
			_('PWM: %s, control: %s, RPM: %s').format(
				fan.pwm1 != null ? fan.pwm1 : '—',
				fanEnableModeLabel(fan.pwm1_enable),
				fan.rpm != null && fan.rpm !== '' ? fan.rpm : _('n/a')
			)
		]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('The Orange Pi CM5 Base fan connector is a 2-wire 5V PWM-controlled output, so no tachometer/RPM input is expected.')
		])
	]);
}

function irBoardInfoBlock(irDev) {
	var info = (irDev || {}).board_info || {};
	var rows = [
		[ _('Manual reference'), info.manual || 'OrangePi_CM5_Base_RK3588S_user-manual_v1.3' ],
		[ _('Onboard hardware'), info.onboard || _('Infrared receiver') ],
		[ _('Kernel implementation'), info.implementation || _('PWM input capture') ],
		[ _('RC device status'), info.rc_device || _('not exposed as /sys/class/rc/rc* by the current upstream kernel') ],
		[ _('Default support'), info.default_support || _('external RC keymap support and onboard diagnostics') ],
		[ _('External receivers'), info.external_receiver || _('gpio-ir-receiver device tree nodes can create /sys/class/rc/rc* devices') ]
	];

	return E('table', { 'class': 'table' }, [
		tableTitles([ _('Property'), _('Value') ]),
		E('tbody', {}, rows.map(function(row) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ row[0] ]),
				E('td', { 'class': 'td' }, [ row[1] ])
			]);
		}))
	]);
}

function counterDevicesBlock(irDev) {
	var counters = (irDev || {}).counter_devices || [];
	if (!counters.length) {
		return E('p', { 'class': 'alert-message notice' }, [
			_('No Linux counter devices were found. This is normal on current RK3588 images unless a future device tree binding exposes the onboard PWM input-capture block.')
		]);
	}

	var rows = [];
	for (var i = 0; i < counters.length; i++) {
		var c = counters[i];
		var counts = (c.counts || []).map(function(cnt) {
			var parts = [ cnt.id || '' ];
			if (cnt.name)
				parts.push(cnt.name);
			if (cnt.count)
				parts.push(_('count=%s').format(cnt.count));
			if (cnt.enable)
				parts.push(_('enable=%s').format(cnt.enable));
			return parts.join(' - ');
		}).join('\n');
		rows.push(E('tr', { 'class': 'tr' }, [
			E('td', { 'class': 'td' }, [ c.id || '' ]),
			E('td', { 'class': 'td' }, [ c.name || '—' ]),
			E('td', { 'class': 'td' }, [ E('code', { 'class': 'peripherals-code-inline' }, [ counts || '—' ]) ])
		]));
	}

	return E('table', { 'class': 'table' }, [
		tableTitles([ _('Device'), _('Name'), _('Counts') ]),
		E('tbody', {}, rows)
	]);
}

function oledBoardInfoBlock(oled) {
	var info = (oled || {}).board_info || {};
	var rows = [
		[ _('Manual reference'), info.manual || 'OrangePi_CM5_Base_RK3588S_user-manual_v1.3' ],
		[ _('Panel type'), info.panel || _('SSD1306 I2C OLED') ],
		[ _('Default I2C bus (CM5)'), info.default_bus || '/dev/i2c-1' ],
		[ _('Typical address'), info.default_address || '0x3c' ],
		[ _('Bus note'), info.shared_bus || _('Confirm wiring on carrier schematic') ],
		[ _('LAN interface'), info.lan_interface || 'br-lan' ],
		[ _('Software stack'), info.daemon || _('luci-app-oled /usr/bin/oled') ],
		[ _('Kernel I2C'), info.kernel || _('I2C char devices required') ]
	];

	return E('table', { 'class': 'table' }, [
		tableTitles([ _('Property'), _('Value') ]),
		E('tbody', {}, rows.map(function(row) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ row[0] ]),
				E('td', { 'class': 'td' }, [ row[1] ])
			]);
		}))
	]);
}

function oledBusNumber(path) {
	var m = String(path || '').match(/^\/dev\/i2c-([0-9]+)$/);
	return m ? m[1] : '1';
}

function oledMetaBlock(oled) {
	oled = oled || {};
	if (!oled.config_present) {
		return E('p', { 'class': 'alert-message warning' }, [
			_('luci-app-oled is not installed. Install the luci-app-oled package to use the SSD1306 status daemon.')
		]);
	}
	if (!oled.installed) {
		return E('p', { 'class': 'alert-message warning' }, [
			_('/etc/config/oled exists but /usr/bin/oled is missing. Reinstall luci-app-oled.')
		]);
	}
	return E('p', {}, [
		_('Service: %s, enabled in UCI: %s, chip: %s, I2C path: %s').format(
			oled.running ? _('running') : _('stopped'),
			oled.enable === '1' ? _('yes') : _('no'),
			oled.chip || 'ssd1306_128x32',
			oled.path || '—'
		)
	]);
}

function debugReportPanel() {
	return E('div', {
		'id': 'periph-debug-report-wrap',
		'style': 'margin-top:1em'
	}, [
		E('h3', {}, [ _('Debug log') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Click Collect debug log after reproducing the behavior. The report is shown here and includes read-only kernel, device tree, module, fan, button, IR, thermal, and log state.')
		]),
		E('div', {
			'id': 'periph-debug-status',
			'class': 'alert-message notice',
			'style': 'margin-bottom:0.5em'
		}, [ _('No debug log collected yet.') ]),
		E('textarea', {
			'id': 'periph-debug-report',
			'class': 'cbi-input-textarea peripherals-debug-report',
			'readonly': 'readonly',
			'placeholder': _('The collected debug log will appear here.')
		})
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			callIrMapsGet(),
			callIrKeymapsList(),
			callIrDevices(),
			callModuleDiagnostics(),
			callFanGet(),
			callOledGet()
		]).then(function(parts) {
			return {
				irMaps: rpcData(parts[0], { content: '' }),
				irKms: rpcData(parts[1], { files: [] }),
				irDev: rpcData(parts[2], { devices: [] }),
				diags: rpcData(parts[3], {}),
				fan: rpcData(parts[4], {}),
				oled: rpcData(parts[5], {})
			};
		});
	},

	buildDiagnosticsSection: function(diags) {
		diags = diags || {};
		var items = diags.items || [];
		var summaryClass = 'alert-message success';
		var summaryParts = [];

		if (!diags.lib_modules_exists)
			summaryClass = 'alert-message error';
		else if (!diags.required_ok)
			summaryClass = 'alert-message error';
		else if (!diags.ir_stack_ok)
			summaryClass = 'alert-message warning';

		if (diags.required_ok && diags.ir_stack_ok && diags.lib_modules_exists)
			summaryParts.push(_('Peripheral kernel module checks look acceptable.'));
		if (!diags.lib_modules_exists)
			summaryParts.push(_('The module directory for this kernel is missing. Loadable modules will not work until kernel and rootfs match (use a full sysupgrade from one build).'));
		if (!diags.required_ok)
			summaryParts.push(_('One or more required kernel features are not loaded or built in.'));
		else if (!diags.ir_stack_ok)
			summaryParts.push(_('External infrared receiver modules are not loaded. The onboard CM5 Base IR receiver is handled separately because it is wired through PWM input capture, not a gpio-ir-receiver RC device.'));

		var summary = E('div', { 'class': summaryClass }, [
			E('strong', {}, [ _('Status') ]),
			E('br'),
			summaryParts.length ? summaryParts.join(' ') : _('Review the details below.')
		]);

		var metaRows = [
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td', 'style': 'white-space:nowrap' }, [ _('Kernel release') + ' (uname -r)' ]),
				E('td', { 'class': 'td' }, [ diags.uname_r || '—' ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Module path') ]),
				E('td', { 'class': 'td' }, [
					'%s (%s)'.format(
						diags.lib_modules_path || '/lib/modules/…',
						diags.lib_modules_exists ? _('present') : _('missing')
					)
				])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Loaded modules (/proc/modules)') ]),
				E('td', { 'class': 'td' }, [ '%d'.format(diags.proc_modules_count | 0) ])
			]),
			E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ 'modules.dep' ]),
				E('td', { 'class': 'td' }, [
					diags.modules_dep ? _('found') : _('not found')
				])
			])
		];
		if (diags.modules_release && diags.modules_release !== diags.uname_r) {
			metaRows.push(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ _('Module directory name (fallback)') ]),
				E('td', { 'class': 'td' }, [ diags.modules_release ])
			]));
		}

		var metaTable = E('table', { 'class': 'table' }, [
			tableTitles([ _('Property'), _('Value') ]),
			E('tbody', {}, metaRows)
		]);

		var modRows = items.map(L.bind(function(it) {
			var st = it.state || 'missing';
			var stateLabel = st === 'loaded' ? _('module loaded') :
				st === 'builtin' ? _('built into kernel') :
				_('not available');
			var rowClass = 'tr';
			if (st === 'missing' && !it.optional)
				rowClass = 'tr cbi-rowstyle-2';
			else if (st === 'missing' && it.optional)
				rowClass = 'tr cbi-rowstyle-1';
			return E('tr', { 'class': rowClass }, [
				E('td', { 'class': 'td' }, [ E('code', {}, [ it.module || '' ]) ]),
				E('td', { 'class': 'td' }, [ it.label || '' ]),
				E('td', { 'class': 'td' }, [ it.optional ? _('optional') : _('required') ]),
				E('td', { 'class': 'td' }, [ stateLabel ])
			]);
		}, this));

		var modTable = E('table', { 'class': 'table' }, [
			tableTitles([ _('Module'), _('Purpose'), _('Expectation'), _('State') ]),
			E('tbody', { 'id': 'periph-diag-body' }, modRows)
		]);

		return E('div', { 'id': 'periph-diag-root' }, [
			cbiSection(
				_('Overview'),
				[ _('These checks are read-only. They compare the running kernel, %s layout, and related modules.').format('/lib/modules') ],
				[ summary, metaTable ]
			),
			cbiSection(
				_('Peripheral-related modules'),
				null,
				[ modTable ]
			),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleDiagRefresh')
				}, _('Refresh')),
				' ',
				E('button', {
					'class': 'btn cbi-button-apply',
					'click': ui.createHandlerFn(this, 'handleDebugReport')
				}, _('Collect debug log'))
			]),
			debugReportPanel()
		]);
	},

	handleDiagRefresh: function() {
		return callModuleDiagnostics().then(L.bind(function(d) {
			d = rpcData(d, {});
			var root = document.getElementById('periph-diag-root');
			if (!root || !root.parentNode)
				return;
			var next = this.buildDiagnosticsSection(d);
			root.parentNode.replaceChild(next, root);
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Could not refresh diagnostics: %s').format(e) ]), 'error');
		});
	},

	handleDebugReport: function() {
		var wrap = document.getElementById('periph-debug-report-wrap');
		var ta = document.getElementById('periph-debug-report');
		var status = document.getElementById('periph-debug-status');
		if (status) {
			status.className = 'alert-message notice';
			status.textContent = _('Collecting debug log...');
		}
		if (ta)
			ta.value = _('Collecting debug log...');

		return callDebugReport().then(function(r) {
			r = rpcData(r, {});
			var report = r && r.report ? String(r.report) : '';
			if (ta) {
				ta.value = report || _('Debug RPC returned an empty report.');
				ta.focus();
				ta.select();
			}
			if (status) {
				status.className = report ? 'alert-message success' : 'alert-message warning';
				status.textContent = report
					? _('Debug log collected (%d characters). Copy it from the text area below.').format(report.length)
					: _('Debug RPC returned an empty report. Check browser console or rpcd logs.');
			}
			if (wrap && wrap.scrollIntoView)
				wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
			ui.addNotification(null, E('p', {}, [ _('Debug log collected. Copy it from the text area and include it with the behavior description.') ]), 'info');
		}).catch(function(e) {
			if (ta)
				ta.value = _('Could not collect debug log: %s').format(e);
			if (status) {
				status.className = 'alert-message error';
				status.textContent = _('Could not collect debug log: %s').format(e);
			}
			if (wrap && wrap.scrollIntoView)
				wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
			ui.addNotification(null, E('p', {}, [ _('Could not collect debug log: %s').format(e) ]), 'error');
		});
	},

	handleMapsSave: function() {
		var ta = document.querySelector('#periph-ir-maps');
		if (!ta || ta.disabled)
			return Promise.resolve();
		var content = String(ta.value || '').replace(/\r\n/g, '\n');
		return callIrMapsSet(content).then(function(r) {
			r = rpcData(r, {});
			if (r.error)
				ui.addNotification(null, E('p', {}, [ '%s'.format(r.error) ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('The file %s has been saved.').format('/etc/rc_maps.cfg') ]), 'info');
		});
	},

	handleIrApply: function() {
		return callIrApply().then(function(r) {
			r = rpcData(r, {});
			var msg = E('div', {}, [
				E('p', {}, [ r.ok ? _('The keymaps were applied successfully.') : _('Keymap application reported an error.') ]),
				r.output ? E('pre', { 'class': 'peripherals-debug-output' }, [ r.output ]) : ''
			]);
			ui.addNotification(null, msg, r.ok ? 'info' : 'warning');
		});
	},

	handleFanApply: function() {
		var sel = document.getElementById('periph-fan-mode');
		var rng = document.getElementById('periph-fan-pwm');
		if (!sel)
			return Promise.resolve();
		var mode = sel.value || 'auto';
		var pwm = rng ? (parseInt(rng.value, 10) || 0) : 128;
		if (pwm < 0)
			pwm = 0;
		if (pwm > 255)
			pwm = 255;
		return callFanSet(mode, pwm).then(function(r) {
			r = rpcData(r, {});
			if (r.error)
				ui.addNotification(null, E('p', {}, [ '%s: %s'.format(r.error, r.message || '') ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('Fan settings have been saved.') ]), 'info');
		});
	},

	handleFanRefresh: function() {
		return callFanGet().then(L.bind(function(f) {
			f = rpcData(f, {});
			var el = document.getElementById('periph-fan-meta');
			if (!el)
				return;
			el.innerHTML = '';
			el.appendChild(fanMetaBlock(f));
		}, this));
	},

	handleFanTest: function(pwm, mode) {
		mode = mode || (pwm > 0 ? 'manual' : 'off');
		return callFanTest(pwm, mode).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error) {
				ui.addNotification(null, E('p', {}, [ '%s: %s'.format(r.error, r.message || '') ]), 'error');
				return;
			}
			var msg;
			if (mode === 'manual' && pwm === 0)
				msg = _('Inverted polarity test set manual PWM to 0. If the fan spins now but not at 255, the DTS PWM polarity likely needs to be inverted.');
			else if (mode === 'manual')
				msg = _('Fan test set manual PWM to %d. If the fan still does not spin, try Inverted full-speed test and check fan polarity, connector seating, and whether this is a 5V 2-wire fan.').format(pwm);
			else
				msg = _('Fan test stopped the fan output.');
			ui.addNotification(null, E('p', {}, [
				msg
			]), mode === 'manual' ? 'warning' : 'info');
			return this.handleFanRefresh();
		}, this));
	},

	readOledFormConfig: function() {
		function flag(id) {
			var el = document.getElementById(id);
			return el && el.checked ? '1' : '0';
		}

		function val(id, fallback) {
			var el = document.getElementById(id);
			return el ? String(el.value || fallback || '') : String(fallback || '');
		}

		return {
			enable: flag('periph-oled-enable'),
			path: val('periph-oled-path', '/dev/i2c-1'),
			chip: val('periph-oled-chip', 'ssd1306_128x32'),
			rotate: flag('periph-oled-rotate'),
			date: flag('periph-oled-date'),
			lanip: flag('periph-oled-lanip'),
			ipifname: val('periph-oled-ipifname', 'br-lan'),
			cputemp: flag('periph-oled-cputemp'),
			cpufreq: flag('periph-oled-cpufreq'),
			netspeed: flag('periph-oled-netspeed'),
			netsource: val('periph-oled-netsource', 'br-lan'),
			time: val('periph-oled-time', '60'),
			scroll: flag('periph-oled-scroll'),
			text: val('periph-oled-text', 'CM5'),
			showmenu: '1'
		};
	},

	handleOledSave: function(restart) {
		if (isReadonlyView)
			return Promise.resolve();
		var cfg = this.readOledFormConfig();
		return callOledSet(cfg).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error) {
				ui.addNotification(null, E('p', {}, [ r.message || r.error ]), 'error');
				return;
			}
			if (!restart) {
				ui.addNotification(null, E('p', {}, [ _('OLED settings saved.') ]), 'info');
				return this.handleOledRefresh();
			}
			return callOledService('restart').then(L.bind(function(sr) {
				sr = rpcData(sr, {});
				if (sr.error)
					ui.addNotification(null, E('p', {}, [ sr.message || sr.error ]), 'error');
				else
					ui.addNotification(null, E('p', {}, [ _('OLED settings saved and service restarted.') ]), 'info');
				return this.handleOledRefresh();
			}, this));
		}, this));
	},

	handleOledRefresh: function() {
		return callOledGet().then(L.bind(function(o) {
			o = rpcData(o, {});
			var el = document.getElementById('periph-oled-meta');
			if (el) {
				el.innerHTML = '';
				el.appendChild(oledMetaBlock(o));
			}
		}, this));
	},

	handleOledDetect: function() {
		var sel = document.getElementById('periph-oled-path');
		var out = document.getElementById('periph-oled-detect');
		if (!sel || !out)
			return Promise.resolve();
		var bus = oledBusNumber(sel.value);
		out.textContent = _('Scanning bus %s…').format(bus);
		return callOledDetect(bus).then(function(r) {
			r = rpcData(r, {});
			if (r.error) {
				out.textContent = r.message || r.error;
				return;
			}
			out.textContent = r.output || _('No output from i2cdetect.');
		}).catch(function(e) {
			out.textContent = String(e);
		});
	},

	handleOledService: function(action) {
		return callOledService(action).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error)
				ui.addNotification(null, E('p', {}, [ r.message || r.error ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('OLED service: %s (%s)').format(action, r.running ? _('running') : _('stopped')) ]), 'info');
			return this.handleOledRefresh();
		}, this));
	},

	buildOledTab: function(oled) {
		oled = oled || {};
		var pkgReady = !!(oled.config_present && oled.installed);
		var i2cList = oled.i2c_devices || [];
		if (!i2cList.length)
			i2cList = [ oled.path || '/dev/i2c-1' ];

		var pathOptions = i2cList.map(function(dev) {
			return E('option', {
				'value': dev,
				'selected': dev === (oled.path || '/dev/i2c-1')
			}, [ dev ]);
		});

		function chk(id, label, checked) {
			return E('label', { 'style': 'display:block;margin:.35em 0' }, [
				E('input', {
					'type': 'checkbox',
					'id': id,
					'checked': checked ? 'checked' : null,
					'disabled': isReadonlyView
				}),
				' ',
				label
			]);
		}

		return E('div', { 'data-tab': 'oled', 'data-tab-title': _('OLED display') }, [
			cbiSection(
				_('Board wiring'),
				[
					_('Waveshare 1.3" HAT (SH1106 128×64) on the CM5 FPC uses i2c7 — set chip to sh1106_128x64. Run I2C detect and look for 0x3c before enabling the daemon.')
				],
				[ oledBoardInfoBlock(oled) ]
			),
			cbiSection(
				_('OLED status display'),
				[
					_('Managed by the luci-app-oled userspace daemon (SSD1306 / SH1106). Full screensaver options remain under Services → OLED when the menu is enabled.')
				],
				[
					E('div', { 'id': 'periph-oled-meta', 'class': 'cbi-value-field' }, [ oledMetaBlock(oled) ]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Enable display') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							chk('periph-oled-enable', _('Run OLED daemon on boot'), oled.enable === '1')
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('I2C device') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', {
								'id': 'periph-oled-path',
								'disabled': isReadonlyView
							}, pathOptions),
							' ',
							E('button', {
								'class': 'btn cbi-button-action',
								'click': ui.createHandlerFn(this, 'handleOledDetect'),
								'disabled': isReadonlyView
							}, [ _('Scan bus') ])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Controller chip') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', {
								'id': 'periph-oled-chip',
								'disabled': isReadonlyView
							}, [
								E('option', { 'value': 'ssd1306_128x32', 'selected': (oled.chip || 'ssd1306_128x32') === 'ssd1306_128x32' }, [ _('SSD1306 128×32') ]),
								E('option', { 'value': 'ssd1306_128x64', 'selected': oled.chip === 'ssd1306_128x64' }, [ _('SSD1306 128×64') ]),
								E('option', { 'value': 'sh1106_128x64', 'selected': oled.chip === 'sh1106_128x64' }, [ _('SH1106 128×64 (Waveshare 1.3" HAT)') ])
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('i2cdetect output') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('pre', {
								'id': 'periph-oled-detect',
								'class': 'peripherals-detect-pre'
							}, [ _('Click Scan bus to probe the selected I2C adapter.') ])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Display fields') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							chk('periph-oled-date', _('Date/time'), oled.date === '1'),
							chk('periph-oled-lanip', _('LAN IP'), oled.lanip === '1'),
							chk('periph-oled-cputemp', _('CPU temperature'), oled.cputemp === '1'),
							chk('periph-oled-cpufreq', _('CPU frequency'), oled.cpufreq === '1'),
							chk('periph-oled-netspeed', _('Network speed'), oled.netspeed === '1'),
							chk('periph-oled-rotate', _('180° rotation'), oled.rotate === '1'),
							chk('periph-oled-scroll', _('Scroll text screensaver'), oled.scroll === '1')
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Interfaces') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('label', {}, [ _('IP interface'), ' ',
								E('input', {
									'type': 'text',
									'id': 'periph-oled-ipifname',
									'class': 'cbi-input-text',
									'value': oled.ipifname || 'br-lan',
									'disabled': isReadonlyView
								})
							]),
							E('br'),
							E('label', {}, [ _('Speed interface'), ' ',
								E('input', {
									'type': 'text',
									'id': 'periph-oled-netsource',
									'class': 'cbi-input-text',
									'value': oled.netsource || 'br-lan',
									'disabled': isReadonlyView
								})
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Screensaver') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('label', {}, [ _('Refresh interval (s)'), ' ',
								E('input', {
									'type': 'number',
									'id': 'periph-oled-time',
									'class': 'cbi-input-text',
									'min': 5,
									'max': 600,
									'value': oled.time || '60',
									'disabled': isReadonlyView
								})
							]),
							E('br'),
							E('label', {}, [ _('Scroll text'), ' ',
								E('input', {
									'type': 'text',
									'id': 'periph-oled-text',
									'class': 'cbi-input-text',
									'value': oled.text || 'CM5',
									'disabled': isReadonlyView
								})
							])
						])
					])
				]
			),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-save',
					'click': ui.createHandlerFn(this, 'handleOledSave', false),
					'disabled': isReadonlyView || !pkgReady
				}, [ _('Save') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-apply',
					'click': ui.createHandlerFn(this, 'handleOledSave', true),
					'disabled': isReadonlyView || !pkgReady
				}, [ _('Save & restart') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleOledRefresh')
				}, [ _('Refresh status') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleOledService', 'start'),
					'disabled': isReadonlyView || !pkgReady
				}, [ _('Start') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-reset',
					'click': ui.createHandlerFn(this, 'handleOledService', 'stop'),
					'disabled': isReadonlyView || !pkgReady
				}, [ _('Stop') ])
			])
		]);
	},

	buildFanTab: function(fan) {
		fan = fan || {};
		var pwmVal = fan.pwm_uci != null ? fan.pwm_uci : 128;
		var fanSectionBody = [
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('Current readings') ]),
				E('div', { 'id': 'periph-fan-meta', 'class': 'cbi-value-field' }, [ fanMetaBlock(fan) ])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('Mode') ]),
				E('div', { 'class': 'cbi-value-field' }, [
					E('select', {
						'id': 'periph-fan-mode'
					}, [
						E('option', { 'value': 'auto', 'selected': fan.mode === 'auto' }, [ _('Automatic (thermal)') ]),
						E('option', { 'value': 'manual', 'selected': fan.mode === 'manual' }, [ _('Manual PWM') ]),
						E('option', { 'value': 'off', 'selected': fan.mode === 'off' }, [ _('Off') ])
					])
				])
			]),
			E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, [ _('PWM duty cycle') ]),
				E('div', { 'class': 'cbi-value-field' }, [
					E('input', {
						'type': 'range',
						'id': 'periph-fan-pwm',
						'min': 0,
						'max': 255,
						'value': pwmVal,
						'input': function(ev) {
							var lbl = document.getElementById('periph-fan-pwm-lbl');
							if (lbl)
								lbl.textContent = ev.target.value;
						}
					}),
					' ',
					E('span', { 'id': 'periph-fan-pwm-lbl', 'style': 'font-family:monospace;margin-left:0.5em' }, [ String(pwmVal) ])
				])
			])
		];

		return E('div', { 'data-tab': 'fan', 'data-tab-title': _('Cooling fan') }, [
			cbiSection(
				_('Board wiring'),
				[
					_('The official Orange Pi CM5 Base manual lists the cooling fan as a 5V 2-pin 1.25mm socket and states that fan speed and switching are controlled through PWM.')
				],
				[ fanBoardInfoBlock(fan) ]
			),
			cbiSection(
				_('PWM fan'),
				[
					_('PWM-controlled cooling fan (hwmon name %s). The generated DTS exposes it as a pwm-fan on PWM13 M1 with thermal cooling levels.').format('pwmfan')
				],
				fanSectionBody
			),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-save',
					'click': ui.createHandlerFn(this, 'handleFanApply')
				}, _('Save')),
				' ',
				E('button', {
					'class': 'btn cbi-button-action',
					'click': ui.createHandlerFn(this, 'handleFanRefresh')
				}, _('Refresh readings')),
				' ',
				E('button', {
					'class': 'btn cbi-button-apply',
					'click': ui.createHandlerFn(this, 'handleFanTest', 255, 'manual')
				}, _('Full-speed test')),
				' ',
				E('button', {
					'class': 'btn cbi-button-apply',
					'click': ui.createHandlerFn(this, 'handleFanTest', 0, 'manual')
				}, _('Inverted full-speed test')),
				' ',
				E('button', {
					'class': 'btn cbi-button-reset',
					'click': ui.createHandlerFn(this, 'handleFanTest', 0, 'off')
				}, _('Stop fan'))
			])
		]);
	},

	render: function(data) {
		var irMaps = data.irMaps || { content: '' };
		var irKms = data.irKms || { files: [] };
		var irDev = data.irDev || { devices: [] };
		var diags = data.diags || {};
		var fan = data.fan || {};
		var oled = data.oled || {};

		var devRows = (irDev.devices || []).map(function(d) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ d.id || '' ]),
				E('td', { 'class': 'td' }, [ E('code', { 'class': 'peripherals-code-inline' }, [ d.uevent || '' ]) ])
			]);
		});

		var devTable = E('table', { 'class': 'table' }, [
			tableTitles([ _('Device'), _('Properties (uevent)') ]),
			E('tbody', {}, devRows)
		]);

		var kmList = E('ul', { 'class': 'peripherals-keymap-list' }, (irKms.files || []).map(function(f) {
			return E('li', {}, [ f ]);
		}));

		var mapsTa = E('textarea', {
			'id': 'periph-ir-maps',
			'class': 'cbi-input-textarea peripherals-ir-maps',
			'disabled': isReadonlyView
		}, [ irMaps.content != null ? irMaps.content : '' ]);

		var tabIr = E('div', { 'data-tab': 'ir', 'data-tab-title': _('Infrared') }, [
			cbiSection(
				_('Onboard IR receiver'),
				[
					_('The CM5 Base includes an onboard infrared receiver. It is wired through PWM input capture, so it is not expected to appear as a normal RC-core device under %s on the current upstream kernel.').format('/sys/class/rc/')
				],
				[ irBoardInfoBlock(irDev) ]
			),
			cbiSection(
				_('PWM/counter capture diagnostics'),
				[
					_('Future RK3588 PWM input-capture support should expose raw capture state through Linux counter devices. This section reports those devices when the kernel and device tree expose them.')
				],
				[ counterDevicesBlock(irDev) ]
			),
			cbiSection(
				_('External RC devices'),
				[ _('Kernel remote control devices (%s) from external gpio-ir-receiver hardware or future compatible device-tree support.').format('/sys/class/rc/') ],
				[
					(irDev.devices || []).length ? devTable : E('p', { 'class': 'alert-message notice' }, [
						_('No external RC devices were found. This is not an error for the onboard CM5 Base IR receiver. If you attach a separate supported receiver, verify its device tree/overlay and that %s and %s are installed.').format('kmod-multimedia-input', 'kmod-ir-gpio-cir')
					])
				]
			),
			cbiSection(
				_('Keymap files'),
				[ _('Files shipped under %s (usually with %s).').format('/etc/rc_keymaps/', 'v4l-utils') ],
				[
					(irKms.files || []).length ? kmList : E('p', { 'class': 'alert-message notice' }, [
						irKms.missing ? _('The directory is missing. Install %s.').format('v4l-utils') : _('No keymap files are installed.')
					])
				]
			),
			cbiSection(
				_('Map configuration'),
				[ _('Contents of %s, which links remotes to keymap files.').format('/etc/rc_maps.cfg') ],
				[
					E('div', { 'class': 'cbi-section-node' }, [
						E('div', { 'class': 'cbi-value' }, [
							E('label', { 'class': 'cbi-value-title' }, [ _('File contents') ]),
							E('div', { 'class': 'cbi-value-field' }, [ mapsTa ])
						])
					]),
					E('div', { 'class': 'cbi-page-actions' }, [
						E('button', {
							'class': 'btn cbi-button-save',
							'click': ui.createHandlerFn(this, 'handleMapsSave'),
							'disabled': isReadonlyView
						}, _('Save')),
						' ',
						E('button', {
							'class': 'btn cbi-button-apply',
							'click': ui.createHandlerFn(this, 'handleIrApply'),
							'disabled': isReadonlyView
						}, _('Apply keymaps'))
					])
				]
			)
		]);

		var viewRoot = E([], [
			E('link', {
				'rel': 'stylesheet',
				'type': 'text/css',
				'href': L.resource('peripherals-theme.css')
			}),
			E('h2', {}, [ _('Peripherals') ]),
			E('p', { 'class': 'cbi-map-descr' }, [
				_('Manage infrared reception, the PWM cooling fan, SSD1306 OLED display, and kernel module diagnostics. Button script editing is handled by the dedicated Buttons app.')
			]),
			E('div', {}, [
				tabIr,
				this.buildFanTab(fan),
				this.buildOledTab(oled),
				E('div', { 'data-tab': 'diagnostics', 'data-tab-title': _('Diagnostics') }, [
					this.buildDiagnosticsSection(diags)
				])
			])
		]);

		ui.tabs.initTabGroup(viewRoot.lastElementChild.childNodes);
		return viewRoot;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
