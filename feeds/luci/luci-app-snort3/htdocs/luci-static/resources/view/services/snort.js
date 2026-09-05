'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require network';
'require snort-core as snortCore';

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

var callCleanupTemp = rpc.declare({
	object: 'luci.snort3',
	method: 'cleanupTemp',
	expect: { '': {} }
});

function val(v, fallback) {
	return (v === undefined || v === null || v === '') ? (fallback || '—') : v;
}

var snortFeeds = [];

function field(id, label, input, help, extra) {
	var control = extra ? E('div', { 'class': 'snort-field-control' }, [ input, extra ]) : input;
	var kids = [
		E('label', { 'for': id }, label),
		control
	];
	if (help)
		kids.push(E('div', { 'class': 'snort-help' }, help));
	return E('div', { 'class': 'snort-field' }, kids);
}

function luciDevList(devs) {
	var out = [];
	var i, d, name, type;
	if (!Array.isArray(devs))
		return out;
	for (i = 0; i < devs.length; i++) {
		d = devs[i];
		if (!d)
			continue;
		name = (typeof d.getName === 'function') ? d.getName() : String(d);
		type = (typeof d.getType === 'function') ? d.getType() : '';
		out.push({ name: name, type: type });
	}
	return out;
}

function lanCidrFromNet(net) {
	var addrs, i, cidr;
	if (!net || typeof net.getIPAddrs !== 'function')
		return '';
	addrs = net.getIPAddrs() || [];
	for (i = 0; i < addrs.length; i++) {
		cidr = snortCore.hostCidrToNetwork(addrs[i]);
		if (cidr)
			return cidr;
	}
	return '';
}

function ifaceSelect(id, current, devices) {
	var list = luciDevList(devices);
	var names = snortCore.idsDeviceNames(list, current);
	var live = {};
	var i, n, label, sel, opts;
	for (i = 0; i < list.length; i++)
		live[list[i].name] = 1;
	opts = [];
	for (i = 0; i < names.length; i++) {
		n = names[i];
		label = live[n] ? n : n + ' (' + _('not present') + ')';
		opts.push(E('option', { value: n }, label));
	}
	sel = E('select', { id: id, required: 'required' }, opts);
	if (current && names.indexOf(current) >= 0)
		sel.value = current;
	else if (names.length)
		sel.value = names[0];
	return sel;
}

function elVal(id) {
	return document.getElementById(id);
}

function collectSnortSettings() {
	var enabled = elVal('snort-enabled');
	var manual = elVal('snort-manual');
	var logging = elVal('snort-logging');
	var openappid = elVal('snort-openappid');
	var iface = elVal('snort-iface');
	var home = elVal('snort-home');
	var ext = elVal('snort-ext');
	var mode = elVal('snort-mode');
	var method = elVal('snort-method');
	var action = elVal('snort-action');
	var snaplen = elVal('snort-snaplen');
	var oink = elVal('snort-oink');
	var logDir = elVal('snort-logdir');
	var cfgDir = elVal('snort-cfgdir');
	var tmpDir = elVal('snort-tmpdir');

	if (!enabled || !manual || !logging || !openappid || !iface || !home ||
	    !ext || !mode || !method || !action || !snaplen || !logDir ||
	    !cfgDir || !tmpDir)
		return { error: _('Settings form is not ready.') };

	return snortCore.collectSettings({
		enabled: enabled.checked,
		manual: manual.checked,
		logging: logging.checked,
		openappid: openappid.checked,
		interface: iface.value,
		home_net: home.value,
		external_net: ext.value,
		mode: mode.value,
		method: method.value,
		action: action.value,
		snaplen: snaplen.value,
		oinkcode: oink ? oink.value : '',
		log_dir: logDir.value,
		config_dir: cfgDir.value,
		temp_dir: tmpDir.value,
		feeds: snortFeeds
	});
}

function rpcFail(res, fallback) {
	if (!res)
		return fallback || _('RPC failed');
	if (res.error)
		return res.error;
	if (res.ok === false)
		return res.output || res.message || fallback || _('RPC failed');
	return null;
}

function saveSnortSettings(apply) {
	var collected = collectSnortSettings();
	if (collected.error)
		return Promise.reject(new Error(collected.error));
	return callSetConfig(collected.config).then(function(res) {
		var err = rpcFail(res, _('Failed to save Snort settings'));
		if (err)
			return Promise.reject(new Error(err));
		if (!apply)
			return res;
		return callServiceControl(collected.config.enabled === '1' ? 'restart' : 'stop').then(function(svc) {
			var svcErr = rpcFail(svc, _('Service control failed'));
			if (svcErr)
				return Promise.reject(new Error(svcErr));
			return res;
		});
	});
}

