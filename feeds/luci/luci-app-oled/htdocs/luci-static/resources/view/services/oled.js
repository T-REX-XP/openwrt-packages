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

var CM5_DEFAULTS = {
	enable: '1',
	path: '/dev/i2c-7',
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
	text: 'CM5'
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

function section(title, descr, body, extraClass) {
	var nodes = [];
	if (title)
		nodes.push(E('h3', { 'class': 'oled-section-title' }, [ title ]));
	if (descr)
		nodes.push(E('p', { 'class': 'cbi-section-descr' }, Array.isArray(descr) ? descr : [ descr ]));
	nodes.push.apply(nodes, body || []);
	return E('div', { 'class': 'cbi-section oled-section' + (extraClass ? ' ' + extraClass : '') }, nodes);
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
			'disabled': isReadonlyView,
			'change': function() { oledSyncLegacyVisibility(); }
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
	return m ? m[1] : '7';
}

function oledSyncLegacyVisibility() {
	var menuMode = document.getElementById('oled-menu-mode');
	var legacy = document.getElementById('oled-legacy-panel');
	if (!menuMode || !legacy)
		return;
	legacy.open = menuMode.checked ? false : legacy.open;
}

function readFormConfig() {
	return {
		enable: flag('oled-enable'),
		path: val('oled-path', CM5_DEFAULTS.path),
		rotate: flag('oled-rotate'),
		menu_mode: flag('oled-menu-mode'),
		menu_timeout: val('oled-menu-timeout', CM5_DEFAULTS.menu_timeout),
		menu_wifi: flag('oled-menu-wifi'),
		menu_interactive: flag('oled-menu-interactive'),
		menu_nav_button: val('oled-nav-button', CM5_DEFAULTS.menu_nav_button),
		menu_select_button: val('oled-select-button', CM5_DEFAULTS.menu_select_button),
		menu_alerts: flag('oled-menu-alerts'),
		autoswitch: flag('oled-autoswitch'),
		from: val('oled-from', CM5_DEFAULTS.from),
		to: val('oled-to', CM5_DEFAULTS.to),
		date: flag('oled-date'),
		lanip: flag('oled-lanip'),
		ipifname: val('oled-ipifname', CM5_DEFAULTS.ipifname),
		cputemp: flag('oled-cputemp'),
		cpufreq: flag('oled-cpufreq'),
		netspeed: flag('oled-netspeed'),
		netsource: val('oled-netsource', CM5_DEFAULTS.netsource),
		time: val('oled-time', CM5_DEFAULTS.time),
		scroll: flag('oled-scroll'),
		text: val('oled-text', CM5_DEFAULTS.text),
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

function renderStatusBlock(st) {
	st = st || {};
	var daemonLabel = st.daemon === 'oledd' ? _('oledd (menu daemon)') : _('oled (legacy screensaver)');
	return E('div', { 'class': 'oled-status-grid', 'id': 'oled-status-panel' }, [
		E('div', { 'class': 'oled-status-card' }, [
			E('div', { 'class': 'oled-status-label' }, [ _('Daemon') ]),
			E('div', { 'class': 'oled-status-value' }, [ daemonLabel, ' ', statusPill(st.running) ])
		]),
		E('div', { 'class': 'oled-status-card' }, [
			E('div', { 'class': 'oled-status-label' }, [ _('Current view') ]),
			E('div', { 'class': 'oled-status-value' }, [ st.view || '—' ])
		]),
		E('div', { 'class': 'oled-status-card' }, [
			E('div', { 'class': 'oled-status-label' }, [ _('Display state') ]),
			E('div', { 'class': 'oled-status-value' }, [
				st.dimmed ? _('Dimmed (idle)') : _('Active'),
				st.menu_interactive ? (' · ' + _('Interactive')) : ''
			])
		]),
		E('div', { 'class': 'oled-status-card' }, [
			E('div', { 'class': 'oled-status-label' }, [ _('I2C path') ]),
			E('div', { 'class': 'oled-status-value' }, [ st.path || '—' ])
		]),
		E('div', { 'class': 'oled-status-card' }, [
			E('div', { 'class': 'oled-status-label' }, [ _('Boot stage') ]),
			E('div', { 'class': 'oled-status-value' }, [ st.boot_stage || _('unknown') ])
		]),
		E('div', { 'class': 'oled-status-card' }, [
			E('div', { 'class': 'oled-status-label' }, [ _('Boot message') ]),
			E('div', { 'class': 'oled-status-value' }, [ st.boot_message || '—' ])
		])
	]);
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
				restart ? _('OLED settings saved and service restarted.') : _('OLED settings saved.')
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
					_('Service %s on %s (%s)').format(action, r.init || 'oled', r.running ? _('running') : _('stopped'))
				]), 'info');
			return this.refreshStatus();
		}, this));
	},

	handleDetect: function() {
		var bus = i2cBusNumber(val('oled-path', CM5_DEFAULTS.path));
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
				ui.addNotification(null, E('p', {}, [ _('RST line released (Waveshare HAT).') ]), 'info');
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
		if (!i2cList.length)
			i2cList = [ cfg.path || CM5_DEFAULTS.path ];

		function pick(key) {
			return cfg[key] != null ? cfg[key] : CM5_DEFAULTS[key];
		}

		var pathOptions = i2cList.map(function(dev) {
			return E('option', {
				'value': dev,
				'selected': dev === pick('path')
			}, [ dev ]);
		});

		var periphLink = E('a', {
			'href': L.url('admin/system/peripherals'),
			'class': 'oled-crosslink'
		}, [ _('Advanced I2C diagnostics → Peripherals') ]);

		var root = E('div', { 'class': 'luci-app-oled' }, [
			oledInjectStyles(),
			E('h2', {}, [ _('OLED display') ]),
			E('p', { 'class': 'cbi-map-descr' }, [
				_('SH1106 128×64 status display for Orange Pi CM5 Base. Menu mode uses oledd for boot splash, rotating views, and button navigation.')
			]),
			section(_('Status'), [
				_('Live daemon and boot state. Status refreshes every few seconds.')
			], [
				renderStatusBlock(st),
				E('div', { 'class': 'cbi-page-actions oled-inline-actions' }, [
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
					}, [ _('Refresh') ])
				])
			]),
			section(_('Display & hardware'), [
				_('CM5 Waveshare 1.3" HAT uses /dev/i2c-7. Enable runs oledd on boot when menu mode is on.'),
				periphLink
			], [
				fieldRow(_('Enable display'), flagInput('oled-enable', _('Run OLED on boot'), pick('enable') === '1')),
				fieldRow(_('I2C bus'), E('div', {}, [
					E('select', { 'id': 'oled-path', 'disabled': isReadonlyView }, pathOptions),
					' ',
					E('button', {
						'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, 'handleDetect'),
						'disabled': isReadonlyView
					}, [ _('Scan bus') ]),
					E('pre', {
						'id': 'oled-detect-out',
						'class': 'oled-detect-pre'
					}, [ _('Optional: scan shows addresses on the selected bus.') ])
				])),
				fieldRow(_('Panel rotation'), flagInput('oled-rotate', _('180° rotation'), pick('rotate') === '1')),
				fieldRow(_('RST release'), E('div', {}, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, 'handleRst'),
						'disabled': isReadonlyView || !st.rst_script
					}, [ _('Release Waveshare RST (GPIO)') ]),
					E('p', { 'class': 'cbi-value-description' }, [
						_('Runs cm5-waveshare-rst.sh on CM5. Safe to use after wiring changes or if the panel stays blank.')
					])
				]))
			]),
			section(_('Menu mode'), [
				_('Interactive menu is off by default on CM5 (auto-rotate views). Turn on interactive mode for button-driven menus.')
			], [
				fieldRow(_('Menu mode (oledd)'), flagInput('oled-menu-mode', _('Use oledd menu daemon (recommended)'), pick('menu_mode') === '1')),
				fieldRow(_('View timeout (s)'), E('input', {
					'type': 'number',
					'id': 'oled-menu-timeout',
					'class': 'cbi-input-text',
					'min': 3,
					'max': 120,
					'value': pick('menu_timeout'),
					'disabled': isReadonlyView
				}), _('Seconds per auto-rotated view (Boot / System / Ports / WiFi).')),
				fieldRow(_('WiFi view'), flagInput('oled-menu-wifi', _('Include WiFi status view'), pick('menu_wifi') === '1')),
				fieldRow(_('Interactive menu'), flagInput('oled-menu-interactive', _('Button-driven menu (disable auto-rotate)'), pick('menu_interactive') === '1')),
				fieldRow(_('Status alerts'), flagInput('oled-menu-alerts', _('WAN-down and high-load banners'), pick('menu_alerts') === '1'))
			]),
			section(_('Button navigation'), [
				_('CM5 defaults: MaskROM (BTN_2) advances screens; USERKEY (WPS) selects items when interactive mode is on.')
			], [
				fieldRow(_('Screen navigation'), E('select', {
					'id': 'oled-nav-button',
					'disabled': isReadonlyView
				}, [
					E('option', { 'value': 'BTN_2', 'selected': pick('menu_nav_button') === 'BTN_2' }, [ _('MaskROM key (BTN_2)') ]),
					E('option', { 'value': 'wps', 'selected': pick('menu_nav_button') === 'wps' }, [ _('USERKEY (WPS)') ])
				])),
				fieldRow(_('Select / OK'), E('select', {
					'id': 'oled-select-button',
					'disabled': isReadonlyView
				}, [
					E('option', { 'value': 'wps', 'selected': pick('menu_select_button') === 'wps' }, [ _('USERKEY (WPS)') ]),
					E('option', { 'value': 'BTN_2', 'selected': pick('menu_select_button') === 'BTN_2' }, [ _('MaskROM key (BTN_2)') ]),
					E('option', { 'value': 'none', 'selected': pick('menu_select_button') === 'none' }, [ _('None') ])
				]))
			]),
			E('details', {
				'id': 'oled-legacy-panel',
				'class': 'oled-legacy-panel cbi-section',
				'open': pick('menu_mode') !== '1' ? 'open' : null
			}, [
				E('summary', { 'class': 'oled-legacy-summary' }, [ _('Legacy screensaver (advanced)') ]),
				E('div', { 'class': 'oled-legacy-body' }, [
					E('p', { 'class': 'cbi-section-descr' }, [
						_('Used when menu mode is off. The legacy /usr/bin/oled daemon draws screensaver animations and status fields.')
					]),
					fieldRow(_('Auto time window'), flagInput('oled-autoswitch', _('Enable auto switch by time'), pick('autoswitch') === '1')),
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
						'type': 'text',
						'id': 'oled-ipifname',
						'class': 'cbi-input-text',
						'value': pick('ipifname'),
						'disabled': isReadonlyView
					})),
					fieldRow(_('Speed interface'), E('input', {
						'type': 'text',
						'id': 'oled-netsource',
						'class': 'cbi-input-text',
						'value': pick('netsource'),
						'disabled': isReadonlyView
					})),
					fieldRow(_('Refresh interval (s)'), E('input', {
						'type': 'number',
						'id': 'oled-time',
						'class': 'cbi-input-text',
						'min': 5,
						'max': 600,
						'value': pick('time'),
						'disabled': isReadonlyView
					})),
					fieldRow(_('Scroll text'), flagInput('oled-scroll', _('Scroll text screensaver'), pick('scroll') === '1')),
					fieldRow(_('Scroll message'), E('input', {
						'type': 'text',
						'id': 'oled-text',
						'class': 'cbi-input-text',
						'value': pick('text'),
						'disabled': isReadonlyView
					})),
					fieldRow(_('Demo animations'), E('div', { 'class': 'oled-flag-grid' }, [
						flagInput('oled-drawline', _('Draw lines'), pick('drawline') === '1'),
						flagInput('oled-drawrect', _('Draw rectangles'), pick('drawrect') === '1'),
						flagInput('oled-fillrect', _('Fill rectangles'), pick('fillrect') === '1'),
						flagInput('oled-drawcircle', _('Draw circles'), pick('drawcircle') === '1'),
						flagInput('oled-drawroundrect', _('Round rect outline'), pick('drawroundrect') === '1'),
						flagInput('oled-fillroundrect', _('Fill round rects'), pick('fillroundrect') === '1'),
						flagInput('oled-drawtriangle', _('Draw triangles'), pick('drawtriangle') === '1'),
						flagInput('oled-filltriangle', _('Fill triangles'), pick('filltriangle') === '1'),
						flagInput('oled-displaybitmap', _('Mini bitmap'), pick('displaybitmap') === '1'),
						flagInput('oled-displayinvertnormal', _('Invert display'), pick('displayinvertnormal') === '1'),
						flagInput('oled-drawbitmapeg', _('Animated bitmap'), pick('drawbitmapeg') === '1')
					]))
				])
			]),
			section(_('Boot / splash'), [
				_('Preinit writes /tmp/oled_state before oledd starts. Boot view shows progress through network ready.')
			], [
				E('table', { 'class': 'table' }, [
					E('tr', { 'class': 'tr table-titles' }, [
						E('th', { 'class': 'th' }, [ _('Property') ]),
						E('th', { 'class': 'th' }, [ _('Value') ])
					]),
					E('tbody', {}, [
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td' }, [ _('Boot stage') ]),
							E('td', { 'class': 'td' }, [ st.boot_stage || '—' ])
						]),
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td' }, [ _('Message') ]),
							E('td', { 'class': 'td' }, [ st.boot_message || '—' ])
						]),
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td' }, [ _('ubus oledd') ]),
							E('td', { 'class': 'td' }, [ st.ubus_available ? _('available') : _('unavailable') ])
						]),
						E('tr', { 'class': 'tr' }, [
							E('td', { 'class': 'td' }, [ _('Preinit hook') ]),
							E('td', { 'class': 'td' }, [ '/lib/preinit/80-oled-preinit' ])
						])
					])
				])
			]),
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
