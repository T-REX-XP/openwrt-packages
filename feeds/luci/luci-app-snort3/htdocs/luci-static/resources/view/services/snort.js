'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callGetStatus = rpc.declare({
	object: 'luci.snort3',
	method: 'getStatus',
	expect: { '': {} }
});

var callGetConfig = rpc.declare({
	object: 'luci.snort3',
	method: 'getConfig',
	expect: { '': {} }
});

var callSetConfig = rpc.declare({
	object: 'luci.snort3',
	method: 'setConfig',
	params: [ 'config' ],
	expect: { '': {} }
});

var callServiceControl = rpc.declare({
	object: 'luci.snort3',
	method: 'serviceControl',
	params: [ 'action' ],
	expect: { '': {} }
});

var callGetAlerts = rpc.declare({
	object: 'luci.snort3',
	method: 'getAlerts',
	params: [ 'limit' ],
	expect: { '': {} }
});

var callUpdateRules = rpc.declare({
	object: 'luci.snort3',
	method: 'updateRules',
	expect: { '': {} }
});

var callUpdateStatus = rpc.declare({
	object: 'luci.snort3',
	method: 'updateStatus',
	expect: { '': {} }
});

var callFixRules = rpc.declare({
	object: 'luci.snort3',
	method: 'fixRules',
	expect: { '': {} }
});

function val(v, fallback) {
	return (v === undefined || v === null || v === '') ? (fallback || '—') : v;
}

