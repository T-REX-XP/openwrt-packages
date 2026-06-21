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

var BLOCKY_CHART_FALLBACK = {
	total: '#2196f3',
	blocked: '#e53935',
	cached: '#43a047'
};

function blockyThemeRoot() {
	return document.querySelector('.luci-app-blocky') || document.documentElement;
}

function blockyCssVar(name, fallback) {
	var val = getComputedStyle(blockyThemeRoot()).getPropertyValue(name).trim();

	return val || fallback || '';
}

function blockyChartColor(key) {
	return blockyCssVar('--blocky-chart-' + key, BLOCKY_CHART_FALLBACK[key]);
}

function blockyChartFill(key) {
	return blockyCssVar('--blocky-chart-' + key + '-fill', 'transparent');
}

function blockyLegendDot(tone) {
	return E('span', { 'class': 'blocky-legend-dot blocky-legend-dot--' + tone });
}

function applyBlockyChartPathTheme(paths) {
	if (!paths)
		return;

	paths.totalFill.setAttribute('fill', blockyChartFill('total'));
	paths.totalStroke.setAttribute('stroke', blockyChartColor('total'));
	paths.blockedFill.setAttribute('fill', blockyChartFill('blocked'));
	paths.blockedStroke.setAttribute('stroke', blockyChartColor('blocked'));
	paths.cachedFill.setAttribute('fill', blockyChartFill('cached'));
	paths.cachedStroke.setAttribute('stroke', blockyChartColor('cached'));
}

function blockyAttachThemeSync(onThemeChange) {
	var root = document.documentElement;
	var mq = window.matchMedia('(prefers-color-scheme: dark)');
	var observer;

	if (typeof onThemeChange !== 'function')
		return function() {};

	function sync() {
		onThemeChange();
	}

	if (typeof MutationObserver !== 'undefined') {
		observer = new MutationObserver(sync);
		observer.observe(root, {
			attributes: true,
			attributeFilter: [ 'data-darkmode' ]
		});
	}

	if (typeof mq.addEventListener === 'function')
		mq.addEventListener('change', sync);
	else if (typeof mq.addListener === 'function')
		mq.addListener(sync);

	return function() {
		if (observer)
			observer.disconnect();

		if (typeof mq.removeEventListener === 'function')
			mq.removeEventListener('change', sync);
		else if (typeof mq.removeListener === 'function')
			mq.removeListener(sync);
	};
}

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

var BLOCKLIST_CATALOG_PATH = '/usr/share/luci-app-blocky/blocklist-catalog.json';
var EMPTY_BLOCKLIST_CATALOG = { presets: [], catalog: [], presetMap: {} };
var blocklistCatalogPromise = null;

function unwrapFsRead(value) {
	return safeString(blockyCliStdout(value)).trim();
}

function emptyBlocklistCatalog() {
	return { presets: [], catalog: [], presetMap: {} };
}

function normalizeBlocklistCatalog(raw) {
	var data = null;
	var text = unwrapFsRead(raw);

	if (text) {
		try {
			data = JSON.parse(text);
		}
		catch (err) {
			data = null;
		}
	}
	else if (raw && typeof raw === 'object' && Array.isArray(raw.presets)) {
		data = raw;
	}

	if (!data || !Array.isArray(data.presets))
		return emptyBlocklistCatalog();

	var presetMap = {};
	var presets = [];

	data.presets.forEach(function(preset) {
		if (!preset || !preset.id || !preset.name || !preset.url)
			return;

		presetMap[preset.id] = preset;
		presets.push(preset);
	});

	return {
		presets: presets,
		catalog: Array.isArray(data.catalog) ? data.catalog : [],
		presetMap: presetMap
	};
}

function loadBlocklistCatalog(forceReload) {
	if (forceReload)
		blocklistCatalogPromise = null;

	if (blocklistCatalogPromise)
		return blocklistCatalogPromise;

	blocklistCatalogPromise = L.resolveDefault(fs.read(BLOCKLIST_CATALOG_PATH), '').then(function(raw) {
		return normalizeBlocklistCatalog(raw);
	});

	return blocklistCatalogPromise;
}

