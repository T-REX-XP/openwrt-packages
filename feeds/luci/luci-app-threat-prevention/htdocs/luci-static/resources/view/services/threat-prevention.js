'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callGetStatus = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'getStatus',
	expect: { '': {} }
});

var callGetEvents = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'getEvents',
	params: [ 'limit' ],
	expect: { '': {} }
});

var callGetConfig = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'getConfig',
	expect: { '': {} }
});

var callSetConfig = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'setConfig',
	params: [ 'config' ],
	expect: { '': {} }
});

var callServiceControl = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'serviceControl',
	params: [ 'action' ],
	expect: { '': {} }
});

var callFetchRules = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'fetchRules',
	expect: { '': {} }
});

function val(v, fallback) {
	return (v === undefined || v === null || v === '') ? (fallback || '—') : v;
}

function collectTpSettings() {
	var enabled = document.getElementById('tp-enabled');
	var iface = document.getElementById('tp-iface');
	var home = document.getElementById('tp-home');
	var profile = document.getElementById('tp-profile');
	var url = document.getElementById('tp-url');
	if (!enabled || !iface || !home || !profile || !url)
		return null;
	var homeNet = (home.value || '').trim();
	if (homeNet && homeNet.charAt(0) !== '[')
		homeNet = '[' + homeNet + ']';
	return {
		enabled: enabled.checked ? '1' : '0',
		interface: (iface.value || '').trim(),
		home_net: homeNet,
		rule_profile: profile.value,
		etopen_url: (url.value || '').trim(),
		mode: 'ids'
	};
}

