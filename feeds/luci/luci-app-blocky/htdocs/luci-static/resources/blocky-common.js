'use strict';
'require view';
'require fs';
'require rpc';
'require ui';
'require poll';
'require baseclass';
'require uci';

var CONFIG_PATH = '/etc/blocky/config.yml';
var blockyApiAccess = {
	baseUrl: 'http://127.0.0.1:4000',
	user: '',
	password: ''
};
var RECORD_TYPES = [ 'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR' ];
var PAUSE_PRESETS = [
	[ '5m', _('5 minutes') ],
	[ '15m', _('15 minutes') ],
	[ '30m', _('30 minutes') ],
	[ '0', _('Until manually enabled') ]
];

function blockyInjectStyles() {
	return E('link', {
		'rel': 'stylesheet',
		'type': 'text/css',
		'href': L.resource('blocky-theme.css')
	});
}

function blockyPill(kind, label) {
	var cls = 'blocky-pill ';

	if (kind === 'yes')
		cls += 'blocky-pill-yes';
	else if (kind === 'no')
		cls += 'blocky-pill-no';
	else if (kind === 'warn')
		cls += 'blocky-pill-warn';
	else
		cls += 'blocky-pill-muted';

	return E('span', { 'class': cls }, [ label ]);
}

function blockyStatusDetail(text) {
	return E('span', { 'class': 'blocky-pill-note' }, [ text ]);
}

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function notify(message, level) {
	ui.addNotification(null, E('p', {}, [ message ]), level || 'info');
}

function actionButton(label, fn, style, onSuccess) {
	return E('button', {
		'class': 'cbi-button ' + (style || 'cbi-button-action'),
		'click': ui.createHandlerFn(this, function(ev) {
			ev.preventDefault();

			return Promise.resolve().then(fn).then(function() {
				notify(_('Action completed.'));
				if (typeof onSuccess === 'function')
					return onSuccess();
			}).catch(function(err) {
				notify(err.message || String(err), 'danger');
			});
		})
	}, [ label ]);
}

function replaceContent(node, content) {
	while (node.firstChild)
		node.removeChild(node.firstChild);

	if (content == null || content === false)
		return;

	if (Array.isArray(content)) {
		for (var i = 0; i < content.length; i++)
			appendContentNode(node, content[i]);
		return;
	}

	appendContentNode(node, content);
}

function appendContentNode(node, content) {
	if (content == null || content === false || content === '')
		return;

	if (typeof content === 'string' || typeof content === 'number')
		node.appendChild(document.createTextNode(String(content)));
	else
		node.appendChild(content);
}

function safeString(value) {
	if (value === null || value === undefined)
		return '';

	return String(value);
}

/** Prefer fs.exec (ubus): { code, stdout, stderr }. fs.exec_direct (cgi-exec) may return raw stdout string only. */
function execResultStdout(value, fallback) {
	if (value === null || value === undefined)
		return fallback;

	if (typeof value === 'string')
		return value;

	if (typeof value === 'object' && value.stdout !== undefined)
		return safeString(value.stdout);

	return fallback;
}

function blockyCliStdout(raw) {
	if (raw === null || raw === undefined || raw === '')
		return '';

	if (typeof raw === 'string')
		return raw;

	if (typeof TextDecoder !== 'undefined') {
		try {
			if (raw instanceof ArrayBuffer)
				return new TextDecoder().decode(raw);

			if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(raw))
				return new TextDecoder().decode(raw);
		}
		catch (err) {
			/* ignore decode failure */
		}
	}

	return String(raw);
}

function parseDnsForwardFlag(stdoutRaw) {
	var text = safeString(blockyCliStdout(stdoutRaw)).trim();
	var line = text.split(/\r?\n/).shift();

	line = safeString(line).trim().toLowerCase();

	return line === '1' || line === 'true' || line === 'yes' || line === 'on';
}

function parseBlockyPortLine(configYaml, key, defaultPort) {
	var lines = safeString(configYaml).split(/\n/);
	var inPorts = false;
	var baseIndent = -1;
	var i;
	var line;
	var m;
	var lead;
	var re = new RegExp('^\\s+' + key + '\\s*:\\s*(.+)$');

	for (i = 0; i < lines.length; i++) {
		line = lines[i];
		if (/^\s*ports\s*:\s*$/.test(line)) {
			inPorts = true;
			m = line.match(/^(\s*)/);
			baseIndent = m ? m[1].length : 0;
			continue;
		}
		if (!inPorts)
			continue;

		if (line.trim() === '')
			continue;

		lead = line.match(/^(\s*)/);
		if (lead && lead[1].length <= baseIndent)
			break;

		m = line.match(re);
		if (m)
			return parseBlockyPortValue(m[1]);
	}

	return { host: '127.0.0.1', port: defaultPort };
}

function parseBlockyPortValue(raw) {
	var value = safeString(raw).trim().replace(/['"]/g, '');

	if (/^\d+$/.test(value))
		return { host: '0.0.0.0', port: Number(value) };

	if (value.charAt(0) === ':')
		return { host: '0.0.0.0', port: Number(value.slice(1)) || 4000 };

	var m = value.match(/^(\[[^\]]+\]|[^:\s]+):(\d+)$/);
	if (m)
		return { host: m[1], port: Number(m[2]) };

	return { host: '127.0.0.1', port: 4000 };
}

function isLoopbackHost(host) {
	var h = safeString(host).toLowerCase();

	return h === '127.0.0.1' || h === 'localhost' || h === '::1' || h === '[::1]';
}

function blockyHttpBaseUrl(configYaml) {
	var ep = parseBlockyPortLine(configYaml, 'http', 4000);
	var host = ep.host;

	if (host === '0.0.0.0' || host === '::' || host === '[::]')
		host = '127.0.0.1';

	return 'http://' + host + ':' + String(ep.port);
}

function applyBlockyApiAccess(configYaml, access) {
	blockyApiAccess.baseUrl = blockyHttpBaseUrl(configYaml);
	blockyApiAccess.user = access && access.user ? access.user : '';
	blockyApiAccess.password = access && access.password ? access.password : '';
}

function loadBlockyUciAccess() {
	return uci.load('blocky').then(function() {
		return {
			user: uci.get('blocky', 'main', 'api_user') || '',
			password: uci.get('blocky', 'main', 'api_password') || '',
			localOnly: uci.get('blocky', 'main', 'api_local_only') !== '0'
		};
	}).catch(function() {
		return { user: '', password: '', localOnly: true };
	});
}

var BLOCKLIST_PRESETS = [
	{
		id: 'stevenblack',
		name: 'StevenBlack Unified',
		url: 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts',
		category: 'ads',
		description: 'Unified ads and malware hosts file (English-focused).'
	},
	{
		id: 'adguard_dns',
		name: 'AdGuard DNS filter',
		url: 'https://adguardteam.github.io/AdGuardSDNSFilter/Filters/filter.txt',
		category: 'ads',
		description: 'DNS-optimized combination of base ad, mobile, social, spyware, and privacy filters.'
	},
	{
		id: 'adguard_tracking',
		name: 'AdGuard Tracking Protection',
		url: 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_3.txt',
		category: 'privacy',
		description: 'Counters, analytics, and web tracking tools.'
	},
	{
		id: 'adguard_social',
		name: 'AdGuard Social Media',
		url: 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_4.txt',
		category: 'social',
		description: 'Social widgets, Like/Tweet buttons, and related integrations.'
	},
	{
		id: 'adguard_mobile',
		name: 'AdGuard Mobile Ads',
		url: 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_11.txt',
		category: 'ads',
		description: 'Advertising on mobile devices and in mobile apps.'
	},
	{
		id: 'adguard_annoyances',
		name: 'AdGuard Annoyances',
		url: 'https://raw.githubusercontent.com/AdguardTeam/FiltersRegistry/master/filters/filter_14.txt',
		category: 'annoyances',
		description: 'Cookie notices, in-page popups, and third-party widgets.'
	},
	{
		id: 'oisd_full',
		name: 'OISD Full Domains',
		url: 'https://big.oisd.nl/domainswild',
		category: 'comprehensive',
		description: 'Large curated wildcard domain blocklist (OISD).'
	},
	{
		id: 'hagezi_pro',
		name: 'HaGeZi Multi PRO',
		url: 'https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/pro.txt',
		category: 'comprehensive',
		description: 'Aggressive multi-purpose DNS blocklist (HaGeZi PRO).'
	},
	{
		id: 'easyprivacy',
		name: 'EasyPrivacy',
		url: 'https://easylist.to/easylist/easyprivacy.txt',
		category: 'privacy',
		description: 'Trackers and privacy-related third-party requests (EasyList project).'
	},
	{
		id: 'phishing_army',
		name: 'Phishing Army Extended',
		url: 'https://phishing.army/download/phishing_army_blocklist_extended.txt',
		category: 'security',
		description: 'Extended phishing and scam domain blocklist.',
		homeUrl: 'https://phishing.army/'
	},
	{
		id: 'adaway',
		name: 'AdAway Default Blocklist',
		url: 'https://adaway.org/hosts.txt',
		category: 'ads',
		description: 'Default blocklist from the AdAway project.',
		homeUrl: 'https://adaway.org/'
	},
	{
		id: 'peter_lowe',
		name: "Peter Lowe's List",
		url: 'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext',
		category: 'ads',
		description: 'Classic ad server domain blocklist.',
		homeUrl: 'https://pgl.yoyo.org/adservers/'
	}
];

var BLOCKLIST_CATALOG = [
	{
		title: 'General',
		description: 'Lists that block tracking and advertising on most devices',
		items: [
			'stevenblack', 'adaway', 'adguard_dns', 'peter_lowe',
			'adguard_tracking', 'adguard_social', 'adguard_mobile',
			'adguard_annoyances', 'oisd_full', 'easyprivacy'
		]
	},
	{
		title: 'Security',
		description: 'Lists that block malware, phishing, and scam domains',
		items: [ 'phishing_army', 'hagezi_pro' ]
	}
];

var BLOCKLIST_PRESET_MAP = {};

BLOCKLIST_PRESETS.forEach(function(preset) {
	BLOCKLIST_PRESET_MAP[preset.id] = preset;
});

function blockyPresetHomeUrl(preset) {
	return preset.homeUrl || preset.url.replace(/\/[^/]*$/, '/');
}

function blockyCloseModal(overlay) {
	if (overlay && overlay.parentNode)
		overlay.parentNode.removeChild(overlay);
}

function blockyOpenModal(title, bodyNodes, footerNodes, options) {
	options = options || {};
	var overlay = E('div', { 'class': 'blocky-modal-overlay' });
	var dialog = E('div', {
		'class': 'blocky-modal' + (options.wide ? ' blocky-modal-wide' : '')
	});
	var closeBtn = E('button', {
		'type': 'button',
		'class': 'blocky-modal-close',
		'title': _('Close'),
		'click': function(ev) {
			ev.preventDefault();
			blockyCloseModal(overlay);
		}
	}, [ '×' ]);

	dialog.appendChild(E('div', { 'class': 'blocky-modal-header' }, [
		E('h4', { 'class': 'blocky-modal-title' }, [ title ]),
		closeBtn
	]));
	dialog.appendChild(E('div', { 'class': 'blocky-modal-body' }, bodyNodes));
	dialog.appendChild(E('div', { 'class': 'blocky-modal-footer' }, footerNodes));

	overlay.appendChild(dialog);
	if (!options.noBackdropClose) {
		overlay.addEventListener('click', function(ev) {
			if (ev.target === overlay)
				blockyCloseModal(overlay);
		});
	}

	document.body.appendChild(overlay);
	return overlay;
}

function blockyModalFooterCancel(onCancel) {
	return E('button', {
		'type': 'button',
		'class': 'cbi-button cbi-button-neutral',
		'click': function(ev) {
			ev.preventDefault();
			if (typeof onCancel === 'function')
				onCancel();
		}
	}, [ _('Cancel') ]);
}

function blockyModalFooterSave(label, onSave, style) {
	return E('button', {
		'type': 'button',
		'class': 'cbi-button ' + (style || 'cbi-button-save'),
		'click': ui.createHandlerFn(null, function(ev) {
			ev.preventDefault();
			return Promise.resolve().then(onSave).catch(function(err) {
				notify(err.message || String(err), 'danger');
			});
		})
	}, [ label || _('Save') ]);
}

function addBlocklistsFromPresets(presets) {
	if (!presets.length) {
		notify(_('Select at least one catalog list.'), 'warning');
		return Promise.resolve(false);
	}

	return uci.load('blocky').then(function() {
		var added = 0;

		presets.forEach(function(preset) {
			if (uci.get('blocky', preset.id))
				return;

			uci.add('blocky', 'blocklist', preset.id);
			uci.set('blocky', preset.id, 'name', preset.name);
			uci.set('blocky', preset.id, 'url', preset.url);
			uci.set('blocky', preset.id, 'enabled', '1');
			uci.set('blocky', preset.id, 'category', preset.category || '');
			uci.set('blocky', preset.id, 'description', preset.description || '');
			added++;
		});

		if (!added) {
			notify(_('Selected lists are already configured.'), 'warning');
			return false;
		}

		return applyBlocklistChanges(true).then(function() {
			notify(_('Catalog lists added.'));
			return true;
		});
	});
}

function saveCustomBlocklist(fields, existingId) {
	var name = fields.name.trim();
	var url = fields.url.trim();
	var id = existingId || sanitizeBlocklistId(name);

	if (!name || !url) {
		notify(_('Name and URL are required.'), 'danger');
		return Promise.resolve(false);
	}

	if (!/^https?:\/\//i.test(url)) {
		notify(_('URL must start with http:// or https://'), 'danger');
		return Promise.resolve(false);
	}

	if (!id)
		id = 'custom_' + String(Date.now());

	return uci.load('blocky').then(function() {
		if (!existingId && uci.get('blocky', id)) {
			notify(_('A list with this identifier already exists. Choose a different name.'), 'danger');
			return false;
		}

		if (!existingId) {
			uci.add('blocky', 'blocklist', id);
			uci.set('blocky', id, 'category', 'custom');
			uci.set('blocky', id, 'description', '');
			uci.set('blocky', id, 'enabled', '1');
		}

		uci.set('blocky', id, 'name', name);
		uci.set('blocky', id, 'url', url);

		return applyBlocklistChanges(true).then(function() {
			notify(existingId ? _('Block list saved.') : _('Custom block list added.'));
			return true;
		});
	});
}

function openCustomBlocklistModal(refreshPage, existing) {
	var nameInput = E('input', {
		'class': 'cbi-input-text blocky-modal-input',
		'placeholder': _('Enter name'),
		'value': existing ? existing.name : ''
	});
	var urlInput = E('input', {
		'class': 'cbi-input-text blocky-modal-input',
		'placeholder': _('Enter a URL or an absolute path of the list'),
		'value': existing ? existing.url : ''
	});
	var overlay;

	overlay = blockyOpenModal(
		existing ? _('Edit block list') : _('New blocklist'),
		[
			E('div', { 'class': 'blocky-modal-field' }, [ nameInput ]),
			E('div', { 'class': 'blocky-modal-field' }, [ urlInput ]),
			E('p', { 'class': 'blocky-note-soft' }, [
				_('Enter a valid URL to the blocklist.')
			])
		],
		[
			blockyModalFooterCancel(function() { blockyCloseModal(overlay); }),
			' ',
			blockyModalFooterSave(_('Save'), function() {
				return saveCustomBlocklist({
					name: nameInput.value,
					url: urlInput.value
				}, existing ? existing.id : null).then(function(ok) {
					if (!ok)
						return;

					blockyCloseModal(overlay);
					return refreshPage();
				});
			})
		]
	);

	setTimeout(function() { nameInput.focus(); }, 50);
}

function openCatalogModal(refreshPage) {
	return loadUciBlocklists().then(function(lists) {
		var existing = {};
		var checkboxes = [];

		lists.forEach(function(entry) {
			existing[entry.id] = true;
		});

		var body = [];

		BLOCKLIST_CATALOG.forEach(function(group) {
			var rows = [];

			group.items.forEach(function(presetId) {
				var preset = BLOCKLIST_PRESET_MAP[presetId];

				if (!preset)
					return;

				var added = !!existing[preset.id];
				var checkbox = E('input', {
					'type': 'checkbox',
					'disabled': added ? '' : null,
					'checked': added ? '' : null,
					'data-preset-id': preset.id
				});

				checkboxes.push({ box: checkbox, preset: preset, added: added });

				rows.push(E('div', { 'class': 'blocky-modal-catalog-row' }, [
					E('label', { 'class': 'blocky-modal-catalog-label' }, [
						checkbox, ' ',
						E('span', { 'class': 'blocky-modal-catalog-name' }, [ _(preset.name) ])
					]),
					E('span', { 'class': 'blocky-modal-catalog-links' }, [
						E('a', {
							'href': blockyPresetHomeUrl(preset),
							'target': '_blank',
							'rel': 'noopener noreferrer',
							'class': 'blocky-modal-icon-link',
							'title': _('Homepage')
						}, [ '⌂' ]),
						' ',
						E('a', {
							'href': preset.url,
							'target': '_blank',
							'rel': 'noopener noreferrer',
							'class': 'blocky-modal-icon-link',
							'title': _('View list source')
						}, [ 'ℹ' ])
					]),
					added ? E('span', { 'class': 'blocky-modal-added-tag' }, [ _('Added') ]) : ''
				]));
			});

			if (!rows.length)
				return;

			body.push(E('div', { 'class': 'blocky-modal-catalog-group' }, [
				E('h5', { 'class': 'blocky-modal-catalog-title' }, [ _(group.title) ]),
				E('p', { 'class': 'blocky-modal-catalog-descr' }, [ _(group.description) ]),
				E('div', { 'class': 'blocky-modal-catalog-rows' }, rows)
			]));
		});

		var overlay = blockyOpenModal(
			_('Choose blocklists'),
			[ E('div', { 'class': 'blocky-modal-catalog' }, body) ],
			[
				blockyModalFooterCancel(function() { blockyCloseModal(overlay); }),
				' ',
				blockyModalFooterSave(_('Save'), function() {
					var selected = checkboxes.filter(function(row) {
						return !row.added && row.box.checked;
					}).map(function(row) {
						return row.preset;
					});

					return addBlocklistsFromPresets(selected).then(function(ok) {
						if (!ok)
							return;

						blockyCloseModal(overlay);
						return refreshPage();
					});
				})
			],
			{ wide: true }
		);
	});
}

function openNewBlocklistModal(refreshPage) {
	var overlay;

	overlay = blockyOpenModal(
		_('New blocklist'),
		[
			E('div', { 'class': 'blocky-modal-choices' }, [
				E('button', {
					'type': 'button',
					'class': 'blocky-modal-choice blocky-modal-choice-catalog',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						blockyCloseModal(overlay);
						return openCatalogModal(refreshPage);
					})
				}, [ _('Choose from the list') ]),
				E('button', {
					'type': 'button',
					'class': 'blocky-modal-choice blocky-modal-choice-custom',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						blockyCloseModal(overlay);
						openCustomBlocklistModal(refreshPage);
					})
				}, [ _('Add a custom list') ])
			])
		],
		[
			blockyModalFooterCancel(function() { blockyCloseModal(overlay); })
		]
	);
}