function blockyPresetHomeUrl(preset) {
	if (!preset || !preset.url)
		return '#';

	if (preset.homeUrl)
		return preset.homeUrl;

	var cleaned = safeString(preset.url).replace(/[#?].*$/, '');

	return cleaned.replace(/\/[^/]*$/, '/') || cleaned;
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
	dialog.addEventListener('click', function(ev) {
		ev.stopPropagation();
	});

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
			if (!preset || !preset.id || !preset.url)
				return;

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

function openCatalogModal(refreshPage, catalogData) {
	catalogData = catalogData || EMPTY_BLOCKLIST_CATALOG;

	if (!catalogData.presets.length) {
		notify(_('Blocklist catalog is missing or invalid (%s).').format(BLOCKLIST_CATALOG_PATH), 'warning');
		return Promise.resolve();
	}

	if (!catalogData.catalog.length) {
		notify(_('Blocklist catalog has no groups. Edit %s on the router.').format(BLOCKLIST_CATALOG_PATH), 'warning');
		return Promise.resolve();
	}

	return loadUciBlocklists().then(function(lists) {
		var existing = {};
		var checkboxes = [];
		var presetMap = catalogData.presetMap || {};

		lists.forEach(function(entry) {
			existing[entry.id] = true;
		});

		var body = [];

		catalogData.catalog.forEach(function(group) {
			var rows = [];

			(group.items || []).forEach(function(presetId) {
				var preset = presetMap[presetId];

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

		if (!body.length) {
			body.push(E('p', { 'class': 'blocky-note-soft' }, [
				_('All catalog lists are already configured.')
			]));
		}

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

function openNewBlocklistModal(refreshPage, catalogData) {
	catalogData = catalogData || EMPTY_BLOCKLIST_CATALOG;
	var overlay;

	if (!catalogData.presets.length) {
		notify(_('Blocklist catalog is missing or invalid (%s).').format(BLOCKLIST_CATALOG_PATH), 'warning');
		openCustomBlocklistModal(refreshPage);
		return;
	}

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
						return openCatalogModal(refreshPage, catalogData);
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

function execBlockyListsRefresh() {
	return fs.exec('/usr/sbin/blocky-lists-refresh', []).then(function(res) {
		var code = res != null ? Number(res.code) : 0;

		if (code !== 0)
			throw new Error(execResultStdout(res, _('Failed to refresh block lists in Blocky.')));

		return res;
	});
}

function applyBlocklistChanges(restart) {
	return uci.load('blocky').then(function() {
		return uci.save();
	}).then(function() {
		return execBlockyListsSync();
	}).then(function() {
		if (restart)
			return runInit('restart').then(refreshBlockyLists);

		return refreshBlockyLists();
	});
}

function refreshBlockyLists() {
	return execBlockyListsRefresh();
}

function resolveDenyCount(counts, entry) {
	var keys;
	var i;

	if (!counts || !entry)
		return null;

	keys = [ entry.id, sanitizeBlocklistId(entry.id), sanitizeBlocklistId(entry.name) ];

	for (i = 0; i < keys.length; i++) {
		if (keys[i] && counts[keys[i]] != null)
			return counts[keys[i]];
	}

	return null;
}

function renderBlocklistsTab(statsResult, refreshPage, catalogData) {
	catalogData = catalogData || EMPTY_BLOCKLIST_CATALOG;
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
				var rules = resolveDenyCount(counts, entry);
				var rulesLabel = rules != null
					? formatNumber(rules)
					: (entry.enabled ? _('pending') : '0');

				return E('div', { 'class': 'tr' }, [
					E('div', { 'class': 'td' }, [
						E('input', {
							'type': 'checkbox',
							'checked': entry.enabled ? '' : null,
							'change': ui.createHandlerFn(this, function(ev) {
								return uci.load('blocky').then(function() {
									uci.set('blocky', entry.id, 'enabled', ev.target.checked ? '1' : '0');
									return applyBlocklistChanges(true);
								}).then(function() {
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
			_('Manage remote DNS blocklists: view, enable, edit, delete, and combine multiple filter lists.')
		]),
		tableHost,
		E('div', { 'class': 'blocky-blocklists-toolbar blocky-blocklists-toolbar-split' }, [
			E('div', { 'class': 'blocky-blocklists-toolbar-left' }, [
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-add',
					'click': ui.createHandlerFn(this, function(ev) {
						ev.preventDefault();
						openNewBlocklistModal(refreshPage, catalogData);
					})
				}, [ _('Add blocklist') ])
			]),
			E('div', { 'class': 'blocky-blocklists-toolbar-right' }, [
				actionButton(_('Update lists now'), function() {
					return execBlockyListsSync().then(function() {
						return runInit('restart');
					}).then(function() {
						return execBlockyListsRefresh();
					});
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

function blockyPathFromUrl(url) {
	var path = safeString(url).trim();

	if (!path)
		return 'metrics';

	if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) {
		var base = blockyApiAccess.baseUrl;

		if (path.indexOf(base) === 0)
			path = path.slice(base.length);
		else {
			var m = path.match(/\/\/[^/]+(\/.*)?$/);

			path = m && m[1] ? m[1] : '/metrics';
		}
	}

	path = path.replace(/^\//, '');

	if (path === 'metrics' || path.indexOf('metrics?') === 0)
		return 'metrics';

	if (path.indexOf('api/') === 0)
		return path;

	return 'api/' + path;
}

function blockyHttpRequest(method, path, body) {
	var args = [ method || 'GET', path || 'metrics' ];

	if (body != null && String(body) !== '')
		args.push(String(body));

	return fs.exec('/usr/sbin/blocky-http-api', args).then(function(res) {
		var code = res != null ? Number(res.code) : 0;
		var text = execResultStdout(res, '');

		if (code !== 0)
			throw new Error(text.trim() || _('Request to Blocky failed.'));

		return text;
	});
}

function fetchText(url, method, body) {
	return blockyHttpRequest(method || 'GET', blockyPathFromUrl(url), body);
}

function unwrapFetchText(res) {
	if (res == null || res === '')
		return '';

	if (typeof res === 'string')
		return res;

	if (typeof res === 'object' && res.stdout !== undefined)
		return execResultStdout(res, '');

	return safeString(res.stderr || res);
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

function topListBarRow(label, val, maxVal, tone) {
	var pct = Math.round(100 * val / Math.max(1, maxVal));

	tone = tone || 'queries';

	return E('div', { 'class': 'blocky-bar-row' }, [
		E('div', { 'class': 'blocky-bar-label', 'title': label }, [ label ]),
		E('div', { 'class': 'blocky-bar-track' }, [
			E('div', {
				'class': 'blocky-bar-seg blocky-bar-seg--' + tone,
				'style': 'width:%d%%'.format(Math.min(100, pct))
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
				? _('Default first-boot setup routes all DHCP client DNS through Blocky with HaGeZi Light and URLhaus blocklists.')
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
		var labels;
		var value;
		var responseType;

		if (!line || line.charAt(0) === '#')
			return;

		match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/);
		if (!match)
			return;

		name = match[1];
		labels = match[2] || '';
		value = Number(match[3]);

		if (!isFinite(value))
			return;

		metrics[name] = (metrics[name] || 0) + value;

		if (labels && name === 'blocky_response_total') {
			responseType = /response_type="([^"]+)"/.exec(labels);

			if (responseType) {
				name = 'blocky_response_total:' + String(responseType[1]).toUpperCase();
				metrics[name] = (metrics[name] || 0) + value;
			}
		}
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
		'blocky_response_total:BLOCKED',
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
		'blocky_denylist_cache_entries',
		'blocky_denylist_cache',
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
		}).catch(function() {});
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

function gatherOverviewMetrics(statsResult, metricsText) {
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

	return {
		stats: stats,
		totalQueries: totalQueries,
		blockedQueries: blockedQueries,
		blockedRate: blockedRate,
		cacheHitRate: cacheHitRate,
		listedEntries: listedEntries,
		listedLabel: listedEntries >= 1000
			? formatCompactNumber(listedEntries)
			: formatNumber(listedEntries),
		avgMs: avgMs,
		sourceDetail: sourceDetail,
		hasStats: !!stats,
		hasPrometheus: promOverview.hasMetrics
	};
}

function renderDashboardSummaryGrid(overview, statsResult) {
	var stats = statsResult && statsResult.ok;

	return E('div', { 'class': 'blocky-dash-summary-grid' }, [
		E('div', { 'class': 'blocky-summary-card blocky-summary-card--queries' }, [
			E('p', { 'class': 'blocky-summary-card-label' }, [ _('DNS queries') ]),
			E('p', { 'class': 'blocky-summary-card-val' }, [ formatNumber(overview.totalQueries) ]),
			E('p', { 'class': 'blocky-summary-card-meta' }, [
				stats ? _('Last 24 hours') : _('Since Blocky started')
			])
		]),
		E('div', { 'class': 'blocky-summary-card blocky-summary-card--blocked' }, [
			overview.totalQueries > 0
				? E('span', { 'class': 'blocky-summary-card-badge' }, [ formatPercent(overview.blockedRate) ])
				: '',
			E('p', { 'class': 'blocky-summary-card-label' }, [ _('Blocked by filters') ]),
			E('p', { 'class': 'blocky-summary-card-val' }, [ formatNumber(overview.blockedQueries) ]),
			E('p', { 'class': 'blocky-summary-card-meta' }, [ _('Matched denylist rules') ])
		]),
		E('div', { 'class': 'blocky-summary-card blocky-summary-card--cache' }, [
			E('p', { 'class': 'blocky-summary-card-label' }, [ _('Cache hit rate') ]),
			E('p', { 'class': 'blocky-summary-card-val' }, [ formatPercent(overview.cacheHitRate) ]),
			E('div', { 'class': 'blocky-cache-track' }, [
				E('div', {
					'class': 'blocky-cache-fill',
					'style': 'width:%.1f%%'.format(Math.min(100, Math.max(0, overview.cacheHitRate)))
				})
			])
		]),
		E('div', { 'class': 'blocky-summary-card blocky-summary-card--lists' }, [
			E('p', { 'class': 'blocky-summary-card-label' }, [ _('Listed domains') ]),
			E('p', { 'class': 'blocky-summary-card-val' }, [ overview.listedLabel ]),
			E('p', { 'class': 'blocky-summary-card-meta' }, [ _('Denylist entries in memory') ])
		])
	]);
}

function renderStatRow(label, value) {
	return E('div', { 'class': 'blocky-stat-row' }, [
		E('div', { 'class': 'blocky-stat-label' }, [ label ]),
		E('div', { 'class': 'blocky-stat-value' }, [ value ])
	]);
}

function renderGeneralStatisticsPanel(overview, statsResult, status, service, refreshPage) {
	var running = isRunning(service);
	var blocking = !!(status && status.enabled && !(status.autoEnableInSec > 0));
	var paused = !!(status && status.autoEnableInSec > 0);
	var refresh = refreshPage || function() {};
	var rows = [
		renderStatRow(_('DNS queries'), formatNumber(overview.totalQueries)),
		renderStatRow(_('Blocked by filters'), formatNumber(overview.blockedQueries)),
		renderStatRow(_('Block rate'), overview.totalQueries > 0 ? formatPercent(overview.blockedRate) : '—'),
		renderStatRow(_('Cache hit rate'), formatPercent(overview.cacheHitRate)),
		overview.avgMs !== null
			? renderStatRow(_('Avg processing time'), formatNumber(overview.avgMs) + ' ms')
			: '',
		renderStatRow(_('Listed domains'), overview.listedLabel),
		renderStatRow(_('Service'), running ? _('Running') : _('Stopped')),
		renderStatRow(_('Blocking'), paused
			? _('Paused (%s)').format(formatDuration(status.autoEnableInSec))
			: (blocking ? _('Enabled') : _('Disabled')))
	];

	return E('div', { 'class': 'blocky-dash-panel' }, [
		E('div', { 'class': 'blocky-dash-panel-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('General statistics') ]),
				E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
					overview.hasStats ? _('For the last 24 hours') : overview.sourceDetail
				])
			]),
			overview.hasStats ? blockyPill('yes', _('24h stats')) :
				overview.hasPrometheus ? blockyPill('warn', _('Prometheus')) :
					blockyPill('no', _('Limited'))
		]),
		E('div', { 'class': 'blocky-stat-table' }, rows),
		E('div', { 'class': 'blocky-btn-grid' }, [
			actionButton(_('Enable blocking'), function() {
				return blockyApi('/blocking/enable');
			}, 'cbi-button-action', refresh),
			actionButton(_('Pause 5m'), function() {
				return blockyApi('/blocking/disable?duration=5m');
			}, 'cbi-button-action', refresh),
			actionButton(_('Clear cache'), function() {
				return blockyApi('/cache/flush', 'POST');
			}, 'cbi-button-action', refresh)
		])
	]);
}

function renderClientTableRows(items, limit) {
	var rows = (items || []).slice(0, limit || 10);
	var total = 0;
	var i;

	for (i = 0; i < rows.length; i++)
		total += Number(rows[i].count) || 0;

	if (!rows.length)
		return E('em', {}, [ _('No data in the current 24h window.') ]);

	return E('div', { 'class': 'blocky-client-table' }, [
		E('div', { 'class': 'blocky-client-table-head' }, [
			E('span', {}, [ _('Client') ]),
			E('span', {}, [ '' ]),
			E('span', {}, [ _('Requests') ]),
			E('span', {}, [ '%' ])
		])
	].concat(rows.map(function(row) {
		var count = Number(row.count) || 0;
		var pct = total > 0 ? count / total * 100 : 0;

		return E('div', { 'class': 'blocky-client-row' }, [
			E('div', { 'class': 'blocky-client-name', 'title': row.name }, [ row.name ]),
			E('div', { 'class': 'blocky-client-bar' }, [
				E('div', {
					'class': 'blocky-client-bar-fill',
					'style': 'width:%.1f%%'.format(Math.min(100, pct))
				})
			]),
			E('div', { 'class': 'blocky-client-count' }, [ formatNumber(count) ]),
			E('div', { 'class': 'blocky-client-pct' }, [ formatPercent(pct) ])
		]);
	})));
}

function renderTopClientsPanel(statsResult, limit) {
	var stats = statsResult && statsResult.ok ? statsResult.data : null;
	var bodyHost = E('div', {});

	if (!stats) {
		replaceContent(bodyHost, E('em', {}, [
			statsResult && statsResult.disabled
				? _('Statistics API is disabled.')
				: _('Statistics are not available yet.')
		]));
	}
	else {
		replaceContent(bodyHost, renderClientTableRows(stats.topClients, limit || 10));
	}

	return E('div', { 'class': 'blocky-dash-panel' }, [
		E('div', { 'class': 'blocky-dash-panel-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Top clients') ]),
				E('p', { 'class': 'blocky-dash-panel-subtitle' }, [ _('For the last 24 hours') ])
			])
		]),
		bodyHost
	]);
}

function renderTopDomainColumn(title, items, limit, tone) {
	var pack = mapToBarRows(items, limit || 8);

	return E('div', { 'class': 'blocky-dash-panel blocky-dash-panel--nested' }, [
		E('h4', { 'class': 'blocky-dash-panel-title', 'style': 'font-size:0.98em;margin:0 0 0.65em' }, [ title ]),
		pack.rows.length
			? E('div', {}, pack.rows.map(function(row) {
				return topListBarRow(row.name, row.count, pack.max, tone);
			}))
			: E('em', {}, [ _('No data') ])
	]);
}

function renderTopDomainsStack(stats) {
	if (!stats)
		return E('div', {});

	return E('div', { 'class': 'blocky-dash-stack' }, [
		renderTopDomainColumn(_('Top queried domains'), stats.topDomains, 8, 'queries'),
		renderTopDomainColumn(_('Top blocked domains'), stats.topBlockedDomains, 8, 'blocked')
	]);
}

function renderOverview(statsResult, metricsText) {
	var overview = gatherOverviewMetrics(statsResult, metricsText);

	return E('div', { 'class': 'blocky-dashboard-metrics-row' }, [
		E('div', { 'class': 'blocky-metric-strip' }, [
			overview.hasStats ? blockyPill('yes', _('24h stats')) :
				overview.hasPrometheus ? blockyPill('warn', _('Prometheus')) :
					blockyPill('no', _('Limited')),
			blockyStatusDetail(overview.sourceDetail)
		]),
		renderDashboardSummaryGrid(overview, statsResult)
	]);
}

function renderStatsHourlyChart(stats) {
	var perHour = stats && stats.perHour ? stats.perHour.slice() : [];
	var vBarHost = E('div', { 'class': 'blocky-vbar-row', 'style': 'min-height:124px' });
	var maxB = 1;

	if (!perHour.length) {
		replaceContent(vBarHost, E('em', {}, [ _('No hourly statistics yet.') ]));
		return E('div', { 'class': 'blocky-dash-panel blocky-dash-widget' }, [
			E('div', { 'class': 'blocky-dash-panel-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Queries over time (24h)') ]),
					E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
						_('Hourly buckets from Blocky in-memory statistics (UTC).')
					])
				])
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

		function barPortion(val, tone) {
			var bh = Math.round(110 * val / scale);

			return E('div', {
				'class': 'blocky-vbar blocky-vbar--' + tone,
				'title': formatNumber(val),
				'style': 'flex:1;min-width:3px;height:%dpx'.format(bh)
			});
		}

		return E('div', {
			'style': 'flex:1;margin:0 2px;max-width:48px;display:flex;flex-direction:row;align-items:flex-end;justify-content:center;gap:2px'
		}, [
			barPortion(total, 'total'),
			barPortion(blocked, 'blocked')
		]);
	})));

	return E('div', { 'class': 'blocky-dash-panel blocky-dash-widget' }, [
		E('div', { 'class': 'blocky-dash-panel-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Queries over time (24h)') ]),
				E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
					_('Hourly buckets from Blocky in-memory statistics (UTC).')
				])
			])
		]),
		vBarHost,
		E('div', { 'class': 'blocky-chart-legend' }, [
			E('span', {}, [ blockyLegendDot('total'), _('Total') ]),
			' ',
			E('span', {}, [ blockyLegendDot('blocked'), _('Blocked') ])
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
		var tone = 'queries';

		if (tabState.key === 'domains') {
			pack = mapToBarRows(stats.topDomains, limit);
			title = _('Top domains');
			tone = 'queries';
		}
		else if (tabState.key === 'blocked') {
			pack = mapToBarRows(stats.topBlockedDomains, limit);
			title = _('Top blocked domains');
			tone = 'blocked';
		}
		else {
			pack = mapToBarRows(stats.topClients, limit);
			title = _('Top clients');
			tone = 'clients';
		}

		if (!pack.rows.length) {
			replaceContent(bodyHost, E('em', {}, [ _('No data in the current 24h window.') ]));
			return;
		}

		replaceContent(bodyHost, E('div', {}, [
			E('h4', {}, [ title ]),
			E('div', {}, pack.rows.map(function(row) {
				return topListBarRow(row.name, row.count, pack.max, tone);
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

	return E('div', { 'class': 'blocky-dash-panel blocky-dash-widget' }, [
		E('div', { 'class': 'blocky-dash-panel-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Top lists (24h)') ]),
				E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
					_('Rankings from Blocky in-memory statistics.')
				])
			])
		]),
		E('div', { 'class': 'blocky-btn-grid' }, [
			tabButton('clients', _('Clients')),
			tabButton('domains', _('Domains')),
			tabButton('blocked', _('Blocked'))
		]),
		bodyHost
	]);
}

function renderMapBreakdown(title, mapObj, tone) {
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
			return topListBarRow(row.name, row.count, pack.max, tone);
		}))
	]);
}

function renderStatsBreakdown(stats) {
	if (!stats)
		return E('div', {});

	return E('div', { 'class': 'blocky-dash-panel blocky-dash-widget' }, [
		E('div', { 'class': 'blocky-dash-panel-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Breakdown (24h)') ]),
				E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
					_('Query type, response type, and response code distribution.')
				])
			])
		]),
		E('div', { 'class': 'blocky-toplists-grid' }, [
			renderMapBreakdown(_('By query type'), stats.byQueryType, 'queries'),
			renderMapBreakdown(_('By response type'), stats.byResponseType, 'blocked'),
			renderMapBreakdown(_('By response code'), stats.byResponseCode, 'response')
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

	return E('div', { 'class': 'blocky-dash-panel blocky-dash-widget' }, [
		E('div', { 'class': 'blocky-dash-panel-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Block lists') ]),
				E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
					_('Current entry counts per group (point-in-time).')
				])
			])
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
		return E('div', { 'class': 'alert-message warning blocky-stats-dashboard' }, [
			statsResult && statsResult.disabled
				? _('Statistics API is disabled. Add statistics.enable: true to /etc/blocky/config.yml and restart Blocky.')
				: _('Statistics are not available yet. Ensure Blocky is running and statistics are enabled.')
		]);
	}

	return E('div', { 'class': 'blocky-stats-dashboard' }, [
		E('div', { 'class': 'blocky-dash-grid' }, [
			renderStatsHourlyChart(stats),
			renderStatsTopLists(stats, 10)
		]),
		E('div', { 'class': 'blocky-dash-grid' }, [
			renderStatsBreakdown(stats),
			renderListInventory(stats)
		]),
		E('div', { 'class': 'blocky-dash-grid blocky-dash-grid--single' }, [
			E('div', { 'class': 'blocky-dash-panel' }, [
				E('div', { 'class': 'blocky-dash-panel-head' }, [
					E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('DNS cache') ])
				]),
				renderCacheWidget(stats, onRefresh)
			])
		])
	]);
}

