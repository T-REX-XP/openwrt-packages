'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require network';
'require threat-prevention-core as tpCore';

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

var callGetRules = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'getRules',
	params: [ 'query', 'classtype', 'file', 'state', 'offset', 'limit' ],
	expect: { '': {} }
});

var callGetRule = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'getRule',
	params: [ 'sid', 'gid' ],
	expect: { '': {} }
});

var callSetRuleState = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'setRuleState',
	params: [ 'sid', 'gid', 'enabled' ],
	expect: { '': {} }
});

var callReindexRules = rpc.declare({
	object: 'luci.threat-prevention',
	method: 'reindexRules',
	expect: { '': {} }
});

function val(v, fallback) {
	return (v === undefined || v === null || v === '') ? (fallback || '—') : v;
}

var settingsFeeds = [];

function cbiSection(title, descr, body) {
	return E('div', { 'class': 'cbi-section' }, [
		title ? E('h3', {}, title) : '',
		descr ? E('div', { 'class': 'cbi-section-descr' }, descr) : '',
		E('div', { 'class': 'cbi-section-node' }, body)
	]);
}

function fieldRow(id, title, field, descr) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title', 'for': id }, title),
		E('div', { 'class': 'cbi-value-field' }, [
			field,
			descr ? E('div', { 'class': 'cbi-value-description' }, descr) : ''
		])
	]);
}

function tpBadge(kind, text) {
	return E('span', { 'class': 'tp-badge tp-badge--' + kind }, text);
}

function tpStatusRow(label, value) {
	return E('div', { 'class': 'tp-status-row' }, [
		E('div', { 'class': 'tp-status-label' }, label),
		E('div', { 'class': 'tp-status-value' }, value)
	]);
}

function tpEngineKind(st) {
	if (!st.suricata_present)
		return 'muted';
	if (st.suricata_running)
		return 'yes';
	return 'no';
}

function tpEngineLabel(st) {
	if (!st.suricata_present)
		return _('Not installed');
	if (st.suricata_running)
		return _('Running');
	return _('Not running');
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
		cidr = tpCore.hostCidrToNetwork(addrs[i]);
		if (cidr)
			return cidr;
	}
	return '';
}