function sanitizeBlocklistId(raw) {
	return safeString(raw).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
}

function loadUciBlocklists() {
	return uci.load('blocky').then(function() {
		return uci.sections('blocky', 'blocklist').map(function(section) {
			var id = section['.name'];

			return {
				id: id,
				name: uci.get('blocky', id, 'name') || id,
				url: uci.get('blocky', id, 'url') || '',
				enabled: uci.get('blocky', id, 'enabled') !== '0',
				category: uci.get('blocky', id, 'category') || '',
				description: uci.get('blocky', id, 'description') || ''
			};
		}).sort(function(a, b) {
			return safeString(a.name).localeCompare(safeString(b.name));
		});
	});
}

function execBlockyListsSync() {
	return fs.exec('/usr/sbin/blocky-lists-sync', []).then(function(res) {
		var code = res != null ? Number(res.code) : 0;

		if (code !== 0)
			throw new Error(execResultStdout(res, _('Failed to sync block lists to config.yml')));

		return res;
	});
}

function applyBlocklistChanges(restart) {
	return uci.save().then(function() {
		return execBlockyListsSync();
	}).then(function() {
		if (restart)
			return runInit('restart');

		return blockyApi('/lists/refresh', 'POST');
	});
}

function renderBlocklistsTab(statsResult, refreshPage) {
	var tableHost = E('div', { 'class': 'table blocky-blocklists-table' });

	function denyCountsMap() {
		var stats = statsResult && statsResult.ok ? statsResult.data : null;

		return stats && stats.lists && stats.lists.denylist ? stats.lists.denylist : {};
	}

	function repaintTable() {
		return loadUciBlocklists().then(function(lists) {
			var counts = denyCountsMap();

			if (!lists.length) {
				replaceContent(tableHost, E('em', {}, [ _('No block lists configured.') ]));
				return;
			}

			replaceContent(tableHost, [
				E('div', { 'class': 'tr table-titles' }, [
					E('div', { 'class': 'th', 'style': 'width:4em' }, [ _('Enabled') ]),
					E('div', { 'class': 'th', 'style': 'width:18%' }, [ _('Name') ]),
					E('div', { 'class': 'th' }, [ _('URL') ]),
					E('div', { 'class': 'th', 'style': 'width:7em' }, [ _('Rules') ]),
					E('div', { 'class': 'th', 'style': 'width:10em' }, [ _('Actions') ])
				])
			].concat(lists.map(function(entry) {
				var countKey = sanitizeBlocklistId(entry.id);
				var rules = counts[countKey];
				var rulesLabel = rules != null
					? formatNumber(rules)
					: (entry.enabled ? '…' : '0');

				return E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td' }, [
						E('input', {
							'type': 'checkbox',
							'checked': entry.enabled ? '' : null,
							'change': ui.createHandlerFn(this, function(ev) {
								uci.set('blocky', entry.id, 'enabled', ev.target.checked ? '1' : '0');

								return applyBlocklistChanges(true).then(function() {
									notify(_('Block list updated.'));
									return refreshPage();
								}).catch(function(err) {
									notify(err.message || String(err), 'danger');
									ev.target.checked = !ev.target.checked;
								});
							})
						})
					]),
					E('div', { 'class': 'td left' }, [
						E('strong', {}, [ entry.name ]),
						entry.description
							? E('div', { 'class': 'blocky-note-soft' }, [ entry.description ])
							: ''
					]),
					E('div', { 'class': 'td left' }, [
						E('code', { 'class': 'blocky-list-url' }, [ entry.url ])
					]),
					E('div', { 'class': 'td left' }, [ rulesLabel ]),
					E('div', { 'class': 'td' }, [
						E('button', {
							'class': 'cbi-button cbi-button-edit',
							'click': ui.createHandlerFn(this, function(ev) {
								ev.preventDefault();
								openCustomBlocklistModal(refreshPage, entry);
							})
						}, [ _('Edit') ]),
						' ',
						E('button', {
							'class': 'cbi-button cbi-button-negative',
							'click': ui.createHandlerFn(this, function(ev) {
								ev.preventDefault();

								if (!confirm(_('Delete block list “%s”?').format(entry.name)))
									return;

								return uci.load('blocky').then(function() {
									uci.remove('blocky', entry.id);
									return applyBlocklistChanges(true);
								}).then(function() {
									notify(_('Block list deleted.'));
									return refreshPage();
								}).catch(function(err) {
									notify(err.message || String(err), 'danger');
								});
							})
						}, [ _('Delete') ])
					])
				]);
			})));
		});
	}

	repaintTable();

	return E('div', { 'class': 'cbi-section blocky-blocklists-section' }, [
		E('h3', {}, [ _('DNS blocklists') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Manage remote DNS blocklists (similar to AdGuard Home): view, enable, edit, delete, and combine multiple filter lists.')
		]),
		tableHost,
		E('div', { 'class': 'blocky-blocklists-toolbar blocky-blocklists-toolbar-split' }, [
			E('div', { 'class': 'blocky-blocklists-toolbar-left' }, [
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-add',
					'click': ui.createHandlerFn(this, function(ev) {
						ev.preventDefault();
						openNewBlocklistModal(refreshPage);
					})
				}, [ _('Add blocklist') ])
			]),
			E('div', { 'class': 'blocky-blocklists-toolbar-right' }, [
				actionButton(_('Update lists now'), function() {
					return blockyApi('/lists/refresh', 'POST');
				}, 'cbi-button-action', refreshPage),
				' ',
				actionButton(_('Save & restart Blocky'), function() {
					return applyBlocklistChanges(true).then(function() {
						notify(_('Block lists applied and Blocky restarted.'));
						return refreshPage();
					});
				}, 'cbi-button-apply')
			])
		])
	]);
}

