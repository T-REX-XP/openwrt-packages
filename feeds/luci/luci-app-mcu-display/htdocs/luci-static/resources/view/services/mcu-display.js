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
		var root = E('div', { 'class': 'luci-app-mcu-display' }, [
			E('link', {
				rel: 'stylesheet',
				href: L.resource('mcu-display-theme.css')
			}),
			E('h2', {}, _('MCU Display')),
			E('p', { 'class': 'hint' }, _('UART bridge to an ESP32 smart display. Configure the serial port in UCI before enabling the service.')),
			this.renderStatus(status, cfg),
			this.renderService(status),
			this.renderConfig(cfg)
		]);
		return root;
	},

	renderStatus: function(status, cfg) {
		var running = status.running;
		var portOk = status.port_exists;
		var cfgOk = status.config_complete;
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Status')),
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
		]);
	},

	renderService: function(status) {
		var self = this;
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
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Service')),
			btns
		]);
	},

	renderConfig: function(cfg) {
		var self = this;
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

		if (cfg.serial_ports && cfg.serial_ports.length)
			s.option(form.DummyValue, '_ports', _('Detected ports'),
				cfg.serial_ports.join(', '));

		return form.render().then(function(node) {
			node.addEventListener('save', function() {
				var map = form.getData();
				return callSetConfig(map, '1');
			});
			return E('div', { 'class': 'cbi-section' }, [
				E('h3', {}, _('Configuration')),
				node
			]);
		});
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
