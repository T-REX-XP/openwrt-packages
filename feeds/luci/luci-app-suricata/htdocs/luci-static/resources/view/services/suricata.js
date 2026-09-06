'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require network';
'require fs';
'require suricata-core as suricataCore';

var callGetStatus = rpc.declare({
	object: 'luci.suricata',
	method: 'getStatus',
	expect: { '': {} }
});

var callGetEvents = rpc.declare({
	object: 'luci.suricata',
	method: 'getEvents',
	params: [ 'limit' ],
	expect: { '': {} }
});

var callGetConfig = rpc.declare({
	object: 'luci.suricata',
	method: 'getConfig',
	expect: { '': {} }
});

var callSetConfig = rpc.declare({
	object: 'luci.suricata',
	method: 'setConfig',
	params: [ 'config' ],
	expect: { '': {} }
});

var callServiceControl = rpc.declare({
	object: 'luci.suricata',
	method: 'serviceControl',
	params: [ 'action' ],
	expect: { '': {} }
});

var callFetchRules = rpc.declare({
	object: 'luci.suricata',
	method: 'fetchRules',
	expect: { '': {} }
});

var callGetRules = rpc.declare({
	object: 'luci.suricata',
	method: 'getRules',
	params: [ 'query', 'classtype', 'file', 'state', 'offset', 'limit' ],
	expect: { '': {} }
});

var callGetRule = rpc.declare({
	object: 'luci.suricata',
	method: 'getRule',
	params: [ 'sid', 'gid' ],
	expect: { '': {} }
});

var callSetRuleState = rpc.declare({
	object: 'luci.suricata',
	method: 'setRuleState',
	params: [ 'sid', 'gid', 'enabled' ],
	expect: { '': {} }
});

var callSetRuleStates = rpc.declare({
	object: 'luci.suricata',
	method: 'setRuleStates',
	params: [ 'sids', 'gid', 'enabled', 'status', 'action' ],
	expect: { '': {} }
});

var callSetRuleTune = rpc.declare({
	object: 'luci.suricata',
	method: 'setRuleTune',
	params: [ 'tune' ],
	expect: { '': {} }
});

var callGetPolicies = rpc.declare({
	object: 'luci.suricata',
	method: 'getPolicies',
	expect: { '': {} }
});

var callSetPolicies = rpc.declare({
	object: 'luci.suricata',
	method: 'setPolicies',
	params: [ 'policies' ],
	expect: { '': {} }
});

var callReindexRules = rpc.declare({
	object: 'luci.suricata',
	method: 'reindexRules',
	expect: { '': {} }
});

var callNotifyTest = rpc.declare({
	object: 'luci.suricata',
	method: 'notifyTest',
	params: [ 'id' ],
	expect: { '': {} }
});

function val(v, fallback) {
	return (v === undefined || v === null || v === '') ? (fallback || '—') : v;
}

function tpCatalogEntry(feed) {
	var rows = suricataCore.knownFeeds();
	var i;
	var id = feed && feed.id;
	var url = feed && feed.url;
	for (i = 0; i < rows.length; i++) {
		if ((id && rows[i].id === id) || (url && rows[i].url === url))
			return rows[i];
	}
	return feed || {};
}

function tpCatalogName(feed) {
	var row = tpCatalogEntry(feed);
	return row.name || '';
}

function tpCatalogDesc(feed) {
	var row = tpCatalogEntry(feed);
	return row.description || '';
}

var settingsFeeds = [];
var settingsSuppress = [];
var settingsNotify = [];

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

function tuneField(id, title, field, descr) {
	return E('div', { 'class': 'tp-tune-field' }, [
		E('label', { 'class': 'tp-tune-field-title', 'for': id }, title),
		E('div', { 'class': 'tp-tune-field-control' }, [ field ]),
		descr ? E('p', { 'class': 'tp-tune-field-help' }, descr) : ''
	]);
}

function tpBadge(kind, text) {
	return E('span', { 'class': 'tp-badge tp-badge--' + kind }, text);
}

function ruleStatusInfo(row) {
	var st = (row && row.status) || ((row && row.enabled) === '0' ? 'disabled' : 'enabled');
	if (st === 'review')
		return { id: 'review', kind: 'warn', label: _('Review'), on: true };
	if (st === 'expired')
		return { id: 'expired', kind: 'muted', label: _('Expired'), on: false };
	if (st === 'disabled' || (row && row.enabled === '0'))
		return { id: 'disabled', kind: 'no', label: _('Disabled'), on: false };
	return { id: 'enabled', kind: 'yes', label: _('Enabled'), on: true };
}

var ICON_GLYPHS = {
	enable: '✓',
	disable: '✕',
	review: '▤',
	expire: '▣',
	edit: '✎',
	delete: '✕',
	add: '+',
	catalog: '☰',
	fetch: '↓',
	search: '⌕',
	prev: '‹',
	next: '›',
	reindex: '↻',
	link: '↔',
	clean: '⌫',
	test: '?'
};

function iconActionEnabled(statusId, kind) {
	if (kind === 'enable')
		return statusId !== 'enabled';
	if (kind === 'disable')
		return statusId === 'enabled' || statusId === 'review';
	if (kind === 'review')
		return statusId !== 'review';
	if (kind === 'expire')
		return statusId !== 'expired';
	return true;
}

function iconBtn(title, kind, fn, enabled) {
	var on = enabled !== false;
	var tip = title;
	if (!on) {
		if (kind === 'enable')
			tip = _('Already enabled');
		else if (kind === 'disable')
			tip = _('Already disabled');
		else if (kind === 'review')
			tip = _('Already set to review');
		else if (kind === 'expire')
			tip = _('Already expired');
	}
	return E('span', { 'class': 'tp-icon-wrap', 'title': tip }, [
		E('button', {
			'type': 'button',
			'class': 'tp-icon-btn tp-icon-btn--' + kind,
			'title': tip,
			'aria-label': tip,
			'disabled': on ? null : true,
			click: function(ev) {
				ev.preventDefault();
				if (!on)
					return;
				fn();
			}
		}, ICON_GLYPHS[kind] || '•')
	]);
}

function labeledActionBtn(label, cls, title, fn, kind) {
	var kids = [];
	if (kind && ICON_GLYPHS[kind])
		kids.push(E('span', { 'class': 'tp-btn-glyph', 'aria-hidden': 'true' }, ICON_GLYPHS[kind]));
	kids.push(E('span', {}, label));
	return E('button', {
		'type': 'button',
		'class': 'btn tp-labeled-btn ' + cls,
		'title': title,
		'aria-label': title,
		click: function(ev) {
			ev.preventDefault();
			fn();
		}
	}, kids);
}

var ruleActionBusy = false;

function progressPanel(msg) {
	return E('div', { 'class': 'luci-app-suricata' }, [
		E('div', { 'class': 'tp-progress', role: 'status', 'aria-live': 'polite' }, [
			E('span', { 'class': 'tp-progress-spinner', 'aria-hidden': 'true' }),
			E('p', { 'class': 'tp-progress-msg' }, msg)
		])
	]);
}

function showProgress(title, msg) {
	ui.showModal(title, [ progressPanel(msg) ]);
}

function withProgress(title, msg, work) {
	if (ruleActionBusy)
		return Promise.reject({ busy: true });
	ruleActionBusy = true;
	showProgress(title, msg);
	return Promise.resolve().then(work).then(function(v) {
		ui.hideModal();
		ruleActionBusy = false;
		return v;
	}, function(e) {
		ui.hideModal();
		ruleActionBusy = false;
		throw e;
	});
}

function isBusyErr(e) {
	return !!(e && e.busy);
}

function ruleStatusBusyMsg(status) {
	if (status === 'enabled')
		return _('Enabling signature… Applying Suricata policy…');
	if (status === 'disabled')
		return _('Disabling signature… Applying Suricata policy…');
	if (status === 'review')
		return _('Marking signature for review… Applying Suricata policy…');
	if (status === 'expired')
		return _('Expiring signature… Applying Suricata policy…');
	return _('Updating signature… Applying Suricata policy…');
}

function ruleStatusDoneMsg(status) {
	if (status === 'enabled')
		return _('Signature enabled');
	if (status === 'disabled')
		return _('Signature disabled');
	if (status === 'review')
		return _('Signature set to review');
	if (status === 'expired')
		return _('Signature expired');
	return _('Signature updated');
}

function ruleTagPills(row) {
	var tags = suricataCore.displayRuleTags(row && row.raw, {
		classtype: row && row.classtype,
		tags: row && row.tags
	});
	var i;
	var kids = [];

	if (!tags.length)
		return E('span', { 'class': 'tp-muted' }, '—');
	for (i = 0; i < tags.length; i++)
		kids.push(E('span', {
			'class': 'tp-tag-pill tp-tag-pill--' + tags[i].tone,
			'title': tags[i].label
		}, tags[i].label));
	return E('div', { 'class': 'tp-tag-pills' }, kids);
}

function tpStatusRow(label, value) {
	return E('div', { 'class': 'tp-status-row' }, [
		E('div', { 'class': 'tp-status-label' }, label),
		E('div', { 'class': 'tp-status-value' }, value)
	]);
}

function actionSelect(id, value, includeEmpty) {
	var opts = [];
	if (includeEmpty)
		opts.push(E('option', { value: '' }, _('Unchanged')));
	opts.push(E('option', { value: 'alert' }, _('Alert')));
	opts.push(E('option', { value: 'drop' }, _('Drop')));
	opts.push(E('option', { value: 'reject' }, _('Reject')));
	opts.push(E('option', { value: 'pass' }, _('Pass')));
	var sel = E('select', { id: id }, opts);
	sel.value = value || (includeEmpty ? '' : 'alert');
	return sel;
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
		cidr = suricataCore.hostCidrToNetwork(addrs[i]);
		if (cidr)
			return cidr;
	}
	return '';
}