function parseBlockyDnsPort(configYaml) {
	return parseBlockyPortLine(configYaml, 'dns', 5353).port;
}

function execDnsmasqSync(argv) {
	return fs.exec('/usr/sbin/blocky-dnsmasq-sync', argv || []).then(function(res) {
		var code = res != null ? Number(res.code) : NaN;

		if (code)
			throw new Error((res.stderr || res.stdout || '').trim() || _('blocky-dnsmasq-sync failed.'));

		return res;
	});
}

function formatNumber(value) {
	var number = Number(value || 0);

	if (!isFinite(number))
		number = 0;

	return number.toLocaleString ? number.toLocaleString() : String(number);
}

function formatPercent(value) {
	var number = Number(value || 0);

	if (!isFinite(number))
		number = 0;

	return number.toFixed(1) + '%';
}

function formatDuration(seconds) {
	var value = Number(seconds || 0);
	var minutes;

	if (!isFinite(value) || value <= 0)
		return _('not scheduled');

	minutes = Math.floor(value / 60);

	return '%dm %02ds'.format(minutes, value % 60);
}

function parseJson(text) {
	if (!text)
		return {};

	try {
		return JSON.parse(text);
	}
	catch (err) {
		return {};
	}
}

function fetchText(url, method, body) {
	var args = [ '-q', '-O', '-' ];

	if (blockyApiAccess.user)
		args.push('--user=' + blockyApiAccess.user + ':' + blockyApiAccess.password);

	if (method === 'POST') {
		args.push('--header=Content-Type: application/json');
		args.push('--post-data=' + (body || ''));
	}

	args.push(url);

	return fs.exec_direct('/bin/uclient-fetch', args);
}

function unwrapFetchText(res) {
	if (res == null || res === '')
		return '';

	if (typeof res === 'string')
		return res;

	if (res.stdout != null)
		return safeString(res.stdout);

	return safeString(res.stderr || '');
}

function fetchJson(url, method, body) {
	return fetchText(url, method, body).then(function(res) {
		return parseJson(unwrapFetchText(res));
	});
}

function blockyApi(path, method, body) {
	return fetchJson(blockyApiAccess.baseUrl + '/api' + path, method || 'GET', body);
}

function blockyMetricsUrl() {
	return blockyApiAccess.baseUrl + '/metrics';
}

function fetchBlockyStats() {
	return fetchText(blockyApiAccess.baseUrl + '/api/stats').then(function(res) {
		var text = safeString(unwrapFetchText(res)).trim();

		if (!text || /statistics are disabled/i.test(text))
			return { ok: false, disabled: true, data: null };

		try {
			var data = parseJson(text);

			if (!data || typeof data !== 'object' || !data.summary)
				return { ok: false, disabled: false, data: null };

			return { ok: true, disabled: false, data: data };
		}
		catch (err) {
			return { ok: false, disabled: false, data: null };
		}
	}).catch(function() {
		return { ok: false, disabled: false, data: null };
	});
}

function sumMapValues(map) {
	var total = 0;

	if (!map || typeof map !== 'object')
		return 0;

	Object.keys(map).forEach(function(key) {
		total += Number(map[key]) || 0;
	});

	return total;
}

function sumDenylistEntries(stats) {
	if (!stats || !stats.lists || !stats.lists.denylist)
		return 0;

	return sumMapValues(stats.lists.denylist);
}

function mapToBarRows(items, limit) {
	var rows = (items || []).slice(0, limit || 10);
	var max = 1;

	rows.forEach(function(row) {
		max = Math.max(max, Number(row.count) || 0);
	});

	return { rows: rows, max: max };
}

function topListBarRow(label, val, maxVal, color) {
	var pct = Math.round(100 * val / Math.max(1, maxVal));

	return E('div', { 'class': 'blocky-bar-row' }, [
		E('div', { 'class': 'blocky-bar-label', 'title': label }, [ label ]),
		E('div', { 'class': 'blocky-bar-track' }, [
			E('div', {
				'class': 'blocky-bar-seg',
				'style': 'width:%d%%;background:%s'.format(Math.min(100, pct), color)
			})
		]),
		E('div', { 'class': 'blocky-bar-val' }, [ formatNumber(val) ])
	]);
}

var blockingCountdownChannels = {};
var blockingCountdownPollRegistered = false;

function registerBlockingCountdownPoll(onStatus, active, channel) {
	if (typeof onStatus !== 'function' || !channel)
		return;

	blockingCountdownChannels[channel] = {
		fn: onStatus,
		active: !!active
	};

	if (blockingCountdownPollRegistered)
		return;

	blockingCountdownPollRegistered = true;

	poll.add(function() {
		var hasActive = false;

		Object.keys(blockingCountdownChannels).forEach(function(key) {
			if (blockingCountdownChannels[key].active)
				hasActive = true;
		});

		if (!hasActive)
			return;

		return blockyApi('/blocking/status').then(function(status) {
			var paused = !!(status && status.autoEnableInSec > 0);

			Object.keys(blockingCountdownChannels).forEach(function(key) {
				var entry = blockingCountdownChannels[key];

				if (entry.active)
					entry.fn(status || { enabled: false });
			});

			if (!paused) {
				Object.keys(blockingCountdownChannels).forEach(function(key) {
					blockingCountdownChannels[key].active = false;
				});
			}
		});
	}, 1);
}