function ifaceSelect(id, current, devices) {
	var list = luciDevList(devices);
	var names = tpCore.idsDeviceNames(list, current);
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

function collectTpSettings() {
	var enabled = document.getElementById('tp-enabled');
	var iface = document.getElementById('tp-iface');
	var home = document.getElementById('tp-home');
	var profile = document.getElementById('tp-profile');
	var mode = document.getElementById('tp-mode');
	if (!enabled || !iface || !home || !profile || !mode)
		return { error: _('Settings form is not ready.') };
	return tpCore.collectSettings({
		enabled: enabled.checked,
		interface: iface.value,
		home_net: home.value,
		rule_profile: profile.value,
		mode: mode.value,
		feeds: settingsFeeds
	});
}

function saveTpSettings(apply) {
	var collected = collectTpSettings();
	if (collected.error)
		return Promise.reject(new Error(collected.error));
	return callSetConfig(collected.config).then(function(res) {
		if (res && res.error)
			return Promise.reject(new Error(res.error));
		if (!apply)
			return res;
		return callServiceControl(collected.config.enabled === '1' ? 'restart' : 'stop').then(function(svc) {
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
			callGetConfig(),
			L.resolveDefault(network.getDevices(), []),
			L.resolveDefault(network.getNetwork('lan'), null)
		]);
	},

	render: function(data) {
		var status = data[0] || {};
		var events = (data[1] && data[1].events) || [];
		var cfg = data[2] || {};
		var netDevices = data[3] || [];
		var lanCidr = lanCidrFromNet(data[4]);
		settingsFeeds = tpCore.normalizeFeeds(
			(cfg.feeds && cfg.feeds.length) ? cfg.feeds : tpCore.defaultFeeds()
		);

		var css = E('link', {
			rel: 'stylesheet',
			href: L.resource('threat-prevention-theme.css')
		});

		var hero = E('div', { 'class': 'tp-hero', 'id': 'tp-hero' });
		var root = E('div', { 'class': 'luci-app-threat-prevention' }, [
			E('h2', {}, _('Threat Prevention')),
			E('p', { 'class': 'tp-lead' }, [
				_('Watches devices on your LAN for known attacks using Suricata and Emerging Threats Open. Start in watch-only mode, then download rules on the Rules tab.')
			]),
			E('p', { 'class': 'tp-cross' }, [
				E('a', { href: L.url('admin/services/snort') }, _('Snort3')),
				' · ',
				E('a', { href: L.url('admin/services/blocky') }, _('Blocky')),
				' · ',
				E('a', { href: L.url('admin/services/banip') }, _('banIP'))
			]),
			hero
		]);

		var statusBox = E('div', { 'data-tab': 'status', 'data-tab-title': _('Status') });
		var eventsBox = E('div', { 'data-tab': 'events', 'data-tab-title': _('Events') });
		var rulesBox = E('div', { 'data-tab': 'rules', 'data-tab-title': _('Rules') });
		var policyBox = E('div', { 'data-tab': 'policy', 'data-tab-title': _('Policy') });
		var settingsBox = E('div', { 'data-tab': 'settings', 'data-tab-title': _('Settings') });

		var rulesState = {
			query: '',
			classtype: '',
			file: '',
			state: 'all',
			offset: 0,
			limit: 50
		};
		var tpFeedsHost;
		var tpSidHost;

		function persistTpFeeds() {
			var err = tpCore.validateFeeds(settingsFeeds);
			if (err)
				return Promise.reject(new Error(err));
			settingsFeeds = tpCore.normalizeFeeds(settingsFeeds);
			return callSetConfig({ feeds: settingsFeeds }).then(function(res) {
				if (res && res.error)
					return Promise.reject(new Error(res.error));
				if (res && res.config && Array.isArray(res.config.feeds))
					settingsFeeds = tpCore.normalizeFeeds(res.config.feeds);
				return res;
			});
		}

		function runTpFetch() {
			ui.showModal(_('Fetching rules'), [ E('p', {}, _('Downloading enabled feeds…')) ]);
			return persistTpFeeds().then(function() {
				return callFetchRules();
			}).then(function(res) {
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
								return Promise.reject(new Error(_('Rule fetch timed out')));
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
				return loadRules();
			}).catch(function(e) {
				ui.hideModal();
				ui.addNotification(null, E('p', {}, e.message || e), 'error');
			});
		}

		function openTpFeedModal(existing) {
			var nameIn = E('input', {
				type: 'text', id: 'tp-feed-name',
				value: existing ? existing.name : '',
				placeholder: _('Name')
			});
			var urlIn = E('input', {
				type: 'text', id: 'tp-feed-url',
				value: existing ? existing.url : 'https://',
				placeholder: tpCore.ETOPEN_OFFICIAL
			});
			var descIn = E('input', {
				type: 'text', id: 'tp-feed-desc',
				value: existing ? (existing.description || '') : '',
				placeholder: _('Optional description')
			});
			ui.showModal(existing ? _('Edit rule feed') : _('Add rule feed'), [
				fieldRow('tp-feed-name', _('Name'), nameIn,
					_('Short label shown in the table.')),
				fieldRow('tp-feed-url', _('URL'), urlIn,
					_('Must be an https:// address of a .tar.gz rules archive or a .rules file.')),
				fieldRow('tp-feed-desc', _('Description'), descIn,
					_('Optional. Shown under the name.')),
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
								id: existing ? existing.id : tpCore.sanitizeFeedId(nameIn.value),
								name: nameIn.value,
								url: urlIn.value,
								enabled: existing ? existing.enabled : '1',
								description: descIn.value
							};
							var err = tpCore.validateFeed(feed);
							var next;
							if (err) {
								ui.addNotification(null, E('p', {}, err), 'error');
								return;
							}
							feed = tpCore.normalizeFeeds([feed])[0];
							if (existing) {
								settingsFeeds = settingsFeeds.map(function(f) {
									return f.id === existing.id ? feed : f;
								});
							} else {
								next = tpCore.validateFeeds(settingsFeeds.concat([feed]));
								if (next) {
									ui.addNotification(null, E('p', {}, _('A feed with this name already exists')), 'error');
									return;
								}
								settingsFeeds = settingsFeeds.concat([feed]);
							}
							persistTpFeeds().then(function() {
								ui.hideModal();
								paintTpFeeds();
								ui.addNotification(null, E('p', {}, _('Rule feeds saved')), 4000);
							}).catch(function(e) {
								ui.addNotification(null, E('p', {}, e.message || e), 'error');
							});
						}
					}, _('Save'))
				])
			]);
		}

		function paintTpFeeds() {
			var table;
			if (!tpFeedsHost)
				return;
			tpFeedsHost.innerHTML = '';
			tpFeedsHost.appendChild(cbiSection(_('Rule feeds'),
				_('A feed is an HTTPS address of a rules tarball. Tick Enabled for feeds to download. Official ET Open is the usual starting point.'),
				[]));
			table = E('div', { 'class': 'table tp-feeds-table' }, [
				E('div', { 'class': 'tr table-titles' }, [
					E('div', { 'class': 'th' }, _('Enabled')),
					E('div', { 'class': 'th' }, _('Name')),
					E('div', { 'class': 'th' }, _('URL')),
					E('div', { 'class': 'th' }, _('Actions'))
				])
			]);
			if (!settingsFeeds.length) {
				tpFeedsHost.appendChild(E('p', {},
					_('No rule feeds. Add the official ET Open URL or a custom HTTPS feed.')));
			} else {
				settingsFeeds.forEach(function(entry) {
					var on = entry.enabled !== '0';
					table.appendChild(E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td' }, [
							E('input', {
								type: 'checkbox',
								checked: on ? 'checked' : null,
								change: function() {
									entry.enabled = this.checked ? '1' : '0';
									persistTpFeeds().then(paintTpFeeds).catch(function(e) {
										ui.addNotification(null, E('p', {}, e.message || e), 'error');
										paintTpFeeds();
									});
								}
							})
						]),
						E('div', { 'class': 'td' }, [
							E('strong', {}, entry.name),
							entry.description
								? E('div', { 'class': 'tp-feed-note' }, entry.description)
								: ''
						]),
						E('div', { 'class': 'td' }, [
							E('code', { 'class': 'tp-feed-url' }, entry.url)
						]),
						E('div', { 'class': 'td' }, [
							E('button', {
								'type': 'button',
								'class': 'btn cbi-button cbi-button-edit',
								click: function(ev) {
									ev.preventDefault();
									openTpFeedModal(entry);
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
									settingsFeeds = settingsFeeds.filter(function(f) {
										return f.id !== entry.id;
									});
									persistTpFeeds().then(function() {
										paintTpFeeds();
										ui.addNotification(null, E('p', {}, _('Rule feed deleted')), 4000);
									}).catch(function(e) {
										ui.addNotification(null, E('p', {}, e.message || e), 'error');
									});
								}
							}, _('Delete'))
						])
					]));
				});
				tpFeedsHost.appendChild(table);
			}
			tpFeedsHost.appendChild(E('div', { 'class': 'tp-feeds-toolbar' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button cbi-button-add',
					click: function(ev) {
						ev.preventDefault();
						openTpFeedModal(null);
					}
				}, _('Add')),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button cbi-button-apply',
					click: function(ev) {
						ev.preventDefault();
						runTpFetch();
					}
				}, _('Fetch now'))
			]));
		}

		function ensureRulesLayout() {
			if (tpFeedsHost)
				return;
			rulesBox.innerHTML = '';
			tpFeedsHost = E('div', { 'class': 'tp-feeds-section' });
			tpSidHost = E('div', { 'class': 'tp-sid-section' });
			rulesBox.appendChild(tpFeedsHost);
			rulesBox.appendChild(tpSidHost);
			paintTpFeeds();
		}

		function paintHero(st) {
			var note;
			hero.innerHTML = '';
			hero.appendChild(tpBadge(tpEngineKind(st), tpEngineLabel(st)));
			if (!st.suricata_present)
				note = _('The Suricata engine is not installed on this router.');
			else if (st.suricata_running)
				note = _('Watching %s in %s mode.').format(val(st.interface), val(st.mode, 'ids').toUpperCase());
			else
				note = _('Protection is off. Enable it on the Settings tab, then Save & Apply.');
			hero.appendChild(E('div', { 'class': 'tp-hero-copy' }, [
				E('strong', {}, tpEngineLabel(st)),
				E('span', { 'class': 'tp-hero-note' }, note)
			]));
		}

		function renderStatus(st) {
			var steps = [];
			statusBox.innerHTML = '';
			paintHero(st);
			statusBox.appendChild(cbiSection(_('Service status'),
				_('This is a watch-only intrusion detector by default. It records suspicious traffic; it does not block it unless you switch to prevention mode.'),
				[
					E('div', { 'class': 'tp-status-grid' }, [
						tpStatusRow(_('Engine'), tpBadge(tpEngineKind(st), tpEngineLabel(st))),
						tpStatusRow(_('Watching'), val(st.interface)),
						tpStatusRow(_('Mode'), (st.mode === 'ips') ? _('Prevention (IPS)') : _('Watch only (IDS)')),
						tpStatusRow(_('Alerts stored'), val(st.events, '0')),
						tpStatusRow(_('Rule set'), st.etopen_state === 'fetching'
							? _('Downloading…')
							: val(st.etopen_mtime, _('Never downloaded')))
					])
				]));
			if (st.etopen_state === 'error' && st.etopen_error)
				statusBox.appendChild(E('p', { 'class': 'alert-message error' }, st.etopen_error));
			if (!st.suricata_present)
				steps.push(_('Install the Suricata packages, then reload this page.'));
			else {
				if (!st.suricata_running)
					steps.push(_('Open Settings, tick Enable protection, and click Save & Apply.'));
				if (!st.etopen_mtime)
					steps.push(_('Open the Rules tab and click Fetch now so signatures are on the router.'));
				if (st.suricata_running && st.etopen_mtime)
					steps.push(_('Leave this running. New matches appear on the Events tab.'));
			}
			statusBox.appendChild(E('div', { 'class': 'tp-next' }, [
				E('strong', {}, _('What to do next')),
				E('ol', {}, steps.map(function(s) { return E('li', {}, s); }))
			]));
			statusBox.appendChild(E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-apply',
					click: function() {
						callServiceControl('start').then(function(res) {
							if (res && res.ok === false)
								ui.addNotification(null, E('p', {}, res.output || _('Start failed')), 'error');
							else
								ui.addNotification(null, E('p', {}, _('Suricata started')), 4000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Start')),
				E('button', {
					'type': 'button',
					'class': 'cbi-button',
					click: function() {
						callServiceControl('stop').then(function(res) {
							if (res && res.ok === false)
								ui.addNotification(null, E('p', {}, res.output || _('Stop failed')), 'error');
							else
								ui.addNotification(null, E('p', {}, _('Suricata stopped')), 4000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Stop')),
				E('button', {
					'type': 'button',
					'class': 'cbi-button',
					click: function() {
						callServiceControl('restart').then(function(res) {
							if (res && res.ok === false)
								ui.addNotification(null, E('p', {}, res.output || _('Restart failed')), 'error');
							else
								ui.addNotification(null, E('p', {}, _('Suricata restarted')), 4000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Restart'))
			]));
		}

		function renderEvents(list) {
			eventsBox.innerHTML = '';
			eventsBox.appendChild(cbiSection(_('Recent alerts'),
				_('Each row is a signature that matched traffic on the watched interface. Empty is normal on a quiet network.'),
				[]));
			if (!list.length) {
				eventsBox.appendChild(E('div', { 'class': 'tp-empty' }, [
					E('p', {}, _('No alerts yet.')),
					E('ol', {}, [
						E('li', {}, _('Enable protection on Settings and Save & Apply.')),
						E('li', {}, _('On Rules, click Fetch now so signatures are downloaded.')),
						E('li', {}, _('Wait for LAN traffic. Harmless probes may appear first.'))
					])
				]));
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

		function loadRules() {
			return callGetRules(
				tpCore.sanitizeRuleQuery(rulesState.query),
				rulesState.classtype,
				rulesState.file,
				rulesState.state,
				rulesState.offset,
				tpCore.clampRuleLimit(rulesState.limit)
			).then(function(res) {
				renderRules(res || {});
				return res;
			});
		}

		function showRule(sid, gid) {
			if (!tpCore.validSid(sid))
				return;
			callGetRule(sid, gid || '1').then(function(rule) {
				if (rule && rule.error)
					return Promise.reject(new Error(rule.error));
				ui.showModal(_('Signature %s').format(sid), [
					E('p', { 'class': 'tp-help' }, [
						val(rule.file), ' · ',
						val(rule.classtype), ' · ',
						'rev ' + val(rule.rev, '0')
					]),
					E('pre', { 'class': 'tp-rule-raw' }, val(rule.raw, '')),
					E('div', { 'class': 'right' }, [
						E('button', {
							'type': 'button',
							'class': 'btn',
							click: ui.hideModal
						}, _('Close'))
					])
				]);
			}).catch(function(e) {
				ui.addNotification(null, E('p', {}, e.message || e), 'error');
			});
		}

		function renderRules(res) {
			var list = (res && res.rules) || [];
			var total = Number(res && res.total) || 0;
			var files = (res && res.files) || [];
			var classes = (res && res.classtypes) || [];
			var indexed = !!(res && res.indexed);
			var indexedCount = Number(res && res.indexed_count) || 0;
			var disabledCount = Number(res && res.disabled_count) || 0;
			var from;
			var to;
			var search;
			var fileSel;
			var classSel;
			var stateSel;
			var i;
			var opt;

			ensureRulesLayout();
			tpSidHost.innerHTML = '';
			tpSidHost.appendChild(cbiSection(_('Signatures'),
				_('Search the downloaded rules. Untick a signature to silence it; that choice is kept when you fetch feeds again.'),
				[]));

			search = E('input', {
				type: 'search',
				id: 'tp-rule-q',
				placeholder: _('SID, message, class, or file'),
				value: rulesState.query
			});
			fileSel = E('select', { id: 'tp-rule-file' }, [
				E('option', { value: '' }, _('All files'))
			]);
			for (i = 0; i < files.length; i++) {
				opt = E('option', { value: files[i] }, files[i]);
				fileSel.appendChild(opt);
			}
			fileSel.value = rulesState.file;
			classSel = E('select', { id: 'tp-rule-class' }, [
				E('option', { value: '' }, _('All classes'))
			]);
			for (i = 0; i < classes.length; i++) {
				opt = E('option', { value: classes[i] }, classes[i]);
				classSel.appendChild(opt);
			}
			classSel.value = rulesState.classtype;
			stateSel = E('select', { id: 'tp-rule-state' }, [
				E('option', { value: 'all' }, _('All states')),
				E('option', { value: 'enabled' }, _('Enabled')),
				E('option', { value: 'disabled' }, _('Disabled'))
			]);
			stateSel.value = rulesState.state;

			function applyFilters(ev) {
				if (ev)
					ev.preventDefault();
				rulesState.query = tpCore.sanitizeRuleQuery(search.value);
				rulesState.file = fileSel.value;
				rulesState.classtype = classSel.value;
				rulesState.state = stateSel.value;
				rulesState.offset = 0;
				loadRules().catch(function(e) {
					ui.addNotification(null, E('p', {}, e.message || e), 'error');
				});
			}

			search.addEventListener('keydown', function(ev) {
				if (ev.key === 'Enter')
					applyFilters(ev);
			});

			tpSidHost.appendChild(E('div', { 'class': 'tp-toolbar' }, [
				search,
				fileSel,
				classSel,
				stateSel,
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					click: applyFilters
				}, _('Search')),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					click: function(ev) {
						ev.preventDefault();
						ui.showModal(_('Indexing rules'), [ E('p', {}, _('Reading signature files…')) ]);
						callReindexRules().then(function(out) {
							ui.hideModal();
							if (out && out.error && !out.ok)
								return Promise.reject(new Error(out.error || out.output));
							rulesState.offset = 0;
							return loadRules();
						}).then(function() {
							ui.addNotification(null, E('p', {}, _('Rule index updated')), 4000);
						}).catch(function(e) {
							ui.hideModal();
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Reindex'))
			]));

			tpSidHost.appendChild(E('p', { 'class': 'tp-help' },
				_('Indexed: %s · Disabled: %s').format(indexedCount, disabledCount)));

			if (!indexed) {
				tpSidHost.appendChild(E('p', {},
					_('No rule index yet. Fetch rules from this tab, then reindex.')));
				return;
			}
			if (!list.length) {
				tpSidHost.appendChild(E('p', {}, _('No matching signatures.')));
				return;
			}

			var table = E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Enabled')),
					E('th', { 'class': 'th' }, _('SID')),
					E('th', { 'class': 'th' }, _('Class')),
					E('th', { 'class': 'th' }, _('File')),
					E('th', { 'class': 'th' }, _('Message'))
				])
			]);
			list.forEach(function(row) {
				var sid = String(row.sid || '');
				var gid = String(row.gid || '1');
				var on = row.enabled !== '0';
				var toggle = E('input', {
					type: 'checkbox',
					checked: on ? 'checked' : null,
					change: function() {
						var next = this.checked ? '1' : '0';
						callSetRuleState(sid, gid, next).then(function(out) {
							if (out && out.error)
								return Promise.reject(new Error(out.error));
							return loadRules();
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
							loadRules();
						});
					}
				});
				var sidLink = E('a', {
					href: '#',
					click: function(ev) {
						ev.preventDefault();
						showRule(sid, gid);
					}
				}, sid);
				var trClass = 'tr';
				if (!on)
					trClass += ' tp-rule--off';
				if (row.in_profile === false)
					trClass += ' tp-rule--unloaded';
				table.appendChild(E('tr', { 'class': trClass }, [
					E('td', { 'class': 'td' }, [ toggle ]),
					E('td', { 'class': 'td' }, [ sidLink ]),
					E('td', { 'class': 'td' }, val(row.classtype)),
					E('td', { 'class': 'td' }, val(row.file)),
					E('td', { 'class': 'td' }, val(row.msg))
				]));
			});
			tpSidHost.appendChild(table);

			from = total ? (rulesState.offset + 1) : 0;
			to = rulesState.offset + list.length;
			tpSidHost.appendChild(E('div', { 'class': 'tp-pager' }, [
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					'disabled': rulesState.offset <= 0 ? true : null,
					click: function(ev) {
						ev.preventDefault();
						if (rulesState.offset <= 0)
							return;
						rulesState.offset = Math.max(0, rulesState.offset - rulesState.limit);
						loadRules();
					}
				}, _('Previous')),
				E('span', {}, _('Showing %s–%s of %s').format(from, to, total)),
				E('button', {
					'type': 'button',
					'class': 'btn cbi-button',
					'disabled': (rulesState.offset + list.length) >= total ? true : null,
					click: function(ev) {
						ev.preventDefault();
						if ((rulesState.offset + list.length) >= total)
							return;
						rulesState.offset += rulesState.limit;
						loadRules();
					}
				}, _('Next'))
			]));
		}

		function renderPolicy(c) {
			policyBox.innerHTML = '';
			policyBox.appendChild(cbiSection(_('Alert categories'),
				_('Each classtype is a kind of attack (malware, web, admin). Actions stay on Alert so the detector only records matches. Blocking is a later, advanced step.'),
				[]));
			var classes = c.classtypes || [];
			if (!classes.length) {
				policyBox.appendChild(E('p', { 'class': 'tp-empty' }, _('No classtype sections in UCI yet.')));
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

		function renderSettings(c) {
			settingsBox.innerHTML = '';
			var enabled = E('input', { type: 'checkbox', id: 'tp-enabled' });
			enabled.checked = c.enabled === '1' || c.enabled === 1;
			var iface = ifaceSelect('tp-iface', val(c.interface, 'br-lan'), netDevices);
			var homeNet = tpCore.unwrapNet(c.home_net);
			if (!homeNet)
				homeNet = lanCidr;
			var home = E('input', {
				type: 'text', id: 'tp-home',
				value: homeNet,
				placeholder: lanCidr || _('LAN subnet from Status → Network')
			});
			var useLan = E('button', {
				'type': 'button',
				'class': 'cbi-button',
				'disabled': lanCidr ? null : true,
				click: function(ev) {
					ev.preventDefault();
					if (lanCidr)
						home.value = lanCidr;
				}
			}, _('Use LAN subnet'));
			var mode = E('select', { id: 'tp-mode' }, [
				E('option', { value: 'ids' }, _('Watch only — log attacks (recommended)')),
				E('option', { value: 'ips' }, _('Prevention — try to block attacks'))
			]);
			mode.value = c.mode || 'ids';
			var ipsWarn = E('div', { 'class': 'tp-warn-inline' },
				_('Prevention mode sits in the packet path and can slow a fast LAN. Stay on Watch only unless you have tested blocking on this device.'));
			var profile = E('select', { id: 'tp-profile' }, [
				E('option', { value: 'small' }, _('Small — malware, C2, and web server rules')),
				E('option', { value: 'full' }, _('Full — every ET Open rule'))
			]);
			profile.value = c.rule_profile || 'small';
			function syncWarns() {
				if (mode.value === 'ips')
					ipsWarn.classList.add('is-visible');
				else
					ipsWarn.classList.remove('is-visible');
			}
			mode.addEventListener('change', syncWarns);
			syncWarns();

			settingsBox.appendChild(cbiSection(_('Service'),
				_('Turn protection on, then Save & Apply. Download rules on the Rules tab if you have not already.'),
				[
					fieldRow('tp-enabled', _('Enable protection'), enabled,
						_('Start Suricata and load this configuration.'))
				]));
			settingsBox.appendChild(cbiSection(_('Network'),
				_('Watch the LAN bridge so phones, PCs, and IoT behind the router are covered. Do not pick the UCI name “lan” — pick the Linux device such as br-lan.'),
				[
					fieldRow('tp-iface', _('Listen on'), iface,
						_('Usually br-lan. This is the Linux device name, not the firewall zone.')),
					fieldRow('tp-home', _('Home network'),
						E('div', { 'class': 'tp-field-control' }, [ home, useLan ]),
						_('IPv4 prefix treated as trusted (HOME_NET), for example 192.168.8.0/24. Square brackets are optional. Use LAN subnet fills the live LAN prefix when LuCI can read it.'))
				]));
			settingsBox.appendChild(cbiSection(_('Detection'),
				_('Watch only records matches. Prevention tries to drop them. Rule size is independent of feeds — feeds are on the Rules tab.'),
				[
					fieldRow('tp-mode', _('Operating mode'), mode,
						_('Watch only = detect and log. Prevention = inline blocking.')),
					ipsWarn,
					fieldRow('tp-profile', _('How many rules to load'), profile,
						_('Small is enough for most home routers. Full loads the complete ET Open set and uses more memory.'))
				]));
			settingsBox.appendChild(E('div', { 'class': 'cbi-page-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-save',
					click: function(ev) {
						ev.preventDefault();
						saveTpSettings(true).then(function() {
							ui.addNotification(null, E('p', {}, _('Saved. Suricata will start if Enable protection is on.')), 5000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}
				}, _('Save & apply')),
				E('button', {
					'type': 'button',
					'class': 'cbi-button',
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
				}, _('Restart Suricata'))
			]));
		}

		renderStatus(status);
		renderEvents(events);
		renderRules({});
		loadRules().catch(function() {});
		renderPolicy(cfg);
		renderSettings(cfg);

		var tabHost = E('div', { 'class': 'tp-tab-host' }, [
			statusBox, settingsBox, rulesBox, eventsBox, policyBox
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
