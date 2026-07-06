'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require form';

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

function rpcData(data) {
	if (Array.isArray(data) && data.length > 1 && data[0] === 0)
		return data[1];
	return data;
}

function cbiSection(title, descrNodes, bodyNodes) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, title),
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

return view.extend({
	load: function() {
		return Promise.all([
			callGetConfig(),
			callGetStatus()
		]);
	},

	render: function(data) {
		var cfg = rpcData(data[0]) || {};
		var status = rpcData(data[1]) || {};
		var self = this;

		var tabHost = E('div', { 'class': 'mcu-tab-host' }, [
			this.buildStatusTab(status, cfg),
			this.buildConfigTab(cfg),
			this.buildDebugTab(cfg)
		]);

		var root = E('div', { 'class': 'luci-app-mcu-display' }, [
			E('link', {
				rel: 'stylesheet',
				href: L.resource('mcu-display-theme.css')
			}),
			E('h2', {}, _('MCU Display')),
			E('p', { 'class': 'hint' }, _('UART bridge to an ESP32 smart display. Configure the serial port in UCI before enabling the service.')),
			tabHost
		]);

		ui.tabs.initTabGroup(tabHost.childNodes);

		return this.renderConfigForm(cfg).then(function(formNode) {
			var slot = root.querySelector('.mcu-config-form-slot');
			if (slot)
				slot.appendChild(formNode);
			return root;
		});
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
					])
				])
			]),
			cbiSection(_('Service control'), [], [ btns ])
		]);
	},

	buildConfigTab: function(cfg) {
		return E('div', { 'data-tab': 'config', 'data-tab-title': _('Configuration') }, [
			E('div', { 'class': 'mcu-config-form-slot' })
		]);
	},

	renderConfigForm: function(cfg) {
		var form = new form.JSONMap(cfg, _('Configuration'));
		var s = form.section(form.NamedSection, 'main', 'mcud', _('Serial & protocol'));
		s.anonymous = true;

		s.option(form.Flag, 'enable', _('Enable mcudd'));
		s.option(form.Value, 'path', _('Serial device'));
		s.option(form.ListValue, 'baud', _('Baud rate'), _('Must match UCI and firmware.'))
			.value('115200', '115200')
			.value('230400', '230400')
			.value('460800', '460800')
			.value('921600', '921600');
		s.option(form.ListValue, 'wire_format', _('Wire format'))
			.value('json', 'JSON')
			.value('msgpack', 'MessagePack (Phase 2)');
		s.option(form.Flag, 'demo_mode', _('Demo alarm data'));
		s.option(form.Value, 'pages', _('Pages JSON path'));
		s.option(form.Value, 'wan_if', _('WAN interface'));
		s.option(form.Value, 'lan_if', _('LAN bridge'));
		s.option(form.Value, 'wifi_if', _('WiFi interface'));
		s.option(form.Value, 'interval_system', _('System poll interval (ms)'));
		s.option(form.Value, 'interval_network', _('Network poll interval (ms)'));
		s.option(form.Flag, 'push_alerts', _('Push alerts'));
		s.option(form.Value, 'max_line', _('Max UART line length'));

		var st = s.option(form.Value, 'screen_timeout', _('Screen timeout (seconds)'),
			_('Turn off, dim, or blank the display after this many seconds without touch input. 0 disables timeout.'));
		st.datatype = 'uinteger';
		st.placeholder = '60';

		s.option(form.ListValue, 'screen_timeout_mode', _('Screen timeout action'),
			_('What the ESP32 does when the idle timer expires.'))
			.value('off', _('Backlight off'))
			.value('dim', _('Dim backlight'))
			.value('blank', _('Blank screen'));

		if (cfg.serial_ports && cfg.serial_ports.length)
			s.option(form.DummyValue, '_ports', _('Detected ports'),
				cfg.serial_ports.join(', '));

		s.option(form.ListValue, 'log_level', _('Log level'),
			_('Syslog verbosity for mcudd. Use debug only when troubleshooting.'))
			.value('error', _('Error'))
			.value('warn', _('Warning'))
			.value('info', _('Info'))
			.value('debug', _('Debug'));
		s.option(form.Flag, 'debug', _('Protocol frame logging'),
			_('Log RDCP frames and scope responses (requires restart).'));
		s.option(form.Flag, 'debug_serial', _('UART trace'),
			_('Log raw TX/RX lines on the serial port (very verbose).'));

		return form.render().then(function(node) {
			node.addEventListener('save', function() {
				var map = form.getData();
				return callSetConfig(map, '1');
			});
			return node;
		});
	},

	buildDebugTab: function() {
		return E('div', { 'data-tab': 'debug', 'data-tab-title': _('Debug') }, [
			cbiSection(_('Debug logs'), [
				_('Recent syslog lines tagged mcudd. Enable protocol or UART trace under Configuration → Debug & logging, then restart mcudd.')
			], [
				fieldRow(_('Line limit'), E('select', { 'id': 'mcu-log-limit' }, [
					E('option', { 'value': '50' }, [ '50' ]),
					E('option', { 'value': '100' }, [ '100' ]),
					E('option', { 'value': '200', 'selected': 'selected' }, [ '200' ]),
					E('option', { 'value': '500' }, [ '500' ])
				])),
				E('div', { 'class': 'mcu-log-toolbar' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, 'refreshLogs')
					}, [ _('Refresh') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-neutral',
						'click': ui.createHandlerFn(this, 'copyLogs')
					}, [ _('Copy to clipboard') ])
				]),
				E('textarea', {
					'id': 'mcu-debug-log',
					'class': 'mcu-log-pre',
					'readonly': 'readonly',
					'rows': 16,
					'placeholder': _('Click Refresh to load log lines.')
				}, [])
			])
		]);
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
			var text = r.output || '';
			ta.value = text.length ? text : _('No matching log entries.');
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
				try {
					notify(document.execCommand('copy'));
				} catch (err) {
					notify(false);
				}
			});
		}
		ta.focus();
		ta.select();
		try {
			notify(document.execCommand('copy'));
		} catch (err) {
			notify(false);
		}
		return Promise.resolve();
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