function ifaceSelect(id, current, devices) {
	var list = luciDevList(devices);
	var names = suricataCore.idsDeviceNames(list, current);
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

function notifyCardVal(card, name) {
	var el = card.querySelector('[data-nf="' + name + '"]');
	if (!el)
		return '';
	if (el.type === 'checkbox')
		return el.checked ? '1' : '0';
	return el.value;
}

function collectNotifyFromDom() {
	var host = document.getElementById('tp-notify-list');
	var cards;
	var i;
	var card;
	var out = [];
	var typ;
	var url;
	if (!host)
		return settingsNotify.slice();
	cards = host.querySelectorAll('.tp-notify-card');
	for (i = 0; i < cards.length; i++) {
		card = cards[i];
		typ = notifyCardVal(card, 'type') || 'telegram';
		url = '';
		if (typ === 'ntfy')
			url = notifyCardVal(card, 'url');
		else if (typ === 'webhook' || typ === 'discord')
			url = notifyCardVal(card, 'url2');
		out.push({
			id: card.getAttribute('data-id') || '',
			type: typ,
			enabled: notifyCardVal(card, 'enabled'),
			mode: notifyCardVal(card, 'mode'),
			min_severity: notifyCardVal(card, 'min_severity'),
			rate_limit: notifyCardVal(card, 'rate_limit'),
			interval: notifyCardVal(card, 'interval'),
			classtype: notifyCardVal(card, 'classtype'),
			sid_allow: notifyCardVal(card, 'sid_allow'),
			sid_deny: notifyCardVal(card, 'sid_deny'),
			include_lan: notifyCardVal(card, 'include_lan'),
			chat_id: notifyCardVal(card, 'chat_id'),
			bot_token: notifyCardVal(card, 'bot_token'),
			url: url,
			topic: notifyCardVal(card, 'topic'),
			token: notifyCardVal(card, 'token'),
			header: notifyCardVal(card, 'header'),
			to: notifyCardVal(card, 'to'),
			msmtp_account: notifyCardVal(card, 'msmtp_account'),
			bot_token_set: card.getAttribute('data-bot-set') || '0',
			token_set: card.getAttribute('data-token-set') || '0',
			header_set: card.getAttribute('data-header-set') || '0'
		});
	}
	return out;
}

function collectTpSettings() {
	var enabled = document.getElementById('tp-enabled');
	var iface = document.getElementById('tp-iface');
	var home = document.getElementById('tp-home');
	var profile = document.getElementById('tp-profile');
	var mode = document.getElementById('tp-mode');
	if (!enabled || !iface || !home || !profile || !mode)
		return { error: _('Settings form is not ready.') };
	return suricataCore.collectSettings({
		enabled: enabled.checked,
		interface: iface.value,
		home_net: home.value,
		rule_profile: profile.value,
		mode: mode.value,
		feeds: settingsFeeds,
		pass: {
			local_nets: !!(document.getElementById('tp-pass-local') && document.getElementById('tp-pass-local').checked),
			wan_gateway: !!(document.getElementById('tp-pass-gw') && document.getElementById('tp-pass-gw').checked),
			wan_dns: !!(document.getElementById('tp-pass-dns') && document.getElementById('tp-pass-dns').checked),
			vpn_addrs: !!(document.getElementById('tp-pass-vpn') && document.getElementById('tp-pass-vpn').checked),
			ips: document.getElementById('tp-pass-ips') ? document.getElementById('tp-pass-ips').value : ''
		},
		suppress: settingsSuppress,
		notify: collectNotifyFromDom()
	});
}

function policyRowEnabled(tr) {
	return !!(tr && tr.getAttribute('data-enabled') === '1');
}

function selectedPolicyRows(pane) {
	var out = [];
	var boxes;
	var i;
	var tr;

	if (!pane)
		return out;
	boxes = pane.querySelectorAll('input.tp-policy-pick:checked');
	for (i = 0; i < boxes.length; i++) {
		tr = boxes[i].parentNode;
		while (tr && tr.tagName !== 'TR')
			tr = tr.parentNode;
		if (tr)
			out.push(tr);
	}
	return out;
}

function collectPolicies() {
	var out = { rulesets: [], classtypes: [] };
	var host = document.getElementById('tp-policy');
	var rows;
	var i;
	var tr;
	var act;

	if (!host)
		return out;
	rows = host.querySelectorAll('tr.tp-rs-row');
	for (i = 0; i < rows.length; i++) {
		tr = rows[i];
		act = tr.querySelector('select');
		out.rulesets.push({
			file: tr.getAttribute('data-file') || '',
			enabled: policyRowEnabled(tr) ? '1' : '0',
			action: act ? act.value : 'alert'
		});
	}
	rows = host.querySelectorAll('tr.tp-cl-row');
	for (i = 0; i < rows.length; i++) {
		tr = rows[i];
		act = tr.querySelector('select');
		out.classtypes.push({
			name: tr.getAttribute('data-name') || '',
			action: act ? act.value : 'alert'
		});
	}
	return out;
}

function saveTpSettings(apply) {
	var collected = collectTpSettings();
	var policies;
	var policyErr;
	var hasPolicy;

	if (collected.error)
		return Promise.reject(new Error(collected.error));
	policies = collectPolicies();
	hasPolicy = policies.rulesets.length > 0 || policies.classtypes.length > 0;
	if (hasPolicy) {
		policyErr = suricataCore.validatePolicies(policies);
		if (policyErr)
			return Promise.reject(new Error(policyErr));
	}
	return callSetConfig(collected.config).then(function(res) {
		if (res && res.error)
			return Promise.reject(new Error(res.error));
		if (!hasPolicy)
			return res;
		return callSetPolicies(policies).then(function(out) {
			if (out && out.error)
				return Promise.reject(new Error(out.error));
			return res;
		});
	}).then(function(res) {
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
			L.resolveDefault(network.getNetwork('lan'), null),
			callGetPolicies(),
			L.resolveDefault(fs.read(suricataCore.CATALOG_PATH), '')
		]);
	},

	render: function(data) {
		var status = data[0] || {};
		var events = (data[1] && data[1].events) || [];
		var cfg = data[2] || {};
		var netDevices = data[3] || [];
		var lanCidr = lanCidrFromNet(data[4]);
		var policies = data[5] || {};
		suricataCore.parseCatalog(data[6]);
		settingsFeeds = suricataCore.normalizeFeeds(
			(cfg.feeds && cfg.feeds.length) ? cfg.feeds : suricataCore.defaultFeeds()
		);
		settingsSuppress = suricataCore.normalizeSuppressList(cfg.suppress);
		settingsNotify = suricataCore.normalizeNotifyList(cfg.notify);
		ruleActionBusy = false;

		var css = E('link', {
			rel: 'stylesheet',
			href: L.resource('suricata-theme.css')
		});

		var hero = E('div', { 'class': 'tp-hero', 'id': 'tp-hero' });
		var root = E('div', { 'class': 'luci-app-suricata' }, [
			E('h2', {}, _('Suricata')),
			E('p', { 'class': 'tp-lead' }, [
				_('Watches devices on your LAN for known attacks using Suricata and Emerging Threats Open. Start in watch-only mode, then download rules on the Rules tab.')
			]),
			hero
		]);

		var statusBox = E('div', { 'data-tab': 'status', 'data-tab-title': _('Status') });
		var eventsBox = E('div', { 'data-tab': 'events', 'data-tab-title': _('Events') });
		var alertsBox = E('div', { 'data-tab': 'alerts', 'data-tab-title': _('Alerts') });
		var rulesBox = E('div', { 'data-tab': 'rules', 'data-tab-title': _('Rules') });
		var policyBox = E('div', { id: 'tp-policy', 'data-tab': 'policy', 'data-tab-title': _('Policy') });
		var passBox = E('div', { id: 'tp-pass', 'data-tab': 'pass', 'data-tab-title': _('Pass list') });
		var suppressBox = E('div', { id: 'tp-suppress', 'data-tab': 'suppress', 'data-tab-title': _('Suppress') });
		var settingsBox = E('div', { 'data-tab': 'settings', 'data-tab-title': _('Settings') });

		var rulesState = {
			query: '',
			classtype: '',
			file: '',
			state: 'all',
			offset: 0,
			limit: 50
		};
		var selectedSids = {};
		var tpFeedsHost;
		var tpSidHost;

		function persistTpFeeds() {
			var err = suricataCore.validateFeeds(settingsFeeds);
			if (err)
				return Promise.reject(new Error(err));
			settingsFeeds = suricataCore.normalizeFeeds(settingsFeeds);
			return callSetConfig({ feeds: settingsFeeds }).then(function(res) {
				if (res && res.error)
					return Promise.reject(new Error(res.error));
				if (res && res.config && Array.isArray(res.config.feeds))
					settingsFeeds = suricataCore.normalizeFeeds(res.config.feeds);
				return res;
			});
		}

		function runTpFetch() {
			return withProgress(_('Fetching rules'), _('Downloading enabled feeds…'), function() {
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
					if (res && res.etopen_state === 'error')
						return Promise.reject(new Error(res.etopen_error || res.output || _('Fetch failed')));
					if (res && res.ok === false)
						return Promise.reject(new Error(res.error || res.output || _('Fetch failed')));
					return loadRules();
				});
			}).then(function() {
				ui.addNotification(null, E('p', {}, _('Rules updated')), 4000);
			}).catch(function(e) {
				if (isBusyErr(e))
					return;
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
				placeholder: suricataCore.ETOPEN_OFFICIAL
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
					_('Must be an https:// address of a .tar.gz, .zip, or .rules file.')),
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
								id: existing ? existing.id : suricataCore.sanitizeFeedId(nameIn.value),
								name: nameIn.value,
								url: urlIn.value,
								enabled: existing ? existing.enabled : '1',
								description: descIn.value
							};
							var err = suricataCore.validateFeed(feed);
							var next;
							if (err) {
								ui.addNotification(null, E('p', {}, err), 'error');
								return;
							}
							feed = suricataCore.normalizeFeeds([feed])[0];
							if (existing) {
								settingsFeeds = settingsFeeds.map(function(f) {
									return f.id === existing.id ? feed : f;
								});
							} else {
								next = suricataCore.validateFeeds(settingsFeeds.concat([feed]));
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

		function addTpCatalogFeed(item) {
			var feed = {
				id: suricataCore.sanitizeFeedId(item.id || item.name),
				name: item.name,
				url: item.url,
				enabled: '1',
				description: item.description || ''
			};
			var err = suricataCore.validateFeed(feed);
			var next;
			if (err) {
				ui.addNotification(null, E('p', {}, err), 'error');
				return Promise.reject(new Error(err));
			}
			feed = suricataCore.normalizeFeeds([feed])[0];
			next = suricataCore.validateFeeds(settingsFeeds.concat([feed]));
			if (next) {
				ui.addNotification(null, E('p', {}, _('A feed with this name already exists')), 'error');
				return Promise.reject(new Error(next));
			}
			settingsFeeds = settingsFeeds.concat([feed]);
			return persistTpFeeds().then(function() {
				paintTpFeeds();
				ui.addNotification(null, E('p', {}, _('Added “%s”. Tick enabled feeds and click Fetch now.').format(tpCatalogName(feed))), 4000);
			});
		}

		function openTpCatalogModal() {
			var unused = suricataCore.unusedKnownFeeds(settingsFeeds);
			var sel;
			var note;
			var i;
			if (!unused.length) {
				ui.addNotification(null, E('p', {}, _('Every catalog ruleset is already in the list.')), 4000);
				return;
			}
			sel = E('select', { id: 'tp-catalog' });
			for (i = 0; i < unused.length; i++)
				sel.appendChild(E('option', { value: unused[i].id }, tpCatalogName(unused[i])));
			note = E('p', { 'class': 'tp-help', id: 'tp-catalog-note' });
			function paintNote() {
				var item = unused.filter(function(x) { return x.id === sel.value; })[0];
				note.textContent = item ? tpCatalogDesc(item) : '';
			}
			sel.addEventListener('change', paintNote);
			paintNote();
			ui.showModal(_('Add from catalog'), [
				fieldRow('tp-catalog', _('Ruleset'), sel,
					_('Public feeds from Emerging Threats, abuse.ch, and the Suricata rule index. After adding, click Fetch now.')),
				note,
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
							var item = unused.filter(function(x) { return x.id === sel.value; })[0];
							if (!item)
								return;
							addTpCatalogFeed(item).then(ui.hideModal).catch(function() {});
						}
					}, _('Add'))
				])
			]);
		}

		function paintTpFeeds() {
			var table;
			var toolbar;
			var enabledCount = 0;
			if (!tpFeedsHost)
				return;
			tpFeedsHost.innerHTML = '';
			tpFeedsHost.appendChild(E('p', { 'class': 'cbi-section-descr' }, [
				_('A feed is an HTTPS address of a rules tarball or zip. Tick Enabled for feeds to download. Official ET Open is the usual starting point. Use Add from catalog for public sets, or Add custom for your own URL.')
			]));
			table = E('div', { 'class': 'table tp-feeds-table' }, [
				E('div', { 'class': 'tr table-titles' }, [
					E('div', { 'class': 'th tp-col-num' }, '#'),
					E('div', { 'class': 'th tp-col-on' }, _('Enabled')),
					E('div', { 'class': 'th tp-col-name' }, _('Name')),
					E('div', { 'class': 'th tp-col-url' }, _('URL')),
					E('div', { 'class': 'th tp-col-actions' }, _('Actions'))
				])
			]);
			if (!settingsFeeds.length) {
				tpFeedsHost.appendChild(E('p', {},
					_('No rule feeds. Add the official ET Open URL or a custom HTTPS feed.')));
			} else {
				settingsFeeds.forEach(function(entry, idx) {
					var on = entry.enabled !== '0';
					var nameTip = tpCatalogDesc(entry)
						? tpCatalogName(entry) + ' — ' + tpCatalogDesc(entry)
						: tpCatalogName(entry);
					if (on)
						enabledCount++;
					table.appendChild(E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td tp-col-num' }, String(idx + 1)),
						E('div', { 'class': 'td tp-col-on' }, [
							E('input', {
								type: 'checkbox',
								title: _('Enable %s').format(tpCatalogName(entry)),
								'aria-label': _('Enable %s').format(tpCatalogName(entry)),
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
						E('div', { 'class': 'td left tp-col-name', title: nameTip }, tpCatalogName(entry)),
						E('div', { 'class': 'td left tp-col-url', title: entry.url }, [
							E('code', { 'class': 'tp-feed-url' }, entry.url)
						]),
						E('div', { 'class': 'td tp-col-actions' }, [
							E('div', { 'class': 'tp-icon-row' }, [
								iconBtn(_('Edit'), 'edit', function() {
									openTpFeedModal(entry);
								}, true),
								iconBtn(_('Delete'), 'delete', function() {
									if (!window.confirm(_('Delete rule feed “%s”?').format(tpCatalogName(entry))))
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
								}, true)
							])
						])
					]));
				});
				tpFeedsHost.appendChild(E('div', { 'class': 'tp-feeds-wrap' }, [ table ]));
			}
			toolbar = [
				labeledActionBtn(_('Add custom'), 'cbi-button cbi-button-positive',
					_('Add a custom HTTPS tarball, zip, or .rules URL'),
					function() {
						openTpFeedModal(null);
					}, 'add'),
				labeledActionBtn(_('Add from catalog'), 'cbi-button',
					_('Pick a public ruleset from Emerging Threats, abuse.ch, or the Suricata rule index'),
					function() {
						openTpCatalogModal();
					}, 'catalog')
			];
			if (enabledCount)
				toolbar.push(labeledActionBtn(_('Fetch now'), 'cbi-button cbi-button-apply',
					_('Download enabled feeds now'),
					function() {
						runTpFetch();
					}, 'fetch'));
			tpFeedsHost.appendChild(E('div', { 'class': 'tp-feeds-toolbar' }, toolbar));
		}

		function ensureRulesLayout() {
			var feedsPane;
			var mgmtPane;
			var inner;
			if (tpFeedsHost)
				return;
			rulesBox.innerHTML = '';
			tpFeedsHost = E('div', { 'class': 'tp-feeds-section' });
			tpSidHost = E('div', { 'class': 'tp-sid-section' });
			feedsPane = E('div', {
				'data-tab': 'rule-feeds',
				'data-tab-title': _('Rule feeds')
			}, [ tpFeedsHost ]);
			mgmtPane = E('div', {
				'data-tab': 'rule-mgmt',
				'data-tab-title': _('Rules management')
			}, [ tpSidHost ]);
			inner = E('div', { 'class': 'tp-rules-inner' }, [ feedsPane, mgmtPane ]);
			rulesBox.appendChild(inner);
			ui.tabs.initTabGroup(inner.childNodes);
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
				suricataCore.sanitizeRuleQuery(rulesState.query),
				rulesState.classtype,
				rulesState.file,
				rulesState.state,
				rulesState.offset,
				suricataCore.clampRuleLimit(rulesState.limit)
			).then(function(res) {
				renderRules(res || {});
				return res;
			});
		}

		function showRule(sid, gid) {
			if (!suricataCore.validSid(sid))
				return;
			callGetRule(sid, gid || '1').then(function(rule) {
				var parsed;
				var status;
				var category;
				var priority;
				var target;
				var threshold;
				var tagIn;
				var tagHost;
				var preview;
				var tags;
				var classes;
				var i;
				if (rule && rule.error)
					return Promise.reject(new Error(rule.error));
				parsed = suricataCore.parseRuleRaw(rule.raw || '');
				status = rule.status || (rule.enabled === '0' ? 'disabled' : 'enabled');
				tags = suricataCore.normalizeTagList(
					(rule.tags && rule.tags.length) ? rule.tags : parsed.tags.map(function(t) {
						return t.key + ':' + t.value;
					})
				);
				classes = rule.classtypes || [];
				category = E('select', { id: 'tp-tune-category' }, [
					E('option', { value: '' }, parsed.classtype || _('Vendor classtype'))
				]);
				for (i = 0; i < classes.length; i++)
					category.appendChild(E('option', { value: classes[i] }, classes[i]));
				if (rule.category)
					category.value = rule.category;
				else if (parsed.classtype && classes.indexOf(parsed.classtype) >= 0)
					category.value = parsed.classtype;
				priority = E('input', {
					type: 'number', id: 'tp-tune-priority',
					min: '1', max: '255', step: '1',
					placeholder: _('e.g. 1'),
					value: rule.priority || parsed.priority || ''
				});
				target = E('select', { id: 'tp-tune-target' }, [
					E('option', { value: '' }, _('Unchanged')),
					E('option', { value: 'src_ip' }, 'src_ip'),
					E('option', { value: 'dest_ip' }, 'dest_ip')
				]);
				target.value = rule.target || parsed.target || '';
				threshold = E('input', {
					type: 'text', id: 'tp-tune-threshold',
					placeholder: 'type limit, track by_src, count 1, seconds 60',
					value: rule.threshold || ''
				});
				preview = E('textarea', {
					id: 'tp-tune-raw',
					'class': 'tp-rule-raw',
					readonly: 'readonly',
					rows: 6
				});
				tagIn = E('input', {
					type: 'text', id: 'tp-tune-tag',
					placeholder: _('Add a tag (key:value)')
				});
				tagHost = E('div', { 'class': 'tp-tag-list' });

				function currentTune() {
					return {
						sid: String(rule.sid),
						gid: String(rule.gid || '1'),
						status: status,
						category: category.value,
						priority: priority.value,
						target: target.value,
						threshold: threshold.value,
						action: rule.tune_action || '',
						tags: tags
					};
				}

				function paintPreview() {
					preview.value = suricataCore.applyRuleTunePreview(rule.raw || '', {
						classtype: category.value,
						priority: priority.value,
						target: target.value,
						action: rule.tune_action || ''
					});
				}

				function paintTags() {
					tagHost.innerHTML = '';
					tags.forEach(function(entry, idx) {
						tagHost.appendChild(E('span', { 'class': 'tp-tag' }, [
							entry,
							' ',
							E('button', {
								'type': 'button',
								'class': 'tp-tag-x',
								click: function(ev) {
									ev.preventDefault();
									tags = tags.filter(function(_, j) { return j !== idx; });
									paintTags();
								}
							}, '×')
						]));
					});
				}

				function statusBtn(id, label, kind) {
					return E('button', {
						'type': 'button',
						'class': 'tp-status-choice tp-status-choice--' + kind +
							(status === id ? ' is-active' : ''),
						'title': label,
						'aria-label': label,
						click: function(ev) {
							var box = document.getElementById('tp-tune-status');
							var btns;
							var n;
							ev.preventDefault();
							status = id;
							if (!box)
								return;
							btns = box.querySelectorAll('.tp-status-choice');
							for (n = 0; n < btns.length; n++)
								btns[n].classList.remove('is-active');
							this.classList.add('is-active');
						}
					}, label);
				}

				paintPreview();
				paintTags();
				category.addEventListener('change', paintPreview);
				priority.addEventListener('input', paintPreview);
				target.addEventListener('change', paintPreview);

				ui.showModal(_('Rules management') + ' → ' + _('SID %s').format(sid), [
					E('div', { 'class': 'luci-app-suricata' }, [
					E('div', { 'class': 'tp-rule-editor' }, [
						E('h4', {}, val(rule.msg, parsed.msg)),
						E('p', { 'class': 'tp-help' }, [
							val(rule.file), ' · rev ', val(rule.rev, '0'), ' · ',
							_('Tunings are stored on the router and kept when feeds are fetched again.')
						]),
						E('label', { 'class': 'tp-tune-label' }, _('Rule')),
						preview,
						E('div', { 'class': 'tp-tune-status', id: 'tp-tune-status' }, [
							statusBtn('enabled', _('Enabled'), 'yes'),
							statusBtn('review', _('Review'), 'warn'),
							statusBtn('expired', _('Expired'), 'muted'),
							statusBtn('disabled', _('Disabled'), 'no')
						]),
						E('div', { 'class': 'tp-tune-grid' }, [
							tuneField('tp-tune-category', _('Category'), category,
								_('Operator label. Empty keeps the vendor classtype.')),
							tuneField('tp-tune-priority', _('Priority'), priority,
								_('1–255. Stored with the SID; Suricata still uses the vendor rule text.')),
							tuneField('tp-tune-target', _('Target'), target,
								_('src_ip or dest_ip. Stored with the SID.')),
							tuneField('tp-tune-threshold', _('Threshold'), threshold,
								_('Applied in threshold.config, for example type limit, track by_src, count 1, seconds 60.'))
						]),
						E('label', { 'class': 'tp-tune-label' }, _('Tags')),
						E('div', { 'class': 'tp-tag-add' }, [
							tagIn,
							E('button', {
								'type': 'button',
								'class': 'btn cbi-button',
								click: function(ev) {
									var next = suricataCore.normalizeTag(tagIn.value);
									ev.preventDefault();
									if (!next) {
										ui.addNotification(null, E('p', {}, _('Use key:value tags.')), 'error');
										return;
									}
									tags = suricataCore.normalizeTagList(tags.concat([next]));
									tagIn.value = '';
									paintTags();
								}
							}, _('Add'))
						]),
						tagHost,
						E('p', { 'class': 'tp-tune-busy', id: 'tp-tune-busy' }, [
							E('span', { 'class': 'tp-progress-spinner', 'aria-hidden': 'true' }),
							E('span', {}, _('Saving signature… Applying Suricata policy…'))
						]),
						E('div', { 'class': 'right' }, [
							E('button', {
								'type': 'button',
								'class': 'btn',
								id: 'tp-tune-close',
								click: ui.hideModal
							}, _('Close')),
							' ',
							E('button', {
								'type': 'button',
								'class': 'btn cbi-button-positive',
								id: 'tp-tune-save',
								click: function(ev) {
									var tune = currentTune();
									var err = suricataCore.validateTune(tune);
									var saveBtn = this;
									var closeBtn = document.getElementById('tp-tune-close');
									var busyEl = document.getElementById('tp-tune-busy');
									ev.preventDefault();
									if (err) {
										ui.addNotification(null, E('p', {}, err), 'error');
										return;
									}
									if (ruleActionBusy)
										return;
									ruleActionBusy = true;
									saveBtn.disabled = true;
									saveBtn.classList.add('spinning');
									if (closeBtn)
										closeBtn.disabled = true;
									if (busyEl)
										busyEl.classList.add('is-on');
									callSetRuleTune(tune).then(function(out) {
										if (out && out.error)
											return Promise.reject(new Error(out.error));
										return loadRules();
									}).then(function() {
										ruleActionBusy = false;
										ui.hideModal();
										ui.addNotification(null, E('p', {}, _('Rule tuning saved')), 4000);
									}).catch(function(e) {
										ruleActionBusy = false;
										saveBtn.disabled = false;
										saveBtn.classList.remove('spinning');
										if (closeBtn)
											closeBtn.disabled = false;
										if (busyEl)
											busyEl.classList.remove('is-on');
										ui.addNotification(null, E('p', {}, e.message || e), 'error');
									});
								}
							}, _('Save'))
						])
					])
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
			var actionBulk;
			var headerCb;
			var i;
			var opt;
			var table;
			var liveSids = {};
			var tableWrap;

			ensureRulesLayout();
			tpSidHost.innerHTML = '';
			tpSidHost.appendChild(E('p', { 'class': 'cbi-section-descr' }, [
				_('Tick rows for bulk changes, or use the icons on a row. Status and action changes stay when feeds are fetched again.')
			]));

			search = E('input', {
				type: 'search',
				id: 'tp-rule-q',
				placeholder: _('Search by Rule SID, Class Type, Message or other attributes…'),
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
				E('option', { value: 'review' }, _('Review')),
				E('option', { value: 'expired' }, _('Expired')),
				E('option', { value: 'disabled' }, _('Disabled'))
			]);
			stateSel.value = rulesState.state;
			actionBulk = actionSelect('tp-rule-set-action', 'alert', false);
			actionBulk.title = _('Action for selected signatures');

			function applyFilters(ev) {
				if (ev)
					ev.preventDefault();
				selectedSids = {};
				rulesState.query = suricataCore.sanitizeRuleQuery(search.value);
				rulesState.file = fileSel.value;
				rulesState.classtype = classSel.value;
				rulesState.state = stateSel.value;
				rulesState.offset = 0;
				loadRules().catch(function(e) {
					ui.addNotification(null, E('p', {}, e.message || e), 'error');
				});
			}

			function selectedList() {
				return suricataCore.normalizeSidList(Object.keys(selectedSids));
			}

			function paintSel() {
				var n = Object.keys(selectedSids).length;
				var el = document.getElementById('tp-sel-count');
				var bulk = document.getElementById('tp-rule-bulk');
				if (el)
					el.textContent = _('Selected: %s').format(n);
				if (bulk)
					bulk.classList.toggle('is-on', n > 0);
			}

			function runBulkStatus(status, msg) {
				var sids = selectedList();
				var n;
				if (!sids) {
					ui.addNotification(null, E('p', {}, _('Tick one or more signatures first.')), 'error');
					return;
				}
				n = sids.length;
				withProgress(_('Updating signatures'),
					_('Updating %s signatures… Applying Suricata policy…').format(n),
					function() {
						return callSetRuleStates(sids, '1', '', status, '').then(function(out) {
							if (out && out.error)
								return Promise.reject(new Error(out.error));
							selectedSids = {};
							return loadRules();
						});
					}).then(function() {
					ui.addNotification(null, E('p', {}, msg), 4000);
				}).catch(function(e) {
					if (isBusyErr(e))
						return;
					ui.addNotification(null, E('p', {}, e.message || e), 'error');
					loadRules();
				});
			}

			function runBulkAction() {
				var sids = selectedList();
				var action = actionBulk.value;
				var n;
				if (!sids) {
					ui.addNotification(null, E('p', {}, _('Tick one or more signatures first.')), 'error');
					return;
				}
				if (!suricataCore.actionOk(action)) {
					ui.addNotification(null, E('p', {}, _('Choose an action first.')), 'error');
					return;
				}
				n = sids.length;
				withProgress(_('Updating signatures'),
					_('Setting action on %s signatures… Applying Suricata policy…').format(n),
					function() {
						return callSetRuleStates(sids, '1', '', '', action).then(function(out) {
							if (out && out.error)
								return Promise.reject(new Error(out.error));
							selectedSids = {};
							return loadRules();
						});
					}).then(function() {
					ui.addNotification(null, E('p', {}, _('Selected signatures set to %s').format(action)), 4000);
				}).catch(function(e) {
					if (isBusyErr(e))
						return;
					ui.addNotification(null, E('p', {}, e.message || e), 'error');
					loadRules();
				});
			}

			function runOneStatus(sid, gid, status) {
				withProgress(_('Updating signature'), ruleStatusBusyMsg(status), function() {
					return callSetRuleStates([sid], gid || '1', '', status, '').then(function(out) {
						if (out && out.error)
							return Promise.reject(new Error(out.error));
						return loadRules();
					});
				}).then(function() {
					ui.addNotification(null, E('p', {}, ruleStatusDoneMsg(status)), 4000);
				}).catch(function(e) {
					if (isBusyErr(e))
						return;
					ui.addNotification(null, E('p', {}, e.message || e), 'error');
					loadRules();
				});
			}

			function runReindex() {
				withProgress(_('Indexing rules'), _('Reading signature files…'), function() {
					return callReindexRules().then(function(out) {
						if (out && out.error && !out.ok)
							return Promise.reject(new Error(out.error || out.output));
						rulesState.offset = 0;
						selectedSids = {};
						return loadRules();
					});
				}).then(function() {
					ui.addNotification(null, E('p', {}, _('Rule index updated')), 4000);
				}).catch(function(e) {
					if (isBusyErr(e))
						return;
					ui.addNotification(null, E('p', {}, e.message || e), 'error');
				});
			}

			search.addEventListener('keydown', function(ev) {
				if (ev.key === 'Enter')
					applyFilters(ev);
			});

			tpSidHost.appendChild(E('div', { 'class': 'tp-rules-head' }, [
				E('div', { 'class': 'tp-rules-actions' }, [
					E('div', { 'id': 'tp-rule-bulk', 'class': 'tp-rule-bulk' }, [
						labeledActionBtn(_('Enable selected'), 'cbi-button-positive',
							_('Enable selected signatures'),
							function() {
								runBulkStatus('enabled', _('Selected signatures enabled'));
							}, 'enable'),
						labeledActionBtn(_('Disable selected'), 'cbi-button-negative',
							_('Disable selected signatures'),
							function() {
								runBulkStatus('disabled', _('Selected signatures disabled'));
							}, 'disable'),
						labeledActionBtn(_('Review selected'), 'cbi-button',
							_('Mark selected signatures for review'),
							function() {
								runBulkStatus('review', _('Selected signatures set to review'));
							}, 'review'),
						labeledActionBtn(_('Expire selected'), 'cbi-button',
							_('Expire selected signatures'),
							function() {
								runBulkStatus('expired', _('Selected signatures expired'));
							}, 'expire'),
						actionBulk,
						labeledActionBtn(_('Set action'), 'cbi-button',
							_('Apply the chosen action to selected signatures'),
							function() {
								runBulkAction();
							}, 'edit')
					]),
					labeledActionBtn(_('Reindex signatures'), 'cbi-button',
						_('Rebuild the local signature index'),
						function() {
							runReindex();
						}, 'reindex')
				]),
				E('div', { 'class': 'tp-rules-search' }, [
					search,
					labeledActionBtn(_('Search'), 'cbi-button cbi-button-apply',
						_('Apply search and filters'),
						applyFilters, 'search')
				])
			]));
			tpSidHost.appendChild(E('div', { 'class': 'tp-toolbar' }, [
				fileSel,
				classSel,
				stateSel
			]));
			tpSidHost.appendChild(E('p', { 'class': 'tp-help' }, [
				_('Indexed: %s · Disabled: %s').format(indexedCount, disabledCount),
				' · ',
				E('span', { id: 'tp-sel-count' }, _('Selected: %s').format(Object.keys(selectedSids).length))
			]));

			if (!indexed) {
				tpSidHost.appendChild(E('p', {},
					_('No rule index yet. Fetch rules from this tab, then reindex.')));
				return;
			}
			if (!list.length) {
				tpSidHost.appendChild(E('p', {}, _('No matching signatures.')));
				return;
			}

			headerCb = E('input', {
				type: 'checkbox',
				id: 'tp-rule-select-all',
				change: function() {
					var on = this.checked;
					var boxes = tpSidHost.querySelectorAll('input.tp-rule-pick');
					var n;
					for (n = 0; n < boxes.length; n++) {
						boxes[n].checked = on;
						if (on)
							selectedSids[boxes[n].getAttribute('data-sid')] = '1';
						else
							delete selectedSids[boxes[n].getAttribute('data-sid')];
					}
					paintSel();
				}
			});
			table = E('table', { 'class': 'table tp-rules-table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th tp-col-check' }, [ headerCb ]),
					E('th', { 'class': 'th tp-col-num' }, '#'),
					E('th', { 'class': 'th tp-col-gid' }, _('GID')),
					E('th', { 'class': 'th tp-col-sid' }, _('SID:rev')),
					E('th', { 'class': 'th tp-col-tuple' }, _('Proto')),
					E('th', { 'class': 'th tp-col-tuple' }, _('Source')),
					E('th', { 'class': 'th tp-col-tuple' }, _('SPort')),
					E('th', { 'class': 'th tp-col-tuple' }, _('Destination')),
					E('th', { 'class': 'th tp-col-tuple' }, _('DPort')),
					E('th', { 'class': 'th tp-col-msg' }, _('Message')),
					E('th', { 'class': 'th tp-col-class' }, _('Category')),
					E('th', { 'class': 'th tp-col-status' }, _('Status')),
					E('th', { 'class': 'th tp-col-tags' }, _('Tags')),
					E('th', { 'class': 'th tp-col-actions' }, _('Actions'))
				])
			]);
			list.forEach(function(row, idx) {
				var sid = String(row.sid || '');
				var gid = String(row.gid || '1');
				var st = ruleStatusInfo(row);
				var parsed = suricataCore.parseRuleRaw(row.raw);
				var pick;
				var trClass = 'tr';
				var statusTitle = st.on ? _('Disable') : _('Enable');
				liveSids[sid] = 1;
				pick = E('input', {
					type: 'checkbox',
					'class': 'tp-rule-pick',
					'data-sid': sid,
					checked: selectedSids[sid] ? 'checked' : null,
					change: function() {
						if (this.checked)
							selectedSids[sid] = gid;
						else
							delete selectedSids[sid];
						paintSel();
					}
				});
				if (!st.on)
					trClass += ' tp-rule--off';
				if (row.in_profile === false)
					trClass += ' tp-rule--unloaded';
				table.appendChild(E('tr', { 'class': trClass }, [
					E('td', { 'class': 'td tp-col-check' }, [ pick ]),
					E('td', { 'class': 'td tp-col-num' }, String(rulesState.offset + idx + 1)),
					E('td', { 'class': 'td tp-col-gid tp-mono' }, gid),
					E('td', { 'class': 'td tp-col-sid tp-mono' }, [
						E('a', {
							href: '#',
							'title': _('Edit signature'),
							click: function(ev) {
								ev.preventDefault();
								showRule(sid, gid);
							}
						}, sid + ':' + val(row.rev, '0'))
					]),
					E('td', { 'class': 'td tp-col-tuple tp-mono' }, val(parsed.proto)),
					E('td', { 'class': 'td tp-col-tuple tp-mono' }, val(parsed.src)),
					E('td', { 'class': 'td tp-col-tuple tp-mono' }, val(parsed.sport)),
					E('td', { 'class': 'td tp-col-tuple tp-mono' }, val(parsed.dst)),
					E('td', { 'class': 'td tp-col-tuple tp-mono' }, val(parsed.dport)),
					E('td', { 'class': 'td tp-col-msg', 'title': val(row.msg) }, val(row.msg)),
					E('td', { 'class': 'td tp-col-class', 'title': val(row.classtype) }, val(row.classtype)),
					E('td', { 'class': 'td tp-col-status' }, [
						E('button', {
							'type': 'button',
							'class': 'tp-status-btn',
							'title': statusTitle,
							'aria-label': statusTitle,
							click: function(ev) {
								ev.preventDefault();
								runOneStatus(sid, gid, st.on ? 'disabled' : 'enabled');
							}
						}, tpBadge(st.kind, st.label))
					]),
					E('td', { 'class': 'td tp-col-tags' }, [ ruleTagPills(row) ]),
					E('td', { 'class': 'td tp-col-actions' }, [
						E('div', { 'class': 'tp-icon-row' }, [
							iconBtn(_('Enable'), 'enable', function() {
								runOneStatus(sid, gid, 'enabled');
							}, iconActionEnabled(st.id, 'enable')),
							iconBtn(_('Disable'), 'disable', function() {
								runOneStatus(sid, gid, 'disabled');
							}, iconActionEnabled(st.id, 'disable')),
							iconBtn(_('Review'), 'review', function() {
								runOneStatus(sid, gid, 'review');
							}, iconActionEnabled(st.id, 'review')),
							iconBtn(_('Expire'), 'expire', function() {
								runOneStatus(sid, gid, 'expired');
							}, iconActionEnabled(st.id, 'expire')),
							iconBtn(_('Edit'), 'edit', function() {
								showRule(sid, gid);
							}, true)
						])
					])
				]));
			});
			Object.keys(selectedSids).forEach(function(sid) {
				if (!liveSids[sid])
					delete selectedSids[sid];
			});
			paintSel();
			tableWrap = E('div', { 'class': 'tp-rules-wrap' }, [ table ]);
			tpSidHost.appendChild(tableWrap);

			from = total ? (rulesState.offset + 1) : 0;
			to = rulesState.offset + list.length;
			(function() {
				var pager = [ E('span', {}, _('Showing %s–%s of %s').format(from, to, total)) ];
				if (rulesState.offset > 0)
					pager.unshift(labeledActionBtn(_('Previous'), 'cbi-button',
						_('Previous page'),
						function() {
							rulesState.offset = Math.max(0, rulesState.offset - rulesState.limit);
							loadRules();
						}, 'prev'));
				if ((rulesState.offset + list.length) < total)
					pager.push(labeledActionBtn(_('Next'), 'cbi-button',
						_('Next page'),
						function() {
							rulesState.offset += rulesState.limit;
							loadRules();
						}, 'next'));
				tpSidHost.appendChild(E('div', { 'class': 'tp-pager' }, pager));
			})();
			paintSel();
		}

		function renderPolicy(p) {
			var rulesets = (p && p.rulesets) || [];
			var classtypes = (p && p.classtypes) || [];
			var rsPane;
			var clPane;
			var inner;
			var actionBulk;
			var selCount;
			var modeNote;

			policyBox.innerHTML = '';
			policyBox.appendChild(cbiSection(_('Policy'),
				_('Tick rows for bulk changes. Enable or disable rulesets, then set Alert, Drop, Reject, or Pass. Drop and Reject only block in Prevention mode; in Watch only they are logged as alerts. Save & Apply writes both lists and overrides the Small/Full profile on the Settings tab.'),
				[]));
			if (p && p.custom === '1')
				policyBox.appendChild(E('p', { 'class': 'tp-help' },
					_('Custom ruleset list is in use (profile: %s).').format(p.profile || 'small')));
			else
				policyBox.appendChild(E('p', { 'class': 'tp-help' },
					_('Showing defaults from the %s profile. Save & Apply to keep a custom list.').format(p.profile || 'small')));
			modeNote = E('p', { 'class': 'tp-warn-inline' + ((p && p.mode) === 'ips' ? ' is-visible' : '') },
				_('Prevention mode is on. Drop/Reject policies can block matching traffic.'));
			if ((p && p.mode) !== 'ips')
				modeNote = E('p', { 'class': 'tp-help' },
					_('Currently in Watch only. Drop/Reject policies will not block until you switch to Prevention on the Settings tab.'));
			policyBox.appendChild(modeNote);

			function activePolicyPane() {
				return policyBox.querySelector('.tp-policy-inner > .cbi-tab-active') ||
					policyBox.querySelector('.tp-policy-inner > [data-tab]');
			}

			function paintPolicySel() {
				var pane = activePolicyPane();
				var n = selectedPolicyRows(pane).length;
				var el = document.getElementById('tp-policy-sel-count');
				if (el)
					el.textContent = _('Selected: %s').format(n);
			}

			function syncPolicyHeader(pane) {
				var header;
				var boxes;
				var on = 0;
				var n;

				if (!pane)
					return;
				header = pane.querySelector('input.tp-policy-select-all');
				boxes = pane.querySelectorAll('input.tp-policy-pick');
				for (n = 0; n < boxes.length; n++) {
					if (boxes[n].checked)
						on++;
				}
				if (!header)
					return;
				header.checked = boxes.length > 0 && on === boxes.length;
				header.indeterminate = on > 0 && on < boxes.length;
			}

			function syncPolicyToolbar(tabId) {
				var hide = tabId !== 'policy-rulesets';
				var btns = policyBox.querySelectorAll('.tp-policy-rs-only');
				var n;

				for (n = 0; n < btns.length; n++)
					btns[n].hidden = hide;
				paintPolicySel();
			}

			function policyPick(pane) {
				return E('input', {
					type: 'checkbox',
					'class': 'tp-policy-pick',
					change: function() {
						syncPolicyHeader(pane);
						paintPolicySel();
					}
				});
			}

			function policySelectAll(pane) {
				return E('input', {
					type: 'checkbox',
					'class': 'tp-policy-select-all',
					change: function() {
						var on = this.checked;
						var boxes = pane.querySelectorAll('input.tp-policy-pick');
						var n;

						this.indeterminate = false;
						for (n = 0; n < boxes.length; n++)
							boxes[n].checked = on;
						paintPolicySel();
					}
				});
			}

			function policyHeader(pane) {
				return E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th tp-col-check' }, [ policySelectAll(pane) ]),
					E('th', { 'class': 'th tp-col-num' }, '#'),
					E('th', { 'class': 'th tp-col-name' }, _('Name')),
					E('th', { 'class': 'th tp-col-info' }, _('Details')),
					E('th', { 'class': 'th tp-col-status' }, _('Enabled')),
					E('th', { 'class': 'th tp-col-action' }, _('Action'))
				]);
			}

			function setRsEnabled(tr, on) {
				var cell;
				var title;

				if (!tr || !tr.classList.contains('tp-rs-row'))
					return;
				tr.setAttribute('data-enabled', on ? '1' : '0');
				tr.classList.toggle('tp-rule--off', !on);
				cell = tr.querySelector('.tp-col-status');
				if (!cell)
					return;
				title = on ? _('Disable') : _('Enable');
				cell.innerHTML = '';
				cell.appendChild(E('button', {
					'type': 'button',
					'class': 'tp-status-btn',
					'title': title,
					'aria-label': title,
					click: function(ev) {
						ev.preventDefault();
						setRsEnabled(tr, !policyRowEnabled(tr));
					}
				}, tpBadge(on ? 'yes' : 'no', on ? _('Enabled') : _('Disabled'))));
			}

			function policyGrid(pane, rows, kind) {
				var table;
				var isRs = kind === 'ruleset';

				if (!rows.length) {
					pane.appendChild(E('p', { 'class': 'tp-empty' },
						isRs
							? _('No rule files indexed yet. Fetch rules on the Rules tab, then return here.')
							: _('No classtypes yet.')));
					return;
				}
				table = E('table', { 'class': 'table tp-policy-table' }, [
					policyHeader(pane)
				]);
				rows.forEach(function(row, idx) {
					var on = isRs && row.enabled !== '0';
					var trClass = 'tr ' + (isRs ? 'tp-rs-row' : 'tp-cl-row');
					var name = isRs ? val(row.file) : val(row.name);
					var attrs;
					var tr;

					if (isRs && !on)
						trClass += ' tp-rule--off';
					attrs = { 'class': trClass };
					if (isRs) {
						attrs['data-file'] = row.file || '';
						attrs['data-enabled'] = on ? '1' : '0';
					} else {
						attrs['data-name'] = row.name || '';
					}
					tr = E('tr', attrs, [
						E('td', { 'class': 'td tp-col-check' }, [ policyPick(pane) ]),
						E('td', { 'class': 'td tp-col-num' }, String(idx + 1)),
						E('td', { 'class': 'td tp-col-name tp-mono', 'title': name }, name),
						E('td', { 'class': 'td tp-col-info' }, isRs ? val(row.count, '0') : '—'),
						isRs
							? E('td', { 'class': 'td tp-col-status' })
							: E('td', { 'class': 'td tp-col-status tp-muted' }, '—'),
						E('td', { 'class': 'td tp-col-action' }, [
							actionSelect((isRs ? 'tp-rs-act-' : 'tp-cl-act-') + idx,
								row.action || 'alert', false)
						])
					]);
					table.appendChild(tr);
					if (isRs)
						setRsEnabled(tr, on);
				});
				pane.appendChild(E('div', { 'class': 'tp-rules-wrap' }, [ table ]));
			}

			function resetPolicies() {
				var collected = collectPolicies();
				var err;

				collected.rulesets = [];
				err = suricataCore.validatePolicies(collected);
				if (err) {
					ui.addNotification(null, E('p', {}, err), 'error');
					return;
				}
				callSetPolicies(collected).then(function(out) {
					if (out && out.error)
						return Promise.reject(new Error(out.error));
					ui.addNotification(null, E('p', {}, _('Rulesets reset to the profile on the Settings tab')), 4000);
					renderPolicy((out && out.policies) || collected);
				}).catch(function(e) {
					ui.addNotification(null, E('p', {}, e.message || e), 'error');
				});
			}

			function selectedOrWarn() {
				var rows = selectedPolicyRows(activePolicyPane());

				if (!rows.length) {
					ui.addNotification(null, E('p', {}, _('Tick one or more rows first.')), 'error');
					return null;
				}
				return rows;
			}

			function bulkRsEnabled(on) {
				var rows = selectedOrWarn();
				var n;
				var changed = 0;

				if (!rows)
					return;
				for (n = 0; n < rows.length; n++) {
					if (!rows[n].classList.contains('tp-rs-row'))
						continue;
					setRsEnabled(rows[n], on);
					changed++;
				}
				if (!changed) {
					ui.addNotification(null, E('p', {}, _('Tick rulesets on the Ruleset policies tab.')), 'error');
					return;
				}
				ui.addNotification(null, E('p', {},
					on ? _('Selected rulesets enabled') : _('Selected rulesets disabled')), 4000);
			}

			function bulkSetAction() {
				var rows = selectedOrWarn();
				var action = actionBulk.value;
				var n;
				var sel;

				if (!rows)
					return;
				if (!suricataCore.actionOk(action)) {
					ui.addNotification(null, E('p', {}, _('Choose an action first.')), 'error');
					return;
				}
				for (n = 0; n < rows.length; n++) {
					sel = rows[n].querySelector('select');
					if (sel)
						sel.value = action;
				}
				ui.addNotification(null, E('p', {}, _('Selected rows set to %s').format(action)), 4000);
			}

			actionBulk = actionSelect('tp-policy-set-action', 'alert', false);
			actionBulk.title = _('Action for selected rows');
			selCount = E('span', { id: 'tp-policy-sel-count' }, _('Selected: %s').format(0));
			policyBox.appendChild(E('div', { 'class': 'tp-rules-head' }, [
				E('div', { 'class': 'tp-rules-actions' }, [
					labeledActionBtn(_('Enable selected'), 'cbi-button-positive tp-policy-rs-only',
						_('Enable selected rulesets'),
						function() {
							bulkRsEnabled(true);
						}, 'enable'),
					labeledActionBtn(_('Disable selected'), 'cbi-button-negative tp-policy-rs-only',
						_('Disable selected rulesets'),
						function() {
							bulkRsEnabled(false);
						}, 'disable'),
					actionBulk,
					labeledActionBtn(_('Set action'), 'cbi-button',
						_('Apply the chosen action to selected rows'),
						bulkSetAction, 'edit'),
					labeledActionBtn(_('Reset rulesets to profile'), 'cbi-button tp-policy-rs-only',
						_('Restore the Small or Full profile from Settings'),
						resetPolicies, 'reindex')
				]),
				E('p', { 'class': 'tp-help' }, [ selCount ])
			]));

			rsPane = E('div', {
				'data-tab': 'policy-rulesets',
				'data-tab-title': _('Ruleset policies')
			}, [
				E('div', { 'class': 'cbi-section-descr' },
					_('Choose which signature files Suricata loads. The Enabled badge and Action column apply to the whole file.'))
			]);
			clPane = E('div', {
				'data-tab': 'policy-classtypes',
				'data-tab-title': _('Classtype policies')
			}, [
				E('div', { 'class': 'cbi-section-descr' },
					_('Set a default action for a class of attacks (for example trojan-activity). A per-SID action on the Rules tab wins over this list. A file action wins over classtype when the SID has no override.'))
			]);
			policyGrid(rsPane, rulesets, 'ruleset');
			policyGrid(clPane, classtypes, 'classtype');
			inner = E('div', { 'class': 'tp-policy-inner' }, [ rsPane, clPane ]);
			policyBox.appendChild(inner);
			ui.tabs.initTabGroup(inner.childNodes);
			rsPane.addEventListener('cbi-tab-active', function() {
				syncPolicyToolbar('policy-rulesets');
			});
			clPane.addEventListener('cbi-tab-active', function() {
				syncPolicyToolbar('policy-classtypes');
			});
			syncPolicyToolbar('policy-rulesets');
		}

		function renderPass(p) {
			var localCb;
			var gwCb;
			var dnsCb;
			var vpnCb;
			var ips;
			p = suricataCore.normalizePass(p);
			passBox.innerHTML = '';
			localCb = E('input', { type: 'checkbox', id: 'tp-pass-local' });
			gwCb = E('input', { type: 'checkbox', id: 'tp-pass-gw' });
			dnsCb = E('input', { type: 'checkbox', id: 'tp-pass-dns' });
			vpnCb = E('input', { type: 'checkbox', id: 'tp-pass-vpn' });
			localCb.checked = p.local_nets === '1';
			gwCb.checked = p.wan_gateway === '1';
			dnsCb.checked = p.wan_dns === '1';
			vpnCb.checked = p.vpn_addrs === '1';
			ips = E('textarea', {
				id: 'tp-pass-ips',
				rows: 5,
				placeholder: '192.168.1.10\n10.0.0.0/8'
			}, (p.ips || []).join('\n'));
			passBox.appendChild(cbiSection(_('Pass list'),
				_('Addresses that Suricata will not alert on or block. Auto entries are resolved when you Save & Apply. Use the footer to write the list.'),
				[
					fieldRow('tp-pass-local', _('Local networks'), localCb,
						_('Add the LAN prefix (excluding WAN).')),
					fieldRow('tp-pass-gw', _('WAN gateways'), gwCb,
						_('Add the current default-route gateway.')),
					fieldRow('tp-pass-dns', _('WAN DNS servers'), dnsCb,
						_('Add nameservers learned on WAN.')),
					fieldRow('tp-pass-vpn', _('VPN addresses'), vpnCb,
						_('Add addresses on WireGuard, Tailscale, and tun interfaces.')),
					fieldRow('tp-pass-ips', _('Custom addresses'), ips,
						_('One IPv4/IPv6 address or prefix per line. These are never blocked.'))
				]));
		}

		function paintSuppress() {
			var host = document.getElementById('tp-suppress-table');
			var table;
			if (!host)
				return;
			host.innerHTML = '';
			if (!settingsSuppress.length) {
				host.appendChild(E('p', { 'class': 'tp-empty' },
					_('No host suppressions yet. Add a SID and IP to ignore a false positive.')));
				return;
			}
			table = E('table', { 'class': 'table tp-policy-table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('SID')),
					E('th', { 'class': 'th' }, _('GID')),
					E('th', { 'class': 'th' }, _('Track')),
					E('th', { 'class': 'th' }, _('IP')),
					E('th', { 'class': 'th' }, _('Description')),
					E('th', { 'class': 'th' }, _('Actions'))
				])
			]);
			settingsSuppress.forEach(function(row, idx) {
				table.appendChild(E('tr', { 'class': 'tr' }, [
					E('td', { 'class': 'td tp-mono' }, row.sid),
					E('td', { 'class': 'td tp-mono' }, row.gid || '1'),
					E('td', { 'class': 'td' }, row.track),
					E('td', { 'class': 'td tp-mono' }, row.ip),
					E('td', { 'class': 'td' }, val(row.comment, '')),
					E('td', { 'class': 'td' }, [
						labeledActionBtn(_('Delete'), 'cbi-button-negative',
							_('Remove this suppression'),
							function() {
								settingsSuppress.splice(idx, 1);
								paintSuppress();
							}, 'delete')
					])
				]));
			});
			host.appendChild(table);
		}

		function renderSuppress() {
			var sidIn = E('input', { type: 'text', id: 'tp-sup-sid', placeholder: '2000354' });
			var gidIn = E('input', { type: 'text', id: 'tp-sup-gid', value: '1' });
			var ipIn = E('input', { type: 'text', id: 'tp-sup-ip', placeholder: '192.168.8.50' });
			var trackIn = E('select', { id: 'tp-sup-track' }, [
				E('option', { value: 'by_src' }, _('Source IP')),
				E('option', { value: 'by_dst' }, _('Destination IP'))
			]);
			var commentIn = E('input', {
				type: 'text', id: 'tp-sup-comment',
				placeholder: _('LAN false positive')
			});
			suppressBox.innerHTML = '';
			suppressBox.appendChild(cbiSection(_('Suppression lists'),
				_('Ignore a signature for one host. This is the usual fix for a noisy SID on a trusted device. Save & Apply writes the list. Disabled SIDs on the Rules tab still suppress globally.'),
				[
					fieldRow('tp-sup-sid', _('SID'), sidIn, _('Signature ID to ignore.')),
					fieldRow('tp-sup-gid', _('GID'), gidIn, _('Usually 1.')),
					fieldRow('tp-sup-ip', _('IP address'), ipIn, _('Host or prefix that should not match.')),
					fieldRow('tp-sup-track', _('Track'), trackIn, _('Source or destination of the flow.')),
					fieldRow('tp-sup-comment', _('Description'), commentIn, _('Optional note for your reference.'))
				]));
			suppressBox.appendChild(E('div', { 'class': 'tp-policy-actions' }, [
				labeledActionBtn(_('Add'), 'cbi-button-positive',
					_('Add this suppression to the list'),
					function() {
						var next = {
							sid: sidIn.value,
							gid: gidIn.value || '1',
							ip: ipIn.value,
							track: trackIn.value,
							comment: commentIn.value
						};
						var err = suricataCore.validateSuppressList([next]);
						if (err) {
							ui.addNotification(null, E('p', {}, err), 'error');
							return;
						}
						settingsSuppress = suricataCore.normalizeSuppressList(settingsSuppress.concat([next]));
						sidIn.value = '';
						ipIn.value = '';
						commentIn.value = '';
						paintSuppress();
					}, 'add')
			]));
			suppressBox.appendChild(E('div', { id: 'tp-suppress-table' }));
			paintSuppress();
		}

		function notifyTypeLabel(t) {
			if (t === 'telegram')
				return _('Telegram');
			if (t === 'ntfy')
				return _('ntfy');
			if (t === 'webhook')
				return _('Webhook');
			if (t === 'discord')
				return _('Discord');
			if (t === 'email')
				return _('Email');
			return t;
		}

		function nfEl(name, node) {
			node.setAttribute('data-nf', name);
			return node;
		}

		function paintNotify() {
			var host = document.getElementById('tp-notify-list');
			if (!host)
				return;
			host.innerHTML = '';
			if (!settingsNotify.length) {
				host.appendChild(E('p', { 'class': 'tp-empty' },
					_('No channels yet. Add Telegram, ntfy, a webhook, Discord, or email. Leave them off until you have tested.')));
				return;
			}
			settingsNotify.forEach(function(row, idx) {
				var enabled = E('input', { type: 'checkbox' });
				var typeSel;
				var mode;
				var sev;
				var card;
				var secretHint;
				enabled.checked = row.enabled === '1';
				nfEl('enabled', enabled);
				typeSel = nfEl('type', E('select', {}, suricataCore.NOTIFY_TYPES.map(function(t) {
					return E('option', { value: t }, notifyTypeLabel(t));
				})));
				typeSel.value = row.type;
				mode = nfEl('mode', E('select', {}, [
					E('option', { value: 'digest' }, _('Digest (summary)')),
					E('option', { value: 'realtime' }, _('Realtime (each alert)'))
				]));
				mode.value = row.mode || 'digest';
				sev = nfEl('sevskip', E('select', {}, [
					E('option', { value: '1' }, _('High only')),
					E('option', { value: '2' }, _('High and medium')),
					E('option', { value: '3' }, _('All severities'))
				]));
				nfEl('min_severity', sev);
				sev.value = row.min_severity || '1';
				secretHint = row.bot_token_set === '1' || row.token_set === '1' || row.header_set === '1'
					? _('Saved. Leave blank to keep.')
					: '';
				card = E('div', {
					'class': 'tp-notify-card',
					'data-id': row.id,
					'data-bot-set': row.bot_token_set || '0',
					'data-token-set': row.token_set || '0',
					'data-header-set': row.header_set || '0'
				}, [
					E('div', { 'class': 'tp-notify-head' }, [
						E('strong', {}, notifyTypeLabel(row.type)),
						E('code', { 'class': 'tp-mono' }, row.id),
						labeledActionBtn(_('Test'), 'cbi-button',
							_('Send a synthetic test to this channel'),
							function() {
								var live = collectNotifyFromDom();
								var err = suricataCore.validateNotifyList(live);
								if (err) {
									ui.addNotification(null, E('p', {}, err), 'error');
									return;
								}
								return callSetConfig({ notify: suricataCore.normalizeNotifyList(live) }).then(function(res) {
									if (res && res.error)
										throw new Error(res.error);
									return callNotifyTest(row.id);
								}).then(function(out) {
									if (out && out.ok === false)
										throw new Error(out.error || _('Send failed'));
									ui.addNotification(null, E('p', {}, _('Test sent.')), 'info');
								}).catch(function(e) {
									ui.addNotification(null, E('p', {}, e.message || e), 'error');
								});
							}, 'test'),
						labeledActionBtn(_('Remove'), 'cbi-button-negative',
							_('Remove this channel'),
							function() {
								settingsNotify = collectNotifyFromDom();
								settingsNotify.splice(idx, 1);
								settingsNotify = suricataCore.normalizeNotifyList(settingsNotify);
								paintNotify();
							}, 'delete')
					]),
					fieldRow('', _('Enable'), enabled,
						_('No messages are sent until this is on and you Save & Apply.')),
					fieldRow('', _('Type'), typeSel, ''),
					fieldRow('', _('Delivery'), mode,
						_('Digest sends at most one summary per interval. Realtime sends each match, still capped by the hourly limit.')),
					fieldRow('', _('Minimum severity'), sev,
						_('Start with high only. Suricata 1 is high, 3 is low.')),
					fieldRow('', _('Hourly limit'),
						nfEl('rate_limit', E('input', { type: 'number', min: '1', max: '1000', value: row.rate_limit || '12' })),
						_('Extra matches are dropped and counted as suppressed.')),
					fieldRow('', _('Digest interval (seconds)'),
						nfEl('interval', E('input', { type: 'number', min: '0', value: row.interval || '3600' })),
						_('Used when delivery is Digest. 3600 is one hour.')),
					E('div', { 'class': 'tp-nf-telegram tp-nf-type' }, [
						fieldRow('', _('Chat ID'),
							nfEl('chat_id', E('input', { type: 'text', value: row.chat_id || '', placeholder: '-100…' })),
							_('User or group id from the Telegram bot.')),
						fieldRow('', _('Bot token'),
							nfEl('bot_token', E('input', {
								type: 'password',
								value: '',
								placeholder: secretHint || _('From BotFather')
							})),
							_('Create a bot with BotFather. Token is stored in UCI and included in backups.'))
					]),
					E('div', { 'class': 'tp-nf-ntfy tp-nf-type' }, [
						fieldRow('', _('Server'),
							nfEl('url', E('input', {
								type: 'text',
								value: row.type === 'ntfy' ? (row.url || 'https://ntfy.sh') : (row.url || ''),
								placeholder: 'https://ntfy.sh'
							})),
							_('Public ntfy.sh or your own server. Use a long random topic on the public server.')),
						fieldRow('', _('Topic'),
							nfEl('topic', E('input', { type: 'text', value: row.topic || '' })),
							''),
						fieldRow('', _('Access token'),
							nfEl('token', E('input', { type: 'password', value: '', placeholder: secretHint })),
							_('Optional. Needed for a private ntfy server.'))
					]),
					E('div', { 'class': 'tp-nf-webhook tp-nf-discord tp-nf-type' }, [
						fieldRow('', _('HTTPS URL'),
							nfEl('url2', E('input', {
								type: 'text',
								value: (row.type === 'webhook' || row.type === 'discord') ? (row.url || '') : '',
								placeholder: 'https://'
							})),
							_('JSON POST for webhook; Discord incoming webhook for Discord. Not the raw EVE line.')),
						fieldRow('', _('Extra header'),
							nfEl('header', E('input', {
								type: 'text',
								value: '',
								placeholder: row.header_set === '1' ? secretHint : 'Authorization: Bearer …'
							})),
							_('Optional. One header, for example an authorization bearer.'))
					]),
					E('div', { 'class': 'tp-nf-email tp-nf-type' }, [
						fieldRow('', _('To'),
							nfEl('to', E('input', { type: 'text', value: row.to || '', placeholder: 'ops@example.com' })),
							_('Install and configure msmtp first. Password stays in /etc/msmtprc, not here.')),
						fieldRow('', _('msmtp account'),
							nfEl('msmtp_account', E('input', {
								type: 'text',
								value: row.msmtp_account || 'suricata_notify'
							})),
							'')
					]),
					fieldRow('', _('Classtypes'),
						nfEl('classtype', E('input', {
							type: 'text',
							value: row.classtype || '',
							placeholder: 'trojan-activity, attempted-admin'
						})),
						_('Empty means every classtype that passes severity.')),
					fieldRow('', _('Allow SIDs'),
						nfEl('sid_allow', E('input', { type: 'text', value: row.sid_allow || '' })),
						_('Empty means all SIDs. Space or comma separated.')),
					fieldRow('', _('Deny SIDs'),
						nfEl('sid_deny', E('input', { type: 'text', value: row.sid_deny || '' })),
						''),
					fieldRow('', _('Include full addresses'),
						nfEl('include_lan', E('input', { type: 'checkbox' })),
						_('Off redacts the last IPv4 octet in the message.')),
					E('p', { 'class': 'tp-notify-status' },
						row.last_err
							? _('Last error: %s (suppressed %s)').format(row.last_err, row.suppressed || '0')
							: _('Sent %s, suppressed %s.').format(row.sent || '0', row.suppressed || '0'))
				]);
				card.querySelector('[data-nf="include_lan"]').checked = row.include_lan !== '0';
				function syncType() {
					var t = typeSel.value;
					var blocks = card.querySelectorAll('.tp-nf-type');
					var b;
					var j;
					for (j = 0; j < blocks.length; j++) {
						b = blocks[j];
						b.style.display = b.classList.contains('tp-nf-' + t) ? '' : 'none';
					}
				}
				typeSel.addEventListener('change', syncType);
				syncType();
				host.appendChild(card);
			});
		}

		function renderAlerts() {
			var typeAdd = E('select', { id: 'tp-notify-add-type' }, [
				E('option', { value: 'telegram' }, _('Telegram')),
				E('option', { value: 'ntfy' }, _('ntfy')),
				E('option', { value: 'webhook' }, _('Webhook')),
				E('option', { value: 'discord' }, _('Discord')),
				E('option', { value: 'email' }, _('Email'))
			]);
			alertsBox.innerHTML = '';
			alertsBox.appendChild(cbiSection(_('Outbound alerts'),
				_('Suricata only writes logs. This tab sends high-severity matches to a phone or mailbox. Start with digest and high severity. Secrets are stored in UCI and will be in backups.'),
				[
					E('p', { 'class': 'tp-help' },
						_('Telegram uses BotFather. ntfy needs a long random topic on ntfy.sh, or your own server. Email needs the msmtp package. Webhooks receive a short JSON record, not packet payloads.'))
				]));
			alertsBox.appendChild(E('div', { 'class': 'tp-policy-actions' }, [
				typeAdd,
				labeledActionBtn(_('Add channel'), 'cbi-button-positive',
					_('Add a notification channel'),
					function() {
						settingsNotify = collectNotifyFromDom();
						settingsNotify.push(suricataCore.emptyNotify(typeAdd.value));
						settingsNotify = suricataCore.normalizeNotifyList(settingsNotify);
						paintNotify();
					}, 'add')
			]));
			alertsBox.appendChild(E('div', { id: 'tp-notify-list' }));
			paintNotify();
		}

		function renderSettings(c) {
			settingsBox.innerHTML = '';
			var enabled = E('input', { type: 'checkbox', id: 'tp-enabled' });
			enabled.checked = c.enabled === '1' || c.enabled === 1;
			var iface = ifaceSelect('tp-iface', val(c.interface, 'br-lan'), netDevices);
			var homeNet = suricataCore.unwrapNet(c.home_net);
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
						_('Small is a connectivity-style set (malware, C2, web). Full is every ET Open rule, closer to a security policy. Tick rulesets on the Policy tab for a custom mix.'))
				]));
		}

		renderStatus(status);
		renderEvents(events);
		renderRules({});
		loadRules().catch(function() {});
		renderPolicy(policies);
		renderPass(cfg.pass);
		renderSuppress();
		renderAlerts();
		renderSettings(cfg);

		var tabHost = E('div', { 'class': 'tp-tab-host' }, [
			statusBox, settingsBox, rulesBox, policyBox, passBox, suppressBox, eventsBox, alertsBox
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