function parseQueryLogConfig(configYaml) {
	var yaml = safeString(configYaml);
	var typeMatch = yaml.match(/(?:^|\n)queryLog:[\s\S]*?\n\s+type:\s*(\S+)/);
	var targetMatch = yaml.match(/(?:^|\n)queryLog:[\s\S]*?\n\s+target:\s*(\S+)/);

	if (!typeMatch)
		return null;

	return {
		type: typeMatch[1].replace(/['"]/g, ''),
		target: targetMatch ? targetMatch[1].replace(/['"]/g, '').replace(/\/$/, '') : ''
	};
}

function shellQuote(value) {
	return "'" + safeString(value).replace(/'/g, "'\\''") + "'";
}

function renderAdBlockerPipeline(status, service, dnsFwdRaw, configYaml, statsResult, adblockService) {
	var port = parseBlockyDnsPort(configYaml);
	var running = isRunning(service);
	var blocking = !!(status && status.enabled && !(status.autoEnableInSec > 0));
	var forwarding = parseDnsForwardFlag(dnsFwdRaw);
	var ql = parseQueryLogConfig(configYaml);
	var stats = statsResult && statsResult.ok ? statsResult.data : null;
	var denyEntries = stats ? sumDenylistEntries(stats) : 0;
	var statsReady = !!(statsResult && statsResult.ok && stats);
	var adblockRunning = isNamedServiceRunning(adblockService, 'adblock');
	var listsOk = denyEntries > 0 || (running && blocking && !statsReady);
	var rows = [
		{
			label: _('Blocky service'),
			ok: running,
			detail: running ? _('Listening on UDP/TCP port %d').format(port) : _('Start Blocky from Controls or reboot.')
		},
		{
			label: _('Ad blocking'),
			ok: blocking,
			detail: blocking ? _('Denylist rules active') :
				(status && status.autoEnableInSec > 0
					? _('Paused — resumes in %s').format(formatDuration(status.autoEnableInSec))
					: _('Blocking disabled in Blocky API'))
		},
		{
			label: _('LAN DNS chain'),
			ok: forwarding && running,
			detail: forwarding
				? _('Clients → dnsmasq :53 → Blocky %s').format('127.0.0.1#' + String(port))
				: _('Enable Router DNS integration under Services → Blocky → Configuration')
		},
		{
			label: _('Block lists loaded'),
			ok: listsOk,
			detail: denyEntries > 0
				? _('%s denylist entries in memory').format(formatNumber(denyEntries))
				: (running && blocking && !statsReady
					? _('Lists loading in background — refresh dashboard in a minute')
					: _('Lists still loading or statistics unavailable — try Refresh lists'))
		},
		{
			label: _('HTTP API listener'),
			ok: isLoopbackHost(parseBlockyPortLine(configYaml, 'http', 4000).host),
			detail: _('REST API and metrics at %s (Blocky has no built-in API key)').format(blockyHttpBaseUrl(configYaml))
		},
		{
			label: _('Query logging'),
			ok: !!(ql && ql.type === 'csv' && ql.target),
			detail: ql && ql.target
				? _('CSV logs under %s').format(ql.target)
				: _('Add queryLog to config.yml for the Logs tab')
		},
		{
			label: _('Adblock package'),
			ok: !adblockRunning,
			detail: adblockRunning
				? _('adblock init is running — disable it to avoid conflicting with Blocky')
				: _('Not running (expected when Blocky is the primary filter)')
		}
	];
	var ready = rows.slice(0, 5).every(function(row) { return row.ok; });

	return E('div', { 'class': 'blocky-dash-widget blocky-pipeline-widget' }, [
		E('h3', { 'class': 'blocky-dash-widget-title' }, [ _('Ad blocking pipeline') ]),
		E('p', { 'class': 'blocky-dash-widget-descr' }, [
			ready
				? _('Default first-boot setup routes all DHCP client DNS through Blocky with StevenBlack denylist filtering.')
				: _('One or more steps below must be fixed before LAN clients receive filtered DNS.')
		]),
		E('div', { 'class': 'table blocky-status-table' }, rows.map(function(row) {
			return E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:34%' }, [ row.label ]),
				E('div', { 'class': 'td left' }, [
					blockyPill(row.ok ? 'yes' : 'no', row.ok ? _('OK') : _('Check')),
					blockyStatusDetail(row.detail)
				])
			]);
		})),
		E('p', { 'class': 'blocky-note-soft' }, [
			_('Test from a phone on Wi‑Fi: open a browser ad-block test page. DNS must point at this router (typically %s).').format('192.168.8.1')
		])
	]);
}

function runInit(action) {
	if ([ 'enable', 'disable', 'start', 'stop', 'restart' ].indexOf(action) === -1)
		return Promise.reject(new Error(_('Unsupported service action.')));

	return fs.exec('/etc/init.d/blocky', [ action ]).then(function(res) {
		var code = res != null ? Number(res.code) : NaN;

		if (code)
			throw new Error((res.stderr || res.stdout || '').trim() || _('blocky init failed.'));

		return res;
	});
}

function isRunning(service) {
	return isNamedServiceRunning(service, 'blocky');
}

function isNamedServiceRunning(service, name) {
	return !!(service && service[name] && service[name].instances &&
		service[name].instances.instance1 && service[name].instances.instance1.running);
}

function parseMetrics(text) {
	var metrics = {};
	var lines = safeString(text).split(/\n/);

	lines.forEach(function(line) {
		var match;
		var name;
		var value;

		if (!line || line.charAt(0) === '#')
			return;

		match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/);
		if (!match)
			return;

		name = match[1];
		value = Number(match[3]);

		if (!isFinite(value))
			return;

		metrics[name] = (metrics[name] || 0) + value;
	});

	return metrics;
}

function metricValue(metrics, names) {
	var value = 0;

	names.forEach(function(name) {
		if (metrics[name])
			value += metrics[name];
	});

	return value;
}

function formatCompactNumber(value) {
	var number = Number(value || 0);

	if (!isFinite(number))
		number = 0;

	if (number >= 1e9)
		return (number / 1e9).toFixed(1).replace(/\.0$/, '') + 'G';

	if (number >= 1e6)
		return (number / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';

	if (number >= 1e3)
		return (number / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';

	return formatNumber(number);
}

function deriveCumulative(metrics) {
	var totalQueries = metricValue(metrics, [
		'blocky_query_total',
		'blocky_queries_total'
	]);
	var blockedQueries = metricValue(metrics, [
		'blocky_query_blocked_total',
		'blocky_blocked_total',
		'blocky_response_total_blocked'
	]);
	var cacheHits = metricValue(metrics, [
		'blocky_cache_hit_total',
		'blocky_cache_hits_total'
	]);
	var cacheMisses = metricValue(metrics, [
		'blocky_cache_miss_total',
		'blocky_cache_misses_total'
	]);
	var denylistEntries = metricValue(metrics, [
		'blocky_blocking_denylists_entries',
		'blocky_denylists_entries',
		'blocky_blocking_groups_total'
	]);

	return {
		totalQueries: totalQueries,
		blockedQueries: blockedQueries,
		cacheHits: cacheHits,
		cacheMisses: cacheMisses,
		denylistEntries: denylistEntries
	};
}

function deriveOverview(metrics) {
	var cumulative = deriveCumulative(metrics);
	var totalQueries = cumulative.totalQueries;
	var blockedQueries = cumulative.blockedQueries;
	var cacheHits = cumulative.cacheHits;
	var cacheMisses = cumulative.cacheMisses;
	var denylistEntries = cumulative.denylistEntries;

	return {
		totalQueries: totalQueries,
		blockedQueries: blockedQueries,
		blockedRate: totalQueries > 0 ? blockedQueries / totalQueries * 100 : 0,
		cacheHitRate: cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) * 100 : 0,
		denylistEntries: denylistEntries,
		hasMetrics: Object.keys(metrics).length > 0
	};
}

var REALTIME_WINDOWS = [
	[ '1h', _('1h'), 3600000 ],
	[ '24h', _('24h'), 86400000 ],
	[ '7d', _('7d'), 604800000 ],
	[ '30d', _('30d'), 2592000000 ]
];

var blockyRtMetricsHook = null;

function registerBlockyMetricsPolling() {
	if (registerBlockyMetricsPolling.done)
		return;

	registerBlockyMetricsPolling.done = true;

	poll.add(function() {
		return fetchText(blockyMetricsUrl()).then(function(res) {
			if (blockyRtMetricsHook)
				blockyRtMetricsHook(unwrapFetchText(res));
		});
	}, 10);
}

function setBlockyMetricsPollingHook(fn) {
	blockyRtMetricsHook = fn;
	registerBlockyMetricsPolling();
}

function filterSamplesByWindow(samples, windowMs) {
	var cutoff = Date.now() - windowMs;

	return samples.filter(function(s) {
		return s.t >= cutoff;
	});
}

function downsampleSamples(samples, maxPoints) {
	var out = [];
	var i;
	var idx;

	if (samples.length <= maxPoints)
		return samples.slice();

	for (i = 0; i < maxPoints; i++) {
		idx = Math.floor(i * (samples.length - 1) / (maxPoints - 1));
		out.push(samples[idx]);
	}

	return out;
}

function bucketAggregateBars(samples, bucketCount) {
	var buckets = [];
	var span;
	var t0;
	var t1;
	var bi;
	var s;
	var i;

	if (!samples.length)
		return buckets;

	t0 = samples[0].t;
	t1 = samples[samples.length - 1].t;
	span = Math.max(1, t1 - t0);

	for (i = 0; i < bucketCount; i++) {
		buckets.push({
			total: 0,
			blocked: 0,
			cached: 0
		});
	}

	for (i = 0; i < samples.length; i++) {
		s = samples[i];
		bi = Math.min(bucketCount - 1, Math.floor((s.t - t0) / span * bucketCount));
		buckets[bi].total += s.total;
		buckets[bi].blocked += s.blocked;
		buckets[bi].cached += s.cached;
	}

	return buckets;
}

function padChartTime2(n) {
	n = Math.floor(n);

	return (n < 10 ? '0' : '') + n;
}

function formatChartAxisTime(ms) {
	var d = new Date(ms);

	return padChartTime2(d.getHours()) + ':' + padChartTime2(d.getMinutes());
}

function samplesToXY(samples, field, W, H, padL, padR, padT, padB, maxY) {
	var innerW = W - padL - padR;
	var innerH = H - padT - padB;
	var pts = [];
	var i;
	var x;
	var y;
	var v;

	for (i = 0; i < samples.length; i++) {
		v = samples[i][field];
		x = padL + innerW * (samples.length <= 1 ? 0.5 : i / (samples.length - 1));
		y = padT + innerH * (1 - Math.min(v / maxY, 1));
		pts.push({ x: x, y: y });
	}

	return pts;
}

function catmullRomPoint(t, p0, p1, p2, p3) {
	var t2 = t * t;
	var t3 = t2 * t;

	return {
		x: 0.5 * ((2 * p1.x) +
			(-p0.x + p2.x) * t +
			(2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
			(-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
		y: 0.5 * ((2 * p1.y) +
			(-p0.y + p2.y) * t +
			(2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
			(-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
	};
}

function densifyCatmullRom(pts, steps) {
	var out = [];
	var i;
	var s;
	var p0;
	var p1;
	var p2;
	var p3;

	if (!pts.length)
		return [];

	if (pts.length === 1)
		return [ pts[0] ];

	steps = Math.max(4, steps || 10);

	for (i = 0; i < pts.length - 1; i++) {
		p0 = i === 0 ? pts[0] : pts[i - 1];
		p1 = pts[i];
		p2 = pts[i + 1];
		p3 = i + 2 < pts.length ? pts[i + 2] : pts[pts.length - 1];

		for (s = 0; s < steps; s++)
			out.push(catmullRomPoint(s / steps, p0, p1, p2, p3));
	}

	out.push(pts[pts.length - 1]);
	return out;
}

function buildSmoothAreaPath(densePts, baselineY) {
	var d = '';
	var i;

	if (!densePts.length)
		return '';

	d = 'M ' + densePts[0].x + ',' + baselineY +
		' L ' + densePts[0].x + ',' + densePts[0].y;

	for (i = 1; i < densePts.length; i++)
		d += ' L ' + densePts[i].x + ',' + densePts[i].y;

	d += ' L ' + densePts[densePts.length - 1].x + ',' + baselineY + ' Z';
	return d;
}

function buildSmoothLinePath(densePts) {
	var d = '';
	var i;

	if (!densePts.length)
		return '';

	d = 'M ' + densePts[0].x + ',' + densePts[0].y;

	for (i = 1; i < densePts.length; i++)
		d += ' L ' + densePts[i].x + ',' + densePts[i].y;

	return d;
}

function buildQueriesChartUnderlay(series, maxY, W, H, padL, padR, padT, padB) {
	var innerW = W - padL - padR;
	var innerH = H - padT - padB;
	var ticks = 4;
	var ti;
	var frac;
	var y;
	var gridLines = [];

	var plotBg = E('rect', {
		'class': 'blocky-chart-plot-bg',
		'x': padL,
		'y': padT,
		'width': innerW,
		'height': innerH,
		'rx': '4',
		'ry': '4',
		'class': 'blocky-chart-shade'
	});

	for (ti = 0; ti <= ticks; ti++) {
		frac = ti / ticks;
		y = padT + innerH * (1 - frac);
		gridLines.push(E('line', {
			'x1': padL,
			'y1': y,
			'x2': padL + innerW,
			'y2': y
		}));
	}

	return E('g', {}, [
		plotBg,
		E('g', { 'class': 'blocky-chart-grid' }, gridLines)
	]);
}

function buildQueriesChartAxisLabels(series, maxY, W, H, padL, padR, padT, padB) {
	var innerW = W - padL - padR;
	var innerH = H - padT - padB;
	var ticks = 4;
	var ti;
	var frac;
	var y;
	var axisTexts = [];
	var n = series.length;
	var indices;
	var ix;
	var seen = {};
	var x;
	var i;

	for (ti = 0; ti <= ticks; ti++) {
		frac = ti / ticks;
		y = padT + innerH * (1 - frac);
		axisTexts.push(E('text', {
			'x': padL - 8,
			'y': y + 4,
			'text-anchor': 'end'
		}, [ formatCompactNumber(Math.round(maxY * frac)) ]));
	}

	if (n >= 2) {
		indices = [ 0, Math.round((n - 1) / 4), Math.round((n - 1) / 2), Math.round(3 * (n - 1) / 4), n - 1 ];

		for (i = 0; i < indices.length; i++) {
			ix = indices[i];

			if (seen[ix])
				continue;

			seen[ix] = 1;
			x = padL + innerW * (ix / (n - 1));
			axisTexts.push(E('text', {
				'x': x,
				'y': H - 12,
				'text-anchor': 'middle'
			}, [ formatChartAxisTime(series[ix].t) ]));
		}
	}

	return E('g', { 'class': 'blocky-chart-axis' }, axisTexts);
}

function renderOverview(statsResult, metricsText) {
	var stats = statsResult && statsResult.ok ? statsResult.data : null;
	var summary = stats && stats.summary ? stats.summary : null;
	var metrics = parseMetrics(metricsText);
	var promOverview = deriveOverview(metrics);
	var totalQueries = summary ? summary.queries : promOverview.totalQueries;
	var blockedQueries = summary ? summary.blocked : promOverview.blockedQueries;
	var blockedRate = summary && summary.queries > 0
		? blockedQueries / summary.queries * 100
		: promOverview.blockedRate;
	var cacheHitRate = summary ? summary.cacheHitRate : promOverview.cacheHitRate;
	var listedEntries = stats ? sumDenylistEntries(stats) : promOverview.denylistEntries;
	var listedLabel = listedEntries >= 1000
		? formatCompactNumber(listedEntries)
		: formatNumber(listedEntries);
	var avgMs = summary ? summary.avgResponseMs : null;
	var sourceDetail;

	if (stats)
		sourceDetail = _('Rolling 24h window from Blocky /api/stats.');
	else if (statsResult && statsResult.disabled)
		sourceDetail = _('Enable statistics.enable in config.yml for native 24h stats.');
	else if (promOverview.hasMetrics)
		sourceDetail = _('Lifetime counters from Prometheus (stats API unavailable).');
	else
		sourceDetail = _('Enable statistics and/or prometheus in Blocky configuration.');

	return E('div', { 'class': 'blocky-dashboard-metrics-row' }, [
		E('div', { 'class': 'blocky-metric-strip' }, [
			stats ? blockyPill('yes', _('24h stats')) :
				promOverview.hasMetrics ? blockyPill('warn', _('Prometheus')) :
					blockyPill('no', _('Limited')),
			blockyStatusDetail(sourceDetail)
		]),
		E('div', { 'class': 'blocky-metric-grid', 'style': 'margin:0' }, [
			E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Total queries') ]),
					''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ formatNumber(totalQueries) ]),
				E('small', {}, [ stats ? _('Last 24 hours') : _('Since Blocky started') ])
			]),
			E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Blocked') ]),
					totalQueries > 0 ? blockyPill('no', formatPercent(blockedRate)) : ''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ formatNumber(blockedQueries) ]),
				E('small', {}, [ _('Matched rules') ])
			]),
			E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Cache hit rate') ]),
					''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ formatPercent(cacheHitRate) ]),
				E('div', { 'class': 'blocky-cache-track' }, [
					E('div', {
						'class': 'blocky-cache-fill',
						'style': 'width:%.1f%%'.format(Math.min(100, Math.max(0, cacheHitRate)))
					})
				]),
				E('small', {}, [ _('Hits vs misses') ])
			]),
			E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Listed domains') ]),
					''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ listedLabel ]),
				E('small', {}, [ _('Denylist entries') ])
			]),
			avgMs !== null ? E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Avg response') ]),
					''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ formatNumber(avgMs) + ' ms' ]),
				E('small', {}, [ _('Last 24 hours') ])
			]) : ''
		])
	]);
}

