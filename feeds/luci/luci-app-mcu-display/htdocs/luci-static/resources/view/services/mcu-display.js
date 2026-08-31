'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require mcu-display-core as mcu';

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

var LIVE_POLL_SEC = 1;
var LOG_POLL_SEC = 3;

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
	menu_wps: '0',
	path_autodiscover: '1',
	config_backend: 'uci',
	config_path: '/etc/config/mcud'
};

function rpcData(data, fallback) {
	return mcu.rpcData(data, fallback);
}

function statusFingerprint(st) {
	return mcu.statusFingerprint(st);
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

function serialPortEffectivePath(cfg) {
	cfg = cfg || {};
	if (cfg.effective_path)
		return cfg.effective_path;
	if (cfg.path_valid !== false && cfg.path)
		return cfg.path;
	return cfg.discovered_path || pick(cfg, 'path');
}

function serialPortOptions(cfg) {
	cfg = cfg || {};
	var ports = (cfg.serial_ports || []).slice();
	var current = serialPortEffectivePath(cfg);
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

function configTabRoot() {
	return document.querySelector('[data-tab="config"]') || document;
}

function val(id, fallback) {
	var root = configTabRoot();
	var el = root.querySelector('#' + id) || document.getElementById(id);
	return el ? String(el.value || '') : String(fallback || '');
}

function flag(id) {
	var root = configTabRoot();
	var el = root.querySelector('#' + id) || document.getElementById(id);
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
		menu_wps: flag('mcu-menu-wps'),
		path_autodiscover: flag('mcu-path-autodiscover')
	};
}

function encodeConfigPayload(cfg) {
	return JSON.stringify(cfg || readFormConfig());
}

function pick(cfg, key) {
	cfg = cfg || {};
	return cfg[key] != null && cfg[key] !== '' ? String(cfg[key]) : String(FORM_DEFAULTS[key] || '');
}

function mcuBadge(kind, label) {
	var cls = 'mcu-badge mcu-badge--' + (kind || 'muted');
	return E('span', { 'class': cls }, [ label ]);
}

function mcuStatusRow(label, value) {
	return E('div', { 'class': 'mcu-status-row' }, [
		E('span', { 'class': 'mcu-status-label' }, label),
		E('span', { 'class': 'mcu-status-value' }, value)
	]);
}

function mcuYesNoBadge(ok, yesLabel, noLabel) {
	return mcuBadge(ok ? 'yes' : 'no', ok ? yesLabel : noLabel);
}

function mcuBootBadge(status) {
	var stage = status.boot_stage || '';
	var message = status.boot_message || '';

	if (stage === 'ready')
		return mcuBadge('yes', message || _('Ready'));
	if (stage === 'network')
		return mcuBadge('warn', message || _('Network up'));
	if (stage === 'boot')
		return mcuBadge('warn', message || _('Starting mcudd…'));
	if (stage === 'preinit')
		return mcuBadge('muted', message || _('Pre-init'));
	if (stage)
		return mcuBadge('muted', message ? stage + ' — ' + message : stage);
	return mcuBadge('muted', _('Unknown'));
}

function buildStatusGrid(status, cfg) {
	var running = status.running;
	var screenLabel = status.page_title || status.active_screen || '—';
	var bootBadge = mcuBootBadge(status);

	return E('div', { 'class': 'mcu-status-grid', 'id': 'mcu-live-status-grid' }, [
		mcuStatusRow(_('Daemon'),
			mcuYesNoBadge(running, _('running'), _('stopped'))),
		mcuStatusRow(_('Serial device'),
			mcuBadge('info', E('span', { 'class': 'mcu-mono' }, cfg.path || cfg.effective_path || '—'))),
		mcuStatusRow(_('Command FIFO'),
			mcuYesNoBadge(status.fifo_ok, _('ready'), _('not available'))),
		mcuStatusRow(_('Boot'), bootBadge),
		mcuStatusRow(_('Active screen'),
			E('span', { 'id': 'mcu-live-active-screen' }, [
				mcuBadge('info', E('span', { 'class': 'mcu-mono', 'id': 'mcu-live-active-screen-label' }, screenLabel))
			])),
		mcuStatusRow(_('Page index'),
			E('span', { 'id': 'mcu-live-page-idx' }, [
				status.page_idx != null ?
					String(status.page_idx + 1) + ' / ' + String(status.page_count || '?') :
					'—'
			]))
	]);
}

function updateLiveStatus(status, cfg) {
	var screenEl = document.getElementById('mcu-live-active-screen');
	var idxEl = document.getElementById('mcu-live-page-idx');
	var screenLabel = status.page_title || status.active_screen || '—';

	if (screenEl) {
		var mono = document.getElementById('mcu-live-active-screen-label') ||
			screenEl.querySelector('.mcu-mono');
		if (mono)
			mono.textContent = screenLabel;
		else
			screenEl.textContent = screenLabel;
		var badge = screenEl.querySelector('.mcu-badge');
		if (badge) {
			badge.classList.remove('mcu-badge--pulse');
			void badge.offsetWidth;
			badge.classList.add('mcu-badge--pulse');
		}
	}

	if (idxEl) {
		idxEl.textContent = status.page_idx != null ?
			String(status.page_idx + 1) + ' / ' + String(status.page_count || '?') :
			'—';
	}

	updatePagesLive(status);
	updateLiveNavControls(status);
}

function updateLiveNavControls(status) {
	var blocked = isReadonly || !status.running;
	var controls = document.querySelector('.mcu-page-controls');
	var jump = document.getElementById('mcu-page-jump');
	var buttons;
	var i;

	if (!controls)
		return;

	buttons = controls.querySelectorAll('button');
	for (i = 0; i < buttons.length; i++)
		buttons[i].disabled = !!blocked;

	if (jump)
		jump.disabled = blocked || jump.options.length === 0;
}

function updatePagesLive(status) {
	var activeId = status.page_id || status.active_screen || '';
	var rows = document.querySelectorAll('.luci-app-mcu-display tr[data-page-id]');
	var jump = document.getElementById('mcu-page-jump');
	var i;

	for (i = 0; i < rows.length; i++) {
		var row = rows[i];
		var isActive = row.getAttribute('data-page-id') === activeId;
		row.classList.toggle('mcu-page-row--active', isActive);
	}

	if (jump && activeId) {
		for (i = 0; i < jump.options.length; i++) {
			jump.options[i].selected = jump.options[i].value === activeId;
		}
	}

	var indicator = document.getElementById('mcu-live-page-indicator');
	if (indicator)
		indicator.textContent = activeId ?
			_('Live: %s').format(status.page_title || activeId) :
			_('Live: waiting…');
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
			E('h2', {}, [
				_('MCU Display'),
				' ',
				E('span', { 'class': 'mcu-live-pill', 'id': 'mcu-live-pill' }, _('Live'))
			]),
			E('p', { 'class': 'hint' }, _('UART bridge to an ESP32 smart display. Connect the yellow ESP32 board to the CM5 debug UART (/dev/ttyS2) at 115200 8N1, or use a USB serial adapter (/dev/ttyUSB0). Physical buttons (USERKEY / MaskROM) navigate pages when mcudd is running.')),
			tabHost
		]);

		ui.tabs.initTabGroup(tabHost.childNodes);
		this.bindTabHooks(tabHost);
		this.startLivePoll(cfg);
		return root;
	},

	startLivePoll: function(cfg) {
		var self = this;
		this._liveCfg = cfg || {};
		this._lastStatusFp = '';

		if (this._livePollFn) {
			poll.remove(this._livePollFn);
			this._livePollFn = null;
		}

		this._livePollFn = function() {
			return callGetStatus().then(function(st) {
				st = rpcData(st, {});
				var fp = statusFingerprint(st);
				if (fp === self._lastStatusFp)
					return;
				self._lastStatusFp = fp;
				updateLiveStatus(st, self._liveCfg);
			});
		};
		poll.add(this._livePollFn, LIVE_POLL_SEC);
	},

	stopLivePoll: function() {
		if (this._livePollFn) {
			poll.remove(this._livePollFn);
			this._livePollFn = null;
		}
	},

	startLogPoll: function() {
		var self = this;
		this.stopLogPoll();
		this._logPollFn = function() {
			return self.refreshLogs(true);
		};
		poll.add(this._logPollFn, LOG_POLL_SEC);
	},

	stopLogPoll: function() {
		if (this._logPollFn) {
			poll.remove(this._logPollFn);
			this._logPollFn = null;
		}
	},

	bindTabHooks: function(tabHost) {
		var self = this;
		var debugPane = tabHost.querySelector('[data-tab="debug"]');
		var pagesPane = tabHost.querySelector('[data-tab="pages"]');
		var statusPane = tabHost.querySelector('[data-tab="status"]');

		if (debugPane) {
			debugPane.addEventListener('cbi-tab-active', function() {
				self.refreshLogs();
				self.startLogPoll();
			});
		}

		[ statusPane, pagesPane ].forEach(function(pane) {
			if (!pane)
				return;
			pane.addEventListener('cbi-tab-active', function() {
				self.stopLogPoll();
			});
		});

		if (debugPane && debugPane.classList.contains('cbi-tab-active'))
			self.startLogPoll();
	},

	buildStatusTab: function(status, cfg) {
		var self = this;
		var btns = E('div', { 'class': 'cbi-page-actions' });
		[ 'start', 'stop', 'restart' ].forEach(function(action) {
			btns.appendChild(E('button', {
				'class': 'cbi-button cbi-button-action',
				click: ui.createHandlerFn(self, function() {
					return callServiceControl(action).then(function() {
						self._lastStatusFp = '';
						return callGetStatus().then(function(st) {
							updateLiveStatus(rpcData(st, {}), cfg);
						});
					});
				}),
				disabled: isReadonly
			}, _(action)));
		});

		return E('div', { 'data-tab': 'status', 'data-tab-title': _('Status') }, [
			cbiSection(_('Daemon status'), [
				_('Updates every %d s while this page is open (LuCI poll — no WebSocket required).').format(LIVE_POLL_SEC)
			], [
				buildStatusGrid(status, cfg)
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
			var isActive = pageList[j].id === (status.page_id || status.active_screen);
			rows.push(E('tr', {
				'class': 'mcu-page-row' + (isActive ? ' mcu-page-row--active' : ''),
				'data-page-id': pageList[j].id
			}, [
				E('td', { 'class': 'mcu-mono' }, pageList[j].id),
				E('td', {}, pageList[j].title || pageList[j].id),
				E('td', { 'class': 'mcu-mono' }, pageList[j].scope || '')
			]));
		}

		return E('div', { 'data-tab': 'pages', 'data-tab-title': _('Pages') }, [
			E('p', {
				'id': 'mcu-live-page-indicator',
				'class': 'mcu-live-page-indicator'
			}, _('Live: %s').format(status.page_title || status.page_id || '—')),
			cbiSection(_('Screen navigation'), [
				_('Send RDCP screen commands over UART. Previous / next mirror physical button mapping (MaskROM / USERKEY on CM5).')
			], [
				E('div', { 'class': 'mcu-page-controls', 'id': 'mcu-page-controls' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'id': 'mcu-page-prev',
						click: ui.createHandlerFn(self, 'handlePagePrev'),
						disabled: disableIf(blocked)
					}, _('Previous page')),
					' ',
					E('button', {
						'class': 'btn cbi-button-action',
						'id': 'mcu-page-next',
						click: ui.createHandlerFn(self, 'handlePageNext'),
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
						'id': 'mcu-page-boot',
						click: ui.createHandlerFn(self, 'handlePageBoot'),
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
			cbiSection(_('mcudd settings'), [
				_('These options write OpenWrt UCI %s — the same file Go mcudd loads at startup. Use Save & Apply to restart the daemon.').format(pick(cfg, 'config_path') || '/etc/config/mcud')
			], [
				fieldRow(_('Config backend'), E('span', { 'class': 'mcu-mono' },
					(pick(cfg, 'config_backend') || 'uci') + ' · ' + (pick(cfg, 'config_path') || '/etc/config/mcud')))
			]),
			cbiSection(_('Serial & protocol'), [], [
				fieldRow(_('Enable mcudd'), flagInput('mcu-enable', _('Run mcudd daemon'), pick(cfg, 'enable') === '1')),
				fieldRow(_('Serial device'), selectInput('mcu-path', portOpts, serialPortEffectivePath(cfg)),
					cfg.path_valid === false && cfg.discovered_path ?
						_('Configured device missing; showing autodiscovered %s. Save to apply.').format(cfg.discovered_path) :
						_('CM5 debug UART: /dev/ttyS2. USB adapter: /dev/ttyUSB0.')),
				fieldRow(_('Autodiscover UART'), flagInput('mcu-path-autodiscover',
					_('Pick the best port on boot when the configured device is missing'),
					pick(cfg, 'path_autodiscover') === '1')),
				fieldRow(_('Baud rate'), selectInput('mcu-baud', [
					[ '115200', '115200' ],
					[ '230400', '230400' ],
					[ '460800', '460800' ],
					[ '921600', '921600' ]
				], pick(cfg, 'baud')), _('Must match ESP32 firmware.')),
				fieldRow(_('Wire format'), selectInput('mcu-wire-format', [
					[ 'json', 'JSON' ],
					[ 'msgpack', _('MessagePack (falls back to JSON)') ]
				], pick(cfg, 'wire_format')),
					_('RDCP framing used on the UART link. MessagePack is reserved until firmware support lands.')),
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
			cfg.effective ? cbiSection(_('Effective mcudd config'), [
				_('Effective settings from UCI %s (same options Go mcudd loads).').format(pick(cfg, 'config_path') || '/etc/config/mcud')
			], [
				E('pre', { 'class': 'mcu-log-pre', 'id': 'mcu-effective-config' }, cfg.effective)
			]) : '',
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'class': 'btn cbi-button-save',
					click: ui.createHandlerFn(self, function() {
						return self.handleMcuSave(false);
					}),
					disabled: isReadonly
				}, _('Save')),
				' ',
				E('button', {
					'class': 'btn cbi-button-apply',
					click: ui.createHandlerFn(self, function() {
						return self.handleMcuSave(true);
					}),
					disabled: isReadonly
				}, _('Save & Apply'))
			])
		]);
	},

	buildDebugTab: function() {
		var self = this;
		return E('div', { 'data-tab': 'debug', 'data-tab-title': _('Debug') }, [
			cbiSection(_('Debug logs'), [
				_('Syslog from mcudd, mcud-event, and mcudd-boot (navigation, LuCI actions, boot, UART). Refreshes every %d s while this tab is open. Enable Configuration → Debug & logging for RDCP frame and raw UART line traces.').format(LOG_POLL_SEC)
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
						click: ui.createHandlerFn(self, 'refreshLogs')
					}, _('Refresh')),
					' ',
					E('button', {
						'class': 'btn cbi-button-neutral',
						click: ui.createHandlerFn(self, 'copyLogs')
					}, _('Copy to clipboard')),
					' ',
					E('span', {
						'class': 'mcu-log-status',
						'id': 'mcu-log-status'
					}, _('Open this tab or click Refresh to load logs.'))
				]),
				E('pre', {
					'id': 'mcu-debug-log',
					'class': 'mcu-log-pre'
				}, '')
			])
		]);
	},

	handleMcuSave: function(restart) {
		if (isReadonly)
			return Promise.resolve();
		return callSetConfig(encodeConfigPayload(readFormConfig()), restart ? '1' : '0').then(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false) {
				ui.addNotification(null, E('p', {}, [ r.message || r.error || _('Save failed.') ]), 'error');
				return;
			}
			ui.addNotification(null, E('p', {}, [
				restart ? _('Settings saved and mcudd restarted.') : _('Settings saved.')
			]), 'info');
			location.reload();
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Could not save: %s').format(e) ]), 'error');
		});
	},

	handlePagePrev: function() {
		return this.handlePageControl('prev');
	},

	handlePageNext: function() {
		return this.handlePageControl('next');
	},

	handlePageBoot: function() {
		return this.handlePageControl('boot');
	},

	handlePageControl: function(action, pageId) {
		if (isReadonly)
			return Promise.resolve();
		return callPageControl(action, pageId || '').then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false) {
				ui.addNotification(null, E('p', {}, [ r.message || r.error || _('Page control failed.') ]), 'error');
				return;
			}
			this._lastStatusFp = '';
			return callGetStatus().then(L.bind(function(st) {
				st = rpcData(st, {});
				updateLiveStatus(st, this._liveCfg || {});
				return this.refreshLogs(true);
			}, this));
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Page control failed: %s').format(e) ]), 'error');
		});
	},

	leave: function() {
		this.stopLivePoll();
		this.stopLogPoll();
	},

	handlePageGoto: function() {
		var jump = document.getElementById('mcu-page-jump');
		if (!jump || !jump.value)
			return Promise.resolve();
		if (isReadonly)
			return Promise.resolve();
		return callPageControl('goto', jump.value).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false)
				ui.addNotification(null, E('p', {}, [ r.message || r.error || _('Jump failed.') ]), 'error');
			else {
				ui.addNotification(null, E('p', {}, [ _('Jumped to %s').format(jump.value) ]), 'info');
				this._lastStatusFp = '';
				return callGetStatus().then(L.bind(function(st) {
					updateLiveStatus(rpcData(st, {}), this._liveCfg || {});
					return this.refreshLogs(true);
				}, this));
			}
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Jump failed: %s').format(e) ]), 'error');
		});
	},

	logLimit: function() {
		var el = document.getElementById('mcu-log-limit');
		return mcu.parseLogLimit(el ? el.value : '', 200);
	},

	setLogView: function(text, lineCount) {
		var pre = document.getElementById('mcu-debug-log');
		var status = document.getElementById('mcu-log-status');
		var stick = false;

		if (pre) {
			stick = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
			pre.textContent = text || '';
			if (stick)
				pre.scrollTop = pre.scrollHeight;
		}
		if (status) {
			if (lineCount > 0)
				status.textContent = _('Showing %d log lines.').format(lineCount);
			else if (text && text.indexOf('\n') < 0)
				status.textContent = text;
			else
				status.textContent = _('No matching log entries.');
		}
	},

	refreshLogs: function(silent) {
		var self = this;

		if (!silent)
			this.setLogView(_('Loading logs…'), 0);

		return callGetLogs(String(this.logLimit())).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error) {
				if (!silent)
					this.setLogView(r.message || r.error, 0);
				else
					ui.addNotification(null, E('p', {}, [ r.message || r.error ]), 'error');
				return;
			}
			var output = r.output || '';
			var count = r.line_count != null ? r.line_count : mcu.countLogLines(output);
			if (!output.length)
				this.setLogView(_('No matching log entries. Try Refresh after navigating a page or pressing a CM5 button.'), 0);
			else
				this.setLogView(output, count);
		}, this)).catch(function(e) {
			var msg = _('Could not load logs: %s').format(e);
			if (!silent)
				self.setLogView(msg, 0);
			ui.addNotification(null, E('p', {}, [ msg ]), 'error');
		});
	},

	copyLogs: function() {
		var pre = document.getElementById('mcu-debug-log');
		if (!pre || !pre.textContent)
			return Promise.resolve();
		var text = pre.textContent;
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
