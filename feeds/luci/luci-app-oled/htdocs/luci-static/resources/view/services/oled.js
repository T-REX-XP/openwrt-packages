'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callGetConfig = rpc.declare({
	object: 'luci.oled',
	method: 'getConfig',
	expect: { '': {} }
});

var callSetConfig = rpc.declare({
	object: 'luci.oled',
	method: 'setConfig',
	params: [ 'config', 'restart' ],
	expect: { '': {} }
});

var callGetStatus = rpc.declare({
	object: 'luci.oled',
	method: 'getStatus',
	expect: { '': {} }
});

var callDetectI2c = rpc.declare({
	object: 'luci.oled',
	method: 'detectI2c',
	params: [ 'bus' ],
	expect: { '': {} }
});

var callReleaseRst = rpc.declare({
	object: 'luci.oled',
	method: 'releaseRst',
	expect: { '': {} }
});

var callServiceControl = rpc.declare({
	object: 'luci.oled',
	method: 'serviceControl',
	params: [ 'action' ],
	expect: { '': {} }
});

var isReadonlyView = !L.hasViewPermission() || null;

var FORM_DEFAULTS = {
	enable: '1',
	rotate: '0',
	menu_mode: '1',
	menu_timeout: '5',
	menu_wifi: '1',
	menu_interactive: '0',
	menu_nav_button: 'BTN_2',
	menu_select_button: 'wps',
	menu_alerts: '1',
	autoswitch: '0',
	from: '0',
	to: '1440',
	date: '0',
	lanip: '0',
	ipifname: 'br-lan',
	cputemp: '0',
	cpufreq: '0',
	netspeed: '0',
	netsource: 'br-lan',
	time: '60',
	scroll: '0',
	text: 'OpenWrt'
};

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

function oledInjectStyles() {
	return E('link', {
		'rel': 'stylesheet',
		'type': 'text/css',
		'href': L.resource('oled-theme.css')
	});
}

function cbiSection(title, descrNodes, bodyNodes, extraClass) {
	var parts = [];
	if (title)
		parts.push(E('h3', {}, [ title ]));
	if (descrNodes && descrNodes.length)
		parts.push(E('p', { 'class': 'cbi-section-descr' }, descrNodes));
	for (var i = 0; i < (bodyNodes || []).length; i++)
		parts.push(bodyNodes[i]);
	var cls = 'cbi-section';
	if (extraClass)
		cls += ' ' + extraClass;
	return E('div', { 'class': cls }, parts);
}

function fieldRow(title, field, descr) {
	var fieldWrap = [ field ];
	if (descr)
		fieldWrap.push(E('div', { 'class': 'cbi-value-description' }, [ descr ]));
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, [ title ]),
		E('div', { 'class': 'cbi-value-field' }, fieldWrap)
	]);
}

function timeSelect(id, selected) {
	var opts = [];
	for (var h = 0; h < 24; h++) {
		for (var m = 0; m < 60; m += 30) {
			var mins = String(h * 60 + m);
			var label = ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
			opts.push(E('option', {
				'value': mins,
				'selected': mins === String(selected) ? 'selected' : null
			}, [ label ]));
		}
	}
	opts.push(E('option', {
		'value': '1440',
		'selected': String(selected) === '1440' ? 'selected' : null
	}, [ '24:00' ]));
	return E('select', { 'id': id, 'disabled': isReadonlyView }, opts);
}