function renderStatsHourlyChart(stats) {
	var perHour = stats && stats.perHour ? stats.perHour.slice() : [];
	var vBarHost = E('div', { 'class': 'blocky-vbar-row', 'style': 'min-height:124px' });
	var maxB = 1;

	if (!perHour.length) {
		replaceContent(vBarHost, E('em', {}, [ _('No hourly statistics yet.') ]));
		return E('div', { 'class': 'blocky-dash-widget' }, [
			E('h3', { 'class': 'blocky-dash-widget-title' }, [ _('Queries over time (24h)') ]),
			E('p', { 'class': 'blocky-dash-widget-descr' }, [
				_('Hourly buckets from Blocky in-memory statistics (UTC).')
			]),
			vBarHost
		]);
	}

	perHour.sort(function(a, b) {
		return String(a.hour).localeCompare(String(b.hour));
	});

	perHour.forEach(function(bucket) {
		maxB = Math.max(maxB, Number(bucket.queries) || 0, Number(bucket.blocked) || 0);
	});

	replaceContent(vBarHost, E('div', {
		'class': 'blocky-chart-vbar-wrap'
	}, perHour.map(function(bucket) {
		var total = Number(bucket.queries) || 0;
		var blocked = Number(bucket.blocked) || 0;
		var scale = Math.max(1, maxB);

		function barPortion(val, color) {
			var bh = Math.round(110 * val / scale);

			return E('div', {
				'title': formatNumber(val),
				'style': 'flex:1;min-width:3px;height:%dpx;background:%s;border-radius:2px 2px 0 0'.format(bh, color)
			});
		}

		return E('div', {
			'style': 'flex:1;margin:0 2px;max-width:48px;display:flex;flex-direction:row;align-items:flex-end;justify-content:center;gap:2px'
		}, [
			barPortion(total, '#2196f3'),
			barPortion(blocked, '#e53935')
		]);
	})));

	return E('div', { 'class': 'blocky-dash-widget' }, [
		E('h3', { 'class': 'blocky-dash-widget-title' }, [ _('Queries over time (24h)') ]),
		E('p', { 'class': 'blocky-dash-widget-descr' }, [
			_('Blue: total queries per hour. Red: blocked. Data from GET /api/stats.')
		]),
		vBarHost,
		E('div', { 'class': 'blocky-chart-legend' }, [
			E('span', {}, [
				E('span', { 'class': 'blocky-legend-dot', 'style': 'background:#2196f3' }),
				_('Total')
			]),
			' ',
			E('span', {}, [
				E('span', { 'class': 'blocky-legend-dot', 'style': 'background:#e53935' }),
				_('Blocked')
			])
		])
	]);
}

function renderStatsTopLists(stats, rowLimit) {
	var limit = Number(rowLimit) || 10;
	var tabState = { key: 'clients' };
	var bodyHost = E('div', {});

	function redraw() {
		var pack;
		var title;
		var color = '#2196f3';

		if (tabState.key === 'domains') {
			pack = mapToBarRows(stats.topDomains, limit);
			title = _('Top domains');
			color = '#2196f3';
		}
		else if (tabState.key === 'blocked') {
			pack = mapToBarRows(stats.topBlockedDomains, limit);
			title = _('Top blocked domains');
			color = '#e53935';
		}
		else {
			pack = mapToBarRows(stats.topClients, limit);
			title = _('Top clients');
			color = '#43a047';
		}

		if (!pack.rows.length) {
			replaceContent(bodyHost, E('em', {}, [ _('No data in the current 24h window.') ]));
			return;
		}

		replaceContent(bodyHost, E('div', {}, [
			E('h4', {}, [ title ]),
			E('div', {}, pack.rows.map(function(row) {
				return topListBarRow(row.name, row.count, pack.max, color);
			}))
		]));
	}

	function tabButton(key, label) {
		return E('button', {
			'class': 'cbi-button ' + (tabState.key === key ? 'cbi-button-action' : ''),
			'click': function(ev) {
				ev.preventDefault();
				tabState.key = key;
				redraw();
			}
		}, [ label ]);
	}

	redraw();

	return E('div', { 'class': 'blocky-dash-widget' }, [
		E('h3', { 'class': 'blocky-dash-widget-title' }, [ _('Top lists (24h)') ]),
		E('p', { 'class': 'blocky-dash-widget-descr' }, [
			_('Rankings from Blocky in-memory statistics.')
		]),
		E('div', { 'class': 'blocky-btn-grid' }, [
			tabButton('clients', _('Clients')),
			tabButton('domains', _('Domains')),
			tabButton('blocked', _('Blocked'))
		]),
		bodyHost
	]);
}

function renderMapBreakdown(title, mapObj, color) {
	var rows = [];

	Object.keys(mapObj || {}).forEach(function(key) {
		rows.push({ name: key, count: Number(mapObj[key]) || 0 });
	});

	rows.sort(function(a, b) {
		return b.count - a.count;
	});

	var pack = mapToBarRows(rows, 12);

	if (!pack.rows.length)
		return E('div', { 'class': 'blocky-toplist-col' }, [
			E('h4', {}, [ title ]),
			E('em', {}, [ _('No data') ])
		]);

	return E('div', { 'class': 'blocky-toplist-col' }, [
		E('h4', {}, [ title ]),
		E('div', {}, pack.rows.map(function(row) {
			return topListBarRow(row.name, row.count, pack.max, color);
		}))
	]);
}

function renderStatsBreakdown(stats) {
	if (!stats)
		return E('div', {});

	return E('div', { 'class': 'blocky-dash-widget' }, [
		E('h3', { 'class': 'blocky-dash-widget-title' }, [ _('Breakdown (24h)') ]),
		E('div', { 'class': 'blocky-toplists-grid' }, [
			renderMapBreakdown(_('By query type'), stats.byQueryType, '#2196f3'),
			renderMapBreakdown(_('By response type'), stats.byResponseType, '#e53935'),
			renderMapBreakdown(_('By response code'), stats.byResponseCode, '#43a047')
		])
	]);
}

function renderListInventory(stats) {
	var lists = stats && stats.lists ? stats.lists : null;

	if (!lists)
		return E('div', {});

	function rowsFor(mapObj) {
		return Object.keys(mapObj || {}).sort().map(function(name) {
			return E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:45%' }, [ name ]),
				E('div', { 'class': 'td left' }, [ formatNumber(mapObj[name]) ])
			]);
		});
	}

	return E('div', { 'class': 'blocky-dash-widget' }, [
		E('h3', { 'class': 'blocky-dash-widget-title' }, [ _('Block lists') ]),
		E('p', { 'class': 'blocky-dash-widget-descr' }, [
			_('Current entry counts per group (point-in-time).')
		]),
		E('div', { 'class': 'blocky-toplists-grid' }, [
			E('div', { 'class': 'blocky-toplist-col' }, [
				E('h4', {}, [ _('Denylists') ]),
				E('div', { 'class': 'table' }, rowsFor(lists.denylist))
			]),
			E('div', { 'class': 'blocky-toplist-col' }, [
				E('h4', {}, [ _('Allowlists') ]),
				E('div', { 'class': 'table' }, rowsFor(lists.allowlist))
			])
		])
	]);
}

function renderCacheWidget(stats, onRefresh) {
	var entries = stats && stats.cache ? Number(stats.cache.entries) || 0 : 0;

	return E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 14em' }, [
		E('div', { 'class': 'blocky-metric-card-head' }, [
			E('strong', {}, [ _('DNS cache') ]),
			''
		]),
		E('div', { 'class': 'blocky-metric-val' }, [ formatNumber(entries) ]),
		E('small', {}, [ _('Cached responses') ]),
		E('div', { 'class': 'blocky-btn-grid' }, [
			actionButton(_('Clear cache'), function() {
				return blockyApi('/cache/flush', 'POST');
			}, 'cbi-button-action', onRefresh)
		])
	]);
}

function renderStatsDashboard(statsResult, onRefresh) {
	var stats = statsResult && statsResult.ok ? statsResult.data : null;

	if (!stats) {
		return E('div', { 'class': 'alert-message warning' }, [
			statsResult && statsResult.disabled
				? _('Statistics API is disabled. Add statistics.enable: true to /etc/blocky/config.yml and restart Blocky.')
				: _('Statistics are not available yet. Ensure Blocky is running and statistics are enabled.')
		]);
	}

	return E('div', { 'class': 'blocky-stats-dashboard' }, [
		renderStatsHourlyChart(stats),
		renderStatsTopLists(stats, 10),
		renderStatsBreakdown(stats),
		renderListInventory(stats),
		E('div', { 'class': 'blocky-metric-grid' }, [
			renderCacheWidget(stats, onRefresh)
		])
	]);
}

function renderStatusDashboard(status, service, onRefresh) {
	var paused = status && status.autoEnableInSec > 0;
	var running = isRunning(service);
	var blockingTailHost = E('span', { 'class': 'blocky-pill-note' });
	var blockingPillHost = E('span', {});
	var headPillHost = E('span', {});
	var statusDescrHost = E('p', { 'class': 'blocky-note-soft' });
	var refresh = onRefresh || function() {};

	function paintStatus(next) {
		var en = next && next.enabled;
		var pa = next && next.autoEnableInSec > 0;

		replaceContent(blockingPillHost, pa ? blockyPill('warn', _('Paused')) :
			blockyPill(en ? 'yes' : 'no', en ? _('Yes') : _('No')));

		replaceContent(headPillHost, running && en && !pa ? blockyPill('yes', _('Enabled')) :
			pa ? blockyPill('warn', _('Paused')) :
				blockyPill('muted', running ? _('Running') : _('Stopped')));

		if (pa)
			replaceContent(blockingTailHost, blockyStatusDetail(
				_('auto-enables in %s').format(formatDuration(next.autoEnableInSec))));
		else
			replaceContent(blockingTailHost, blockyStatusDetail(en ? _('enabled') : _('disabled')));

		replaceContent(statusDescrHost, pa
			? _('Blocking is temporarily disabled.')
			: (running
				? _('DNS server is running and processing queries.')
				: _('DNS server is not running.')));
	}

	paintStatus(status);
	registerBlockingCountdownPoll(paintStatus, paused, 'dashboard');

	return E('div', { 'class': 'blocky-dash-row' }, [
		E('div', { 'class': 'blocky-dash-card' }, [
			E('div', { 'class': 'blocky-dash-card-head' }, [
				E('strong', {}, [ _('Server status') ]),
				headPillHost
			]),
			statusDescrHost,
			E('div', { 'class': 'table blocky-status-table', 'style': 'margin:.5em 0' }, [
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left', 'style': 'width:38%' }, [ _('Service') ]),
					E('div', { 'class': 'td left' }, [
						blockyPill(running ? 'yes' : 'no', running ? _('Yes') : _('No')),
						blockyStatusDetail(running ? _('running') : _('stopped'))
					])
				]),
				E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td left' }, [ _('Blocking') ]),
					E('div', { 'class': 'td left' }, [
						blockingPillHost,
						' ',
						blockingTailHost
					])
				]),
				status && status.disabledGroups && status.disabledGroups.length
					? E('div', { 'class': 'tr' }, [
						E('div', { 'class': 'td left' }, [ _('Disabled groups') ]),
						E('div', { 'class': 'td left' }, [
							blockyPill('warn', _('Yes')),
							blockyStatusDetail(status.disabledGroups.join(', '))
						])
					])
					: ''
			]),
			E('div', { 'class': 'blocky-btn-grid' }, [
				actionButton(_('Pause %s').format(_('5 minutes')), function() {
					return blockyApi('/blocking/disable?duration=5m');
				}, 'cbi-button-action', refresh),
				actionButton(_('Pause %s').format(_('15 minutes')), function() {
					return blockyApi('/blocking/disable?duration=15m');
				}, 'cbi-button-action', refresh),
				actionButton(_('Pause %s').format(_('30 minutes')), function() {
					return blockyApi('/blocking/disable?duration=30m');
				}, 'cbi-button-action', refresh),
				actionButton(_('Disable'), function() {
					return blockyApi('/blocking/disable');
				}, 'cbi-button-negative', refresh)
			])
		]),
		E('div', { 'class': 'blocky-dash-card' }, [
			E('div', { 'class': 'blocky-dash-card-head' }, [
				E('strong', {}, [ _('Operations') ]),
				''
			]),
			E('p', { 'class': 'blocky-note-soft' }, [
				_('Perform maintenance operations on the DNS server.')
			]),
			E('div', { 'class': 'blocky-btn-grid' }, [
				actionButton(_('Clear DNS cache'), function() {
					return blockyApi('/cache/flush', 'POST');
				}, 'cbi-button-action', refresh),
				actionButton(_('Reload allow/deny lists'), function() {
					return blockyApi('/lists/refresh', 'POST');
				}, 'cbi-button-action', refresh)
			])
		])
	]);
}

