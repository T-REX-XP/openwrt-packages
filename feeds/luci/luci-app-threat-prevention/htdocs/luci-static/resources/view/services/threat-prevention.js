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
				E('div', { 'class': 'tp-field' }, [
					E('label', { 'for': 'tp-feed-name' }, _('Name')), nameIn
				]),
				E('div', { 'class': 'tp-field' }, [
					E('label', { 'for': 'tp-feed-url' }, _('URL')), urlIn,
					E('div', { 'class': 'tp-help' }, _('HTTPS URL to a rules tarball or .rules file'))
				]),
				E('div', { 'class': 'tp-field' }, [
					E('label', { 'for': 'tp-feed-desc' }, _('Description')), descIn
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
			tpFeedsHost.appendChild(E('h3', {}, _('Rule feeds')));
			tpFeedsHost.appendChild(E('p', { 'class': 'tp-help' },
				_('Manage HTTPS rule tarball URLs. Disable a feed to skip it on the next fetch.')));
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
			tpSidHost.appendChild(E('h3', {}, _('Signatures')));
			tpSidHost.appendChild(E('p', { 'class': 'tp-help' },
				_('Search, filter, and disable ET Open signatures. Disabled SIDs are suppressed and kept across rule fetches.')));

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

		function field(id, label, input, help, extra) {
			var control = extra ? E('div', { 'class': 'tp-field-control' }, [ input, extra ]) : input;
			var kids = [
				E('label', { 'for': id }, label),
				control
			];
			if (help)
				kids.push(E('div', { 'class': 'tp-help' }, help));
			return E('div', { 'class': 'tp-field' }, kids);
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
			var mode = E('select', { id: 'tp-mode' }, [
				E('option', { value: 'ids' }, _('IDS (detection only)')),
				E('option', { value: 'ips' }, _('IPS (prevention)'))
			]);
			mode.value = c.mode || 'ids';
			var ipsWarn = E('div', { 'class': 'tp-warn-inline' },
				_('Inline IPS at 2.5 GbE is not recommended on this router. Prefer IDS (detect only).'));
			var profile = E('select', { id: 'tp-profile' }, [
				E('option', { value: 'small' }, _('Small (malware / C2 / web server)')),
				E('option', { value: 'full' }, _('Full ET Open'))
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

			settingsBox.appendChild(E('div', {}, [
				field('tp-enabled', _('Enable IDS'), enabled,
					_('Start Suricata in the selected mode and load this configuration')),
				field('tp-iface', _('Interface'), iface,
					_('Linux device to sniff (br-lan, eth0, …), not the UCI name (lan).')),
				field('tp-home', _('HOME_NET'), home,
					_('CIDR to protect, e.g. 192.168.8.0/24. Square brackets are optional.'),
					useLan),
				field('tp-mode', _('Operating mode'), mode,
					_('IDS = Detection only, IPS = Active prevention')),
				ipsWarn,
				field('tp-profile', _('Rule profile'), profile,
					_('Small loads malware, C2, and web-server rules. Full loads the complete ET Open set. Manage feed URLs on the Rules tab.')),
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
					}, _('Restart Suricata'))
				])
			]));
		}

		renderStatus(status);
		renderEvents(events);
		renderRules({});
		loadRules().catch(function() {});
		renderPolicy(cfg);
		renderSettings(cfg);

		var tabHost = E('div', { 'class': 'tp-tab-host' }, [
			statusBox, eventsBox, rulesBox, policyBox, settingsBox
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
