'use strict';
'require view';
'require rpc';
'require ui';

var callIrMapsGet = rpc.declare({
	object: 'luci.peripherals',
	method: 'irMapsGet',
	expect: { '': {} }
});

var callIrMapsSet = rpc.declare({
	object: 'luci.peripherals',
	method: 'irMapsSet',
	params: ['content'],
	expect: { '': {} }
});

var callIrKeymapsList = rpc.declare({
	object: 'luci.peripherals',
	method: 'irKeymapsList',
	expect: { '': {} }
});

var callIrDevices = rpc.declare({
	object: 'luci.peripherals',
	method: 'irDevices',
	expect: { '': {} }
});

var callIrApply = rpc.declare({
	object: 'luci.peripherals',
	method: 'irApply',
	expect: { '': {} }
});

var callModuleDiagnostics = rpc.declare({
	object: 'luci.peripherals',
	method: 'moduleDiagnostics',
	expect: { '': {} }
});

var callDebugReport = rpc.declare({
	object: 'luci.peripherals',
	method: 'debugReport',
	expect: { '': {} }
});

var callFanGet = rpc.declare({
	object: 'luci.peripherals',
	method: 'fanGet',
	expect: { '': {} }
});

var callFanSet = rpc.declare({
	object: 'luci.peripherals',
	method: 'fanSet',
	params: ['mode', 'pwm'],
	expect: { '': {} }
});

var callFanTest = rpc.declare({
	object: 'luci.peripherals',
	method: 'fanTest',
	params: ['pwm', 'mode'],
	expect: { '': {} }
});

var callOledGet = rpc.declare({
	object: 'luci.peripherals',
	method: 'oledGet',
	expect: { '': {} }
});