function renderDashboardStatsZone(statsResult, metricsPayload, status, service, refreshPage) {
	var overview = gatherOverviewMetrics(statsResult, metricsPayload);
	var stats = statsResult && statsResult.ok ? statsResult.data : null;
	var nodes = [
		renderDashboardSummaryGrid(overview, statsResult),
		E('div', { 'class': 'blocky-dash-grid' }, [
			renderGeneralStatisticsPanel(overview, statsResult, status, service, refreshPage),
			renderTopClientsPanel(statsResult, 10)
		])
	];

	if (stats)
		nodes.push(renderStatsDashboard(statsResult, refreshPage));
	else
		nodes.push(E('div', { 'class': 'alert-message warning' }, [
			statsResult && statsResult.disabled
				? _('Statistics API is disabled. Add statistics.enable: true to /etc/blocky/config.yml and restart Blocky.')
				: _('Statistics are not available yet. Ensure Blocky is running and statistics are enabled.')
		]));

	return E('div', { 'class': 'blocky-dash-stats-zone' }, nodes);
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
					return execBlockyListsSync().then(function() {
						return refreshBlockyLists();
					});
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
	var pathTotalFill = E('path', { 'fill': 'transparent', 'stroke': 'none' });
	var pathTotalStroke = E('path', {
		'fill': 'none',
		'stroke-width': '2',
		'stroke-linejoin': 'round',
		'stroke-linecap': 'round'
	});
	var pathBlockedFill = E('path', { 'fill': 'transparent', 'stroke': 'none' });
	var pathBlockedStroke = E('path', {
		'fill': 'none',
		'stroke-width': '2',
		'stroke-linejoin': 'round',
		'stroke-linecap': 'round'
	});
	var pathCachedFill = E('path', { 'fill': 'transparent', 'stroke': 'none' });
	var pathCachedStroke = E('path', {
		'fill': 'none',
		'stroke-width': '2',
		'stroke-linejoin': 'round',
		'stroke-linecap': 'round'
	});
	var chartPaths = {
		totalFill: pathTotalFill,
		totalStroke: pathTotalStroke,
		blockedFill: pathBlockedFill,
		blockedStroke: pathBlockedStroke,
		cachedFill: pathCachedFill,
		cachedStroke: pathCachedStroke
	};
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

	function barRowSingle(label, val, maxVal, tone) {
		var pct = Math.round(100 * val / Math.max(1, maxVal));

		return E('div', { 'class': 'blocky-bar-row' }, [
			E('div', { 'class': 'blocky-bar-label' }, [ label ]),
			E('div', { 'class': 'blocky-bar-track' }, [
				E('div', {
					'class': 'blocky-bar-seg blocky-bar-seg--' + tone,
					'style': 'width:%d%%'.format(Math.min(100, pct))
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

		if (!sample) {
			replaceContent(mixHost, E('em', {}, [ _('Waiting for the next metrics sample…') ]));
			return;
		}

		replaceContent(mixHost, E('div', {}, [
			barRowSingle(_('Total Δ'), totalVal, maxVal, 'total'),
			barRowSingle(_('Blocked Δ'), blockedVal, maxVal, 'blocked'),
			barRowSingle(_('Cache hit Δ'), cachedVal, maxVal, 'cached'),
			E('p', { 'class': 'cbi-section-descr', 'style': 'margin-top:.75em;margin-bottom:0' }, [
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

			function barPortion(val, tone) {
				scale = Math.max(1, maxB);
				bh = Math.round(110 * val / scale);

				return E('div', {
					'class': 'blocky-vbar blocky-vbar--' + tone,
					'title': formatNumber(val),
					'style': 'flex:1;min-width:3px;height:%dpx'.format(bh)
				});
			}

			return E('div', { 'style': colW }, [
				barPortion(bucket.total, 'total'),
				barPortion(bucket.blocked, 'blocked'),
				barPortion(bucket.cached, 'cached')
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
		applyBlockyChartPathTheme(chartPaths);
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
	applyBlockyChartPathTheme(chartPaths);
	blockyAttachThemeSync(function() {
		applyBlockyChartPathTheme(chartPaths);
	});
	redrawAll();

	return E('div', { 'class': 'blocky-live-metrics-grid' }, [
		E('div', { 'class': 'blocky-dash-panel blocky-live-metrics-col blocky-live-metrics-col--chart' }, [
			E('div', { 'class': 'blocky-dash-panel-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Queries over time') ]),
					E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
						_('Estimated rates from Prometheus counter deltas while this page stays open.')
					])
				]),
				E('div', { 'class': 'blocky-time-range' }, rangeButtons)
			]),
			metricsBannerHost,
			E('div', { 'class': 'blocky-chart-svg-wrap' }, [ svg ]),
			E('div', { 'class': 'blocky-chart-legend' }, [
				E('span', {}, [ blockyLegendDot('total'), _('Total') ]),
				' ',
				E('span', {}, [ blockyLegendDot('blocked'), _('Blocked') ]),
				' ',
				E('span', {}, [ blockyLegendDot('cached'), _('Cached') ])
			]),
			E('p', { 'class': 'blocky-note-soft', 'style': 'margin-bottom:0;margin-top:.65em' }, [
				_('Long windows need more samples — keep the dashboard open. Past sessions are not stored.')
			])
		]),
		E('div', { 'class': 'blocky-dash-panel blocky-live-metrics-col' }, [
			E('div', { 'class': 'blocky-dash-panel-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Activity snapshot') ]),
					E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
						_('Bar chart: summed deltas in the visible window.')
					])
				])
			]),
			vBarHost
		]),
		E('div', { 'class': 'blocky-dash-panel blocky-live-metrics-col' }, [
			E('div', { 'class': 'blocky-dash-panel-head' }, [
				E('div', {}, [
					E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Latest interval') ]),
					E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
						_('Counter deltas since the last Prometheus poll.')
					])
				])
			]),
			mixHost
		]),
		E('p', { 'class': 'cbi-section-descr blocky-live-metrics-footnote' }, [
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
				return execBlockyListsSync().then(function() {
					return refreshBlockyLists();
				});
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

function renderApiSecuritySection(configYaml, uciAccess, embedded) {
	var httpEp = parseBlockyPortLine(configYaml, 'http', 4000);
	var localBind = isLoopbackHost(httpEp.host);

	var body = [
		E('p', { 'class': 'blocky-config-section-descr' }, [
			_('Blocky v0.32.x does not support API keys or built-in HTTP authentication. Keep ports.http bound to 127.0.0.1 so only processes on the router (LuCI, local scripts) can reach /api and /metrics.')
		]),
		E('div', { 'class': 'table blocky-status-table' }, [
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:33%' }, [ _('HTTP listener') ]),
				E('div', { 'class': 'td left' }, [
					blockyPill(localBind ? 'yes' : 'warn', localBind ? _('Localhost') : _('Exposed')),
					blockyStatusDetail(blockyHttpBaseUrl(configYaml))
				])
			])
		]),
		E('p', { 'class': 'blocky-note-soft' }, [
			_('Recommended config.yml: ports.http: 127.0.0.1:4000 and ports.dns: 127.0.0.1:5353. Do not expose the Blocky API on LAN without an external authenticating reverse proxy.')
		])
	];

	if (embedded)
		return configSectionPage(_('API access'), '', body);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('API access') ])
	].concat(body));
}