function runService(action, okMsg) {
	return callServiceControl(action).then(function(res) {
		var err = rpcFail(res, _('Service control failed'));
		if (err)
			return Promise.reject(new Error(err));
		ui.addNotification(null, E('p', {}, okMsg), 4000);
		return res;
	}).catch(function(e) {
		ui.addNotification(null, E('p', {}, e.message || e), 'error');
	});
}

return view.extend({
	load: function() {
		return Promise.all([
			callGetStatus(),
			callGetConfig(),
			callGetAlerts(50),
			callUpdateStatus(),
			L.resolveDefault(network.getDevices(), []),
			L.resolveDefault(network.getNetwork('lan'), null)
		]);
	},

	render: function(data) {
		var status = data[0] || {};
		var cfg = data[1] || {};
		var alerts = data[2] || {};
		var upd = data[3] || {};
		var netDevices = data[4] || [];
		var lanCidr = lanCidrFromNet(data[5]);
		snortFeeds = snortCore.normalizeFeeds(
			(cfg.feeds && cfg.feeds.length) ? cfg.feeds : snortCore.defaultFeeds()
		);

		var css = E('link', {
			rel: 'stylesheet',
			href: L.resource('snort-theme.css')
		});

		var root = E('div', { 'class': 'luci-app-snort3' }, [
			E('h2', {}, _('Snort IDS/IPS')),
			E('p', { 'class': 'snort-lead' }, [
				_('Snort is an open source intrusion detection and prevention system.')
			]),
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
			var engineLabel;
			var memClass = snortCore.memTone(st.mem_percent);
			statusBox.innerHTML = '';
			if (!st.present)
				engineLabel = _('Not installed');
			else if (st.running)
				engineLabel = _('Running');
			else
				engineLabel = _('Stopped');
			statusBox.appendChild(E('div', { 'class': 'snort-cards' }, [
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('Engine')),
					E('div', { 'class': 'snort-card-value' }, engineLabel)
				]),
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('PID / autostart')),
					E('div', { 'class': 'snort-card-value' },
						val(st.pid, '—') + ' / ' + (st.enabled_boot ? _('enabled') : _('disabled')))
				]),
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('Snort memory')),
					E('div', { 'class': 'snort-card-value' },
						st.running ? snortCore.formatKb(st.mem_rss_kb) : '—')
				]),
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('System memory')),
					E('div', { 'class': 'snort-card-value ' + memClass },
						snortCore.formatSysMem(st.mem_used_kb, st.mem_total_kb, st.mem_percent))
				]),
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('Mode')),
					E('div', { 'class': 'snort-card-value' },
						val(st.mode, 'ids') + ' / ' + val(st.method) + ' / ' + val(st.interface))
				]),
				E('div', { 'class': 'snort-card' }, [
					E('div', { 'class': 'snort-card-label' }, _('Total alerts')),
					E('div', { 'class': 'snort-card-value' }, val(st.alert_count, '0'))
				])
			]));
			statusBox.appendChild(E('div', { 'class': 'snort-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button cbi-button-apply',
					click: function() {
						runService('start', _('Snort started'));
					}
				}, _('Start')),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					click: function() {
						runService('stop', _('Snort stopped'));
					}
				}, _('Stop')),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					click: function() {
						runService('restart', _('Snort restarted'));
					}
				}, _('Restart')),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					click: function() {
						runService(st.enabled_boot ? 'disable' : 'enable',
							st.enabled_boot ? _('Auto-start disabled') : _('Auto-start enabled'));
					}
				}, st.enabled_boot ? _('Disable at boot') : _('Enable at boot'))
			]));
		}

		function renderAlerts(a) {
			var text = (a && a.alerts) ? a.alerts : '';
			var logs = (a && a.logs) ? a.logs : '';
			alertsBox.innerHTML = '';
			alertsBox.appendChild(E('h3', {}, _('Recent alerts (50 most recent)')));
			if (!text)
				alertsBox.appendChild(E('p', {}, _('No alerts yet. Enable IDS and wait for traffic.')));
			else
				alertsBox.appendChild(E('pre', { 'class': 'snort-alert-box' }, text));
			alertsBox.appendChild(E('div', { 'class': 'snort-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					click: function() {
						callGetAlerts(50).then(function(next) {
							renderAlerts(next || {});
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Refresh'))
			]));
			alertsBox.appendChild(E('h3', {}, _('Snort system logs (20 most recent)')));
			if (!logs)
				alertsBox.appendChild(E('p', {}, _('No logs')));
			else
				alertsBox.appendChild(E('pre', { 'class': 'snort-log-box' }, logs));
			alertsBox.appendChild(E('h3', {}, _('Actions')));
			alertsBox.appendChild(E('p', { 'class': 'snort-help' },
				_('View detailed reports via SSH with the command:')));
			alertsBox.appendChild(E('pre', { 'class': 'snort-hint' },
				'snort-mgr report -v (requires coreutils-sort package)'));
			alertsBox.appendChild(E('p', { 'class': 'snort-help' }, _('Log files:')));
			alertsBox.appendChild(E('ul', { 'class': 'snort-help' }, [
				E('li', {}, [ E('code', {}, '/var/log/alert_fast.txt'), ' — ', _('Fast alerts') ]),
				E('li', {}, [ E('code', {}, '/var/log/*alert_json.txt'), ' — ', _('Detailed JSON alerts') ])
			]));
		}

		function renderSettings(c) {
			settingsBox.innerHTML = '';
			var enabled = E('input', { type: 'checkbox', id: 'snort-enabled' });
			enabled.checked = c.enabled === '1' || c.enabled === 1;
			var manual = E('input', { type: 'checkbox', id: 'snort-manual' });
			manual.checked = c.manual === '1' || c.manual === 1;
			var logging = E('input', { type: 'checkbox', id: 'snort-logging' });
			logging.checked = c.logging === '1' || c.logging === 1 || c.logging === undefined;
			var openappid = E('input', { type: 'checkbox', id: 'snort-openappid' });
			openappid.checked = c.openappid === '1' || c.openappid === 1;
			var iface = ifaceSelect('snort-iface', val(c.interface, 'br-lan'), netDevices);
			var homeNet = snortCore.unwrapNet(c.home_net);
			if (!homeNet)
				homeNet = lanCidr;
			var home = E('input', {
				type: 'text', id: 'snort-home',
				value: homeNet,
				placeholder: lanCidr
			});
			var useLan = E('button', {
				'type': 'button',
				'class': 'btn cbi-button',
				'disabled': lanCidr ? null : true,
				click: function(ev) {
					ev.preventDefault();
					if (lanCidr)
						home.value = lanCidr;
				}
			}, _('Use LAN subnet'));
			var ext = E('input', {
				type: 'text', id: 'snort-ext',
				value: snortCore.unwrapNet(val(c.external_net, 'any')),
				placeholder: 'any'
			});
			var mode = E('select', { id: 'snort-mode' }, [
				E('option', { value: 'ids' }, _('IDS (detection only)')),
				E('option', { value: 'ips' }, _('IPS (prevention)'))
			]);
			mode.value = c.mode || 'ids';
			var ipsWarn = E('div', { 'class': 'snort-warn-inline' },
				_('Inline IPS at 2.5 GbE is not recommended on this router. Prefer IDS (detect only).'));
			var method = E('select', { id: 'snort-method' }, [
				E('option', { value: 'pcap' }, 'PCAP'),
				E('option', { value: 'afpacket' }, 'AF_PACKET'),
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
			var snaplen = E('input', {
				type: 'number', id: 'snort-snaplen',
				min: '0', max: '65535', step: '1',
				value: val(c.snaplen, '1518'),
				placeholder: '1518'
			});
			var logDir = E('input', {
				type: 'text', id: 'snort-logdir',
				value: val(c.log_dir, '/var/log'),
				placeholder: '/var/log'
			});
			var cfgDir = E('input', {
				type: 'text', id: 'snort-cfgdir',
				value: val(c.config_dir, '/etc/snort'),
				placeholder: '/etc/snort'
			});
			var tmpDir = E('input', {
				type: 'text', id: 'snort-tmpdir',
				value: val(c.temp_dir, '/var/snort.d'),
				placeholder: '/var/snort.d'
			});

			function syncModeWidgets() {
				var nfqOpt = method.querySelector('option[value="nfq"]');
				var ips = mode.value === 'ips';
				if (nfqOpt) {
					nfqOpt.disabled = !ips;
					nfqOpt.hidden = !ips;
				}
				if (!ips && method.value === 'nfq')
					method.value = 'afpacket';
				if (ips)
					ipsWarn.classList.add('is-visible');
				else
					ipsWarn.classList.remove('is-visible');
			}
			mode.addEventListener('change', syncModeWidgets);
			syncModeWidgets();

			settingsBox.appendChild(E('h3', {}, _('Configuration')));
			settingsBox.appendChild(E('div', {}, [
				field('snort-enabled', _('Enable Snort'), enabled,
					_('Start the Snort service and load this configuration')),
				field('snort-manual', _('Manual mode'), manual,
					_('Use manual configuration (snort.lua)')),
				field('snort-iface', _('Network interface'), iface,
					_('Linux device to sniff (br-lan, eth0, …), not the UCI name (lan).')),
				field('snort-home', _('HOME_NET'), home,
					_('CIDR to protect, e.g. 192.168.8.0/24. Square brackets are optional.'),
					useLan),
				field('snort-ext', _('EXTERNAL_NET'), ext,
					_('External range, usually any or !$HOME_NET')),
				field('snort-mode', _('Operating mode'), mode,
					_('IDS = Detection only, IPS = Active prevention')),
				ipsWarn,
				field('snort-method', _('DAQ method'), method,
					_('Packet acquisition method. NFQ is only used for inline IPS.')),
				field('snort-snaplen', _('Capture length'), snaplen,
					_('Maximum packet capture size (0–65535 bytes)')),
				field('snort-action', _('Rule action'), action,
					_('Default action for rules')),
				field('snort-openappid', _('Enable OpenAppID'), openappid,
					_('Use the OpenAppID detector package if installed'))
			]));
			settingsBox.appendChild(E('h3', {}, _('Logging')));
			settingsBox.appendChild(E('div', {}, [
				field('snort-logging', _('Enable logging'), logging,
					_('Write fast alerts and JSON events'))
			]));
			settingsBox.appendChild(E('details', { 'class': 'snort-advanced' }, [
				E('summary', {}, _('Advanced paths')),
				field('snort-logdir', _('Log directory'), logDir,
					_('Path where logs will be stored')),
				field('snort-cfgdir', _('Configuration directory'), cfgDir,
					_('Snort configuration directory path')),
				field('snort-tmpdir', _('Temporary directory'), tmpDir,
					_('Directory for temporary files and downloaded rules'))
			]));
			settingsBox.appendChild(E('div', { 'class': 'snort-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button cbi-button-save',
					click: function(ev) {
						ev.preventDefault();
						saveSnortSettings(true).then(function() {
							ui.addNotification(null, E('p', {},
								_('Saved. Snort will start if Enable Snort is on.')), 5000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Save & apply'))
			]));
		}

		var snortFeedsHost;
		var snortUpdateHost;

		function persistSnortFeeds() {
			var oink = elVal('snort-oink');
			var err = snortCore.validateFeeds(snortFeeds);
			var payload;
			if (err)
				return Promise.reject(new Error(err));
			snortFeeds = snortCore.normalizeFeeds(snortFeeds);
			payload = { feeds: snortFeeds };
			if (oink)
				payload.oinkcode = oink.value;
			return callSetConfig(payload).then(function(res) {
				var fail = rpcFail(res, _('Failed to save rule feeds'));
				if (fail)
					return Promise.reject(new Error(fail));
				if (res && res.config && Array.isArray(res.config.feeds))
					snortFeeds = snortCore.normalizeFeeds(res.config.feeds);
				return res;
			});
		}

		function openSnortFeedModal(existing) {
			var nameIn = E('input', {
				type: 'text', id: 'snort-feed-name',
				value: existing ? existing.name : '',
				placeholder: _('Name')
			});
			var urlIn = E('input', {
				type: 'text', id: 'snort-feed-url',
				value: existing ? existing.url : 'https://',
				placeholder: snortCore.COMMUNITY_RULES_URL
			});
			var descIn = E('input', {
				type: 'text', id: 'snort-feed-desc',
				value: existing ? (existing.description || '') : '',
				placeholder: _('Optional description')
			});
			ui.showModal(existing ? _('Edit rule feed') : _('Add rule feed'), [
				E('div', { 'class': 'snort-field' }, [
					E('label', { 'for': 'snort-feed-name' }, _('Name')), nameIn
				]),
				E('div', { 'class': 'snort-field' }, [
					E('label', { 'for': 'snort-feed-url' }, _('URL')), urlIn,
					E('div', { 'class': 'snort-help' },
						_('HTTPS URL to a rules tarball. Use {oinkcode} in the URL if the feed needs a Snort Oinkcode.'))
				]),
				E('div', { 'class': 'snort-field' }, [
					E('label', { 'for': 'snort-feed-desc' }, _('Description')), descIn
				]),
				E('div', { 'class': 'right' }, [
					E('button', {
						'type': 'button',
						'class': 'btn',
						click: ui.hideModal
					}, _('Cancel')),
					' ',
					E('button', {
						'type': 'button',
						'class': 'btn cbi-button-positive',
						click: function() {
							var feed = {
								id: existing ? existing.id : snortCore.sanitizeFeedId(nameIn.value),
								name: nameIn.value,
								url: urlIn.value,
								enabled: existing ? existing.enabled : '1',
								description: descIn.value
							};
							var err = snortCore.validateFeed(feed);
							var next;
							if (err) {
								ui.addNotification(null, E('p', {}, err), 'error');
								return;
							}
							feed = snortCore.normalizeFeeds([feed])[0];
							if (existing) {
								snortFeeds = snortFeeds.map(function(f) {
									return f.id === existing.id ? feed : f;
								});
							} else {
								next = snortCore.validateFeeds(snortFeeds.concat([feed]));
								if (next) {
									ui.addNotification(null, E('p', {}, _('A feed with this name already exists')), 'error');
									return;
								}
								snortFeeds = snortFeeds.concat([feed]);
							}
							persistSnortFeeds().then(function() {
								ui.hideModal();
								paintSnortFeeds();
								ui.addNotification(null, E('p', {}, _('Rule feeds saved')), 4000);
							}).catch(function(e) {
								ui.addNotification(null, E('p', {}, e.message || e), 'error');
							});
						}
					}, _('Save'))
				])
			]);
		}

		function paintSnortFeeds() {
			var table;
			if (!snortFeedsHost)
				return;
			snortFeedsHost.innerHTML = '';
			snortFeedsHost.appendChild(E('h3', {}, _('Rule feeds')));
			snortFeedsHost.appendChild(E('p', { 'class': 'snort-help' },
				_('Manage HTTPS rule tarball URLs. Disable a feed to skip it on the next update.')));
			table = E('div', { 'class': 'table snort-feeds-table' }, [
				E('div', { 'class': 'tr table-titles' }, [
					E('div', { 'class': 'th' }, _('Enabled')),
					E('div', { 'class': 'th' }, _('Name')),
					E('div', { 'class': 'th' }, _('URL')),
					E('div', { 'class': 'th' }, _('Actions'))
				])
			]);
			if (!snortFeeds.length) {
				snortFeedsHost.appendChild(E('p', {},
					_('No rule feeds. Add the Snort 3 community URL or a subscription tarball.')));
			} else {
				snortFeeds.forEach(function(entry) {
					var on = entry.enabled !== '0';
					table.appendChild(E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td' }, [
							E('input', {
								type: 'checkbox',
								checked: on ? 'checked' : null,
								change: function() {
									entry.enabled = this.checked ? '1' : '0';
									persistSnortFeeds().then(paintSnortFeeds).catch(function(e) {
										ui.addNotification(null, E('p', {}, e.message || e), 'error');
										paintSnortFeeds();
									});
								}
							})
						]),
						E('div', { 'class': 'td' }, [
							E('strong', {}, entry.name),
							entry.description
								? E('div', { 'class': 'snort-feed-note' }, entry.description)
								: ''
						]),
						E('div', { 'class': 'td' }, [
							E('code', { 'class': 'snort-feed-url' }, entry.url)
						]),
						E('div', { 'class': 'td' }, [
							E('button', {
								'type': 'button',
								'class': 'btn cbi-button cbi-button-edit',
								click: function(ev) {
									ev.preventDefault();
									openSnortFeedModal(entry);
								}
							}, _('Edit')),
							' ',
							E('button', {
								'type': 'button',
								'class': 'btn cbi-button cbi-button-negative',
								click: function(ev) {
									ev.preventDefault();
									if (!window.confirm(_('Delete rule feed “%s”?').format(entry.name)))
										return;
									snortFeeds = snortFeeds.filter(function(f) {
										return f.id !== entry.id;
									});
									persistSnortFeeds().then(function() {
										paintSnortFeeds();
										ui.addNotification(null, E('p', {}, _('Rule feed deleted')), 4000);
									}).catch(function(e) {
										ui.addNotification(null, E('p', {}, e.message || e), 'error');
									});
								}
							}, _('Delete'))
						])
					]));
				});
				snortFeedsHost.appendChild(table);
			}
			snortFeedsHost.appendChild(E('div', { 'class': 'snort-feeds-toolbar' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button cbi-button-add',
					click: function(ev) {
						ev.preventDefault();
						openSnortFeedModal(null);
					}
				}, _('Add'))
			]));
		}

		function paintSnortUpdate(st, u) {
			var r = (st && st.rules) || {};
			var loc;
			if (!snortUpdateHost)
				return;
			snortUpdateHost.innerHTML = '';
			if (r.symlink)
				loc = E('p', { 'class': 'snort-rules-ok' },
					_('Active symbolic link') + ': /etc/snort/rules → ' + val(r.target));
			else if (r.temp_exists)
				loc = E('p', { 'class': 'snort-rules-warn' },
					_('Rules are in') + ' /var/snort.d/rules. ' +
					_('Create a symbolic link from /var/snort.d/rules to /etc/snort/rules?'));
			else
				loc = E('p', { 'class': 'snort-rules-err' }, _('No rules directory found'));
			snortUpdateHost.appendChild(loc);
			snortUpdateHost.appendChild(E('p', { 'class': 'snort-rules-meta' },
				_('Rule files:') + ' ' + val(r.rule_files, '0')));

			if (u && u.running)
				snortUpdateHost.appendChild(E('p', { 'class': 'snort-status-warn' }, _('Update in progress...')));
			else if (u && u.finished)
				snortUpdateHost.appendChild(E('p', { 'class': 'snort-status-ok' }, _('Update completed!')));
			else
				snortUpdateHost.appendChild(E('p', { 'class': 'snort-help' },
					_('Click on "Update" to start the rules update')));
			snortUpdateHost.appendChild(E('pre', { 'class': 'snort-log-box' }, (u && u.log) || ''));

			snortUpdateHost.appendChild(E('div', { 'class': 'snort-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button cbi-button-apply',
					click: function() {
						persistSnortFeeds().then(function() {
							return callUpdateRules();
						}).then(function(res) {
							var err = rpcFail(res, null);
							if (err)
								ui.addNotification(null, E('p', {}, err), 'error');
							else
								ui.addNotification(null, E('p', {},
									_('Update launched in background. Monitoring starts automatically.')), 4000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Update rules')),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					click: function() {
						if (!window.confirm(_('Create a symbolic link from /var/snort.d/rules to /etc/snort/rules?')))
							return;
						callFixRules().then(function(res) {
							var err = rpcFail(res, _('Error creating symbolic link'));
							if (err)
								ui.addNotification(null, E('p', {}, err), 'error');
							else
								ui.addNotification(null, E('p', {},
									_('Symbolic link created successfully!')), 4000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Create symbolic link')),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					click: function() {
						callCleanupTemp().then(function(res) {
							var err = rpcFail(res, _('Failed'));
							if (err)
								ui.addNotification(null, E('p', {}, err), 'error');
							else
								ui.addNotification(null, E('p', {}, _('Temporary files cleaned')), 4000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Clean temporary files'))
			]));
		}

		function ensureSnortRulesLayout() {
			var oink;
			if (snortFeedsHost)
				return;
			rulesBox.innerHTML = '';
			snortFeedsHost = E('div', { 'class': 'snort-feeds-section' });
			rulesBox.appendChild(snortFeedsHost);
			paintSnortFeeds();
			oink = E('input', {
				type: 'password', id: 'snort-oink',
				value: cfg.oinkcode || '',
				placeholder: _('Enter your Oinkcode if you have one')
			});
			rulesBox.appendChild(E('h3', {}, _('Subscription')));
			rulesBox.appendChild(field('snort-oink', _('Oinkcode'), oink,
				_('Access code for official Snort rules. Used when a feed URL contains {oinkcode}.')));
			snortUpdateHost = E('div', { 'class': 'snort-rules-update' });
			rulesBox.appendChild(snortUpdateHost);
		}

		function renderRules(st, u) {
			ensureSnortRulesLayout();
			paintSnortUpdate(st, u);
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
	},

	handleSave: function() {
		return saveSnortSettings(false);
	},

	handleSaveApply: function() {
		return saveSnortSettings(true);
	},

	handleReset: null
});