function flagInput(id, label, checked) {
	return E('label', { 'class': 'oled-flag' }, [
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

function val(id, fallback) {
	var el = document.getElementById(id);
	return el ? String(el.value || '') : String(fallback || '');
}

function flag(id) {
	var el = document.getElementById(id);
	return el && el.checked ? '1' : '0';
}

function i2cBusNumber(path) {
	var m = String(path || '').match(/^\/dev\/i2c-([0-9]+)$/);
	return m ? m[1] : '0';
}

function readFormConfig() {
	return {
		enable: flag('oled-enable'),
		path: val('oled-path'),
		rotate: flag('oled-rotate'),
		menu_mode: flag('oled-menu-mode'),
		menu_timeout: val('oled-menu-timeout', FORM_DEFAULTS.menu_timeout),
		menu_wifi: flag('oled-menu-wifi'),
		menu_interactive: flag('oled-menu-interactive'),
		menu_nav_button: val('oled-nav-button', FORM_DEFAULTS.menu_nav_button),
		menu_select_button: val('oled-select-button', FORM_DEFAULTS.menu_select_button),
		menu_alerts: flag('oled-menu-alerts'),
		autoswitch: flag('oled-autoswitch'),
		from: val('oled-from', FORM_DEFAULTS.from),
		to: val('oled-to', FORM_DEFAULTS.to),
		date: flag('oled-date'),
		lanip: flag('oled-lanip'),
		ipifname: val('oled-ipifname', FORM_DEFAULTS.ipifname),
		cputemp: flag('oled-cputemp'),
		cpufreq: flag('oled-cpufreq'),
		netspeed: flag('oled-netspeed'),
		netsource: val('oled-netsource', FORM_DEFAULTS.netsource),
		time: val('oled-time', FORM_DEFAULTS.time),
		scroll: flag('oled-scroll'),
		text: val('oled-text', FORM_DEFAULTS.text),
		drawline: flag('oled-drawline'),
		drawrect: flag('oled-drawrect'),
		fillrect: flag('oled-fillrect'),
		drawcircle: flag('oled-drawcircle'),
		drawroundrect: flag('oled-drawroundrect'),
		fillroundrect: flag('oled-fillroundrect'),
		drawtriangle: flag('oled-drawtriangle'),
		filltriangle: flag('oled-filltriangle'),
		displaybitmap: flag('oled-displaybitmap'),
		displayinvertnormal: flag('oled-displayinvertnormal'),
		drawbitmapeg: flag('oled-drawbitmapeg')
	};
}

function statusPill(running, label) {
	return E('span', {
		'class': 'oled-pill ' + (running ? 'oled-pill--ok' : 'oled-pill--err')
	}, [ label || (running ? _('Running') : _('Stopped')) ]);
}

function statusCard(label, value) {
	return E('div', { 'class': 'oled-status-card' }, [
		E('div', { 'class': 'oled-status-label' }, [ label ]),
		E('div', { 'class': 'oled-status-value' }, [ value ])
	]);
}

function renderStatusBlock(st) {
	st = st || {};
	var daemonLabel = st.daemon === 'oledd' ? _('oledd (menu)') : _('oled (legacy)');
	return E('div', { 'class': 'oled-status-grid', 'id': 'oled-status-panel' }, [
		statusCard(_('Daemon'), E('span', {}, [ daemonLabel, ' ', statusPill(st.running) ])),
		statusCard(_('Current view'), st.view || '—'),
		statusCard(_('Display'), st.dimmed ? _('Dimmed') : _('Active')),
		statusCard(_('I2C bus'), st.path || '—'),
		statusCard(_('Boot stage'), st.boot_stage || _('unknown')),
		statusCard(_('Boot message'), st.boot_message || '—')
	]);
}

function renderLegacyFields(pick) {
	return [
		fieldRow(_('Time window'), flagInput('oled-autoswitch', _('Limit to hours'), pick('autoswitch') === '1')),
		fieldRow(_('Active hours'), E('div', { 'class': 'oled-time-range' }, [
			E('label', {}, [ _('From'), ' ', timeSelect('oled-from', pick('from')) ]),
			E('label', {}, [ _('To'), ' ', timeSelect('oled-to', pick('to')) ])
		])),
		fieldRow(_('Status fields'), E('div', { 'class': 'oled-flag-grid' }, [
			flagInput('oled-date', _('Date/time'), pick('date') === '1'),
			flagInput('oled-lanip', _('LAN IP'), pick('lanip') === '1'),
			flagInput('oled-cputemp', _('CPU temperature'), pick('cputemp') === '1'),
			flagInput('oled-cpufreq', _('CPU frequency'), pick('cpufreq') === '1'),
			flagInput('oled-netspeed', _('Network speed'), pick('netspeed') === '1')
		])),
		fieldRow(_('IP interface'), E('input', {
			'type': 'text', 'id': 'oled-ipifname', 'class': 'cbi-input-text',
			'value': pick('ipifname'), 'disabled': isReadonlyView
		})),
		fieldRow(_('Speed interface'), E('input', {
			'type': 'text', 'id': 'oled-netsource', 'class': 'cbi-input-text',
			'value': pick('netsource'), 'disabled': isReadonlyView
		})),
		fieldRow(_('Refresh interval'), E('input', {
			'type': 'number', 'id': 'oled-time', 'class': 'cbi-input-text',
			'min': 5, 'max': 600, 'value': pick('time'), 'disabled': isReadonlyView
		}), _('Seconds between screen updates.')),
		fieldRow(_('Scroll text'), flagInput('oled-scroll', _('Enable scroll'), pick('scroll') === '1')),
		fieldRow(_('Message'), E('input', {
			'type': 'text', 'id': 'oled-text', 'class': 'cbi-input-text',
			'value': pick('text'), 'disabled': isReadonlyView
		})),
		fieldRow(_('Demo animations'), E('div', { 'class': 'oled-flag-grid' }, [
			flagInput('oled-drawline', _('Lines'), pick('drawline') === '1'),
			flagInput('oled-drawrect', _('Rectangles'), pick('drawrect') === '1'),
			flagInput('oled-fillrect', _('Filled rects'), pick('fillrect') === '1'),
			flagInput('oled-drawcircle', _('Circles'), pick('drawcircle') === '1'),
			flagInput('oled-drawroundrect', _('Round rects'), pick('drawroundrect') === '1'),
			flagInput('oled-fillroundrect', _('Filled round rects'), pick('fillroundrect') === '1'),
			flagInput('oled-drawtriangle', _('Triangles'), pick('drawtriangle') === '1'),
			flagInput('oled-filltriangle', _('Filled triangles'), pick('filltriangle') === '1'),
			flagInput('oled-displaybitmap', _('Bitmap'), pick('displaybitmap') === '1'),
			flagInput('oled-displayinvertnormal', _('Invert'), pick('displayinvertnormal') === '1'),
			flagInput('oled-drawbitmapeg', _('Animated bitmap'), pick('drawbitmapeg') === '1')
		]))
	];
}

return view.extend({
	load: function() {
		return Promise.all([
			callGetConfig(),
			callGetStatus()
		]).then(function(parts) {
			return {
				config: rpcData(parts[0], {}).config || {},
				status: rpcData(parts[1], {})
			};
		});
	},

	handleOledSave: function(restart) {
		if (isReadonlyView)
			return Promise.resolve();
		return callSetConfig(readFormConfig(), !!restart).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error) {
				ui.addNotification(null, E('p', {}, [ r.message || r.error ]), 'error');
				return;
			}
			ui.addNotification(null, E('p', {}, [
				restart ? _('Settings saved and service restarted.') : _('Settings saved.')
			]), 'info');
			return this.refreshStatus();
		}, this));
	},

	handleService: function(action) {
		return callServiceControl(action).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error)
				ui.addNotification(null, E('p', {}, [ r.message || r.error ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [
					_('Service %s: %s').format(action, r.running ? _('running') : _('stopped'))
				]), 'info');
			return this.refreshStatus();
		}, this));
	},

	handleDetect: function() {
		var bus = i2cBusNumber(val('oled-path'));
		var out = document.getElementById('oled-detect-out');
		if (out)
			out.textContent = _('Scanning bus %s…').format(bus);
		return callDetectI2c(bus).then(function(r) {
			r = rpcData(r, {});
			if (!out)
				return;
			out.textContent = r.error ? (r.message || r.error) : (r.output || _('No output'));
		});
	},

	handleRst: function() {
		return callReleaseRst().then(function(r) {
			r = rpcData(r, {});
			if (r.error)
				ui.addNotification(null, E('p', {}, [ r.error ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('Display reset signal sent.') ]), 'info');
		});
	},

	refreshStatus: function() {
		return callGetStatus().then(L.bind(function(st) {
			st = rpcData(st, {});
			var panel = document.getElementById('oled-status-panel');
			if (panel && panel.parentNode) {
				var next = renderStatusBlock(st);
				panel.parentNode.replaceChild(next, panel);
			}
		}, this));
	},

	render: function(data) {
		var cfg = data.config || {};
		var st = data.status || {};
		var i2cList = cfg.i2c_devices || [];
		var defaultPath = cfg.path || (i2cList.length ? i2cList[0] : '');
		if (!i2cList.length && defaultPath)
			i2cList = [ defaultPath ];

		function pick(key) {
			return cfg[key] != null ? cfg[key] : FORM_DEFAULTS[key];
		}

		var pathOptions = i2cList.map(function(dev) {
			return E('option', {
				'value': dev,
				'selected': dev === (pick('path') || defaultPath)
			}, [ dev ]);
		});

		var periphLink = E('a', {
			'href': L.url('admin/system/peripherals'),
			'class': 'oled-crosslink'
		}, [ _('I2C diagnostics → Peripherals') ]);

		var serviceButtons = E('div', { 'class': 'cbi-page-actions oled-inline-actions' }, [
			E('button', {
				'class': 'btn cbi-button-action',
				'click': ui.createHandlerFn(this, 'handleService', 'restart'),
				'disabled': isReadonlyView
			}, [ _('Restart') ]),
			' ',
			E('button', {
				'class': 'btn cbi-button-action',
				'click': ui.createHandlerFn(this, 'handleService', 'start'),
				'disabled': isReadonlyView
			}, [ _('Start') ]),
			' ',
			E('button', {
				'class': 'btn cbi-button-reset',
				'click': ui.createHandlerFn(this, 'handleService', 'stop'),
				'disabled': isReadonlyView
			}, [ _('Stop') ]),
			' ',
			E('button', {
				'class': 'btn cbi-button-action',
				'click': ui.createHandlerFn(this, 'refreshStatus')
			}, [ _('Refresh status') ])
		]);

		var root = E('div', { 'class': 'luci-app-oled' }, [
			oledInjectStyles(),
			E('h2', {}, [ _('OLED display') ]),
			E('p', { 'class': 'cbi-map-descr' }, [
				_('SH1106 128×64 I2C display — menu, boot splash, and button navigation.')
			]),

			cbiSection(_('Status'), [
				_('Live daemon and boot state. Refreshes automatically every few seconds.')
			], [
				renderStatusBlock(st),
				E('div', { 'class': 'oled-boot-grid' }, [
					statusCard(_('ubus'), st.ubus_available ? _('available') : _('unavailable')),
					statusCard(_('Interactive'), st.menu_interactive ? _('yes') : _('no')),
					statusCard(_('Preinit hook'), st.preinit_hook || _('not installed'))
				])
			]),

			cbiSection(_('Service control'), [
				_('Start, stop, or restart the display daemon without saving other settings.')
			], [ serviceButtons ]),

			cbiSection(_('Display & I2C'), [
				_('Enable the display, select the I2C adapter, and adjust hardware options.'),
				' ', periphLink
			], [
				fieldRow(_('Enable'), flagInput('oled-enable', _('Run on boot'), pick('enable') === '1')),
				fieldRow(_('I2C bus'), E('div', {}, [
					E('select', { 'id': 'oled-path', 'disabled': isReadonlyView || !pathOptions.length }, pathOptions.length ? pathOptions : [
						E('option', { 'value': '' }, [ _('No I2C devices') ])
					]),
					' ',
					E('button', {
						'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, 'handleDetect'),
						'disabled': isReadonlyView || !pathOptions.length
					}, [ _('Scan bus') ]),
					E('pre', { 'id': 'oled-detect-out', 'class': 'oled-detect-pre' }, [ _('Scan output appears here.') ])
				]), _('Quick scan of the selected bus. For full diagnostics use Peripherals.')),
				fieldRow(_('Rotation'), flagInput('oled-rotate', _('180° rotation'), pick('rotate') === '1')),
				fieldRow(_('Reset display'), E('div', {}, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, 'handleRst'),
						'disabled': isReadonlyView || !st.rst_led
					}, [ _('Send RST pulse') ]),
					E('p', { 'class': 'cbi-value-description' }, [
						_('Release the display reset GPIO when available on this board. Use after wiring changes or if the display stays blank.')
					])
				]))
			]),

			cbiSection(_('Menu & buttons'), [
				_('Menu mode uses oledd for boot splash, rotating views, and button navigation.')
			], [
				fieldRow(_('Menu mode'), flagInput('oled-menu-mode', _('Use oledd menu daemon'), pick('menu_mode') === '1')),
				fieldRow(_('View timeout'), E('input', {
					'type': 'number',
					'id': 'oled-menu-timeout',
					'class': 'cbi-input-text',
					'min': 0,
					'max': 120,
					'value': pick('menu_timeout'),
					'disabled': isReadonlyView
				}), _('Seconds per view when auto-rotating. Set 0 to disable idle dimming timeout side-effects.')),
				fieldRow(_('WiFi view'), flagInput('oled-menu-wifi', _('Show WiFi status'), pick('menu_wifi') === '1')),
				fieldRow(_('Interactive menu'), flagInput('oled-menu-interactive', _('Button-driven menu'), pick('menu_interactive') === '1')),
				fieldRow(_('Status alerts'), flagInput('oled-menu-alerts', _('WAN-down and load banners'), pick('menu_alerts') === '1')),
				E('fieldset', { 'class': 'oled-fieldset' }, [
					E('legend', {}, [ _('Button mapping') ]),
					fieldRow(_('Navigate screens'), E('select', { 'id': 'oled-nav-button', 'disabled': isReadonlyView }, [
						E('option', { 'value': 'BTN_2', 'selected': pick('menu_nav_button') === 'BTN_2' }, [ _('GPIO button 2 (BTN_2)') ]),
						E('option', { 'value': 'wps', 'selected': pick('menu_nav_button') === 'wps' }, [ _('WPS key') ])
					])),
					fieldRow(_('Select / OK'), E('select', { 'id': 'oled-select-button', 'disabled': isReadonlyView }, [
						E('option', { 'value': 'wps', 'selected': pick('menu_select_button') === 'wps' }, [ _('WPS key') ]),
						E('option', { 'value': 'BTN_2', 'selected': pick('menu_select_button') === 'BTN_2' }, [ _('GPIO button 2 (BTN_2)') ]),
						E('option', { 'value': 'none', 'selected': pick('menu_select_button') === 'none' }, [ _('None') ])
					]))
				])
			]),

			cbiSection(_('Legacy screensaver'), [
				_('These options apply only when menu mode is disabled. Most installations use menu mode (oledd) and can ignore this section.')
			], renderLegacyFields(pick), 'oled-section-legacy'),

			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-save',
					'click': ui.createHandlerFn(this, 'handleOledSave', false),
					'disabled': isReadonlyView
				}, [ _('Save') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-apply',
					'click': ui.createHandlerFn(this, 'handleOledSave', true),
					'disabled': isReadonlyView
				}, [ _('Save & restart') ])
			])
		]);

		poll.add(L.bind(this.refreshStatus, this), 5);

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