function renderRouterDnsIntegration(configYaml, dnsFwdRaw, embedded) {
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

	var body = [
		E('p', { 'class': 'blocky-config-section-descr' }, [
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
		E('p', { 'class': 'blocky-note-soft' }, [
			_('After changing the DNS port in YAML, click Save & restart Blocky, then toggle this again so dnsmasq matches. Block list refresh still uses the Controls tab “Refresh lists” API button.')
		])
	];

	if (embedded)
		return configSectionPage(_('Router DNS integration'), '', body);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Router DNS integration') ])
	].concat(body));
}

function extractYamlSection(yaml, sectionName) {
	var lines = safeString(yaml).split('\n');
	var out = [];
	var inSection = false;
	var re = new RegExp('^' + sectionName + ':\\s*$');

	lines.forEach(function(line) {
		if (re.test(line)) {
			inSection = true;
			out.push(line);
			return;
		}

		if (!inSection)
			return;

		if (/^[a-zA-Z0-9_]+:\s*$/.test(line) && !re.test(line))
			return;

		if (/^[^#\s]/.test(line) && !re.test(line))
			return;

		out.push(line);
	});

	return out.length ? out.join('\n') : '';
}

function parseYamlScalar(sectionYaml, key, fallback) {
	var m = safeString(sectionYaml).match(new RegExp('(?:^|\\n)\\s+' + key + ':\\s*(.+)$', 'm'));

	if (!m)
		return fallback;

	return m[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
}

function parseYamlBool(sectionYaml, key, fallback) {
	var value = parseYamlScalar(sectionYaml, key, null);

	if (value === null)
		return fallback;

	value = value.toLowerCase();

	return value === 'true' || value === '1' || value === 'yes';
}

function parseYamlListItems(sectionYaml) {
	var items = [];

	safeString(sectionYaml).split('\n').forEach(function(line) {
		var m = line.match(/^\s+-\s+(.+)$/);

		if (!m)
			return;

		items.push(m[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, ''));
	});

	return items;
}

function parseUpstreamGroupResolvers(sectionYaml) {
	var items = [];
	var inDefault = false;

	safeString(sectionYaml).split('\n').forEach(function(line) {
		if (/^\s+default:\s*$/.test(line)) {
			inDefault = true;
			return;
		}

		if (inDefault && /^\s+-\s+(.+)$/.test(line)) {
			items.push(line.match(/^\s+-\s+(.+)$/)[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, ''));
			return;
		}

		if (inDefault && /^\s+[A-Za-z0-9_*[\].-]+:\s*$/.test(line))
			inDefault = false;
	});

	return items;
}

function parseBlockySettings(yaml) {
	var upstreams = extractYamlSection(yaml, 'upstreams');
	var bootstrap = extractYamlSection(yaml, 'bootstrapDns');
	var blocking = extractYamlSection(yaml, 'blocking');
	var caching = extractYamlSection(yaml, 'caching');
	var hostsFile = extractYamlSection(yaml, 'hostsFile');
	var logSec = extractYamlSection(yaml, 'log');
	var queryLog = extractYamlSection(yaml, 'queryLog');
	var ports = extractYamlSection(yaml, 'ports');
	var rebinding = extractYamlSection(yaml, 'rebindingProtection');
	var prometheus = extractYamlSection(yaml, 'prometheus');
	var statistics = extractYamlSection(yaml, 'statistics');
	var dnsEp = parseBlockyPortLine(yaml, 'dns', 5353);
	var httpEp = parseBlockyPortLine(yaml, 'http', 4000);
	var bootstrapItems = parseYamlListItems(bootstrap);
	var bootstrapResolvers = [];
	var initMatch = upstreams.match(/init:\s*\n\s+strategy:\s*(\S+)/);
	var refreshMatch = blocking.match(/refreshPeriod:\s*(\S+)/);
	var downloadTimeoutMatch = blocking.match(/downloads:[\s\S]*?\n\s+timeout:\s*(\S+)/);
	var downloadAttemptsMatch = blocking.match(/downloads:[\s\S]*?\n\s+attempts:\s*(\S+)/);
	var loadingStrategyMatch = blocking.match(/loading:[\s\S]*?\n\s+strategy:\s*(\S+)/);
	var cachePathMatch = blocking.match(/cachePath:\s*(\S+)/);
	var writeTimeoutMatch = blocking.match(/writeTimeout:\s*(\S+)/);
	var readTimeoutMatch = blocking.match(/readTimeout:\s*(\S+)/);
	var cooldownMatch = blocking.match(/cooldown:\s*(\S+)/);
	var concurrencyMatch = blocking.match(/concurrency:\s*(\S+)/);

	bootstrapItems.forEach(function(item) {
		if (/^resolvFile:/i.test(item))
			return;

		bootstrapResolvers.push(item);
	});

	return {
		upstreamResolvers: parseUpstreamGroupResolvers(upstreams),
		upstreamInitStrategy: initMatch ? initMatch[1].replace(/['"]/g, '') : 'fast',
		upstreamTimeout: parseYamlScalar(upstreams, 'timeout', '5s'),
		bootstrapResolvers: bootstrapResolvers,
		bootstrapUseWan: bootstrapItems.some(function(item) {
			return /^resolvFile:/i.test(item);
		}),
		listRefreshPeriod: refreshMatch ? refreshMatch[1].replace(/['"]/g, '') : '4h',
		loadingStrategy: loadingStrategyMatch ? loadingStrategyMatch[1].replace(/['"]/g, '') : 'fast',
		listCachePath: cachePathMatch ? cachePathMatch[1].replace(/['"]/g, '') : '/var/lib/blocky/lists',
		listDownloadTimeout: downloadTimeoutMatch ? downloadTimeoutMatch[1].replace(/['"]/g, '') : '60s',
		listWriteTimeout: writeTimeoutMatch ? writeTimeoutMatch[1].replace(/['"]/g, '') : '60s',
		listReadTimeout: readTimeoutMatch ? readTimeoutMatch[1].replace(/['"]/g, '') : '60s',
		listDownloadAttempts: downloadAttemptsMatch ? downloadAttemptsMatch[1].replace(/['"]/g, '') : '5',
		listCooldown: cooldownMatch ? cooldownMatch[1].replace(/['"]/g, '') : '10s',
		listConcurrency: concurrencyMatch ? concurrencyMatch[1].replace(/['"]/g, '') : '4',
		cachingMinTime: parseYamlScalar(caching, 'minTime', '5m'),
		cachingMaxTime: parseYamlScalar(caching, 'maxTime', '30m'),
		cachingPrefetch: parseYamlBool(caching, 'prefetching', false),
		hostsSources: parseYamlListItems(hostsFile),
		logLevel: parseYamlScalar(logSec, 'level', 'warn'),
		logPrivacy: parseYamlBool(logSec, 'privacy', false),
		queryLogType: parseYamlScalar(queryLog, 'type', 'csv'),
		queryLogTarget: parseYamlScalar(queryLog, 'target', '/tmp/blocky-logs'),
		queryLogRetention: parseYamlScalar(queryLog, 'logRetentionDays', '7'),
		queryLogFlush: parseYamlScalar(queryLog, 'flushInterval', '30s'),
		portDns: dnsEp.host + ':' + String(dnsEp.port),
		portHttp: httpEp.host + ':' + String(httpEp.port),
		rebindingEnable: parseYamlBool(rebinding, 'enable', true),
		prometheusEnable: parseYamlBool(prometheus, 'enable', true),
		prometheusPath: parseYamlScalar(prometheus, 'path', '/metrics'),
		statisticsEnable: parseYamlBool(statistics, 'enable', true),
		blockingSection: blocking
	};
}

function yamlQuote(value) {
	var v = safeString(value).trim();

	if (!v)
		return '""';

	if (/[:#{}[\],&*?|>!%@`"]|\s/.test(v))
		return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

	return v;
}

function yamlListLines(items, indent) {
	var prefix = indent || '      ';

	return items.filter(function(item) {
		return safeString(item).trim();
	}).map(function(item) {
		return prefix + '- ' + yamlQuote(item.trim());
	}).join('\n');
}

function buildBlockySettingsYaml(fields, currentYaml) {
	var blocking = fields.blockingSection || extractYamlSection(currentYaml, 'blocking');
	var upstreamResolvers = fields.upstreamResolvers.split(/\n/).map(function(s) {
		return s.trim();
	}).filter(Boolean);
	var bootstrapResolvers = fields.bootstrapResolvers.split(/\n/).map(function(s) {
		return s.trim();
	}).filter(Boolean);
	var hostsSources = fields.hostsSources.split(/\n/).map(function(s) {
		return s.trim();
	}).filter(Boolean);
	var bootstrapLines = bootstrapResolvers.slice();

	if (fields.bootstrapUseWan)
		bootstrapLines.push('resolvFile: /tmp/resolv.conf.auto');

	if (!blocking.trim())
		blocking = extractYamlSection(currentYaml, 'blocking');

	return [
		'upstreams:',
		'  init:',
		'    strategy: ' + yamlQuote(fields.upstreamInitStrategy || 'fast'),
		'  timeout: ' + yamlQuote(fields.upstreamTimeout || '5s'),
		'  groups:',
		'    default:',
		yamlListLines(upstreamResolvers, '      '),
		'',
		'bootstrapDns:',
		bootstrapLines.length ? yamlListLines(bootstrapLines, '  ') : '  - tcp+udp:1.1.1.1',
		'',
		blocking.trim(),
		'',
		'caching:',
		'  minTime: ' + yamlQuote(fields.cachingMinTime || '5m'),
		'  maxTime: ' + yamlQuote(fields.cachingMaxTime || '30m'),
		'  prefetching: ' + (fields.cachingPrefetch ? 'true' : 'false'),
		'',
		'hostsFile:',
		'  sources:',
		hostsSources.length ? yamlListLines(hostsSources, '    ') : '    - /etc/hosts',
		'',
		'log:',
		'  level: ' + yamlQuote(fields.logLevel || 'warn'),
		'  privacy: ' + (fields.logPrivacy ? 'true' : 'false'),
		'',
		'queryLog:',
		'  type: ' + yamlQuote(fields.queryLogType || 'csv'),
		'  target: ' + yamlQuote(fields.queryLogTarget || '/tmp/blocky-logs'),
		'  logRetentionDays: ' + yamlQuote(fields.queryLogRetention || '7'),
		'  flushInterval: ' + yamlQuote(fields.queryLogFlush || '30s'),
		'',
		'ports:',
		'  dns: ' + yamlQuote(fields.portDns || '127.0.0.1:5353'),
		'  http: ' + yamlQuote(fields.portHttp || '127.0.0.1:4000'),
		'',
		'rebindingProtection:',
		'  enable: ' + (fields.rebindingEnable ? 'true' : 'false'),
		'',
		'prometheus:',
		'  enable: ' + (fields.prometheusEnable ? 'true' : 'false'),
		'  path: ' + yamlQuote(fields.prometheusPath || '/metrics'),
		'',
		'statistics:',
		'  enable: ' + (fields.statisticsEnable ? 'true' : 'false'),
		''
	].join('\n');
}

function patchBlockingLoadingSection(blockingYaml, fields) {
	var lines = safeString(blockingYaml).split('\n');
	var out = [];
	var inLoading = false;
	var inDownloads = false;
	var replaced = {};

	function patchLine(line, key, indent, value, flag) {
		if (replaced[flag])
			return null;

		if (!new RegExp('^' + indent + key + ':').test(line))
			return null;

		replaced[flag] = true;
		return indent + key + ': ' + yamlQuote(value);
	}

	lines.forEach(function(line) {
		if (/^\s+loading:\s*$/.test(line)) {
			inLoading = true;
			inDownloads = false;
			out.push(line);
			return;
		}

		if (inLoading && /^\s+downloads:\s*$/.test(line)) {
			inDownloads = true;
			out.push(line);
			return;
		}

		if (inLoading && !inDownloads) {
			var loadingStrategy = patchLine(line, 'strategy', '    ', fields.loadingStrategy || 'fast', 'loadingStrategy');
			if (loadingStrategy) {
				out.push(loadingStrategy);
				return;
			}

			var loadingConcurrency = patchLine(line, 'concurrency', '    ', fields.listConcurrency || '4', 'concurrency');
			if (loadingConcurrency) {
				out.push(loadingConcurrency);
				return;
			}
		}

		if (inLoading) {
			var refresh = patchLine(line, 'refreshPeriod', '    ', fields.listRefreshPeriod || '4h', 'refreshPeriod');
			if (refresh) {
				out.push(refresh);
				return;
			}
		}

		if (inDownloads) {
			if (/^\s{6}concurrency:/.test(line))
				return;

			var patched = patchLine(line, 'cachePath', '      ', fields.listCachePath || '/var/lib/blocky/lists', 'cachePath') ||
				patchLine(line, 'timeout', '      ', fields.listDownloadTimeout || '60s', 'timeout') ||
				patchLine(line, 'writeTimeout', '      ', fields.listWriteTimeout || '60s', 'writeTimeout') ||
				patchLine(line, 'readTimeout', '      ', fields.listReadTimeout || '60s', 'readTimeout') ||
				patchLine(line, 'attempts', '      ', fields.listDownloadAttempts || '5', 'attempts') ||
				patchLine(line, 'cooldown', '      ', fields.listCooldown || '10s', 'cooldown');

			if (patched) {
				out.push(patched);
				return;
			}
		}

		if (/^\s{2}[A-Za-z0-9_]+:/.test(line) && !/^\s+loading:/.test(line)) {
			inLoading = false;
			inDownloads = false;
		}

		out.push(line);
	});

	if (!replaced.concurrency) {
		var insertAt = -1;
		var i;

		for (i = 0; i < out.length; i++) {
			if (/^\s+refreshPeriod:/.test(out[i])) {
				insertAt = i + 1;
				break;
			}
		}

		if (insertAt < 0) {
			for (i = 0; i < out.length; i++) {
				if (/^\s+loading:\s*$/.test(out[i])) {
					insertAt = i + 1;
					break;
				}
			}
		}

		if (insertAt >= 0)
			out.splice(insertAt, 0, '    concurrency: ' + yamlQuote(fields.listConcurrency || '4'));
	}

	return out.join('\n');
}

function settingsRow(label, descr, control) {
	return E('div', { 'class': 'blocky-settings-row' }, [
		E('div', { 'class': 'blocky-settings-meta' }, [
			E('label', { 'class': 'blocky-settings-label' }, [ label ]),
			descr ? E('p', { 'class': 'blocky-settings-hint' }, [ descr ]) : ''
		]),
		E('div', { 'class': 'blocky-settings-control' }, [ control ])
	]);
}

function settingsPanel(title, descr, rows) {
	return E('div', { 'class': 'blocky-dash-panel blocky-settings-panel' }, [
		E('div', { 'class': 'blocky-dash-panel-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ title ]),
				descr ? E('p', { 'class': 'blocky-dash-panel-subtitle' }, [ descr ]) : ''
			])
		]),
		E('div', { 'class': 'blocky-settings-body' }, rows)
	]);
}

function configSectionPage(title, descr, rows) {
	var nodes = [
		E('h3', { 'class': 'blocky-config-section-title' }, [ title ])
	];

	if (descr)
		nodes.push(E('p', { 'class': 'blocky-config-section-descr' }, [ descr ]));

	nodes.push(E('div', { 'class': 'blocky-config-section-form' }, rows));

	return E('div', { 'class': 'blocky-config-section' }, nodes);
}

function renderBlockyConfigLayout(sections, toolbar, activeIndex) {
	var mainHost = E('div', { 'class': 'blocky-config-main' });
	var navItems = [];

	function activate(index) {
		if (!sections[index])
			return;

		navItems.forEach(function(item, pos) {
			item.classList.toggle('active', pos === index);
		});
		replaceContent(mainHost, sections[index].content);
	}

	var nav = E('nav', { 'class': 'blocky-config-nav', 'role': 'navigation' });

	sections.forEach(function(section, index) {
		var item = E('button', {
			'type': 'button',
			'class': 'blocky-config-nav-item' + (index === activeIndex ? ' active' : ''),
			'click': function(ev) {
				ev.preventDefault();
				activate(index);
			}
		}, [ section.title ]);

		navItems.push(item);
		nav.appendChild(item);
	});

	activate(activeIndex || 0);

	return E('div', { 'class': 'blocky-config-layout' }, [
		E('aside', { 'class': 'blocky-config-sidebar' }, [ nav ]),
		E('div', { 'class': 'blocky-config-content' }, [
			toolbar,
			mainHost
		])
	]);
}

function readBlockySettingsForm(state) {
	return {
		upstreamResolvers: state.upstreamResolvers.value,
		upstreamInitStrategy: state.upstreamInitStrategy.value,
		upstreamTimeout: state.upstreamTimeout.value,
		bootstrapResolvers: state.bootstrapResolvers.value,
		bootstrapUseWan: state.bootstrapUseWan.checked,
		listRefreshPeriod: state.listRefreshPeriod.value,
		loadingStrategy: state.loadingStrategy.value,
		listCachePath: state.listCachePath.value.trim(),
		listDownloadTimeout: state.listDownloadTimeout.value,
		listWriteTimeout: state.listWriteTimeout.value,
		listReadTimeout: state.listReadTimeout.value,
		listDownloadAttempts: state.listDownloadAttempts.value,
		listCooldown: state.listCooldown.value,
		listConcurrency: state.listConcurrency.value,
		cachingMinTime: state.cachingMinTime.value,
		cachingMaxTime: state.cachingMaxTime.value,
		cachingPrefetch: state.cachingPrefetch.checked,
		hostsSources: state.hostsSources.value,
		logLevel: state.logLevel.value,
		logPrivacy: state.logPrivacy.checked,
		queryLogType: 'csv',
		queryLogTarget: state.queryLogTarget.value,
		queryLogRetention: state.queryLogRetention.value,
		queryLogFlush: state.queryLogFlush.value,
		portDns: state.portDns.value.trim(),
		portHttp: state.portHttp.value.trim(),
		rebindingEnable: state.rebindingEnable.checked,
		prometheusEnable: state.prometheusEnable.checked,
		prometheusPath: state.prometheusPath.value.trim(),
		statisticsEnable: state.statisticsEnable.checked,
		blockingSection: state.blockingSection
	};
}

function saveBlockySettingsForm(state, currentYaml, restart) {
	var fields = readBlockySettingsForm(state);

	fields.blockingSection = patchBlockingLoadingSection(fields.blockingSection, fields);

	if (!/^127\.0\.0\.1:|^localhost:|^\[::1\]:/.test(fields.portDns) ||
	    !/^127\.0\.0\.1:|^localhost:|^\[::1\]:/.test(fields.portHttp))
		throw new Error(_('Keep DNS and HTTP listeners on localhost (127.0.0.1) on the router.'));

	var yaml = buildBlockySettingsYaml(fields, currentYaml);

	return fs.write(CONFIG_PATH, yaml).then(function() {
		return uci.load('blocky').then(function() {
			uci.set('blocky', 'main', 'refresh_period', fields.listRefreshPeriod || '4h');
			return uci.save();
		});
	}).then(function() {
		return execBlockyListsSync();
	}).then(function() {
		return runInit('restart');
	});
}

function renderBlockySettingsForm(configYaml, dnsFwdRaw, uciAccess, refreshPage) {
	var parsed = parseBlockySettings(configYaml);
	var state = {
		upstreamResolvers: E('textarea', {
			'class': 'cbi-input-textarea blocky-settings-textarea',
			'rows': 5
		}, [ parsed.upstreamResolvers.join('\n') ]),
		upstreamInitStrategy: E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'fast', 'selected': parsed.upstreamInitStrategy === 'fast' ? '' : null }, [ 'fast' ]),
			E('option', { 'value': 'blocking', 'selected': parsed.upstreamInitStrategy === 'blocking' ? '' : null }, [ 'blocking' ]),
			E('option', { 'value': 'failOnError', 'selected': parsed.upstreamInitStrategy === 'failOnError' ? '' : null }, [ 'failOnError' ])
		]),
		upstreamTimeout: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.upstreamTimeout,
			'placeholder': '5s'
		}),
		bootstrapResolvers: E('textarea', {
			'class': 'cbi-input-textarea blocky-settings-textarea',
			'rows': 3
		}, [ parsed.bootstrapResolvers.join('\n') ]),
		bootstrapUseWan: E('input', {
			'type': 'checkbox',
			'checked': parsed.bootstrapUseWan ? '' : null
		}),
		listRefreshPeriod: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listRefreshPeriod,
			'placeholder': '4h'
		}),
		listDownloadTimeout: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listDownloadTimeout,
			'placeholder': '60s'
		}),
		listDownloadAttempts: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listDownloadAttempts,
			'placeholder': '5'
		}),
		loadingStrategy: E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'fast', 'selected': parsed.loadingStrategy === 'fast' ? '' : null }, [ 'fast' ]),
			E('option', { 'value': 'blocking', 'selected': parsed.loadingStrategy === 'blocking' ? '' : null }, [ 'blocking' ]),
			E('option', { 'value': 'failOnError', 'selected': parsed.loadingStrategy === 'failOnError' ? '' : null }, [ 'failOnError' ])
		]),
		listCachePath: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listCachePath,
			'style': 'width:100%'
		}),
		listWriteTimeout: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listWriteTimeout,
			'placeholder': '60s'
		}),
		listReadTimeout: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listReadTimeout,
			'placeholder': '60s'
		}),
		listCooldown: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listCooldown,
			'placeholder': '10s'
		}),
		listConcurrency: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listConcurrency,
			'placeholder': '4'
		}),
		cachingMinTime: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.cachingMinTime,
			'placeholder': '5m'
		}),
		cachingMaxTime: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.cachingMaxTime,
			'placeholder': '30m'
		}),
		cachingPrefetch: E('input', {
			'type': 'checkbox',
			'checked': parsed.cachingPrefetch ? '' : null
		}),
		hostsSources: E('textarea', {
			'class': 'cbi-input-textarea blocky-settings-textarea',
			'rows': 3
		}, [ parsed.hostsSources.join('\n') ]),
		logLevel: E('select', { 'class': 'cbi-input-select' }, [
			'trace', 'debug', 'info', 'warn', 'error'
		].map(function(level) {
			return E('option', {
				'value': level,
				'selected': parsed.logLevel === level ? '' : null
			}, [ level ]);
		})),
		logPrivacy: E('input', {
			'type': 'checkbox',
			'checked': parsed.logPrivacy ? '' : null
		}),
		queryLogTarget: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.queryLogTarget,
			'style': 'width:100%'
		}),
		queryLogRetention: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.queryLogRetention,
			'placeholder': '7'
		}),
		queryLogFlush: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.queryLogFlush,
			'placeholder': '30s'
		}),
		portDns: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.portDns,
			'style': 'width:100%'
		}),
		portHttp: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.portHttp,
			'style': 'width:100%'
		}),
		rebindingEnable: E('input', {
			'type': 'checkbox',
			'checked': parsed.rebindingEnable ? '' : null
		}),
		prometheusEnable: E('input', {
			'type': 'checkbox',
			'checked': parsed.prometheusEnable ? '' : null
		}),
		prometheusPath: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.prometheusPath,
			'style': 'width:100%'
		}),
		statisticsEnable: E('input', {
			'type': 'checkbox',
			'checked': parsed.statisticsEnable ? '' : null
		}),
		blockingSection: parsed.blockingSection
	};

	function saveHandler() {
		return saveBlockySettingsForm(state, configYaml, true).then(function() {
			notify(_('Settings saved and Blocky restarted.'));
			if (typeof refreshPage === 'function')
				return refreshPage();
		}).catch(function(err) {
			notify(err.message || String(err), 'danger');
		});
	}

	var toolbar = E('div', { 'class': 'blocky-settings-toolbar' }, [
		E('button', {
			'class': 'cbi-button cbi-button-save',
			'click': ui.createHandlerFn(this, function(ev) {
				ev.preventDefault();
				return saveHandler();
			})
		}, [ _('Save settings') ]),
		' ',
		E('button', {
			'class': 'cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, function(ev) {
				ev.preventDefault();
				return saveHandler();
			})
		}, [ _('Save & restart Blocky') ])
	]);

	var sections = [
		{
			id: 'router',
			title: _('Router DNS'),
			content: renderRouterDnsIntegration(configYaml, dnsFwdRaw, true)
		},
		{
			id: 'upstream',
			title: _('Upstream DNS'),
			content: configSectionPage(
				_('Upstream DNS'),
				_('External resolvers Blocky uses after filtering. Supports plain IP, tcp-tls:, and https: DoH URLs.'),
				[
					settingsRow(
						_('Resolvers (default group)'),
						_('One entry per line.'),
						state.upstreamResolvers
					),
					settingsRow(_('Startup strategy'), _('fast = start quickly; blocking = wait for upstreams.'), state.upstreamInitStrategy),
					settingsRow(_('Query timeout'), '', state.upstreamTimeout)
				]
			)
		},
		{
			id: 'bootstrap',
			title: _('Bootstrap DNS'),
			content: configSectionPage(
				_('Bootstrap DNS'),
				_('Used to resolve upstream hostnames and denylist download URLs.'),
				[
					settingsRow(
						_('Bootstrap resolvers'),
						_('One entry per line (e.g. tcp+udp:1.1.1.1).'),
						state.bootstrapResolvers
					),
					settingsRow(
						_('Use WAN resolvers'),
						_('Also read /tmp/resolv.conf.auto (OpenWrt DHCP WAN DNS).'),
						state.bootstrapUseWan
					)
				]
			)
		},
		{
			id: 'downloads',
			title: _('List downloads'),
			content: configSectionPage(
				_('Block lists & downloads'),
				_('Denylist URLs are managed on the Block lists tab. These options control refresh timing.'),
				[
					E('p', { 'class': 'blocky-note-soft' }, [
						_('Edit denylist sources under '),
						E('strong', {}, [ _('Block lists') ]),
						_(' — saving here preserves your lists and re-syncs config.yml.')
					]),
					settingsRow(_('List refresh period'), _('How often Blocky re-downloads lists (e.g. 4h).'), state.listRefreshPeriod),
					settingsRow(_('List load strategy'), _('How Blocky waits for lists at startup.'), state.loadingStrategy),
					settingsRow(_('List cache directory'), _('On-disk cache for downloaded blocklists.'), state.listCachePath),
					settingsRow(_('Download timeout'), _('Per-URL download timeout.'), state.listDownloadTimeout),
					settingsRow(_('Write timeout'), _('Timeout writing list data to disk.'), state.listWriteTimeout),
					settingsRow(_('Read timeout'), _('Timeout reading list data from disk.'), state.listReadTimeout),
					settingsRow(_('Download attempts'), _('Retries when a list URL fails.'), state.listDownloadAttempts),
					settingsRow(_('Retry cooldown'), _('Pause between failed download retries.'), state.listCooldown),
					settingsRow(_('Download concurrency'), _('Parallel list downloads (1–8).'), state.listConcurrency)
				]
			)
		},
		{
			id: 'cache',
			title: _('DNS cache'),
			content: configSectionPage(
				_('DNS cache'),
				_('Response cache limits. Prefetching increases upstream traffic.'),
				[
					settingsRow(_('Minimum cache time'), '', state.cachingMinTime),
					settingsRow(_('Maximum cache time'), '', state.cachingMaxTime),
					settingsRow(_('Enable prefetching'), '', state.cachingPrefetch)
				]
			)
		},
		{
			id: 'hosts',
			title: _('Hosts sources'),
			content: configSectionPage(
				_('Hosts file sources'),
				_('Additional static hostname blocks (paths or URLs).'),
				[
					settingsRow(_('Sources'), _('/etc/hosts is included by default.'), state.hostsSources)
				]
			)
		},
		{
			id: 'logging',
			title: _('Logging'),
			content: configSectionPage(
				_('Logging'),
				_('Blocky service log level. DNS query logging is configured separately below.'),
				[
					settingsRow(_('Log level'), '', state.logLevel),
					settingsRow(_('Obfuscate log output'), _('Mask domains in Blocky logs.'), state.logPrivacy)
				]
			)
		},
		{
			id: 'querylog',
			title: _('Query log'),
			content: configSectionPage(
				_('Query log'),
				_('CSV query logs for the Logs tab.'),
				[
					settingsRow(_('Target directory'), '', state.queryLogTarget),
					settingsRow(_('Retention (days)'), '', state.queryLogRetention),
					settingsRow(_('Flush interval'), '', state.queryLogFlush)
				]
			)
		},
		{
			id: 'listeners',
			title: _('Listeners'),
			content: configSectionPage(
				_('Listeners'),
				_('Keep both listeners on 127.0.0.1 — dnsmasq forwards LAN DNS here.'),
				[
					settingsRow(_('DNS port'), _('Format: 127.0.0.1:5353'), state.portDns),
					settingsRow(_('HTTP port (API / metrics)'), _('Format: 127.0.0.1:4000'), state.portHttp)
				]
			)
		},
		{
			id: 'security',
			title: _('Security'),
			content: configSectionPage(
				_('Security & observability'),
				_('Rebinding protection, Prometheus metrics, and in-memory statistics.'),
				[
					settingsRow(_('DNS rebinding protection'), '', state.rebindingEnable),
					settingsRow(_('Prometheus metrics'), '', state.prometheusEnable),
					settingsRow(_('Metrics path'), '', state.prometheusPath),
					settingsRow(_('In-memory statistics (/api/stats)'), _('Powers the Dashboard 24h widgets.'), state.statisticsEnable)
				]
			)
		},
		{
			id: 'api',
			title: _('API access'),
			content: renderApiSecuritySection(configYaml, uciAccess, true)
		},
		{
			id: 'advanced',
			title: _('Advanced YAML'),
			content: renderConfigYamlAdvanced(configYaml, refreshPage, true)
		}
	];

	return E('div', { 'class': 'blocky-settings-page' }, [
		renderBlockyConfigLayout(sections, toolbar, 0)
	]);
}

