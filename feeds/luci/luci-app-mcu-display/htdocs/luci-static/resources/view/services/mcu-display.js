'use strict';
'require view';
'require rpc';
'require ui';

var callGetConfig = rpc.declare({
	object: 'luci.mcu-display',
	method: 'getConfig',
	expect: { '': {} }
});

var callSetConfig = rpc.declare({
	object: 'luci.mcu-display',
	method: 'setConfig',
	params: [ 'config', 'restart' ],
	expect: { '': {} }
});

var callGetStatus = rpc.declare({
	object: 'luci.mcu-display',
	method: 'getStatus',
	expect: { '': {} }
});

var callGetPageList = rpc.declare({
	object: 'luci.mcu-display',
	method: 'getPageList',
	expect: { '': {} }
});

var callPageControl = rpc.declare({
	object: 'luci.mcu-display',
	method: 'pageControl',
	params: [ 'action', 'page_id' ],
	expect: { '': {} }
});

var callServiceControl = rpc.declare({
	object: 'luci.mcu-display',
	method: 'serviceControl',
	params: [ 'action' ],
	expect: { '': {} }
});

var callGetLogs = rpc.declare({
	object: 'luci.mcu-display',
	method: 'getLogs',
	params: [ 'limit' ],
	expect: { '': {} }
});

var isReadonly = !L.hasViewPermission() || null;

var FORM_DEFAULTS = {
	enable: '1',
	path: '/dev/ttyS2',
	baud: '115200',
	wire_format: 'json',
	demo_mode: '0',
	pages: '/etc/mcud/pages.json',
	wan_if: 'wan',
	lan_if: 'br-lan',
	wifi_if: 'wlan0',
	interval_system: '1000',
	interval_network: '2000',
	push_alerts: '1',
	max_line: '4096',
	screen_timeout: '60',
	screen_timeout_mode: 'off',
	log_level: 'info',
	debug: '0',
	debug_serial: '0',
	menu_nav_button: 'BTN_2',
	menu_select_button: 'wps',
	menu_wps: '0'
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

function cbiSection(title, descrNodes, bodyNodes) {
	return E('div', { 'class': 'cbi-section' }, [
		title ? E('h3', {}, title) : '',
		descrNodes && descrNodes.length ? E('div', { 'class': 'cbi-section-descr' }, descrNodes) : '',
		E('div', { 'class': 'cbi-section-node' }, bodyNodes)
	]);
}

function fieldRow(title, field, descr) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, title),
		E('div', { 'class': 'cbi-value-field' }, [
			field,
			descr ? E('div', { 'class': 'cbi-value-description' }, descr) : ''
		])
	]);
}

function optionSelected(value, current) {
	return String(value) === String(current) ? 'selected' : null;
}

function disableIf(cond) {
	return cond ? true : null;
}

function flagInput(id, label, checked) {
	return E('label', { 'class': 'mcu-flag' }, [
		E('input', {
			'type': 'checkbox',
			'id': id,
			'checked': checked ? 'checked' : null,
			'disabled': isReadonly
		}),
		' ',
		label
	]);
}

function serialPortOptions(cfg) {
	cfg = cfg || {};
	var ports = (cfg.serial_ports || []).slice();
	var current = pick(cfg, 'path');
	var opts = [];
	var seen = {};
	var i;

	if (current && ports.indexOf(current) < 0)
		ports.unshift(current);

	ports.sort(function(a, b) {
		return L.naturalCompare(a, b);
	});

	for (i = 0; i < ports.length; i++) {
		if (!ports[i] || seen[ports[i]])
			continue;
		seen[ports[i]] = true;
		opts.push([ ports[i], ports[i] ]);
	}

	if (!opts.length)
		opts.push([ current || '/dev/ttyS2', current || '/dev/ttyS2' ]);

	return opts;
}

function selectInput(id, options, current) {
	var opts = [];
	for (var i = 0; i < options.length; i++) {
		opts.push(E('option', {
			'value': options[i][0],
			'selected': optionSelected(options[i][0], current)
		}, options[i][1]));
	}
	return E('select', { 'id': id, 'class': 'cbi-input-select', 'disabled': isReadonly }, opts);
}

function textInput(id, value, attrs) {
	var el = {
		'type': 'text',
		'id': id,
		'class': 'cbi-input-text',
		'value': value || '',
		'disabled': isReadonly
	};
	if (attrs) {
		for (var k in attrs) {
			if (Object.prototype.hasOwnProperty.call(attrs, k))
				el[k] = attrs[k];
		}
	}
	return E('input', el);
}