function renderRealtimeMetrics(initialMetricsText) {
	var W = 820;
	var H = 268;
	var padL = 52;
	var padR = 14;
	var padT = 16;
	var padB = 42;
	var chartUnderlayG = E('g', {});
	var axisLabelsG = E('g', {});
	var pathTotalFill = E('path', {
		'fill': 'rgba(33,150,243,0.18)',
		'stroke': 'none'
	});
	var pathTotalStroke = E('path', {
		'fill': 'none',
		'stroke': '#2196f3',
		'stroke-width': '2',
		'stroke-linejoin': 'round',
		'stroke-linecap': 'round'
	});
	var pathBlockedFill = E('path', {
		'fill': 'rgba(229,57,53,0.2)',
		'stroke': 'none'
	});
	var pathBlockedStroke = E('path', {
		'fill': 'none',
		'stroke': '#e53935',
		'stroke-width': '2',
		'stroke-linejoin': 'round',
		'stroke-linecap': 'round'
	});
	var pathCachedFill = E('path', {
		'fill': 'rgba(67,160,71,0.2)',
		'stroke': 'none'
	});
	var pathCachedStroke = E('path', {
		'fill': 'none',
		'stroke': '#43a047',
		'stroke-width': '2',
		'stroke-linejoin': 'round',
		'stroke-linecap': 'round'
	});
	var svg = E('svg', {
		'width': '100%',
		'height': '286',
		'viewBox': '0 0 ' + W + ' ' + H,
		'preserveAspectRatio': 'none'
	}, [
		E('rect', {
			'x': '0',
			'y': '0',
			'width': W,
			'height': H,
			'fill': 'transparent'
		}),
		chartUnderlayG,
		pathTotalFill,
		pathBlockedFill,
		pathCachedFill,
		pathTotalStroke,
		pathBlockedStroke,
		pathCachedStroke,
		axisLabelsG
	]);
	var rangeButtons = [];
	var vBarHost = E('div', { 'class': 'blocky-vbar-row', 'style': 'min-height:124px' });
	var mixHost = E('div', { 'class': 'blocky-bar-chart' });
	var metricsBannerHost = E('div', {});
	var state = {
		samples: [],
		lastCum: null,
		windowKey: '24h',
		windowMs: 86400000,
		lastRaw: safeString(initialMetricsText)
	};
	var i;
	var activeCls = 'cbi-button cbi-button-action blocky-range-active';
	var idleCls = 'cbi-button';

	function barRowSingle(label, val, maxVal, color) {
		var pct = Math.round(100 * val / Math.max(1, maxVal));

		return E('div', { 'class': 'blocky-bar-row' }, [
			E('div', { 'class': 'blocky-bar-label' }, [ label ]),
			E('div', { 'class': 'blocky-bar-track' }, [
				E('div', {
					'class': 'blocky-bar-seg',
					'style': 'width:%d%%;background:%s'.format(Math.min(100, pct), color)
				})
			]),
			E('div', { 'class': 'blocky-bar-val' }, [ formatNumber(val) ])
		]);
	}

	function redrawMixRow(sample) {
		var totalVal = sample ? sample.total : 0;
		var blockedVal = sample ? sample.blocked : 0;
		var cachedVal = sample ? sample.cached : 0;
		var maxVal = Math.max(1, totalVal, blockedVal, cachedVal);

		replaceContent(mixHost, E('div', {}, [
			E('h4', {}, [ _('Latest interval') ]),
			barRowSingle(_('Total Δ'), totalVal, maxVal, '#2196f3'),
			barRowSingle(_('Blocked Δ'), blockedVal, maxVal, '#e53935'),
			barRowSingle(_('Cache hit Δ'), cachedVal, maxVal, '#43a047'),
			E('p', { 'class': 'cbi-section-descr', 'style': 'margin-top:.75em' }, [
				_('Each bar uses the largest counter delta in that polling interval as full width.')
			])
		]));
	}

	function redrawGroupedBars(filtered) {
		var buckets = bucketAggregateBars(filtered, 14);
		var maxB = 1;
		var colW;
		var bh;
		var b;
		var j;
		var scale;

		for (j = 0; j < buckets.length; j++) {
			b = buckets[j];
			maxB = Math.max(maxB, b.total, b.blocked, b.cached);
		}

		replaceContent(vBarHost, E('div', { 'class': 'blocky-chart-vbar-wrap' }, buckets.map(function(bucket) {
			colW = 'flex:1;margin:0 3px;max-width:52px;display:flex;flex-direction:row;align-items:flex-end;justify-content:center;gap:2px';

			function barPortion(val, color) {
				scale = Math.max(1, maxB);
				bh = Math.round(110 * val / scale);

				return E('div', {
					'title': formatNumber(val),
					'style': 'flex:1;min-width:3px;height:%dpx;background:%s;border-radius:2px 2px 0 0'.format(bh, color)
				});
			}

			return E('div', { 'style': colW }, [
				barPortion(bucket.total, '#2196f3'),
				barPortion(bucket.blocked, '#e53935'),
				barPortion(bucket.cached, '#43a047')
			]);
		})));
	}

	function redrawSmoothChart(series) {
		var maxY = 1;
		var smoothSteps = 12;
		var baselineY = H - padB;
		var dTotal;
		var dBlocked;
		var dCached;
		var i;
		var s;

		for (i = 0; i < series.length; i++) {
			s = series[i];
			maxY = Math.max(maxY, s.total, s.blocked, s.cached);
		}

		replaceContent(chartUnderlayG, buildQueriesChartUnderlay(series, maxY, W, H, padL, padR, padT, padB));
		replaceContent(axisLabelsG, buildQueriesChartAxisLabels(series, maxY, W, H, padL, padR, padT, padB));

		if (!series.length) {
			pathTotalFill.setAttribute('d', '');
			pathTotalStroke.setAttribute('d', '');
			pathBlockedFill.setAttribute('d', '');
			pathBlockedStroke.setAttribute('d', '');
			pathCachedFill.setAttribute('d', '');
			pathCachedStroke.setAttribute('d', '');
			return;
		}

		dTotal = densifyCatmullRom(samplesToXY(series, 'total', W, H, padL, padR, padT, padB, maxY), smoothSteps);
		dBlocked = densifyCatmullRom(samplesToXY(series, 'blocked', W, H, padL, padR, padT, padB, maxY), smoothSteps);
		dCached = densifyCatmullRom(samplesToXY(series, 'cached', W, H, padL, padR, padT, padB, maxY), smoothSteps);

		pathTotalFill.setAttribute('d', buildSmoothAreaPath(dTotal, baselineY));
		pathTotalStroke.setAttribute('d', buildSmoothLinePath(dTotal));
		pathBlockedFill.setAttribute('d', buildSmoothAreaPath(dBlocked, baselineY));
		pathBlockedStroke.setAttribute('d', buildSmoothLinePath(dBlocked));
		pathCachedFill.setAttribute('d', buildSmoothAreaPath(dCached, baselineY));
		pathCachedStroke.setAttribute('d', buildSmoothLinePath(dCached));
	}

	function redrawChart(filtered) {
		redrawSmoothChart(downsampleSamples(filtered, 160));
	}

	function ingestMetrics(text) {
		var metrics = parseMetrics(text);
		var overview = deriveOverview(metrics);
		var cum = deriveCumulative(metrics);
		var last = state.lastCum;
		var dTotal;
		var dBlocked;
		var dCached;

		if (!overview.hasMetrics)
			return;

		if (!last) {
			state.lastCum = {
				totalQueries: cum.totalQueries,
				blockedQueries: cum.blockedQueries,
				cacheHits: cum.cacheHits
			};
			return;
		}

		dTotal = cum.totalQueries - last.totalQueries;
		dBlocked = cum.blockedQueries - last.blockedQueries;
		dCached = cum.cacheHits - last.cacheHits;

		if (dTotal < 0 || dBlocked < 0 || dCached < 0) {
			state.lastCum = {
				totalQueries: cum.totalQueries,
				blockedQueries: cum.blockedQueries,
				cacheHits: cum.cacheHits
			};
			return;
		}

		state.lastCum = {
			totalQueries: cum.totalQueries,
			blockedQueries: cum.blockedQueries,
			cacheHits: cum.cacheHits
		};

		state.samples.push({
			t: Date.now(),
			total: dTotal,
			blocked: dBlocked,
			cached: dCached
		});

		while (state.samples.length > 4000)
			state.samples.shift();
	}

	function redrawAll() {
		var live = deriveOverview(parseMetrics(state.lastRaw)).hasMetrics;

		replaceContent(metricsBannerHost, E('div', {}, live ? [] : [
			E('p', { 'class': 'alert-message warning' }, [
				_('No Prometheus samples detected yet. Enable prometheus in Blocky and confirm /metrics responds.')
			])
		]));

		if (!live) {
			replaceContent(vBarHost, E('div', { 'style': 'padding:.75em 0' }, [
				E('em', {}, [ _('Charts activate once metrics are available.') ])
			]));
			replaceContent(mixHost, E('div', {}, []));
			redrawSmoothChart([]);
			return;
		}

		var filtered = filterSamplesByWindow(state.samples, state.windowMs);

		if (!filtered.length) {
			redrawMixRow(null);
			replaceContent(vBarHost, E('div', { 'style': 'padding:.75em 0' }, [
				E('em', {}, [ _('Waiting for the next metrics sample…') ])
			]));
			redrawSmoothChart([]);
			return;
		}

		redrawChart(filtered);
		redrawGroupedBars(filtered);
		redrawMixRow(filtered[filtered.length - 1]);
	}

	function setWindow(ms, key) {
		state.windowMs = ms;
		state.windowKey = key;

		rangeButtons.forEach(function(btn) {
			btn.className = btn._rangeKey === key ? activeCls : idleCls;
		});

		redrawAll();
	}

	for (i = 0; i < REALTIME_WINDOWS.length; i++) {
		(function(win) {
			var btn = E('button', {
				'class': state.windowKey === win[0] ? activeCls : idleCls,
				'click': function(ev) {
					ev.preventDefault();
					setWindow(win[2], win[0]);
				}
			}, [ win[1] ]);

			btn._rangeKey = win[0];
			rangeButtons.push(btn);
		})(REALTIME_WINDOWS[i]);
	}

	function hook(text) {
		state.lastRaw = text;
		ingestMetrics(text);
		redrawAll();
	}

	setBlockyMetricsPollingHook(hook);
	state.lastRaw = safeString(initialMetricsText);
	ingestMetrics(state.lastRaw);
	redrawAll();

	return E('div', {}, [
		E('div', { 'class': 'blocky-dash-widget' }, [
			E('div', { 'class': 'blocky-queries-widget blocky-queries-widget--embedded' }, [
				E('div', { 'class': 'blocky-queries-widget-head' }, [
					E('div', {}, [
						E('h3', { 'class': 'blocky-dash-widget-title' }, [ _('Queries over time') ]),
						E('p', { 'class': 'blocky-dash-widget-descr', 'style': 'margin:.35em 0 0' }, [
							_('DNS query volume and blocking activity.')
						]),
						E('p', { 'class': 'blocky-note-soft', 'style': 'margin:.35em 0 0' }, [
							_('Estimated rates from Prometheus counter deltas while this page stays open.')
						])
					]),
					E('div', { 'class': 'blocky-time-range' }, rangeButtons)
				]),
				metricsBannerHost,
				E('div', { 'class': 'blocky-chart-svg-wrap' }, [ svg ]),
				E('div', { 'class': 'blocky-chart-legend' }, [
					E('span', {}, [
						E('span', { 'class': 'blocky-legend-dot', 'style': 'background:#2196f3' }),
						_('Total')
					]),
					' ',
					E('span', {}, [
						E('span', { 'class': 'blocky-legend-dot', 'style': 'background:#e53935' }),
						_('Blocked')
					]),
					' ',
					E('span', {}, [
						E('span', { 'class': 'blocky-legend-dot', 'style': 'background:#43a047' }),
						_('Cached')
					])
				]),
				E('p', { 'class': 'blocky-note-soft', 'style': 'margin-bottom:0;margin-top:.65em' }, [
					_('Long windows need more samples — keep the dashboard open. Past sessions are not stored.')
				])
			])
		]),
		E('div', { 'class': 'blocky-dash-widget' }, [
			E('h3', { 'class': 'blocky-dash-widget-title' }, [ _('Activity snapshot') ]),
			E('p', { 'class': 'blocky-dash-widget-descr' }, [
				_('Bar chart: summed deltas in the visible window. Below: last polling interval.')
			]),
			vBarHost,
			mixHost
		]),
		E('p', { 'class': 'cbi-section-descr', 'style': 'margin:.75em 0 0' }, [
			_('For 24h rankings use the stats widgets above. This chart tracks Prometheus counter deltas while the page stays open.')
		])
	]);
}