function renderBlockySettingsPage(configYaml, dnsFwdRaw, uciAccess, refreshPage) {
	return E('div', { 'class': 'blocky-config-page' }, [
		E('p', { 'class': 'cbi-section-descr blocky-config-intro' }, [
			_('Choose a settings section on the left. Block list URLs stay under the Block lists tab.')
		]),
		renderBlockySettingsForm(configYaml, dnsFwdRaw, uciAccess, refreshPage)
	]);
}

function renderConfigYamlAdvanced(content, refreshPage, embedded) {
	var editor = E('textarea', {
		'class': 'cbi-input-textarea blocky-settings-yaml',
		'style': 'width:100%; min-height:22em; font-family:monospace'
	}, [ content || '' ]);

	var buttons = E('p', {}, [
		E('button', {
			'class': 'cbi-button cbi-button-save',
			'click': ui.createHandlerFn(this, function(ev) {
				ev.preventDefault();

				if (!editor.value.trim()) {
					notify(_('Configuration cannot be empty.'), 'danger');
					return;
				}

				return fs.write(CONFIG_PATH, editor.value).then(function() {
					return execBlockyListsSync();
				}).then(function() {
					notify(_('Configuration saved.'));
					if (typeof refreshPage === 'function')
						return refreshPage();
				}).catch(function(err) {
					notify(err.message || String(err), 'danger');
				});
			})
		}, [ _('Save YAML') ]),
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
					return execBlockyListsSync();
				}).then(function() {
					return runInit('restart');
				}).then(function() {
					notify(_('Configuration saved and Blocky restarted.'));
					if (typeof refreshPage === 'function')
						return refreshPage();
				}).catch(function(err) {
					notify(err.message || String(err), 'danger');
				});
			})
		}, [ _('Save YAML & restart') ])
	]);
	var body = [
		E('p', { 'class': 'blocky-config-section-descr' }, [
			_('Edit %s directly. Prefer the settings sections — the blocking: section is overwritten when block lists sync.').format(CONFIG_PATH)
		]),
		editor,
		buttons
	];

	if (embedded)
		return configSectionPage(_('Advanced YAML editor'), '', body);

	return E('details', { 'class': 'blocky-settings-advanced cbi-section' }, [
		E('summary', { 'class': 'blocky-settings-advanced-summary' }, [ _('Advanced YAML editor') ])
	].concat(body));
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
		L.resolveDefault(callServiceList('adblock'), {}),
		loadBlocklistCatalog()
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
			Promise.resolve(bootstrap[2]),
			Promise.resolve(bootstrap[5])
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
		renderDashboardStatsZone(statsResult, metricsPayload, status, service, refreshPage),
		renderAdBlockerPipeline(status, service, dnsFwdRaw, config, statsResult, adblockService),
		E('div', { 'class': 'blocky-dash-full blocky-live-metrics-section' }, [
			E('div', { 'class': 'blocky-dash-section-head' }, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Live metrics') ]),
				E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
					_('Prometheus counter deltas while this page stays open.')
				])
			]),
			renderRealtimeMetrics(metricsPayload)
		])
	);

	return {
		service: service,
		status: status,
		config: config,
		metricsPayload: metricsPayload,
		statsResult: statsResult
	};
}