function val(id, fallback) {
	var el = document.getElementById(id);
	return el ? String(el.value || '') : String(fallback || '');
}

function flag(id) {
	var el = document.getElementById(id);
	return el && el.checked ? '1' : '0';
}

function readFormConfig() {
	return {
		enable: flag('mcu-enable'),
		path: val('mcu-path'),
		baud: val('mcu-baud'),
		wire_format: val('mcu-wire-format'),
		demo_mode: flag('mcu-demo-mode'),
		pages: val('mcu-pages'),
		wan_if: val('mcu-wan-if'),
		lan_if: val('mcu-lan-if'),
		wifi_if: val('mcu-wifi-if'),
		interval_system: val('mcu-interval-system'),
		interval_network: val('mcu-interval-network'),
		push_alerts: flag('mcu-push-alerts'),
		max_line: val('mcu-max-line'),
		screen_timeout: val('mcu-screen-timeout'),
		screen_timeout_mode: val('mcu-screen-timeout-mode'),
		log_level: val('mcu-log-level'),
		debug: flag('mcu-debug'),
		debug_serial: flag('mcu-debug-serial'),
		menu_nav_button: val('mcu-menu-nav-button'),
		menu_select_button: val('mcu-menu-select-button'),
		menu_wps: flag('mcu-menu-wps')
	};
}

function pick(cfg, key) {
	cfg = cfg || {};
	return cfg[key] != null && cfg[key] !== '' ? String(cfg[key]) : String(FORM_DEFAULTS[key] || '');
}