function field(id, label, input) {
	return E('div', { 'class': 'snort-field' }, [
		E('label', { 'for': id }, label),
		input
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			callGetStatus(),
			callGetConfig(),
			callGetAlerts(50),
			callUpdateStatus()
		]);
	},

	render: function(data) {
		var status = data[0] || {};
		var cfg = data[1] || {};
		var alerts = data[2] || {};
		var upd = data[3] || {};

		var css = E('link', {
			rel: 'stylesheet',
			href: L.resource('snort-theme.css')
		});

		var root = E('div', { 'class': 'luci-app-snort3' }, [
			E('h2', {}, _('Snort IDS/IPS')),
			E('p', { 'class': 'snort-lead' }, [
				_('Snort 3 on the LAN bridge. Keep IDS (detect only) on CM5; inline IPS at 2.5 GbE is not recommended.')
			]),
			E('p', { 'class': 'snort-cross' }, [
				E('a', { href: L.url('admin/services/threat-prevention') }, _('Threat Prevention')),
				' · ',
				E('a', { href: L.url('admin/services/blocky') }, _('Blocky'))
			])
		]);

		var statusBox = E('div', { 'data-tab': 'status', 'data-tab-title': _('Status') });
		var alertsBox = E('div', { 'data-tab': 'alerts', 'data-tab-title': _('Alerts') });
		var settingsBox = E('div', { 'data-tab': 'settings', 'data-tab-title': _('Settings') });
		var rulesBox = E('div', { 'data-tab': 'rules', 'data-tab-title': _('Rules') });

		function renderStatus(st) {
			statusBox.innerHTML = '';
			statusBox.appendChild(E('div', { 'class': 'snort-cards' }, [
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('Engine')),
					E('div', { 'class': 'snort-card-value' }, !st.present
						? _('Not installed')
						: (st.running ? _('Running') : _('Stopped')))
				]),
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('Mode')),
					E('div', { 'class': 'snort-card-value' },
						val(st.mode, 'ids') + ' / ' + val(st.method) + ' / ' + val(st.interface))
				]),
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('Alerts')),
					E('div', { 'class': 'snort-card-value' }, val(st.alert_count, '0'))
				]),
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('PID / autostart')),
					E('div', { 'class': 'snort-card-value' },
						val(st.pid, '—') + ' / ' + (st.enabled_boot ? _('enabled') : _('disabled')))
				])
			]));
			statusBox.appendChild(E('div', { 'class': 'snort-actions' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					click: function() {
						callServiceControl('start').then(function() {
							ui.addNotification(null, E('p', {}, _('Snort start requested')), 4000);
						});
					}
				}, _('Start')),
				E('button', {
					'class': 'btn cbi-button',
					click: function() {
						callServiceControl('stop').then(function() {
							ui.addNotification(null, E('p', {}, _('Snort stopped')), 4000);
						});
					}
				}, _('Stop')),
				E('button', {
					'class': 'btn cbi-button',
					click: function() {
						callServiceControl('restart').then(function() {
							ui.addNotification(null, E('p', {}, _('Snort restarted')), 4000);
						});
					}
				}, _('Restart')),
				E('button', {
					'class': 'btn cbi-button',
					click: function() {
						callServiceControl(st.enabled_boot ? 'disable' : 'enable').then(function() {
							ui.addNotification(null, E('p', {},
								st.enabled_boot ? _('Autostart disabled') : _('Autostart enabled')), 4000);
						});
					}
				}, st.enabled_boot ? _('Disable autostart') : _('Enable autostart'))
			]));
		}

		function renderAlerts(a) {
			alertsBox.innerHTML = '';
			var text = (a && a.alerts) ? a.alerts : '';
			if (!text) {
				alertsBox.appendChild(E('p', {}, _('No alerts yet. Enable IDS and wait for traffic.')));
			} else {
				alertsBox.appendChild(E('pre', { 'class': 'snort-alert-box' }, text));
			}
			if (a && a.logs)
				alertsBox.appendChild(E('pre', { 'class': 'snort-log-box' }, a.logs));
		}

		function renderSettings(c) {
			settingsBox.innerHTML = '';
			var enabled = E('input', { type: 'checkbox', id: 'snort-enabled' });
			enabled.checked = c.enabled === '1' || c.enabled === 1;
			var iface = E('input', { type: 'text', id: 'snort-iface', value: val(c.interface, 'br-lan') });
			var home = E('input', { type: 'text', id: 'snort-home', value: val(c.home_net, '192.168.8.0/24') });
			var ext = E('input', { type: 'text', id: 'snort-ext', value: val(c.external_net, 'any') });
			var mode = E('select', { id: 'snort-mode' }, [
				E('option', { value: 'ids' }, _('IDS (detection only)')),
				E('option', { value: 'ips' }, _('IPS (prevention)'))
			]);
			mode.value = c.mode || 'ids';
			var method = E('select', { id: 'snort-method' }, [
				E('option', { value: 'afpacket' }, 'AF_PACKET'),
				E('option', { value: 'pcap' }, 'PCAP'),
				E('option', { value: 'nfq' }, 'NFQ (IPS)')
			]);
			method.value = c.method || 'afpacket';
			var action = E('select', { id: 'snort-action' }, [
				E('option', { value: 'default' }, _('Default')),
				E('option', { value: 'alert' }, _('Alert')),
				E('option', { value: 'block' }, _('Block')),
				E('option', { value: 'drop' }, _('Drop')),
				E('option', { value: 'reject' }, _('Reject'))
			]);
			action.value = c.action || 'alert';
			var oink = E('input', { type: 'password', id: 'snort-oink', value: c.oinkcode || '' });

			settingsBox.appendChild(E('div', {}, [
				field('snort-enabled', _('Enable Snort'), enabled),
				field('snort-iface', _('Interface'), iface),
				field('snort-home', _('HOME_NET'), home),
				field('snort-ext', _('EXTERNAL_NET'), ext),
				field('snort-mode', _('Operating mode'), mode),
				field('snort-method', _('DAQ method'), method),
				field('snort-action', _('Rule action override'), action),
				field('snort-oink', _('Oinkcode (optional)'), oink),
				E('div', { 'class': 'snort-actions' }, [
					E('button', {
						'class': 'btn cbi-button cbi-button-save',
						click: function() {
							callSetConfig({
								enabled: enabled.checked ? '1' : '0',
								interface: iface.value,
								home_net: home.value,
								external_net: ext.value,
								mode: mode.value,
								method: method.value,
								action: action.value,
								oinkcode: oink.value,
								manual: '0'
							}).then(function(res) {
								if (res && res.error)
									ui.addNotification(null, E('p', {}, res.error), 'error');
								else
									ui.addNotification(null, E('p', {}, _('Saved. Restart Snort to apply.')), 4000);
							}).catch(function(e) {
								ui.addNotification(null, E('p', {}, e.message || e), 'error');
							});
						}
					}, _('Save'))
				])
			]));
		}

		function renderRules(st, u) {
			rulesBox.innerHTML = '';
			var r = (st && st.rules) || {};
			var loc;
			if (r.symlink)
				loc = E('p', { 'class': 'snort-rules-ok' },
					_('Active symlink') + ': /etc/snort/rules → ' + val(r.target));
			else if (r.temp_exists)
				loc = E('p', { 'class': 'snort-rules-warn' },
					_('Rules are in /var/snort.d/rules. Create a symlink to /etc/snort/rules.'));
			else
				loc = E('p', { 'class': 'snort-rules-err' }, _('No rules directory found.'));
			rulesBox.appendChild(loc);
			rulesBox.appendChild(E('p', { 'class': 'snort-rules-meta' },
				_('Rule files:') + ' ' + val(r.rule_files, '0')));

			var logPre = E('pre', { 'class': 'snort-log-box' }, (u && u.log) || '');
			if (u && u.running)
				rulesBox.appendChild(E('p', { 'class': 'snort-status-warn' }, _('Update in progress…')));
			else if (u && u.finished)
				rulesBox.appendChild(E('p', { 'class': 'snort-status-ok' }, _('Last update finished.')));
			rulesBox.appendChild(logPre);

			rulesBox.appendChild(E('div', { 'class': 'snort-actions' }, [
				E('button', {
					'class': 'btn cbi-button cbi-button-apply',
					click: function() {
						callUpdateRules().then(function(res) {
							if (res && res.error)
								ui.addNotification(null, E('p', {}, res.error), 'error');
							else
								ui.addNotification(null, E('p', {}, _('Rule update started')), 4000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Update rules')),
				E('button', {
					'class': 'btn cbi-button',
					click: function() {
						callFixRules().then(function(res) {
							if (res && res.ok === false)
								ui.addNotification(null, E('p', {}, res.error || _('Failed')), 'error');
							else
								ui.addNotification(null, E('p', {}, _('Symlink created')), 4000);
						});
					}
				}, _('Create rules symlink'))
			]));
		}

		renderStatus(status);
		renderAlerts(alerts);
		renderSettings(cfg);
		renderRules(status, upd);

		var tabHost = E('div', { 'class': 'snort-tab-host' }, [
			statusBox, alertsBox, settingsBox, rulesBox
		]);
		root.appendChild(tabHost);
		ui.tabs.initTabGroup(tabHost.childNodes);

		poll.add(function() {
			return Promise.all([ callGetStatus(), callGetAlerts(50), callUpdateStatus() ]).then(function(next) {
				renderStatus(next[0] || {});
				renderAlerts(next[1] || {});
				renderRules(next[0] || {}, next[2] || {});
			});
		}, 8);

		return E('div', {}, [ css, root ]);
	}
});