function attachDashboardHostState(host, service, status, refreshPage) {
	host._blockyService = service;
	host._blockyStatus = status;
	host._blockyRefresh = refreshPage;
}

function registerStatsPoll(dashboardHost, refreshPage) {
	poll.add(function() {
		return Promise.all([
			fetchBlockyStats(),
			L.resolveDefault(fetchText(blockyMetricsUrl()), '')
		]).then(function(results) {
			var sr = results[0];
			var metricsPayload = unwrapFetchText(results[1]);
			var statsZone = dashboardHost.querySelector('.blocky-dash-stats-zone');
			var service = dashboardHost._blockyService;
			var status = dashboardHost._blockyStatus;

			if (!sr.ok || !sr.data)
				return;

			if (statsZone && typeof dashboardHost._blockyRefresh === 'function')
				statsZone.replaceWith(renderDashboardStatsZone(sr, metricsPayload, status, service, dashboardHost._blockyRefresh));
			else if (statsZone)
				statsZone.replaceWith(renderDashboardStatsZone(sr, metricsPayload, status, service, function() {}));
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
			var catalogData = data[8] || EMPTY_BLOCKLIST_CATALOG;
			var dnsFwdRaw = blockyCliStdout(execResultStdout(dnsFwd, '0\n'));
			var metricsPayload = unwrapFetchText(metrics);
			var dashboardHost = E('div', { 'class': 'blocky-dashboard' });
			var blocklistsHost = E('div', {});
			var configHost = E('div', {});
			var controlsHost = E('div', {});
			var logsHost = E('div', {});

			function refreshPage() {
				return self.load().then(function(fresh) {
					var mounted = mountDashboardContent(dashboardHost, fresh, refreshPage);
					attachDashboardHostState(dashboardHost, mounted.service, mounted.status, refreshPage);
					blocklistsHost.replaceChildren(renderBlocklistsTab(fresh[5], refreshPage, fresh[8]));
					configHost.replaceChildren(renderBlockySettingsPage(
						fresh[2],
						blockyCliStdout(execResultStdout(fresh[4], '0\n')),
						fresh[7] || { user: '', password: '', localOnly: true },
						refreshPage
					));
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

			var mounted = mountDashboardContent(dashboardHost, data, refreshPage);
			attachDashboardHostState(dashboardHost, mounted.service, mounted.status, refreshPage);
			blocklistsHost.appendChild(renderBlocklistsTab(statsResult, refreshPage, catalogData));
			configHost.appendChild(renderBlockySettingsPage(config, dnsFwdRaw, uciAccess, refreshPage));
			logsHost.appendChild(renderQueryLogsTab(config));

			controlsHost.appendChild(renderBlockingControls(status, refreshPage));
			controlsHost.appendChild(renderOperations(service, refreshPage));
			controlsHost.appendChild(renderServiceControls(service, refreshPage));

			if (!statsPollRegistered) {
				statsPollRegistered = true;
				registerStatsPoll(dashboardHost, refreshPage);
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
						nodes: [ configHost ]
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