var callScanI2c = rpc.declare({
	object: 'luci.peripherals',
	method: 'scanI2c',
	params: ['bus'],
	expect: { '': {} }
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

function periphInjectStyles() {
	return E('link', {
		'rel': 'stylesheet',
		'type': 'text/css',
		'href': L.resource('peripherals-theme.css')
	});
}

function statusCard(label, value) {
	return E('div', { 'class': 'periph-status-card' }, [
		E('div', { 'class': 'periph-status-label' }, [ label ]),
		E('div', { 'class': 'periph-status-value' }, [ value ])
	]);
}

function statusPill(ok, label) {
	return E('span', {
		'class': 'periph-pill ' + (ok ? 'periph-pill--ok' : 'periph-pill--err')
	}, [ label ]);
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

function fanMetaBlock(fan) {
	var diag = (fan || {}).diagnostics || {};
	if (!fan || !fan.present) {
		var hwmon = diag.hwmon || [];

		return E('div', {}, [
			E('p', { 'class': 'alert-message warning' }, [
				_('No PWM fan hwmon device was found. Check the device tree, kernel modules, and that pwm-fan is loaded.')
			]),
			E('div', { 'class': 'periph-status-grid' }, [
				statusCard(_('DT pwm-fan'), diag.dt_pwm_fan ? _('present') : _('missing')),
				statusCard(_('pwm_fan module'), diag.module_state || _('unknown')),
				statusCard(_('Module file'), diag.module_file ? _('present') : _('missing')),
				statusCard(_('Autoload'), diag.autoload ? _('present') : _('missing')),
				statusCard(_('hwmon devices'), hwmon.length ? hwmon.map(function(h) {
					return '%s=%s'.format(h.id || '?', h.name || _('unnamed'));
				}).join(', ') : _('none'))
			])
		]);
	}
	return E('div', { 'class': 'periph-status-grid' }, [
		statusCard(_('PWM duty'), fan.pwm1 != null ? String(fan.pwm1) : '—'),
		statusCard(_('Control mode'), fanEnableModeLabel(fan.pwm1_enable)),
		statusCard(_('RPM'), fan.rpm != null && fan.rpm !== '' ? String(fan.rpm) : _('n/a')),
		statusCard(_('hwmon path'), fan.path || diag.path || '—')
	]);
}

function counterDevicesBlock(irDev) {
	var counters = (irDev || {}).counter_devices || [];
	if (!counters.length) {
		return E('p', { 'class': 'alert-message notice' }, [
			_('No Linux counter devices were found. Counter devices appear when the kernel exposes PWM input-capture hardware.')
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

function i2cBusNumber(path) {
	var m = String(path || '').match(/^\/dev\/i2c-([0-9]+)$/);
	return m ? m[1] : '';
}

function oledMetaBlock(oled) {
	oled = oled || {};
	if (!oled.config_present) {
		return E('p', { 'class': 'alert-message warning' }, [
			_('luci-app-oled is not installed. Install luci-app-oled for SH1106 display support.')
		]);
	}
	if (!oled.installed) {
		return E('p', { 'class': 'alert-message warning' }, [
			_('/etc/config/oled exists but neither oledd nor the legacy oled binary is present. Reinstall luci-app-oled.')
		]);
	}
	var daemon = oled.menu_mode === '1' ? 'oledd' : 'oled';
	return E('div', { 'class': 'periph-status-grid' }, [
		statusCard(_('Daemon'), E('span', {}, [
			daemon,
			' ',
			statusPill(oled.running, oled.running ? _('running') : _('stopped'))
		])),
		statusCard(_('Enabled'), oled.enable === '1' ? _('yes') : _('no')),
		statusCard(_('I2C bus'), oled.path || '—')
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
			summaryParts.push(_('External infrared receiver modules are not loaded. GPIO IR receivers require kmod-ir-gpio-cir.'));

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

	handleI2cRefresh: function() {
		return callOledGet().then(L.bind(function(o) {
			o = rpcData(o, {});
			var el = document.getElementById('periph-i2c-meta');
			if (el) {
				el.innerHTML = '';
				el.appendChild(oledMetaBlock(o));
			}
		}, this));
	},

	handleI2cScan: function() {
		var sel = document.getElementById('periph-i2c-path');
		var out = document.getElementById('periph-i2c-detect');
		if (!sel || !out)
			return Promise.resolve();
		var bus = i2cBusNumber(sel.value);
		if (!bus) {
			out.textContent = _('Select an I2C adapter first.');
			return Promise.resolve();
		}
		out.textContent = _('Scanning bus %s…').format(bus);
		return callScanI2c(bus).then(function(r) {
			r = rpcData(r, {});
			if (r.error) {
				out.textContent = r.message || r.error;
				ui.addNotification(null, E('p', {}, [ r.message || r.error ]), 'error');
				return;
			}
			out.textContent = r.output || _('No output from i2cdetect.');
		}).catch(function(e) {
			out.textContent = String(e);
			ui.addNotification(null, E('p', {}, [ _('I2C scan failed: %s').format(e) ]), 'error');
		});
	},

	buildI2cTab: function(oled) {
		oled = oled || {};
		var i2cList = (oled.i2c_devices || []).slice();
		var configuredPath = oled.path || '';
		var defaultPath = configuredPath || (i2cList.length ? i2cList[0] : '');
		if (configuredPath && i2cList.indexOf(configuredPath) < 0)
			i2cList.unshift(configuredPath);

		var pathOptions = i2cList.map(function(dev) {
			return E('option', {
				'value': dev,
				'selected': dev === defaultPath
			}, [ dev ]);
		});

		var oledAppLink = oled.config_present
			? E('a', {
				'href': L.url('admin/services/oled'),
				'class': 'periph-crosslink'
			}, [ _('Configure display → Services → OLED') ])
			: E('p', { 'class': 'alert-message notice' }, [ _('Install luci-app-oled for display configuration.') ]);

		return E('div', { 'data-tab': 'i2c', 'data-tab-title': _('I2C') }, [
			cbiSection(
				_('OLED status'),
				[
					_('Read-only service and bus state when luci-app-oled is installed. Display settings are in the OLED app.'),
					oledAppLink
				],
				[
					E('div', { 'id': 'periph-i2c-meta' }, [ oledMetaBlock(oled) ])
				]
			),
			cbiSection(
				_('I2C bus scan'),
				[ _('Probe the selected adapter with i2cdetect. Read-only; does not change device configuration.') ],
				[
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('I2C adapter') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							E('select', { 'id': 'periph-i2c-path' }, pathOptions.length ? pathOptions : [
								E('option', { 'value': '' }, [ _('No I2C devices found') ])
							]),
							' ',
							E('button', {
								'class': 'btn cbi-button-action',
								'click': ui.createHandlerFn(this, 'handleI2cScan'),
								'disabled': !pathOptions.length
							}, [ _('Scan bus') ]),
							' ',
							E('button', {
								'class': 'btn cbi-button-action',
								'click': ui.createHandlerFn(this, 'handleI2cRefresh')
							}, [ _('Refresh') ])
						])
					]),
					E('pre', {
						'id': 'periph-i2c-detect',
						'class': 'peripherals-detect-pre'
					}, [ _('Scan output appears here.') ])
				]
			)
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
						'class': 'periph-fan-slider',
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
					E('span', { 'id': 'periph-fan-pwm-lbl', 'class': 'periph-fan-pwm-lbl' }, [ String(pwmVal) ])
				])
			])
		];

		return E('div', { 'data-tab': 'fan', 'data-tab-title': _('Cooling fan') }, [
			cbiSection(
				_('PWM fan control'),
				[ _('Adjust cooling fan mode and PWM duty via the hwmon interface.') ],
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
				_('Counter capture'),
				[ _('Linux counter devices exposed by PWM input-capture drivers, when available.') ],
				[ counterDevicesBlock(irDev) ]
			),
			cbiSection(
				_('RC devices'),
				[ _('Kernel remote-control devices under %s.').format('/sys/class/rc/') ],
				[
					(irDev.devices || []).length ? devTable : E('p', { 'class': 'alert-message notice' }, [
						_('No RC devices found. Attach a gpio-ir-receiver or compatible device and ensure kmod-ir-gpio-cir is installed.')
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

		var viewRoot = E('div', { 'class': 'luci-app-peripherals' }, [
			periphInjectStyles(),
			E('h2', {}, [ _('Peripherals') ]),
			E('p', { 'class': 'cbi-map-descr' }, [
				_('Low-level tuning for infrared, cooling fan, I2C diagnostics, and kernel modules.'),
				' ',
				_('Display settings:'),
				' ',
				E('a', { 'href': L.url('admin/services/oled') }, [ _('Services → OLED') ]),
				'. ',
				_('Button scripts:'),
				' ',
				E('a', { 'href': L.url('admin/system/buttons') }, [ _('System → Buttons') ]),
				'.'
			]),
			E('div', {}, [
				tabIr,
				this.buildFanTab(fan),
				this.buildI2cTab(oled),
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