return view.extend({
	load: function() {
		return Promise.all([
			callGetConfig(),
			callGetStatus(),
			callGetPageList()
		]).then(function(parts) {
			return {
				config: rpcData(parts[0], {}),
				status: rpcData(parts[1], {}),
				pages: rpcData(parts[2], {})
			};
		});
	},

	render: function(data) {
		var cfg = data.config || {};
		var status = data.status || {};
		var pages = data.pages || {};
		var self = this;

		var tabHost = E('div', { 'class': 'mcu-tab-host' }, [
			this.buildStatusTab(status, cfg),
			this.buildPagesTab(status, pages, cfg),
			this.buildConfigTab(cfg),
			this.buildDebugTab()
		]);

		var root = E('div', { 'class': 'luci-app-mcu-display' }, [
			E('link', { rel: 'stylesheet', href: L.resource('mcu-display-theme.css') }),
			E('h2', {}, _('MCU Display')),
			E('p', { 'class': 'hint' }, _('UART bridge to an ESP32 smart display. Connect the yellow ESP32 board to the CM5 debug UART (/dev/ttyS2) at 115200 8N1, or use a USB serial adapter (/dev/ttyUSB0). Physical buttons (USERKEY / MaskROM) navigate pages when mcudd is running.')),
			tabHost
		]);

		ui.tabs.initTabGroup(tabHost.childNodes);
		return root;
	},

	buildStatusTab: function(status, cfg) {
		var self = this;
		var running = status.running;
		var portOk = status.port_exists;
		var cfgOk = status.config_complete;
		var btns = E('div', { 'class': 'cbi-page-actions' });
		[ 'start', 'stop', 'restart' ].forEach(function(action) {
			btns.appendChild(E('button', {
				'class': 'cbi-button cbi-button-action',
				click: ui.createHandlerFn(self, function() {
					return callServiceControl(action).then(function() {
						location.reload();
					});
				}),
				disabled: isReadonly
			}, _(action)));
		});

		var bootLine = status.boot_stage ?
			_('Boot: %s — %s').format(status.boot_stage, status.boot_message || '') :
			_('Boot stage unknown');

		return E('div', { 'data-tab': 'status', 'data-tab-title': _('Status') }, [
			cbiSection(_('Daemon status'), [], [
				E('ul', {}, [
					E('li', {}, [
						_('Daemon: '),
						E('span', { 'class': running ? 'mcu-status-ok' : 'mcu-status-bad' },
							running ? _('running') : _('stopped'))
					]),
					E('li', {}, [
						_('Serial device: '),
						E('span', { 'class': 'mcu-mono' }, cfg.path || '—')
					]),
					E('li', {}, [
						_('Device present: '),
						E('span', { 'class': portOk ? 'mcu-status-ok' : 'mcu-status-bad' },
							portOk ? _('yes') : _('no'))
					]),
					E('li', {}, [
						_('UCI complete: '),
						E('span', { 'class': cfgOk ? 'mcu-status-ok' : 'mcu-status-bad' },
							cfgOk ? _('yes') : _('no'))
					]),
					E('li', {}, [
						_('Command FIFO: '),
						E('span', { 'class': status.fifo_ok ? 'mcu-status-ok' : 'mcu-status-bad' },
							status.fifo_ok ? _('ready') : _('not available'))
					]),
					E('li', {}, bootLine),
					E('li', {}, [
						_('Active screen: '),
						E('span', { 'class': 'mcu-mono' },
							status.page_title || status.active_screen || '—')
					])
				])
			]),
			cbiSection(_('Service control'), [], [ btns ])
		]);
	},

	buildPagesTab: function(status, pages, cfg) {
		var self = this;
		cfg = cfg || {};
		var pageList = pages.pages || status.pages || [];
		var running = status.running || pages.running;
		var blocked = isReadonly || !running;
		var opts = [];

		for (var i = 0; i < pageList.length; i++) {
			opts.push(E('option', {
				'value': pageList[i].id,
				'selected': optionSelected(pageList[i].id, status.page_id || pages.page_id)
			}, pageList[i].title || pageList[i].id));
		}

		var rows = [];
		for (var j = 0; j < pageList.length; j++) {
			rows.push(E('tr', {}, [
				E('td', { 'class': 'mcu-mono' }, pageList[j].id),
				E('td', {}, pageList[j].title || pageList[j].id),
				E('td', { 'class': 'mcu-mono' }, pageList[j].scope || '')
			]));
		}

		return E('div', { 'data-tab': 'pages', 'data-tab-title': _('Pages') }, [
			cbiSection(_('Screen navigation'), [
				_('Send RDCP screen commands over UART. Previous / next mirror physical button mapping (MaskROM / USERKEY on CM5).')
			], [
				E('div', { 'class': 'mcu-page-controls' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						click: ui.createHandlerFn(self, 'handlePageControl', 'prev'),
						disabled: disableIf(blocked)
					}, _('Previous page')),
					' ',
					E('button', {
						'class': 'btn cbi-button-action',
						click: ui.createHandlerFn(self, 'handlePageControl', 'next'),
						disabled: disableIf(blocked)
					}, _('Next page')),
					' ',
					E('select', {
						'id': 'mcu-page-jump',
						disabled: disableIf(blocked || !pageList.length)
					}, opts.length ? opts : [ E('option', { 'value': '' }, _('No pages')) ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-action',
						click: ui.createHandlerFn(self, 'handlePageGoto'),
						disabled: disableIf(blocked || !pageList.length)
					}, _('Jump to page')),
					' ',
					E('button', {
						'class': 'btn cbi-button-neutral',
						click: ui.createHandlerFn(self, 'handlePageControl', 'boot'),
						disabled: disableIf(blocked)
					}, _('Show boot screen'))
				])
			]),
			cbiSection(_('Configured pages'), [
				_('From %s').format(pick(cfg, 'pages'))
			], [
				pageList.length ?
					E('table', { 'class': 'table' }, [
						E('tr', { 'class': 'tr table-titles' }, [
							E('th', { 'class': 'th' }, _('ID')),
							E('th', { 'class': 'th' }, _('Title')),
							E('th', { 'class': 'th' }, _('Scope'))
						])
					].concat(rows)) :
					E('p', {}, _('No enabled pages in pages.json.'))
			])
		]);
	},

	buildConfigTab: function(cfg) {
		var self = this;
		var portOpts = serialPortOptions(cfg);
		var buttonOpts = [
			[ 'BTN_2', 'MaskROM (BTN_2)' ],
			[ 'wps', 'USERKEY (wps)' ],
			[ 'none', _('Disabled') ]
		];

		return E('div', { 'data-tab': 'config', 'data-tab-title': _('Configuration') }, [
			cbiSection(_('Serial & protocol'), [], [
				fieldRow(_('Enable mcudd'), flagInput('mcu-enable', _('Run mcudd daemon'), pick(cfg, 'enable') === '1')),
				fieldRow(_('Serial device'), selectInput('mcu-path', portOpts, pick(cfg, 'path')),
					_('CM5 debug UART: /dev/ttyS2. USB adapter: /dev/ttyUSB0.')),
				fieldRow(_('Baud rate'), selectInput('mcu-baud', [
					[ '115200', '115200' ],
					[ '230400', '230400' ],
					[ '460800', '460800' ],
					[ '921600', '921600' ]
				], pick(cfg, 'baud')), _('Must match ESP32 firmware.')),
				fieldRow(_('Wire format'), selectInput('mcu-wire-format', [
					[ 'json', 'JSON' ],
					[ 'msgpack', 'MessagePack (Phase 2)' ]
				], pick(cfg, 'wire_format'))),
				fieldRow(_('Demo alarm data'), flagInput('mcu-demo-mode', _('Use demo metrics'), pick(cfg, 'demo_mode') === '1')),
				fieldRow(_('Pages JSON path'), textInput('mcu-pages', pick(cfg, 'pages')))
			]),
			cbiSection(_('Network interfaces'), [], [
				fieldRow(_('WAN interface'), textInput('mcu-wan-if', pick(cfg, 'wan_if'))),
				fieldRow(_('LAN bridge'), textInput('mcu-lan-if', pick(cfg, 'lan_if'))),
				fieldRow(_('WiFi interface'), textInput('mcu-wifi-if', pick(cfg, 'wifi_if'))),
				fieldRow(_('System poll interval (ms)'), textInput('mcu-interval-system', pick(cfg, 'interval_system'), { type: 'number', min: 100 })),
				fieldRow(_('Network poll interval (ms)'), textInput('mcu-interval-network', pick(cfg, 'interval_network'), { type: 'number', min: 100 })),
				fieldRow(_('Push alerts'), flagInput('mcu-push-alerts', _('Push network alerts'), pick(cfg, 'push_alerts') === '1')),
				fieldRow(_('Max UART line length'), textInput('mcu-max-line', pick(cfg, 'max_line'), { type: 'number', min: 64 }))
			]),
			cbiSection(_('Display & buttons'), [
				_('Physical button mapping for CM5 Base. USERKEY is exposed as wps; MaskROM as BTN_2.')
			], [
				fieldRow(_('Previous page button'), selectInput('mcu-menu-nav-button', buttonOpts, pick(cfg, 'menu_nav_button'))),
				fieldRow(_('Next page button'), selectInput('mcu-menu-select-button', buttonOpts, pick(cfg, 'menu_select_button'))),
				fieldRow(_('WPS on USERKEY'), flagInput('mcu-menu-wps', _('Also run Wi-Fi WPS push-button on USERKEY press'), pick(cfg, 'menu_wps') === '1')),
				fieldRow(_('Screen timeout (seconds)'), textInput('mcu-screen-timeout', pick(cfg, 'screen_timeout'), { type: 'number', min: 0, max: 3600 }), _('0 disables idle timeout on ESP32.')),
				fieldRow(_('Screen timeout action'), selectInput('mcu-screen-timeout-mode', [
					[ 'off', _('Backlight off') ],
					[ 'dim', _('Dim backlight') ],
					[ 'blank', _('Blank screen') ]
				], pick(cfg, 'screen_timeout_mode')))
			]),
			cbiSection(_('Debug & logging'), [], [
				fieldRow(_('Log level'), selectInput('mcu-log-level', [
					[ 'error', _('Error') ],
					[ 'warn', _('Warning') ],
					[ 'info', _('Info') ],
					[ 'debug', _('Debug') ]
				], pick(cfg, 'log_level'))),
				fieldRow(_('Protocol frame logging'), flagInput('mcu-debug', _('Log RDCP frames'), pick(cfg, 'debug') === '1')),
				fieldRow(_('UART trace'), flagInput('mcu-debug-serial', _('Log raw TX/RX lines'), pick(cfg, 'debug_serial') === '1'))
			]),
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-save',
					click: ui.createHandlerFn(self, 'handleSave', false),
					disabled: isReadonly
				}, _('Save')),
				' ',
				E('button', {
					'class': 'btn cbi-button-apply',
					click: ui.createHandlerFn(self, 'handleSave', true),
					disabled: isReadonly
				}, _('Save & Apply'))
			])
		]);
	},

	buildDebugTab: function() {
		return E('div', { 'data-tab': 'debug', 'data-tab-title': _('Debug') }, [
			cbiSection(_('Debug logs'), [
				_('Recent syslog lines tagged mcudd.')
			], [
				fieldRow(_('Line limit'), E('select', { 'id': 'mcu-log-limit' }, [
					E('option', { 'value': '50' }, '50'),
					E('option', { 'value': '100' }, '100'),
					E('option', { 'value': '200', 'selected': 'selected' }, '200'),
					E('option', { 'value': '500' }, '500')
				])),
				E('div', { 'class': 'mcu-log-toolbar' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						click: ui.createHandlerFn(this, 'refreshLogs')
					}, _('Refresh')),
					' ',
					E('button', {
						'class': 'btn cbi-button-neutral',
						click: ui.createHandlerFn(this, 'copyLogs')
					}, _('Copy to clipboard'))
				]),
				E('textarea', {
					'id': 'mcu-debug-log',
					'class': 'mcu-log-pre',
					readonly: 'readonly',
					rows: 16,
					placeholder: _('Click Refresh to load log lines.')
				}, [])
			])
		]);
	},

	handleSave: function(restart) {
		if (isReadonly)
			return Promise.resolve();
		return callSetConfig(readFormConfig(), restart ? '1' : '0').then(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false) {
				ui.addNotification(null, E('p', {}, [ r.message || r.error || _('Save failed.') ]), 'error');
				return;
			}
			ui.addNotification(null, E('p', {}, [
				restart ? _('Settings saved and mcudd restarted.') : _('Settings saved.')
			]), 'info');
			if (restart)
				location.reload();
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Could not save: %s').format(e) ]), 'error');
		});
	},

	handlePageControl: function(action) {
		if (isReadonly)
			return Promise.resolve();
		return callPageControl(action, '').then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false) {
				ui.addNotification(null, E('p', {}, [ r.message || r.error || _('Page control failed.') ]), 'error');
				return;
			}
			ui.addNotification(null, E('p', {}, [ _('Sent %s command to mcudd.').format(action) ]), 'info');
			return callGetStatus().then(L.bind(function(st) {
				st = rpcData(st, {});
				var el = document.querySelector('.luci-app-mcu-display');
				if (!el)
					return;
				ui.addNotification(null, E('p', {}, [
					_('Active screen: %s').format(st.page_title || st.active_screen || '—')
				]), 'info');
			}, this));
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Page control failed: %s').format(e) ]), 'error');
		});
	},

	handlePageGoto: function() {
		var jump = document.getElementById('mcu-page-jump');
		if (!jump || !jump.value)
			return Promise.resolve();
		if (isReadonly)
			return Promise.resolve();
		return callPageControl('goto', jump.value).then(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false)
				ui.addNotification(null, E('p', {}, [ r.message || r.error || _('Jump failed.') ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('Jumped to %s').format(jump.value) ]), 'info');
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Jump failed: %s').format(e) ]), 'error');
		});
	},

	logLimit: function() {
		var el = document.getElementById('mcu-log-limit');
		var n = el ? parseInt(el.value, 10) : 200;
		return (n > 0 && n <= 2000) ? n : 200;
	},

	refreshLogs: function() {
		var ta = document.getElementById('mcu-debug-log');
		if (ta)
			ta.value = _('Loading logs…');
		return callGetLogs(this.logLimit()).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (!ta)
				return;
			if (r.error) {
				ta.value = r.message || r.error;
				ui.addNotification(null, E('p', {}, [ r.message || r.error ]), 'error');
				return;
			}
			ta.value = r.output && r.output.length ? r.output : _('No matching log entries.');
		}, this)).catch(function(e) {
			if (ta)
				ta.value = _('Could not load logs: %s').format(e);
			ui.addNotification(null, E('p', {}, [ _('Could not load logs: %s').format(e) ]), 'error');
		});
	},

	copyLogs: function() {
		var ta = document.getElementById('mcu-debug-log');
		if (!ta || !ta.value)
			return Promise.resolve();
		var text = ta.value;
		var notify = function(ok) {
			ui.addNotification(null, E('p', {}, [
				ok ? _('Log copied to clipboard.') : _('Copy failed — select the text area and copy manually.')
			]), ok ? 'info' : 'warning');
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text).then(function() {
				notify(true);
			}).catch(function() {
				ta.focus();
				ta.select();
				try { notify(document.execCommand('copy')); } catch (err) { notify(false); }
			});
		}
		ta.focus();
		ta.select();
		try { notify(document.execCommand('copy')); } catch (err) { notify(false); }
		return Promise.resolve();
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