function saveTpSettings(apply) {
	var payload = collectTpSettings();
	if (!payload)
		return Promise.reject(new Error(_('Settings form is not ready.')));
	return callSetConfig(payload).then(function(res) {
		if (res && res.error)
			return Promise.reject(new Error(res.error));
		if (!apply)
			return res;
		return callServiceControl(payload.enabled === '1' ? 'restart' : 'stop').then(function(svc) {
			if (svc && svc.ok === false)
				return Promise.reject(new Error(svc.output || _('Service control failed')));
			return res;
		});
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			callGetStatus(),
			callGetEvents(50),
			callGetConfig()
		]);
	},

	render: function(data) {
		var status = data[0] || {};
		var events = (data[1] && data[1].events) || [];
		var cfg = data[2] || {};
		var self = this;

		var css = E('link', {
			rel: 'stylesheet',
			href: L.resource('threat-prevention-theme.css')
		});

		var root = E('div', { 'class': 'luci-app-threat-prevention' }, [
			E('h2', {}, _('Threat Prevention')),
			E('p', { 'class': 'tp-lead' }, [
				_('Suricata IDS on the LAN bridge with Emerging Threats Open. Not in the default CM5 image. Inline IPS at 2.5 GbE is not recommended.')
			]),
			E('p', { 'class': 'tp-cross' }, [
				E('a', { href: L.url('admin/services/snort') }, _('Snort3')),
				' · ',
				E('a', { href: L.url('admin/services/blocky') }, _('Blocky')),
				' · ',
				E('a', { href: L.url('admin/services/banip') }, _('banIP'))
			])
		]);

		var statusBox = E('div', { 'data-tab': 'status', 'data-tab-title': _('Status') });
		var eventsBox = E('div', { 'data-tab': 'events', 'data-tab-title': _('Events') });
		var policyBox = E('div', { 'data-tab': 'policy', 'data-tab-title': _('Policy') });
		var settingsBox = E('div', { 'data-tab': 'settings', 'data-tab-title': _('Settings') });

		function renderStatus(st) {
			statusBox.innerHTML = '';
			statusBox.appendChild(E('div', { 'class': 'tp-cards' }, [
				E('div', { 'class': 'tp-card' }, [
					E('div', { 'class': 'tp-card-label' }, _('Engine')),
					E('div', { 'class': 'tp-card-value' }, st.suricata_present
						? (st.suricata_running ? _('Running') : _('Stopped'))
						: _('Not installed'))
				]),
				E('div', { 'class': 'tp-card' }, [
					E('div', { 'class': 'tp-card-label' }, _('Mode')),
					E('div', { 'class': 'tp-card-value' }, val(st.mode, 'ids') + ' / ' + val(st.interface))
				]),
				E('div', { 'class': 'tp-card' }, [
					E('div', { 'class': 'tp-card-label' }, _('Alerts stored')),
					E('div', { 'class': 'tp-card-value' }, val(st.events, '0'))
				]),
				E('div', { 'class': 'tp-card' }, [
					E('div', { 'class': 'tp-card-label' }, _('ET Open')),
					E('div', { 'class': 'tp-card-value' }, st.etopen_state === 'fetching'
						? _('Fetching…')
						: val(st.etopen_mtime, _('Never fetched')))
				])
			]));
			if (st.etopen_state === 'error' && st.etopen_error)
				statusBox.appendChild(E('p', { 'class': 'tp-warn' }, st.etopen_error));
			if (st.rule_profile === 'full')
				statusBox.appendChild(E('p', { 'class': 'tp-warn' },
					_('Full ET Open uses a lot of RAM. Prefer the small profile on CM5.')));
		}

		function renderEvents(list) {
			eventsBox.innerHTML = '';
			if (!list.length) {
				eventsBox.appendChild(E('p', {}, _('No alerts yet. Enable IDS, fetch ET Open, and wait for traffic.')));
				return;
			}
			var table = E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Time')),
					E('th', { 'class': 'th' }, _('SID')),
					E('th', { 'class': 'th' }, _('Class')),
					E('th', { 'class': 'th' }, _('Src')),
					E('th', { 'class': 'th' }, _('Dst')),
					E('th', { 'class': 'th' }, _('Message'))
				])
			]);
			list.forEach(function(ev) {
				table.appendChild(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, val(ev.ts)),
					E('td', { 'class': 'td' }, val(ev.sid)),
					E('td', { 'class': 'td' }, val(ev.classtype)),
					E('td', { 'class': 'td' }, val(ev.src)),
					E('td', { 'class': 'td' }, val(ev.dst)),
					E('td', { 'class': 'td' }, val(ev.msg))
				]));
			});
			eventsBox.appendChild(table);
		}

		function renderPolicy(c) {
			policyBox.innerHTML = '';
			policyBox.appendChild(E('p', {},
				_('Classtype actions are alert by default (not drop). Disable or drop is reserved for a later IPS phase.')));
			var classes = c.classtypes || [];
			if (!classes.length) {
				policyBox.appendChild(E('p', {}, _('No classtype sections in UCI.')));
				return;
			}
			var table = E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Classtype')),
					E('th', { 'class': 'th' }, _('Action'))
				])
			]);
			classes.forEach(function(row) {
				table.appendChild(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td' }, val(row.name)),
					E('td', { 'class': 'td' }, val(row.action, 'alert'))
				]));
			});
			policyBox.appendChild(table);
		}

		function field(id, label, input) {
			return E('div', { 'class': 'tp-field' }, [
				E('label', { 'for': id }, label),
				input
			]);
		}

		function renderSettings(c) {
			settingsBox.innerHTML = '';
			var enabled = E('input', { type: 'checkbox', id: 'tp-enabled' });
			enabled.checked = c.enabled === '1' || c.enabled === 1;
			var iface = E('input', { type: 'text', id: 'tp-iface', value: val(c.interface, 'br-lan') });
			var home = E('input', { type: 'text', id: 'tp-home', value: val(c.home_net, '[192.168.8.0/24]') });
			var profile = E('select', { id: 'tp-profile' }, [
				E('option', { value: 'small' }, _('Small (malware / C2 / web server)')),
				E('option', { value: 'full' }, _('Full ET Open (high RAM)'))
			]);
			profile.value = c.rule_profile || 'small';
			var url = E('input', { type: 'text', id: 'tp-url', value: val(c.etopen_url,
				'https://rules.emergingthreats.net/open/suricata-8.0/emerging.rules.tar.gz') });

			settingsBox.appendChild(E('div', {}, [
				field('tp-enabled', _('Enable IDS'), enabled),
				field('tp-iface', _('Interface'), iface),
				field('tp-home', _('HOME_NET'), home),
				field('tp-profile', _('Rule profile'), profile),
				field('tp-url', _('ET Open URL'), url),
				E('div', { 'class': 'tp-actions' }, [
					E('button', {
						'type': 'button',
						'class': 'btn cbi-button cbi-button-save',
						click: function(ev) {
							ev.preventDefault();
							saveTpSettings(true).then(function() {
								ui.addNotification(null, E('p', {}, _('Saved. Suricata will start if Enable IDS is on.')), 5000);
							}).catch(function(e) {
								ui.addNotification(null, E('p', {}, e.message || e), 'error');
							});
						}
					}, _('Save & apply')),
					E('button', {
						'type': 'button',
						'class': 'btn cbi-button',
						click: function(ev) {
							ev.preventDefault();
							callServiceControl('restart').then(function(res) {
								if (res && res.ok === false)
									ui.addNotification(null, E('p', {}, res.output || _('Restart failed')), 'error');
								else
									ui.addNotification(null, E('p', {}, _('Suricata restarted')), 4000);
							}).catch(function(e) {
								ui.addNotification(null, E('p', {}, e.message || e), 'error');
							});
						}
					}, _('Restart Suricata')),
					E('button', {
						'type': 'button',
						'class': 'btn cbi-button',
						click: function(ev) {
							ev.preventDefault();
							ui.showModal(_('Fetching ET Open'), [ E('p', {}, _('Downloading rules…')) ]);
							callFetchRules().then(function(res) {
								if (res && res.error && !res.started)
									return Promise.reject(new Error(res.error));
								if (res && res.ok === false)
									return Promise.reject(new Error(res.error || res.output || _('Fetch failed')));
								if (!res || !res.started)
									return res;
								var tries = 0;
								function pollDone() {
									tries++;
									return callGetStatus().then(function(st) {
										if (st && st.etopen_state === 'fetching') {
											if (tries >= 120)
												return Promise.reject(new Error(_('ET Open fetch timed out')));
											return new Promise(function(resolve) {
												window.setTimeout(function() {
													resolve(pollDone());
												}, 2000);
											});
										}
										return st;
									});
								}
								return pollDone();
							}).then(function(res) {
								ui.hideModal();
								if (res && res.etopen_state === 'error')
									ui.addNotification(null, E('p', {}, res.etopen_error || res.output || _('Fetch failed')), 'error');
								else if (res && res.ok === false)
									ui.addNotification(null, E('p', {}, res.error || res.output || _('Fetch failed')), 'error');
								else
									ui.addNotification(null, E('p', {}, _('Rules updated')), 4000);
							}).catch(function(e) {
								ui.hideModal();
								ui.addNotification(null, E('p', {}, e.message || e), 'error');
							});
						}
					}, _('Fetch ET Open now'))
				])
			]));
		}

		renderStatus(status);
		renderEvents(events);
		renderPolicy(cfg);
		renderSettings(cfg);

		var tabHost = E('div', { 'class': 'tp-tab-host' }, [
			statusBox, eventsBox, policyBox, settingsBox
		]);
		root.appendChild(tabHost);
		ui.tabs.initTabGroup(tabHost.childNodes);

		poll.add(function() {
			return Promise.all([ callGetStatus(), callGetEvents(50) ]).then(function(next) {
				renderStatus(next[0] || {});
				renderEvents((next[1] && next[1].events) || []);
			});
		}, 8);

		return E('div', {}, [ css, root ]);
	},

	handleSave: function() {
		return saveTpSettings(false);
	},

	handleSaveApply: function() {
		return saveTpSettings(true);
	},

	handleReset: null
});