function renderBlockingControls(status, onRefresh) {
	var refresh = onRefresh || function() {};
	var pauseNoteHost = E('p', { 'class': 'blocky-note-soft' });
	var pause = E('select', { 'class': 'cbi-input-select' },
		PAUSE_PRESETS.map(function(preset) {
			return E('option', { 'value': preset[0] }, [ preset[1] ]);
		}));
	var customPause = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'placeholder': '45m',
		'style': 'width:7em',
		'pattern': '^[0-9]+[smhd]?$'
	});
	var groups = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'placeholder': 'ads,malware',
		'style': 'min-width:16em'
	});

	function pauseDuration() {
		var value = customPause.value.trim() || pause.value;

		if (!value.match(/^[0-9]+[smhd]?$/))
			throw new Error(_('Pause duration must look like 5m, 1h, or 0.'));

		return value;
	}

	function groupQuery() {
		var value = groups.value.trim();

		if (!value)
			return '';

		if (!value.match(/^[A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+)*$/))
			throw new Error(_('Groups must be comma-separated names using letters, numbers, dots, dashes, or underscores.'));

		return '&groups=' + encodeURIComponent(value);
	}

	function paintPauseNote(next) {
		if (next && next.autoEnableInSec > 0) {
			replaceContent(pauseNoteHost, E('span', {}, [
				blockyPill('warn', _('Paused')),
				' ',
				blockyStatusDetail(_('auto-enables in %s').format(formatDuration(next.autoEnableInSec)))
			]));
			registerBlockingCountdownPoll(paintPauseNote, true, 'controls');
		}
		else {
			while (pauseNoteHost.firstChild)
				pauseNoteHost.removeChild(pauseNoteHost.firstChild);
			registerBlockingCountdownPoll(paintPauseNote, false, 'controls');
		}
	}

	paintPauseNote(status);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Blocking Controls') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Controls mirror the Blocky API: enable blocking, disable it temporarily, or disable specific groups.')
		]),
		pauseNoteHost,
		E('p', {}, [
			actionButton(_('Enable blocking'), function() {
				return blockyApi('/blocking/enable');
			}, 'cbi-button-action', refresh),
			' ',
			actionButton(_('Disable blocking'), function() {
				return blockyApi('/blocking/disable');
			}, 'cbi-button-negative', refresh),
			' ',
			E('label', { 'style': 'margin-left:1em' }, [ _('Preset'), ' ', pause ]),
			' ',
			E('label', {}, [ _('Custom'), ' ', customPause ]),
			' ',
			E('label', {}, [ _('Groups'), ' ', groups ]),
			' ',
			actionButton(_('Pause'), function() {
				return blockyApi('/blocking/disable?duration=' + encodeURIComponent(pauseDuration()) + groupQuery());
			}, 'cbi-button-action', refresh)
		]),
		status && status.disabledGroups && status.disabledGroups.length
			? E('p', {}, [ _('Currently disabled groups: %s').format(status.disabledGroups.join(', ')) ])
			: ''
	]);
}

function renderOperations(service, onRefresh) {
	var running = isRunning(service);
	var refresh = onRefresh || function() {};

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Operations') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Maintenance actions are restricted to the local Blocky service and API endpoint.')
		]),
		E('p', {}, [
			actionButton(_('Refresh lists'), function() {
				return blockyApi('/lists/refresh', 'POST');
			}, 'cbi-button-action', refresh),
			' ',
			actionButton(_('Flush cache'), function() {
				return blockyApi('/cache/flush', 'POST');
			}, 'cbi-button-action', refresh),
			' ',
			actionButton(_('Restart service'), function() {
				return runInit('restart');
			}, 'cbi-button-apply', refresh)
		])
	]);
}

function renderServiceControls(service, onRefresh) {
	var running = isRunning(service);
	var refresh = onRefresh || function() {};

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Service') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Enable, start, stop, or restart the OpenWrt service wrapper.')
		]),
		E('p', {}, [
			actionButton(_('Enable on boot'), function() {
				return runInit('enable');
			}, 'cbi-button-action', refresh),
			' ',
			actionButton(_('Disable on boot'), function() {
				return runInit('disable');
			}, 'cbi-button-negative', refresh),
			' ',
			actionButton(running ? _('Restart') : _('Start'), function() {
				return runInit(running ? 'restart' : 'start');
			}, 'cbi-button-apply', refresh),
			' ',
			actionButton(_('Stop'), function() {
				return runInit('stop');
			}, 'cbi-button-negative', refresh)
		])
	]);
}

function renderQueryResult(result) {
	var fields = [
		[ _('Response type'), result.responseType ],
		[ _('Return code'), result.returnCode ],
		[ _('Reason'), result.reason ],
		[ _('Response'), result.response ]
	];

	if (result.responseTable && result.responseTable.length) {
		fields.push([ _('Records'), result.responseTable.map(function(row) {
			return row.join(' ');
		}).join('\n') ]);
	}

	return E('div', { 'class': 'table' }, fields.map(function(row) {
		return E('div', { 'class': 'tr' }, [
			E('div', { 'class': 'td left', 'style': 'width:25%' }, [ row[0] ]),
			E('div', { 'class': 'td left' }, [ safeString(row[1]) || _('none') ])
		]);
	}));
}

function renderQuery() {
	var query = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'placeholder': 'example.org',
		'pattern': '^[A-Za-z0-9_.:-]+$',
		'style': 'min-width:22em'
	});
	var type = E('select', { 'class': 'cbi-input-select' },
		RECORD_TYPES.map(function(recordType) {
			return E('option', { 'value': recordType }, [ recordType ]);
		}));
	var result = E('div', {}, [ E('em', {}, [ _('No query executed yet.') ]) ]);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('DNS query test') ]),
		E('p', {}, [
			query, ' ', type, ' ',
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();

					if (!query.value.trim()) {
						notify(_('Enter a domain name first.'), 'warning');
						return;
					}

					return blockyApi('/query', 'POST', JSON.stringify({
						query: query.value.trim(),
						type: type.value
					})).then(function(res) {
						replaceContent(result, renderQueryResult(res));
					}).catch(function(err) {
						replaceContent(result, E('p', { 'class': 'alert-message warning' }, [
							err.message || String(err)
						]));
					});
				})
			}, [ _('Query') ])
		]),
		result
	]);
}

function renderQueryLogsTab(config) {
	var ql = parseQueryLogConfig(config);
	var tableHost = E('div', {});
	var filterDomain = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'placeholder': 'example.org',
		'style': 'min-width:14em'
	});
	var filterClient = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'placeholder': '192.168.1.10',
		'style': 'min-width:12em'
	});
	var pageState = { page: 0, pageSize: 50, rows: [] };

	function parseCsvRows(text) {
		var lines = safeString(text).split(/\n/);
		var rows = [];
		var i;

		for (i = 0; i < lines.length; i++) {
			var line = lines[i].trim();

			if (!line || line.charAt(0) === '#')
				continue;

			var cols = line.split('\t');
			if (cols.length < 6)
				cols = line.split(';');
			if (cols.length < 6)
				cols = line.split(',');

			if (cols.length < 6)
				continue;

			if (/^time(stamp)?$/i.test(cols[0]) || cols[0] === '2006-01-02 15:04:05')
				continue;

			rows.push({
				time: cols[0],
				client: cols[1] || cols[2] || '',
				question: cols[5] || cols[2] || '',
				type: cols[9] || cols[3] || '',
				response: cols[4] || cols[7] || '',
				reason: cols[4] || '',
				answer: cols[6] || ''
			});
		}

		return rows.reverse();
	}

	function filteredRows() {
		var domainNeedle = filterDomain.value.trim().toLowerCase();
		var clientNeedle = filterClient.value.trim().toLowerCase();

		return pageState.rows.filter(function(row) {
			if (domainNeedle && row.question.toLowerCase().indexOf(domainNeedle) === -1)
				return false;

			if (clientNeedle && row.client.toLowerCase().indexOf(clientNeedle) === -1)
				return false;

			return true;
		});
	}

	function renderTable() {
		var filtered = filteredRows();
		var start = pageState.page * pageState.pageSize;
		var slice = filtered.slice(start, start + pageState.pageSize);

		if (!pageState.rows.length) {
			replaceContent(tableHost, E('em', {}, [ _('No log lines loaded.') ]));
			return;
		}

		if (!slice.length) {
			replaceContent(tableHost, E('em', {}, [ _('No rows match the current filters.') ]));
			return;
		}

		replaceContent(tableHost, E('div', { 'class': 'table' }, [
			E('div', { 'class': 'tr table-titles' }, [
				E('div', { 'class': 'td left' }, [ _('Time') ]),
				E('div', { 'class': 'td left' }, [ _('Client') ]),
				E('div', { 'class': 'td left' }, [ _('Query') ]),
				E('div', { 'class': 'td left' }, [ _('Type') ]),
				E('div', { 'class': 'td left' }, [ _('Response') ])
			])
		].concat(slice.map(function(row) {
			return E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left' }, [ row.time ]),
				E('div', { 'class': 'td left' }, [ row.client ]),
				E('div', { 'class': 'td left' }, [ row.question ]),
				E('div', { 'class': 'td left' }, [ row.type ]),
				E('div', { 'class': 'td left' }, [ row.response || row.reason ])
			]);
		}))));
	}

	function loadCsvLogs() {
		if (!ql || ql.type !== 'csv' || !ql.target) {
			replaceContent(tableHost, E('div', { 'class': 'alert-message' }, [
				_('Query log viewer supports queryLog.type: csv with a directory target. Other backends (MySQL, PostgreSQL, VictoriaLogs) require blocky-ui or external tools.')
			]));
			return Promise.resolve();
		}

		return fs.exec('/bin/sh', [ '-c', 'ls -1t ' + shellQuote(ql.target) + '/*.log 2>/dev/null | head -1' ]).then(function(res) {
			var latest = execResultStdout(res, '').trim();

			if (!latest)
				throw new Error(_('No query log files found in %s (expected YYYY-MM-DD_ALL.log)').format(ql.target));

			return fs.read_direct(latest);
		}).then(function(raw) {
			var text = blockyCliStdout(raw);

			if (text.length > 524288)
				text = text.slice(-524288);

			pageState.rows = parseCsvRows(text);
			pageState.page = 0;
			renderTable();
		}).catch(function(err) {
			replaceContent(tableHost, E('p', { 'class': 'alert-message warning' }, [
				err.message || String(err)
			]));
		});
	}

	if (!ql) {
		return E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, [ _('Query Logs') ]),
			E('p', { 'class': 'cbi-section-descr' }, [
				_('No queryLog section in config.yml. Add queryLog with type csv and a target directory to browse logs here.')
			])
		]);
	}

	loadCsvLogs();

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Query Logs') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Read-only viewer for Blocky tab-separated query logs (%s). Shows the newest daily .log file (tail capped at 512 KiB).').format(ql.type)
		]),
		E('p', {}, [
			filterDomain, ' ',
			filterClient, ' ',
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();
					pageState.page = 0;
					renderTable();
				})
			}, [ _('Filter') ]),
			' ',
			E('button', {
				'class': 'cbi-button',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();
					return loadCsvLogs();
				})
			}, [ _('Reload') ])
		]),
		tableHost,
		E('p', {}, [
			E('button', {
				'class': 'cbi-button',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();
					if (pageState.page > 0) {
						pageState.page--;
						renderTable();
					}
				})
			}, [ _('Previous') ]),
			' ',
			E('button', {
				'class': 'cbi-button',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();
					var maxPage = Math.floor(filteredRows().length / pageState.pageSize);

					if (pageState.page < maxPage) {
						pageState.page++;
						renderTable();
					}
				})
			}, [ _('Next') ])
		])
	]);
}

