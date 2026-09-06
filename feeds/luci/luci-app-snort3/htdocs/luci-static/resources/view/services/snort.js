'use strict';
'require view';
'require rpc';
'require ui';
'require poll';
'require network';
'require fs';
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

var callGetLogs = rpc.declare({
	object: 'luci.snort3',
	method: 'getLogs',
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

var callGetRules = rpc.declare({
	object: 'luci.snort3',
	method: 'getRules',
	params: [ 'query', 'classtype', 'file', 'state', 'offset', 'limit' ],
	expect: { '': {} }
});

var callSetRuleStates = rpc.declare({
	object: 'luci.snort3',
	method: 'setRuleStates',
	params: [ 'sids', 'gid', 'enabled', 'status' ],
	expect: { '': {} }
});

var callReindexRules = rpc.declare({
	object: 'luci.snort3',
	method: 'reindexRules',
	expect: { '': {} }
});

var callGetPolicies = rpc.declare({
	object: 'luci.snort3',
	method: 'getPolicies',
	expect: { '': {} }
});

var callSetPolicies = rpc.declare({
	object: 'luci.snort3',
	method: 'setPolicies',
	params: [ 'policies' ],
	expect: { '': {} }
});

var callNotifyTest = rpc.declare({
	object: 'luci.snort3',
	method: 'notifyTest',
	params: [ 'id' ],
	expect: { '': {} }
});

function val(v, fallback) {
	return (v === undefined || v === null || v === '') ? (fallback || '—') : v;
}

function snortCatalogEntry(feed) {
	var rows = snortCore.knownFeeds();
	var i;
	var id = feed && feed.id;
	var url = feed && feed.url;
	for (i = 0; i < rows.length; i++) {
		if ((id && rows[i].id === id) || (url && rows[i].url === url))
			return rows[i];
	}
	return feed || {};
}

function snortCatalogName(feed) {
	var row = snortCatalogEntry(feed);
	return row.name || '';
}

function snortCatalogDesc(feed) {
	var row = snortCatalogEntry(feed);
	return row.description || '';
}

var snortFeeds = [];
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

function snortBadge(kind, text) {
	return E('span', { 'class': 'snort-badge snort-badge--' + kind }, text);
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
	test: '?',
	refresh: '↻'
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
	return E('span', { 'class': 'snort-icon-wrap', 'title': tip }, [
		E('button', {
			'type': 'button',
			'class': 'snort-icon-btn snort-icon-btn--' + kind,
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
		kids.push(E('span', { 'class': 'snort-btn-glyph', 'aria-hidden': 'true' }, ICON_GLYPHS[kind]));
	kids.push(E('span', {}, label));
	return E('button', {
		'type': 'button',
		'class': 'btn snort-labeled-btn ' + cls,
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
	return E('div', { 'class': 'luci-app-snort3' }, [
		E('div', { 'class': 'snort-progress', role: 'status', 'aria-live': 'polite' }, [
			E('span', { 'class': 'snort-progress-spinner', 'aria-hidden': 'true' }),
			E('p', { 'class': 'snort-progress-msg' }, msg)
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
		return _('Enabling signature… Restarting Snort…');
	if (status === 'disabled')
		return _('Disabling signature… Restarting Snort…');
	if (status === 'review')
		return _('Marking signature for review… Restarting Snort…');
	if (status === 'expired')
		return _('Expiring signature… Restarting Snort…');
	return _('Updating signature… Restarting Snort…');
}

function snortStatusRow(label, value) {
	return E('div', { 'class': 'snort-status-row' }, [
		E('div', { 'class': 'snort-status-label' }, label),
		E('div', { 'class': 'snort-status-value' }, value)
	]);
}

function snortEngineKind(st) {
	if (!st.present)
		return 'muted';
	if (st.running)
		return 'yes';
	return 'no';
}

function snortEngineLabel(st) {
	if (!st.present)
		return _('Not installed');
	if (st.running)
		return _('Running');
	return _('Not running');
}

function field(id, label, input, help, extra) {
	var control = extra ? E('div', { 'class': 'snort-field-control' }, [ input, extra ]) : input;
	return fieldRow(id, label, control, help);
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

function notifyCardVal(card, name) {
	var el = card.querySelector('[data-nf="' + name + '"]');
	if (!el)
		return '';
	if (el.type === 'checkbox')
		return el.checked ? '1' : '0';
	return el.value;
}

function collectNotifyFromDom() {
	var host = document.getElementById('snort-notify-list');
	var cards;
	var i;
	var card;
	var out = [];
	var typ;
	var url;
	if (!host)
		return settingsNotify.slice();
	cards = host.querySelectorAll('.snort-notify-card');
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

function collectSnortSettings() {
	var enabled = elVal('snort-enabled');
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

	if (!enabled || !logging || !openappid || !iface || !home ||
	    !ext || !mode || !method || !action || !snaplen || !logDir ||
	    !cfgDir || !tmpDir)
		return { error: _('Settings form is not ready.') };

	return snortCore.collectSettings({
		enabled: enabled.checked,
		manual: false,
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
		feeds: snortFeeds,
		pass: {
			local_nets: !!(document.getElementById('snort-pass-local') &&
				document.getElementById('snort-pass-local').checked),
			wan_gateway: !!(document.getElementById('snort-pass-gw') &&
				document.getElementById('snort-pass-gw').checked),
			wan_dns: !!(document.getElementById('snort-pass-dns') &&
				document.getElementById('snort-pass-dns').checked),
			vpn_addrs: !!(document.getElementById('snort-pass-vpn') &&
				document.getElementById('snort-pass-vpn').checked),
			ips: document.getElementById('snort-pass-ips')
				? document.getElementById('snort-pass-ips').value : ''
		},
		suppress: settingsSuppress,
		notify: collectNotifyFromDom()
	});
}

function collectPolicies() {
	var out = { rulesets: [] };
	var host = document.getElementById('snort-policy');
	var rows;
	var i;
	var tr;
	var en;

	if (!host)
		return out;
	rows = host.querySelectorAll('tr.snort-rs-row');
	for (i = 0; i < rows.length; i++) {
		tr = rows[i];
		en = tr.querySelector('input.snort-rs-en');
		out.rulesets.push({
			file: en ? en.getAttribute('data-file') : '',
			enabled: en && en.checked ? '1' : '0'
		});
	}
	return out;
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
	var policies;
	var policyErr;
	var hasPolicy;

	if (collected.error)
		return Promise.reject(new Error(collected.error));
	policies = collectPolicies();
	hasPolicy = policies.rulesets.length > 0;
	if (hasPolicy) {
		policyErr = snortCore.validatePolicies(policies);
		if (policyErr)
			return Promise.reject(new Error(policyErr));
	}
	return callSetConfig(collected.config).then(function(res) {
		var err = rpcFail(res, _('Failed to save Snort settings'));
		if (err)
			return Promise.reject(new Error(err));
		if (!hasPolicy)
			return res;
		return callSetPolicies(policies).then(function(out) {
			var pErr = rpcFail(out, _('Failed to save policies'));
			if (pErr)
				return Promise.reject(new Error(pErr));
			return res;
		});
	}).then(function(res) {
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

return view.extend({
	load: function() {
		return Promise.all([
			callGetStatus(),
			callGetConfig(),
			callGetAlerts(50),
			callGetLogs(100),
			callUpdateStatus(),
			L.resolveDefault(network.getDevices(), []),
			L.resolveDefault(network.getNetwork('lan'), null),
			callGetPolicies(),
			L.resolveDefault(fs.read(snortCore.CATALOG_PATH), '')
		]);
	},

	render: function(data) {
		var status = data[0] || {};
		var cfg = data[1] || {};
		var alerts = data[2] || {};
		var serviceLogs = data[3] || {};
		var upd = data[4] || {};
		var netDevices = data[5] || [];
		var lanCidr = lanCidrFromNet(data[6]);
		var policies = data[7] || {};
		snortCore.parseCatalog(data[8]);
		snortFeeds = snortCore.normalizeFeeds(
			(cfg.feeds && cfg.feeds.length) ? cfg.feeds : snortCore.defaultFeeds()
		);
		settingsSuppress = snortCore.normalizeSuppressList(cfg.suppress || []);
		settingsNotify = snortCore.normalizeNotifyList(cfg.notify || []);

		var css = E('link', {
			rel: 'stylesheet',
			href: L.resource('snort-theme.css')
		});

		var hero = E('div', { 'class': 'snort-hero', 'id': 'snort-hero' });
		var root = E('div', { 'class': 'luci-app-snort3' }, [
			E('h2', {}, _('Snort IDS/IPS')),
			E('p', { 'class': 'snort-lead' }, [
				_('Snort watches LAN traffic for known attacks. Start in watch-only mode. Download or update signatures on the Rules tab before you expect alerts.')
			]),
			hero
		]);

		var statusBox = E('div', { 'data-tab': 'status', 'data-tab-title': _('Status') });
		var alertsBox = E('div', { 'data-tab': 'alerts', 'data-tab-title': _('Alerts') });
		var logsBox = E('div', { 'data-tab': 'logs', 'data-tab-title': _('Logs') });
		var settingsBox = E('div', { 'data-tab': 'settings', 'data-tab-title': _('Settings') });
		var rulesBox = E('div', { 'data-tab': 'rules', 'data-tab-title': _('Rules') });
		var policyBox = E('div', { 'data-tab': 'policy', 'data-tab-title': _('Policy') });
		var passBox = E('div', { 'data-tab': 'pass', 'data-tab-title': _('Pass list') });
		var suppressBox = E('div', { 'data-tab': 'suppress', 'data-tab-title': _('Suppress') });
		var notifyBox = E('div', { 'data-tab': 'notify', 'data-tab-title': _('Notify') });

		function paintHero(st) {
			var note;
			hero.innerHTML = '';
			hero.appendChild(snortBadge(snortEngineKind(st), snortEngineLabel(st)));
			if (!st.present)
				note = _('The Snort engine is not installed on this router.');
			else if (st.running)
				note = _('Watching %s in %s mode.').format(val(st.interface), val(st.mode, 'ids').toUpperCase());
			else
				note = _('Protection is off. Enable it on the Settings tab, then Save & Apply.');
			hero.appendChild(E('div', { 'class': 'snort-hero-copy' }, [
				E('strong', {}, snortEngineLabel(st)),
				E('span', { 'class': 'snort-hero-note' }, note)
			]));
		}

		function renderStatus(st) {
			var steps = [];
			var memClass = snortCore.memTone(st.mem_percent);
			statusBox.innerHTML = '';
			paintHero(st);
			statusBox.appendChild(cbiSection(_('Service status'),
				_('Watch-only mode records matches. Prevention mode tries to block them and can slow a fast LAN.'),
				[
					E('div', { 'class': 'snort-status-grid' }, [
						snortStatusRow(_('Engine'), snortBadge(snortEngineKind(st), snortEngineLabel(st))),
						snortStatusRow(_('Watching'), val(st.interface)),
						snortStatusRow(_('Mode'),
							((st.mode === 'ips') ? _('Prevention (IPS)') : _('Watch only (IDS)')) +
							' · ' + val(st.method)),
						snortStatusRow(_('Start at boot'), st.enabled_boot ? _('Yes') : _('No')),
						snortStatusRow(_('Process'), val(st.pid, '—')),
						snortStatusRow(_('Snort memory'),
							st.running ? snortCore.formatKb(st.mem_rss_kb) : '—'),
						snortStatusRow(_('System memory'),
							E('span', { 'class': memClass },
								snortCore.formatSysMem(st.mem_used_kb, st.mem_total_kb, st.mem_percent))),
						snortStatusRow(_('Alerts'), val(st.alert_count, '0'))
					])
				]));
			if (!st.present)
				steps.push(_('Install the Snort 3 packages, then reload this page.'));
			else {
				if (!st.running)
					steps.push(_('Open Settings, tick Enable Snort, and click Save & Apply.'));
				steps.push(_('On the Rules tab, keep at least one feed enabled and click Update rules.'));
				if (st.running)
					steps.push(_('New matches appear on the Alerts tab.'));
			}
			statusBox.appendChild(E('div', { 'class': 'snort-next' }, [
				E('strong', {}, _('What to do next')),
				E('ol', {}, steps.map(function(s) { return E('li', {}, s); }))
			]));
		}

		function renderAlerts(a) {
			var text = (a && a.alerts) ? a.alerts : '';
			alertsBox.innerHTML = '';
			alertsBox.appendChild(cbiSection(_('Recent alerts'),
				_('The last 50 fast-alert lines. Empty is normal until Snort is running and rules are installed.'),
				[]));
			if (!text)
				alertsBox.appendChild(E('div', { 'class': 'snort-empty' }, [
					E('p', {}, _('No alerts yet.')),
					E('ol', {}, [
						E('li', {}, _('Enable Snort on Settings and Save & Apply.')),
						E('li', {}, _('On Rules, click Update rules so signatures are downloaded.')),
						E('li', {}, _('Wait for LAN traffic.'))
					])
				]));
			else
				alertsBox.appendChild(E('pre', { 'class': 'snort-alert-box' }, text));
			alertsBox.appendChild(E('div', { 'class': 'snort-actions' }, [
				labeledActionBtn(_('Refresh'), 'cbi-button',
					_('Reload recent alerts'),
					function() {
						callGetAlerts(50).then(function(next) {
							renderAlerts(next || {});
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}, 'refresh')
			]));
		}

		function renderLogs(a) {
			var logs = (a && a.logs) ? a.logs : '';
			logsBox.innerHTML = '';
			logsBox.appendChild(cbiSection(_('Service log'),
				_('The last 100 logread lines from the Snort service.'),
				[]));
			if (!logs)
				logsBox.appendChild(E('p', {}, _('No logs')));
			else
				logsBox.appendChild(E('pre', { 'class': 'snort-log-box' }, logs));
			logsBox.appendChild(E('div', { 'class': 'snort-actions' }, [
				labeledActionBtn(_('Refresh'), 'cbi-button',
					_('Reload Snort system logs'),
					function() {
						callGetLogs(100).then(function(next) {
							renderLogs(next || {});
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}, 'refresh')
			]));
			logsBox.appendChild(cbiSection(_('Log files'),
				_('View detailed reports via SSH with the command:'),
				[
					E('pre', { 'class': 'snort-hint' },
						'snort-mgr report -v (requires coreutils-sort package)'),
					E('ul', { 'class': 'snort-help' }, [
						E('li', {}, [ E('code', {}, '/var/log/snort/alert_fast.txt'), ' — ', _('Fast alerts') ]),
						E('li', {}, [ E('code', {}, '/var/log/snort/alert_json.txt'), ' — ', _('Detailed JSON alerts') ])
					])
				]));
		}

		function renderSettings(c) {
			settingsBox.innerHTML = '';
			var enabled = E('input', { type: 'checkbox', id: 'snort-enabled' });
			enabled.checked = c.enabled === '1' || c.enabled === 1;
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
				E('option', { value: 'ids' }, _('Watch only — log attacks (recommended)')),
				E('option', { value: 'ips' }, _('Prevention — try to block attacks'))
			]);
			mode.value = c.mode || 'ids';
			var ipsWarn = E('div', { 'class': 'snort-warn-inline' },
				_('Prevention mode sits in the packet path and can slow a fast LAN. Stay on Watch only unless you have tested blocking on this device.'));
			var method = E('select', { id: 'snort-method' }, [
				E('option', { value: 'afpacket' }, _('AF_PACKET (recommended)')),
				E('option', { value: 'nfq' }, _('NFQ (prevention only)'))
			]);
			method.value = (c.method === 'nfq') ? 'nfq' : 'afpacket';
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
				value: (c.log_dir === '/var/log' || c.log_dir === '/var/log/')
					? '/var/log/snort' : val(c.log_dir, '/var/log/snort'),
				placeholder: '/var/log/snort'
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

			settingsBox.appendChild(cbiSection(_('Service'),
				_('Turn Snort on, then Save & Apply. Update rules on the Rules tab if you have not already.'),
				[
					fieldRow('snort-enabled', _('Enable Snort'), enabled,
						_('Start the Snort service with this configuration.'))
				]));
			settingsBox.appendChild(cbiSection(_('Network'),
				_('Watch the LAN bridge so devices behind the router are covered. Pick the Linux device (br-lan), not the UCI name “lan”.'),
				[
					fieldRow('snort-iface', _('Listen on'), iface,
						_('Usually br-lan.')),
					fieldRow('snort-home', _('Home network'),
						E('div', { 'class': 'snort-field-control' }, [ home, useLan ]),
						_('IPv4 prefix treated as trusted (HOME_NET). Use LAN subnet fills the live LAN prefix when LuCI can read it.')),
					fieldRow('snort-ext', _('Outside network'), ext,
						_('EXTERNAL_NET. Use any for the whole internet, or !$HOME_NET to exclude your LAN.'))
				]));
			settingsBox.appendChild(cbiSection(_('Detection'),
				_('Watch only records matches. Prevention tries to drop them and can slow a fast LAN. The generated config always includes /etc/snort/snort.lua, then applies the settings below.'),
				[
					fieldRow('snort-mode', _('Operating mode'), mode,
						_('Watch only = detect and log. Prevention = inline blocking.')),
					ipsWarn,
					fieldRow('snort-method', _('How packets are captured'), method,
						_('AF_PACKET listens on the interface (usual for watch-only). NFQ uses a netfilter queue and is only available in prevention mode.')),
					fieldRow('snort-snaplen', _('Bytes per packet'), snaplen,
						_('Capture length (0–65535). 1518 is enough for typical Ethernet.')),
					fieldRow('snort-action', _('Default rule action'), action,
						_('Alert logs a match. Block/drop/reject are for prevention mode.')),
					fieldRow('snort-openappid', _('OpenAppID'), openappid,
						_('Optional application identification if the openappid package is installed.'))
				]));
			settingsBox.appendChild(cbiSection(_('Logging'), null, [
				fieldRow('snort-logging', _('Write alert files'), logging,
					_('Fast alerts and JSON events under the log directory.'))
			]));
			settingsBox.appendChild(E('details', { 'class': 'snort-advanced' }, [
				E('summary', {}, _('Advanced paths')),
				fieldRow('snort-logdir', _('Log directory'), logDir,
					_('Where alert files are stored.')),
				fieldRow('snort-cfgdir', _('Config directory'), cfgDir,
					_('Snort configuration files.')),
				fieldRow('snort-tmpdir', _('Download directory'), tmpDir,
					_('Temporary files and unpacked rule tarballs.'))
			]));
		}

		var snortFeedsHost;
		var snortUpdateHost;
		var snortSidHost;
		var rulesState = { query: '', classtype: '', file: '', state: 'all', offset: 0, limit: 50 };
		var selectedSids = {};
		var sidLayoutReady = false;

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
				fieldRow('snort-feed-name', _('Name'), nameIn,
					_('Short label shown in the table.')),
				fieldRow('snort-feed-url', _('URL'), urlIn,
					_('HTTPS tarball, zip, or .rules file. Put {oinkcode} in the URL if this feed needs a subscriber code.')),
				fieldRow('snort-feed-desc', _('Description'), descIn,
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

		function addSnortCatalogFeed(item) {
			var feed = {
				id: snortCore.sanitizeFeedId(item.id || item.name),
				name: item.name,
				url: item.url,
				enabled: '1',
				description: item.description || ''
			};
			var err = snortCore.validateFeed(feed);
			var next;
			if (err) {
				ui.addNotification(null, E('p', {}, err), 'error');
				return Promise.reject(new Error(err));
			}
			feed = snortCore.normalizeFeeds([feed])[0];
			next = snortCore.validateFeeds(snortFeeds.concat([feed]));
			if (next) {
				ui.addNotification(null, E('p', {}, _('A feed with this name already exists')), 'error');
				return Promise.reject(new Error(next));
			}
			snortFeeds = snortFeeds.concat([feed]);
			return persistSnortFeeds().then(function() {
				paintSnortFeeds();
				ui.addNotification(null, E('p', {}, _('Added “%s”. Tick enabled feeds and click Update rules.').format(snortCatalogName(feed))), 4000);
			});
		}

		function openSnortCatalogModal() {
			var unused = snortCore.unusedKnownFeeds(snortFeeds);
			var sel;
			var note;
			var i;
			if (!unused.length) {
				ui.addNotification(null, E('p', {}, _('Every catalog ruleset is already in the list.')), 4000);
				return;
			}
			sel = E('select', { id: 'snort-catalog' });
			for (i = 0; i < unused.length; i++)
				sel.appendChild(E('option', { value: unused[i].id }, snortCatalogName(unused[i])));
			note = E('p', { 'class': 'snort-help', id: 'snort-catalog-note' });
			function paintNote() {
				var item = unused.filter(function(x) { return x.id === sel.value; })[0];
				note.textContent = item ? snortCatalogDesc(item) : '';
			}
			sel.addEventListener('change', paintNote);
			paintNote();
			ui.showModal(_('Add from catalog'), [
				fieldRow('snort-catalog', _('Ruleset'), sel,
					_('Public feeds from Talos, abuse.ch, and Networkforensic. After adding, click Update rules.')),
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
							addSnortCatalogFeed(item).then(ui.hideModal).catch(function() {});
						}
					}, _('Add'))
				])
			]);
		}

		function paintSnortFeeds() {
			var table;
			var toolbar;
			var enabledCount = 0;
			if (!snortFeedsHost)
				return;
			snortFeedsHost.innerHTML = '';
			snortFeedsHost.appendChild(E('p', { 'class': 'cbi-section-descr' }, [
				_('A feed is an HTTPS address of a rules tarball or zip. Tick Enabled for feeds to download. The free Snort 3 community set is the usual starting point. Paid Talos feeds need an Oinkcode. Use Add from catalog for public sets.')
			]));
			table = E('div', { 'class': 'table snort-feeds-table' }, [
				E('div', { 'class': 'tr table-titles' }, [
					E('div', { 'class': 'th snort-col-num' }, '#'),
					E('div', { 'class': 'th snort-col-on' }, _('Enabled')),
					E('div', { 'class': 'th snort-col-name' }, _('Name')),
					E('div', { 'class': 'th snort-col-url' }, _('URL')),
					E('div', { 'class': 'th snort-col-actions' }, _('Actions'))
				])
			]);
			if (!snortFeeds.length) {
				snortFeedsHost.appendChild(E('p', {},
					_('No rule feeds. Add the Snort 3 community URL or a subscription tarball.')));
			} else {
				snortFeeds.forEach(function(entry, idx) {
					var on = entry.enabled !== '0';
					var nameTip = snortCatalogDesc(entry)
						? snortCatalogName(entry) + ' — ' + snortCatalogDesc(entry)
						: snortCatalogName(entry);
					if (on)
						enabledCount++;
					table.appendChild(E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td snort-col-num' }, String(idx + 1)),
						E('div', { 'class': 'td snort-col-on' }, [
							E('input', {
								type: 'checkbox',
								title: _('Enable %s').format(snortCatalogName(entry)),
								'aria-label': _('Enable %s').format(snortCatalogName(entry)),
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
						E('div', { 'class': 'td left snort-col-name', title: nameTip }, snortCatalogName(entry)),
						E('div', { 'class': 'td left snort-col-url', title: entry.url }, [
							E('code', { 'class': 'snort-feed-url' }, entry.url)
						]),
						E('div', { 'class': 'td snort-col-actions' }, [
							E('div', { 'class': 'snort-icon-row' }, [
								iconBtn(_('Edit'), 'edit', function() {
									openSnortFeedModal(entry);
								}, true),
								iconBtn(_('Delete'), 'delete', function() {
									if (!window.confirm(_('Delete rule feed “%s”?').format(snortCatalogName(entry))))
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
								}, true)
							])
						])
					]));
				});
				snortFeedsHost.appendChild(E('div', { 'class': 'snort-feeds-wrap' }, [ table ]));
			}
			toolbar = [
				labeledActionBtn(_('Add custom'), 'cbi-button cbi-button-positive',
					_('Add a custom HTTPS tarball, zip, or .rules URL'),
					function() {
						openSnortFeedModal(null);
					}, 'add'),
				labeledActionBtn(_('Add from catalog'), 'cbi-button',
					_('Pick a public ruleset from Emerging Threats, abuse.ch, or Networkforensic'),
					function() {
						openSnortCatalogModal();
					}, 'catalog')
			];
			if (enabledCount)
				toolbar.push(labeledActionBtn(_('Update rules'), 'cbi-button cbi-button-apply',
					_('Download enabled rule feeds in the background'),
					function() {
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
					}, 'fetch'));
			snortFeedsHost.appendChild(E('div', { 'class': 'snort-feeds-toolbar' }, toolbar));
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
			else if (snortFeeds.some(function(f) { return f.enabled !== '0'; }))
				snortUpdateHost.appendChild(E('p', { 'class': 'snort-help' },
					_('Click Update rules above to download enabled feeds.')));
			else
				snortUpdateHost.appendChild(E('p', { 'class': 'snort-help' },
					_('Enable at least one feed, then Update rules.')));
			snortUpdateHost.appendChild(E('pre', { 'class': 'snort-log-box' }, (u && u.log) || ''));

			snortUpdateHost.appendChild(E('div', { 'class': 'snort-actions' }, [
				labeledActionBtn(_('Create symbolic link'), 'cbi-button',
					_('Create a symbolic link from /var/snort.d/rules to /etc/snort/rules'),
					function() {
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
					}, 'link'),
				labeledActionBtn(_('Clean temporary files'), 'cbi-button',
					_('Remove leftover files from the last rules update'),
					function() {
						callCleanupTemp().then(function(res) {
							var err = rpcFail(res, _('Failed'));
							if (err)
								ui.addNotification(null, E('p', {}, err), 'error');
							else
								ui.addNotification(null, E('p', {}, _('Temporary files cleaned')), 4000);
						}).catch(function(e) {
							ui.addNotification(null, E('p', {}, e.message || e), 'error');
						});
					}, 'clean')
			]));
		}

		function ensureSnortRulesLayout() {
			var oink;
			var feedsPane;
			var mgmtPane;
			var inner;
			if (snortFeedsHost)
				return;
			rulesBox.innerHTML = '';
			snortFeedsHost = E('div', { 'class': 'snort-feeds-table-host' });
			snortUpdateHost = E('div', { 'class': 'snort-rules-update' });
			snortSidHost = E('div', { 'class': 'snort-sid-host' });
			oink = E('input', {
				type: 'password', id: 'snort-oink',
				value: cfg.oinkcode || '',
				placeholder: _('Enter your Oinkcode if you have one')
			});
			feedsPane = E('div', {
				'data-tab': 'rule-feeds',
				'data-tab-title': _('Rule feeds')
			}, [
				snortFeedsHost,
				fieldRow('snort-oink', _('Oinkcode'), oink,
					_('From snort.org. Leave empty for community rules.')),
				snortUpdateHost
			]);
			mgmtPane = E('div', {
				'data-tab': 'rule-mgmt',
				'data-tab-title': _('Rules management')
			}, [ snortSidHost ]);
			inner = E('div', { 'class': 'snort-rules-inner' }, [ feedsPane, mgmtPane ]);
			rulesBox.appendChild(inner);
			ui.tabs.initTabGroup(inner.childNodes);
			paintSnortFeeds();
		}

		function renderRules(st, u) {
			ensureSnortRulesLayout();
			paintSnortUpdate(st, u);
			if (!sidLayoutReady) {
				sidLayoutReady = true;
				loadRules().catch(function() {});
			}
		}

		function loadRules() {
			return callGetRules(
				snortCore.sanitizeRuleQuery(rulesState.query),
				rulesState.classtype,
				rulesState.file,
				rulesState.state,
				rulesState.offset,
				snortCore.clampRuleLimit(rulesState.limit)
			).then(function(res) {
				paintSidTable(res || {});
				return res;
			});
		}

		function paintSidTable(res) {
			var list = (res && res.rules) || [];
			var total = (res && res.total) || 0;
			var indexed = !!(res && res.indexed);
			var indexedCount = (res && res.indexed_count) || 0;
			var disabledCount = (res && res.disabled_count) || 0;
			var files = (res && res.files) || [];
			var classtypes = (res && res.classtypes) || [];
			var search;
			var fileSel;
			var classSel;
			var stateSel;
			var table;
			var tableWrap;
			var headerCb;
			var liveSids = {};
			var from;
			var to;
			var i;

			if (!snortSidHost)
				return;
			snortSidHost.innerHTML = '';

			search = E('input', {
				type: 'search',
				id: 'snort-rule-q',
				placeholder: _('SID or message'),
				value: rulesState.query
			});
			fileSel = E('select', { id: 'snort-rule-file' }, [
				E('option', { value: '' }, _('All files'))
			]);
			for (i = 0; i < files.length; i++)
				fileSel.appendChild(E('option', { value: files[i] }, files[i]));
			fileSel.value = rulesState.file;
			classSel = E('select', { id: 'snort-rule-class' }, [
				E('option', { value: '' }, _('All classes'))
			]);
			for (i = 0; i < classtypes.length; i++)
				classSel.appendChild(E('option', { value: classtypes[i] }, classtypes[i]));
			classSel.value = rulesState.classtype;
			stateSel = E('select', { id: 'snort-rule-state' }, [
				E('option', { value: 'all' }, _('All statuses')),
				E('option', { value: 'enabled' }, _('Enabled')),
				E('option', { value: 'disabled' }, _('Disabled')),
				E('option', { value: 'review' }, _('Review')),
				E('option', { value: 'expired' }, _('Expired'))
			]);
			stateSel.value = rulesState.state;

			function applyFilters(ev) {
				if (ev)
					ev.preventDefault();
				rulesState.query = search.value;
				rulesState.file = fileSel.value;
				rulesState.classtype = classSel.value;
				rulesState.state = stateSel.value;
				rulesState.offset = 0;
				loadRules().catch(function(e) {
					ui.addNotification(null, E('p', {}, e.message || e), 'error');
				});
			}

			function selectedList() {
				return snortCore.normalizeSidList(Object.keys(selectedSids));
			}

			function paintSel() {
				var n = Object.keys(selectedSids).length;
				var el = document.getElementById('snort-sel-count');
				var bulk = document.getElementById('snort-rule-bulk');
				var canEnable = false;
				var canDisable = false;
				var boxes = snortSidHost.querySelectorAll('input.snort-rule-pick:checked');
				var i;
				var tr;
				var st;
				var enBtn;
				var disBtn;

				if (el)
					el.textContent = _('Selected: %s').format(n);
				if (bulk)
					bulk.classList.toggle('is-on', n > 0);
				for (i = 0; i < boxes.length; i++) {
					tr = boxes[i].parentNode;
					while (tr && tr.tagName !== 'TR')
						tr = tr.parentNode;
					st = tr ? tr.getAttribute('data-status') : '';
					if (iconActionEnabled(st, 'enable'))
						canEnable = true;
					if (iconActionEnabled(st, 'disable'))
						canDisable = true;
				}
				enBtn = bulk && bulk.querySelector('.snort-bulk-enable');
				disBtn = bulk && bulk.querySelector('.snort-bulk-disable');
				if (enBtn)
					enBtn.hidden = !canEnable;
				if (disBtn)
					disBtn.hidden = !canDisable;
			}

			function runBulkStatus(status) {
				var sids = selectedList();
				var n;
				if (!sids) {
					ui.addNotification(null, E('p', {}, _('Tick one or more signatures first.')), 'error');
					return;
				}
				n = sids.length;
				withProgress(_('Updating signatures'),
					_('Updating %s signatures… Restarting Snort…').format(n),
					function() {
						return callSetRuleStates(sids, '1', '', status).then(function(out) {
							var err = rpcFail(out, _('Failed to update signatures'));
							if (err)
								return Promise.reject(new Error(err));
							selectedSids = {};
							return loadRules();
						});
					}).catch(function(e) {
					if (isBusyErr(e))
						return;
					ui.addNotification(null, E('p', {}, e.message || e), 'error');
					loadRules();
				});
			}

			function runOneStatus(sid, gid, status) {
				withProgress(_('Updating signature'), ruleStatusBusyMsg(status), function() {
					return callSetRuleStates([sid], gid || '1', '', status).then(function(out) {
						var err = rpcFail(out, _('Failed to update signature'));
						if (err)
							return Promise.reject(new Error(err));
						return loadRules();
					});
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

			snortSidHost.appendChild(E('p', { 'class': 'cbi-section-descr' }, [
				_('Search downloaded rules by SID, message, or file. Tick rows for bulk changes, or use the icons on a row. Enable and disable take effect after Snort restarts (a few seconds).')
			]));
			snortSidHost.appendChild(E('div', { 'class': 'snort-rules-head' }, [
				E('div', { 'class': 'snort-rules-actions' }, [
					E('div', { 'id': 'snort-rule-bulk', 'class': 'snort-rule-bulk' }, [
						labeledActionBtn(_('Enable selected'), 'cbi-button-positive snort-bulk-enable',
							_('Enable selected signatures'),
							function() {
								runBulkStatus('enabled');
							}, 'enable'),
						labeledActionBtn(_('Disable selected'), 'cbi-button-negative snort-bulk-disable',
							_('Disable selected signatures'),
							function() {
								runBulkStatus('disabled');
							}, 'disable'),
						labeledActionBtn(_('Review selected'), 'cbi-button',
							_('Mark selected signatures for review'),
							function() {
								runBulkStatus('review');
							}, 'review'),
						labeledActionBtn(_('Expire selected'), 'cbi-button',
							_('Expire selected signatures'),
							function() {
								runBulkStatus('expired');
							}, 'expire')
					]),
					labeledActionBtn(_('Reindex signatures'), 'cbi-button',
						_('Rebuild the local signature index'),
						function() {
							runReindex();
						}, 'reindex')
				]),
				E('div', { 'class': 'snort-rules-search' }, [
					search,
					labeledActionBtn(_('Search'), 'cbi-button cbi-button-apply',
						_('Apply search and filters'),
						applyFilters, 'search')
				])
			]));
			snortSidHost.appendChild(E('div', { 'class': 'snort-toolbar' }, [
				fileSel, classSel, stateSel
			]));
			snortSidHost.appendChild(E('p', { 'class': 'snort-help' }, [
				_('Indexed: %s · Disabled: %s').format(indexedCount, disabledCount),
				' · ',
				E('span', { id: 'snort-sel-count' }, _('Selected: %s').format(Object.keys(selectedSids).length))
			]));

			if (!indexed) {
				snortSidHost.appendChild(E('p', {},
					_('No rule index yet. Update rules on this tab, then reindex.')));
				return;
			}
			if (!list.length) {
				snortSidHost.appendChild(E('p', {}, _('No matching signatures.')));
				return;
			}

			headerCb = E('input', {
				type: 'checkbox',
				id: 'snort-rule-select-all',
				change: function() {
					var on = this.checked;
					var boxes = snortSidHost.querySelectorAll('input.snort-rule-pick');
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
			table = E('table', { 'class': 'table snort-rules-table' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th snort-col-check' }, [ headerCb ]),
					E('th', { 'class': 'th snort-col-num' }, '#'),
					E('th', { 'class': 'th snort-col-gid' }, _('GID')),
					E('th', { 'class': 'th snort-col-sid' }, _('SID:rev')),
					E('th', { 'class': 'th snort-col-tuple' }, _('Proto')),
					E('th', { 'class': 'th snort-col-tuple' }, _('Source')),
					E('th', { 'class': 'th snort-col-tuple' }, _('SPort')),
					E('th', { 'class': 'th snort-col-tuple' }, _('Destination')),
					E('th', { 'class': 'th snort-col-tuple' }, _('DPort')),
					E('th', { 'class': 'th' }, _('Message')),
					E('th', { 'class': 'th' }, _('Status')),
					E('th', { 'class': 'th' }, _('Actions'))
				])
			]);
			list.forEach(function(row, idx) {
				var sid = String(row.sid || '');
				var gid = String(row.gid || '1');
				var st = ruleStatusInfo(row);
				var parsed = snortCore.parseRuleRaw(row.raw);
				var pick;
				var trClass = 'tr';
				var statusTitle = st.on ? _('Disable') : _('Enable');
				liveSids[sid] = 1;
				pick = E('input', {
					type: 'checkbox',
					'class': 'snort-rule-pick',
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
					trClass += ' snort-rule--off';
				table.appendChild(E('tr', { 'class': trClass, 'data-status': st.id }, [
					E('td', { 'class': 'td snort-col-check' }, [ pick ]),
					E('td', { 'class': 'td snort-col-num' }, String(rulesState.offset + idx + 1)),
					E('td', { 'class': 'td snort-col-gid snort-mono' }, gid),
					E('td', { 'class': 'td snort-col-sid snort-mono' }, sid + ':' + val(row.rev, '0')),
					E('td', { 'class': 'td snort-col-tuple snort-mono' }, val(parsed.proto)),
					E('td', { 'class': 'td snort-col-tuple snort-mono' }, val(parsed.src)),
					E('td', { 'class': 'td snort-col-tuple snort-mono' }, val(parsed.sport)),
					E('td', { 'class': 'td snort-col-tuple snort-mono' }, val(parsed.dst)),
					E('td', { 'class': 'td snort-col-tuple snort-mono' }, val(parsed.dport)),
					E('td', { 'class': 'td' }, val(row.msg)),
					E('td', { 'class': 'td snort-col-status' }, [
						E('button', {
							'type': 'button',
							'class': 'snort-status-btn',
							'title': statusTitle,
							'aria-label': statusTitle,
							click: function(ev) {
								ev.preventDefault();
								runOneStatus(sid, gid, st.on ? 'disabled' : 'enabled');
							}
						}, snortBadge(st.kind, st.label))
					]),
					E('td', { 'class': 'td snort-col-actions' }, [
						E('div', { 'class': 'snort-icon-row' }, [
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
							}, iconActionEnabled(st.id, 'expire'))
						])
					])
				]));
			});
			Object.keys(selectedSids).forEach(function(sid) {
				if (!liveSids[sid])
					delete selectedSids[sid];
			});
			paintSel();
			tableWrap = E('div', { 'class': 'snort-rules-wrap' }, [ table ]);
			snortSidHost.appendChild(tableWrap);
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
				snortSidHost.appendChild(E('div', { 'class': 'snort-pager' }, pager));
			})();
			paintSel();
		}

		function renderPolicy(p) {
			var rulesets = (p && p.rulesets) || [];
			var rsTable;
			policyBox.innerHTML = '';
			policyBox.appendChild(cbiSection(_('Ruleset policies'),
				_('Choose which signature files Snort loads. Unticked files are skipped. Use Select all or Unselect all, then Save & Apply.'),
				[]));
			if (!rulesets.length) {
				policyBox.appendChild(E('p', { 'class': 'snort-empty' },
					_('No rule files indexed yet. Update rules on the Rules tab, then reindex.')));
				return;
			}
			rsTable = E('table', { 'class': 'table', id: 'snort-policy' }, [
				E('tr', { 'class': 'tr table-titles' }, [
					E('th', { 'class': 'th' }, _('Enabled')),
					E('th', { 'class': 'th' }, _('Ruleset')),
					E('th', { 'class': 'th' }, _('Signatures'))
				])
			]);
			rulesets.forEach(function(row) {
				var en = E('input', {
					type: 'checkbox',
					'class': 'snort-rs-en',
					'data-file': row.file
				});
				en.checked = row.enabled !== '0';
				rsTable.appendChild(E('tr', { 'class': 'tr snort-rs-row' }, [
					E('td', { 'class': 'td' }, [ en ]),
					E('td', { 'class': 'td snort-mono' }, row.file),
					E('td', { 'class': 'td' }, val(row.count, '0'))
				]));
			});
			policyBox.appendChild(rsTable);
			policyBox.appendChild(E('div', { 'class': 'snort-policy-actions' }, [
				labeledActionBtn(_('Select all'), 'cbi-button',
					_('Enable every ruleset in the list'),
					function() {
						var boxes = policyBox.querySelectorAll('input.snort-rs-en');
						var n;
						for (n = 0; n < boxes.length; n++)
							boxes[n].checked = true;
					}, 'enable'),
				labeledActionBtn(_('Unselect all'), 'cbi-button',
					_('Disable every ruleset in the list'),
					function() {
						var boxes = policyBox.querySelectorAll('input.snort-rs-en');
						var n;
						for (n = 0; n < boxes.length; n++)
							boxes[n].checked = false;
					}, 'disable')
			]));
		}

		function renderPass(p) {
			var localCb;
			var gwCb;
			var dnsCb;
			var vpnCb;
			var ips;
			p = snortCore.normalizePass(p);
			passBox.innerHTML = '';
			localCb = E('input', { type: 'checkbox', id: 'snort-pass-local' });
			gwCb = E('input', { type: 'checkbox', id: 'snort-pass-gw' });
			dnsCb = E('input', { type: 'checkbox', id: 'snort-pass-dns' });
			vpnCb = E('input', { type: 'checkbox', id: 'snort-pass-vpn' });
			localCb.checked = p.local_nets === '1';
			gwCb.checked = p.wan_gateway === '1';
			dnsCb.checked = p.wan_dns === '1';
			vpnCb.checked = p.vpn_addrs === '1';
			ips = E('textarea', {
				id: 'snort-pass-ips',
				rows: 5,
				placeholder: '192.168.1.10\n10.0.0.0/8'
			}, (p.ips || []).join('\n'));
			passBox.appendChild(cbiSection(_('Pass list'),
				_('Addresses that Snort will not alert on. Auto entries are resolved when you Save & Apply. Use the footer to write the list.'),
				[
					fieldRow('snort-pass-local', _('Local networks'), localCb,
						_('Add the LAN address.')),
					fieldRow('snort-pass-gw', _('WAN gateways'), gwCb,
						_('Add the current default-route gateway.')),
					fieldRow('snort-pass-dns', _('WAN DNS servers'), dnsCb,
						_('Add nameservers learned on WAN.')),
					fieldRow('snort-pass-vpn', _('VPN addresses'), vpnCb,
						_('Add addresses on WireGuard, Tailscale, and tun interfaces.')),
					fieldRow('snort-pass-ips', _('Custom addresses'), ips,
						_('One IPv4/IPv6 address or prefix per line.'))
				]));
		}

		function paintSuppress() {
			var host = document.getElementById('snort-suppress-table');
			var table;
			if (!host)
				return;
			host.innerHTML = '';
			if (!settingsSuppress.length) {
				host.appendChild(E('p', { 'class': 'snort-empty' },
					_('No host suppressions yet. Add a SID and IP to ignore a false positive.')));
				return;
			}
			table = E('table', { 'class': 'table' }, [
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
					E('td', { 'class': 'td snort-mono' }, row.sid),
					E('td', { 'class': 'td snort-mono' }, row.gid || '1'),
					E('td', { 'class': 'td' }, row.track),
					E('td', { 'class': 'td snort-mono' }, row.ip),
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
			var sidIn = E('input', { type: 'text', id: 'snort-sup-sid', placeholder: '2020001' });
			var gidIn = E('input', { type: 'text', id: 'snort-sup-gid', value: '1' });
			var ipIn = E('input', { type: 'text', id: 'snort-sup-ip', placeholder: '192.168.8.50' });
			var trackIn = E('select', { id: 'snort-sup-track' }, [
				E('option', { value: 'by_src' }, _('Source IP')),
				E('option', { value: 'by_dst' }, _('Destination IP'))
			]);
			var commentIn = E('input', {
				type: 'text', id: 'snort-sup-comment',
				placeholder: _('LAN false positive')
			});
			suppressBox.innerHTML = '';
			suppressBox.appendChild(cbiSection(_('Suppression lists'),
				_('Ignore a signature for one host. Save & Apply writes the list. Disabled SIDs on the Rules tab still suppress globally.'),
				[
					fieldRow('snort-sup-sid', _('SID'), sidIn, _('Signature ID to ignore.')),
					fieldRow('snort-sup-gid', _('GID'), gidIn, _('Usually 1.')),
					fieldRow('snort-sup-ip', _('IP address'), ipIn, _('Host or prefix that should not match.')),
					fieldRow('snort-sup-track', _('Track'), trackIn, _('Source or destination of the flow.')),
					fieldRow('snort-sup-comment', _('Description'), commentIn, _('Optional note for your reference.'))
				]));
			suppressBox.appendChild(E('div', { 'class': 'snort-policy-actions' }, [
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
						var err = snortCore.validateSuppressList([next]);
						if (err) {
							ui.addNotification(null, E('p', {}, err), 'error');
							return;
						}
						settingsSuppress = snortCore.normalizeSuppressList(settingsSuppress.concat([next]));
						sidIn.value = '';
						ipIn.value = '';
						commentIn.value = '';
						paintSuppress();
					}, 'add')
			]));
			suppressBox.appendChild(E('div', { id: 'snort-suppress-table' }));
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
			var host = document.getElementById('snort-notify-list');
			if (!host)
				return;
			host.innerHTML = '';
			if (!settingsNotify.length) {
				host.appendChild(E('p', { 'class': 'snort-empty' },
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
				typeSel = nfEl('type', E('select', {}, snortCore.NOTIFY_TYPES.map(function(t) {
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
					'class': 'snort-notify-card',
					'data-id': row.id,
					'data-bot-set': row.bot_token_set || '0',
					'data-token-set': row.token_set || '0',
					'data-header-set': row.header_set || '0'
				}, [
					E('div', { 'class': 'snort-notify-head' }, [
						E('strong', {}, notifyTypeLabel(row.type)),
						E('code', { 'class': 'snort-mono' }, row.id),
						labeledActionBtn(_('Test'), 'cbi-button',
							_('Send a synthetic test to this channel'),
							function() {
								var live = collectNotifyFromDom();
								var err = snortCore.validateNotifyList(live);
								if (err) {
									ui.addNotification(null, E('p', {}, err), 'error');
									return;
								}
								return callSetConfig({ notify: snortCore.normalizeNotifyList(live) }).then(function(res) {
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
								settingsNotify = snortCore.normalizeNotifyList(settingsNotify);
								paintNotify();
							}, 'delete')
					]),
					fieldRow('', _('Enable'), enabled,
						_('No messages are sent until this is on and you Save & Apply.')),
					fieldRow('', _('Type'), typeSel, ''),
					fieldRow('', _('Delivery'), mode,
						_('Digest sends at most one summary per interval. Realtime sends each match, still capped by the hourly limit.')),
					fieldRow('', _('Minimum severity'), sev,
						_('Start with high only. Snort 1 is high.')),
					fieldRow('', _('Hourly limit'),
						nfEl('rate_limit', E('input', { type: 'number', min: '1', max: '1000', value: row.rate_limit || '12' })),
						_('Extra matches are dropped and counted as suppressed.')),
					fieldRow('', _('Digest interval (seconds)'),
						nfEl('interval', E('input', { type: 'number', min: '0', value: row.interval || '3600' })),
						_('Used when delivery is Digest. 3600 is one hour.')),
					E('div', { 'class': 'snort-nf-telegram snort-nf-type' }, [
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
					E('div', { 'class': 'snort-nf-ntfy snort-nf-type' }, [
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
					E('div', { 'class': 'snort-nf-webhook snort-nf-discord snort-nf-type' }, [
						fieldRow('', _('HTTPS URL'),
							nfEl('url2', E('input', {
								type: 'text',
								value: (row.type === 'webhook' || row.type === 'discord') ? (row.url || '') : '',
								placeholder: 'https://'
							})),
							_('JSON POST for webhook; Discord incoming webhook for Discord. Not the raw alert line.')),
						fieldRow('', _('Extra header'),
							nfEl('header', E('input', {
								type: 'text',
								value: '',
								placeholder: row.header_set === '1' ? secretHint : 'Authorization: Bearer …'
							})),
							_('Optional. One header, for example an authorization bearer.'))
					]),
					E('div', { 'class': 'snort-nf-email snort-nf-type' }, [
						fieldRow('', _('To'),
							nfEl('to', E('input', { type: 'text', value: row.to || '', placeholder: 'ops@example.com' })),
							_('Install and configure msmtp first. Password stays in /etc/msmtprc, not here.')),
						fieldRow('', _('msmtp account'),
							nfEl('msmtp_account', E('input', {
								type: 'text',
								value: row.msmtp_account || 'snort_notify'
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
					E('p', { 'class': 'snort-notify-status' },
						row.last_err
							? _('Last error: %s (suppressed %s)').format(row.last_err, row.suppressed || '0')
							: _('Sent %s, suppressed %s.').format(row.sent || '0', row.suppressed || '0'))
				]);
				card.querySelector('[data-nf="include_lan"]').checked = row.include_lan !== '0';
				function syncType() {
					var t = typeSel.value;
					var blocks = card.querySelectorAll('.snort-nf-type');
					var b;
					var j;
					for (j = 0; j < blocks.length; j++) {
						b = blocks[j];
						b.style.display = b.classList.contains('snort-nf-' + t) ? '' : 'none';
					}
				}
				typeSel.addEventListener('change', syncType);
				syncType();
				host.appendChild(card);
			});
		}

		function renderNotify() {
			var typeAdd = E('select', { id: 'snort-notify-add-type' }, [
				E('option', { value: 'telegram' }, _('Telegram')),
				E('option', { value: 'ntfy' }, _('ntfy')),
				E('option', { value: 'webhook' }, _('Webhook')),
				E('option', { value: 'discord' }, _('Discord')),
				E('option', { value: 'email' }, _('Email'))
			]);
			notifyBox.innerHTML = '';
			notifyBox.appendChild(cbiSection(_('Outbound alerts'),
				_('Snort only writes logs. This tab sends high-severity matches to a phone or mailbox. Start with digest and high severity. Secrets are stored in UCI and will be in backups.'),
				[
					E('p', { 'class': 'snort-help' },
						_('Telegram uses BotFather. ntfy needs a long random topic on ntfy.sh, or your own server. Email needs the msmtp package. Webhooks receive a short JSON record, not packet payloads.'))
				]));
			notifyBox.appendChild(E('div', { 'class': 'snort-policy-actions' }, [
				typeAdd,
				labeledActionBtn(_('Add channel'), 'cbi-button-positive',
					_('Add a notification channel'),
					function() {
						settingsNotify = collectNotifyFromDom();
						settingsNotify.push(snortCore.emptyNotify(typeAdd.value));
						settingsNotify = snortCore.normalizeNotifyList(settingsNotify);
						paintNotify();
					}, 'add')
			]));
			notifyBox.appendChild(E('div', { id: 'snort-notify-list' }));
			paintNotify();
		}

		renderStatus(status);
		renderAlerts(alerts);
		renderLogs(serviceLogs);
		renderSettings(cfg);
		renderRules(status, upd);
		renderPolicy(policies);
		renderPass(cfg.pass);
		renderSuppress();
		renderNotify();

		var tabHost = E('div', { 'class': 'snort-tab-host' }, [
			statusBox, settingsBox, rulesBox, policyBox, passBox, suppressBox, alertsBox, logsBox, notifyBox
		]);
		root.appendChild(tabHost);
		ui.tabs.initTabGroup(tabHost.childNodes);

		poll.add(function() {
			return Promise.all([
				callGetStatus(),
				callGetAlerts(50),
				callUpdateStatus(),
				callGetLogs(100)
			]).then(function(next) {
				renderStatus(next[0] || {});
				renderAlerts(next[1] || {});
				paintSnortUpdate(next[0] || {}, next[2] || {});
				renderLogs(next[3] || {});
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