function renderApiSecuritySection(configYaml, uciAccess) {
	var httpEp = parseBlockyPortLine(configYaml, 'http', 4000);
	var localBind = isLoopbackHost(httpEp.host);
	var userInput = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'value': uciAccess.user || '',
		'placeholder': _('username'),
		'style': 'min-width:12em'
	});
	var passInput = E('input', {
		'type': 'password',
		'class': 'cbi-input-password',
		'value': uciAccess.password || '',
		'placeholder': _('password'),
		'style': 'min-width:12em',
		'autocomplete': 'new-password'
	});

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('API access') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Blocky v0.32.x does not support API keys or built-in HTTP authentication. Keep ports.http bound to 127.0.0.1 so only processes on the router (LuCI, local scripts) can reach /api and /metrics.')
		]),
		E('div', { 'class': 'table blocky-status-table' }, [
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:33%' }, [ _('HTTP listener') ]),
				E('div', { 'class': 'td left' }, [
					blockyPill(localBind ? 'yes' : 'warn', localBind ? _('Localhost') : _('Exposed')),
					blockyStatusDetail(blockyHttpBaseUrl(configYaml))
				])
			]),
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left' }, [ _('LuCI proxy auth') ]),
				E('div', { 'class': 'td left' }, [
					uciAccess.user
						? blockyPill('yes', _('Configured'))
						: blockyPill('muted', _('None')),
					blockyStatusDetail(_('Optional HTTP Basic credentials for LuCI when a reverse proxy protects Blocky'))
				])
			])
		]),
		E('p', {}, [
			userInput, ' ', passInput, ' ',
			E('button', {
				'class': 'cbi-button cbi-button-save',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();

					uci.set('blocky', 'main', 'api_user', userInput.value.trim());
					uci.set('blocky', 'main', 'api_password', passInput.value);
					uci.set('blocky', 'main', 'api_local_only', localBind ? '1' : '0');

					return uci.save().then(function() {
						applyBlockyApiAccess(configYaml, {
							user: userInput.value.trim(),
							password: passInput.value
						});
						notify(_('API access settings saved.'));
					}).catch(function(err) {
						notify(err.message || String(err), 'danger');
					});
				})
			}, [ _('Save API credentials') ])
		]),
		E('p', { 'class': 'blocky-note-soft' }, [
			_('Recommended config.yml: ports.http: 127.0.0.1:4000 and ports.dns: 127.0.0.1:5353. Do not expose the Blocky API on LAN without an external authenticating reverse proxy.')
		])
	]);
}

function renderRouterDnsIntegration(configYaml, dnsFwdRaw) {
	var port = parseBlockyDnsPort(configYaml);
	var forwardHost = E('div', { 'class': 'td left' });

	function paintForward(raw) {
		var enabled = parseDnsForwardFlag(raw);

		replaceContent(forwardHost, [
			blockyPill(enabled ? 'yes' : 'no', enabled ? _('Yes') : _('No')),
			blockyStatusDetail(enabled
				? _('dnsmasq uses %s').format('127.0.0.1#' + String(port))
				: _('WAN / resolv upstream only'))
		]);
	}

	function refreshForward() {
		return fs.exec('/usr/sbin/blocky-dnsmasq-sync', [ 'status' ]).then(function(res) {
			paintForward(blockyCliStdout(execResultStdout(res, '0\n')));
		});
	}

	paintForward(dnsFwdRaw);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Router DNS integration') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Phones and laptops on Wi-Fi ask dnsmasq on the router for DNS (UDP/TCP port 53). Blocky uses its own port (%s in config.yml) so it does not replace dnsmasq. Turn this on to chain dnsmasq to Blocky so filtering and block lists apply to every DHCP client without manual DNS settings.').format(String(port))
		]),
		E('div', { 'class': 'table blocky-status-table' }, [
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:33%' }, [ _('Forwarding') ]),
				forwardHost
			])
		]),
		E('p', {}, [
			actionButton(_('Use Blocky for all LAN / Wi-Fi DNS'), function() {
				return execDnsmasqSync([ 'enable', String(port) ]);
			}, 'cbi-button-apply', refreshForward),
			' ',
			actionButton(_('Stop forwarding (restore dnsmasq only)'), function() {
				return execDnsmasqSync([ 'disable' ]);
			}, 'cbi-button-negative', refreshForward)
		]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('After changing the DNS port in YAML, click Save & restart Blocky, then toggle this again so dnsmasq matches. Block list refresh still uses the Controls tab “Refresh lists” API button.')
		])
	]);
}

function renderConfig(content) {
	var editor = E('textarea', {
		'class': 'cbi-input-textarea',
		'style': 'width:100%; min-height:28em; font-family:monospace'
	}, [ content || '' ]);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Configuration') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Edit %s directly. Save and restart Blocky for changes to take effect.').format(CONFIG_PATH),
			' ',
			_('DNS blocklists are managed under the Block lists tab; the blocking section here is overwritten when lists are applied or Blocky starts.')
		]),
		editor,
		E('p', {}, [
			E('button', {
				'class': 'cbi-button cbi-button-save',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();

					if (!editor.value.trim()) {
						notify(_('Configuration cannot be empty.'), 'danger');
						return;
					}

					return fs.write(CONFIG_PATH, editor.value).then(function() {
						notify(_('Configuration saved.'));
					}).catch(function(err) {
						notify(err.message || String(err), 'danger');
					});
				})
			}, [ _('Save configuration') ]),
			' ',
			E('button', {
				'class': 'cbi-button cbi-button-apply',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();

					if (!editor.value.trim()) {
						notify(_('Configuration cannot be empty.'), 'danger');
						return;
					}

					return fs.write(CONFIG_PATH, editor.value).then(function() {
						return runInit('restart');
					}).then(function() {
						notify(_('Configuration saved and Blocky restarted.'));
					}).catch(function(err) {
						notify(err.message || String(err), 'danger');
					});
				})
			}, [ _('Save & restart') ])
		])
	]);
}

function renderTabs(tabs, activeIndex) {
	var tabButtons = [];
	var tabPanels = [];
	activeIndex = activeIndex || 0;

	function activate(index) {
		tabButtons.forEach(function(button, pos) {
			button.className = pos === index ? 'cbi-tab' : 'cbi-tab-disabled';
		});

		tabPanels.forEach(function(panel, pos) {
			panel.style.display = pos === index ? '' : 'none';
		});
	}

	tabs.forEach(function(tab, index) {
		var button = E('li', {
			'class': index === activeIndex ? 'cbi-tab' : 'cbi-tab-disabled',
			'role': 'tab',
			'click': function(ev) {
				ev.preventDefault();
				activate(index);
			}
		}, [
			E('a', { 'href': '#' }, [ tab.title ])
		]);
		var panel = E('div', {
			'role': 'tabpanel',
			'style': index === activeIndex ? '' : 'display:none'
		}, tab.nodes);

		tabButtons.push(button);
		tabPanels.push(panel);
	});

	return E('div', {}, [
		E('ul', { 'class': 'cbi-tabmenu', 'role': 'tablist' }, tabButtons)
	].concat(tabPanels));
}

function loadBlockyPageData() {
	return Promise.all([
		L.resolveDefault(callServiceList('blocky'), {}),
		L.resolveDefault(fs.read_direct(CONFIG_PATH), ''),
		loadBlockyUciAccess(),
		L.resolveDefault(fs.exec('/usr/sbin/blocky-dnsmasq-sync', [ 'status' ]), { code: 0, stdout: '0\n' }),
		L.resolveDefault(callServiceList('adblock'), {})
	]).then(function(bootstrap) {
		applyBlockyApiAccess(bootstrap[1], bootstrap[2]);

		return Promise.all([
			Promise.resolve(bootstrap[0]),
			L.resolveDefault(blockyApi('/blocking/status'), { enabled: false }),
			Promise.resolve(bootstrap[1]),
			L.resolveDefault(fetchText(blockyMetricsUrl()), ''),
			Promise.resolve(bootstrap[3]),
			L.resolveDefault(fetchBlockyStats(), { ok: false, data: null }),
			Promise.resolve(bootstrap[4]),
			Promise.resolve(bootstrap[2])
		]);
	});
}

function mountDashboardContent(host, data, refreshPage) {
	var service = data[0];
	var status = data[1];
	var config = data[2];
	var metrics = data[3];
	var dnsFwd = data[4];
	var statsResult = data[5];
	var adblockService = data[6];
	var dnsFwdRaw = blockyCliStdout(execResultStdout(dnsFwd, '0\n'));
	var metricsPayload = unwrapFetchText(metrics);

	host.replaceChildren(
		renderAdBlockerPipeline(status, service, dnsFwdRaw, config, statsResult, adblockService),
		renderOverview(statsResult, metricsPayload),
		renderStatusDashboard(status, service, refreshPage),
		renderStatsDashboard(statsResult, refreshPage),
		renderRealtimeMetrics(metricsPayload)
	);

	return {
		service: service,
		status: status,
		config: config,
		metricsPayload: metricsPayload,
		statsResult: statsResult
	};
}

function registerStatsPoll(dashboardHost, getMetricsPayload, refreshPage) {
	poll.add(function() {
		return fetchBlockyStats().then(function(sr) {
			if (!sr.ok || !sr.data)
				return;

			var metricsPayload = typeof getMetricsPayload === 'function' ? getMetricsPayload() : '';
			var overview = dashboardHost.querySelector('.blocky-dashboard-metrics-row');
			if (overview)
				overview.replaceWith(renderOverview(sr, metricsPayload));

			var statsSection = dashboardHost.querySelector('.blocky-stats-dashboard');
			if (statsSection)
				statsSection.replaceWith(renderStatsDashboard(sr, refreshPage));
		});
	}, 45);
}

function createBlockyView(options) {
	options = options || {};
	var defaultTab = options.defaultTab || 0;
	var viewMode = options.viewMode || 'services';
	var statsPollRegistered = false;

	return view.extend({
		load: loadBlockyPageData,

		render: function(data) {
			var self = this;
			var service = data[0];
			var status = data[1];
			var config = data[2];
			var metrics = data[3];
			var dnsFwd = data[4];
			var statsResult = data[5];
			var uciAccess = data[7] || { user: '', password: '', localOnly: true };
			var dnsFwdRaw = blockyCliStdout(execResultStdout(dnsFwd, '0\n'));
			var metricsPayload = unwrapFetchText(metrics);
			var dashboardHost = E('div', { 'class': 'blocky-dashboard' });
			var blocklistsHost = E('div', {});
			var controlsHost = E('div', {});
			var logsHost = E('div', {});

			function refreshPage() {
				return self.load().then(function(fresh) {
					mountDashboardContent(dashboardHost, fresh, refreshPage);
					blocklistsHost.replaceChildren(renderBlocklistsTab(fresh[5], refreshPage));
					controlsHost.replaceChildren(
						renderBlockingControls(fresh[1], refreshPage),
						renderOperations(fresh[0], refreshPage),
						renderServiceControls(fresh[0], refreshPage)
					);
					logsHost.replaceChildren(renderQueryLogsTab(fresh[2]));
				}).catch(function(err) {
					notify(err.message || String(err), 'danger');
				});
			}

			mountDashboardContent(dashboardHost, data, refreshPage);
			blocklistsHost.appendChild(renderBlocklistsTab(statsResult, refreshPage));
			logsHost.appendChild(renderQueryLogsTab(config));

			controlsHost.appendChild(renderBlockingControls(status, refreshPage));
			controlsHost.appendChild(renderOperations(service, refreshPage));
			controlsHost.appendChild(renderServiceControls(service, refreshPage));

			if (!statsPollRegistered) {
				statsPollRegistered = true;
				registerStatsPoll(dashboardHost, function() { return metricsPayload; }, refreshPage);
			}

			if (viewMode === 'status') {
				return E('div', { 'class': 'luci-app-blocky' }, [
					blockyInjectStyles(),
					E('h2', {}, [ _('Blocky DNS — Status & Statistics') ]),
					E('p', { 'class': 'cbi-section-descr' }, [
						_('Live ad-blocking health, 24-hour statistics, and recent query logs. Configuration and controls are under '),
						E('a', { 'href': L.url('admin/services/blocky') }, [ _('Services → Blocky') ]),
						'.'
					]),
					dashboardHost,
					logsHost
				]);
			}

			return E('div', { 'class': 'luci-app-blocky' }, [
				blockyInjectStyles(),
				E('h2', {}, [ _('Blocky DNS') ]),
				E('p', { 'class': 'cbi-section-descr' }, [
					_('Dashboard for Blocky on your router — live statistics, blocking controls, and DNS integration.')
				]),
				renderTabs([
					{
						title: _('Dashboard'),
						nodes: [ dashboardHost ]
					},
					{
						title: _('Block lists'),
						nodes: [ blocklistsHost ]
					},
					{
						title: _('Configuration'),
						nodes: [
							renderApiSecuritySection(config, uciAccess),
							renderRouterDnsIntegration(config, dnsFwdRaw),
							renderConfig(config)
						]
					},
					{
						title: _('Controls'),
						nodes: [ controlsHost ]
					},
					{
						title: _('DNS Query'),
						nodes: [ renderQuery() ]
					},
					{
						title: _('Logs'),
						nodes: [ logsHost ]
					}
				], defaultTab)
			]);
		},

		handleSaveApply: null,
		handleSave: null,
		handleReset: null
	});
}

return baseclass.extend({
	createBlockyView: createBlockyView
});
