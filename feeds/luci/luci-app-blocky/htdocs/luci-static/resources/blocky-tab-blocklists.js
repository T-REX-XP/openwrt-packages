'use strict';
'require ui';
'require uci';
'require fs';
'require poll';
'require blocky-base as Blocky';

var safeString = Blocky.safeString,
	execResultStdout = Blocky.execResultStdout,
	blockyCliStdout = Blocky.blockyCliStdout,
	parseDnsForwardFlag = Blocky.parseDnsForwardFlag,
	parseBlockyPortLine = Blocky.parseBlockyPortLine,
	parseBlockyPortValue = Blocky.parseBlockyPortValue,
	isLoopbackHost = Blocky.isLoopbackHost,
	blockyHttpBaseUrl = Blocky.blockyHttpBaseUrl,
	unwrapFsRead = Blocky.unwrapFsRead,
	emptyBlocklistCatalog = Blocky.emptyBlocklistCatalog,
	normalizeBlocklistCatalog = Blocky.normalizeBlocklistCatalog,
	sanitizeBlocklistId = Blocky.sanitizeBlocklistId,
	parseBlockyDnsPort = Blocky.parseBlockyDnsPort,
	formatNumber = Blocky.formatNumber,
	formatPercent = Blocky.formatPercent,
	parseJson = Blocky.parseJson,
	sumMapValues = Blocky.sumMapValues,
	sumDenylistEntries = Blocky.sumDenylistEntries,
	parseQueryLogConfig = Blocky.parseQueryLogConfig,
	parseMetrics = Blocky.parseMetrics,
	mergeDenyCounts = Blocky.mergeDenyCounts,
	parseDenylistGroupCounts = Blocky.parseDenylistGroupCounts,
	metricValue = Blocky.metricValue,
	formatCompactNumber = Blocky.formatCompactNumber,
	deriveOverview = Blocky.deriveOverview,
	deriveCumulative = Blocky.deriveCumulative,
	filterSamplesByWindow = Blocky.filterSamplesByWindow,
	downsampleSamples = Blocky.downsampleSamples,
	bucketAggregateBars = Blocky.bucketAggregateBars,
	padChartTime2 = Blocky.padChartTime2,
	formatChartAxisTime = Blocky.formatChartAxisTime,
	samplesToXY = Blocky.samplesToXY,
	catmullRomPoint = Blocky.catmullRomPoint,
	densifyCatmullRom = Blocky.densifyCatmullRom,
	buildSmoothAreaPath = Blocky.buildSmoothAreaPath,
	buildSmoothLinePath = Blocky.buildSmoothLinePath,
	parseBlockyVersionFromMetrics = Blocky.parseBlockyVersionFromMetrics,
	formatDuration = Blocky.formatDuration,
	blockyPathFromUrl = Blocky.blockyPathFromUrl,
	CONFIG_PATH = Blocky.CONFIG_PATH,
	blockyApiAccess = Blocky.blockyApiAccess,
	RECORD_TYPES = Blocky.RECORD_TYPES,
	PAUSE_PRESETS = Blocky.PAUSE_PRESETS,
	EMPTY_BLOCKLIST_CATALOG = Blocky.EMPTY_BLOCKLIST_CATALOG,
	BLOCKLIST_CATALOG_PATH = Blocky.BLOCKLIST_CATALOG_PATH,
	REALTIME_WINDOWS = Blocky.REALTIME_WINDOWS,
	BLOCKY_CHART_FALLBACK = Blocky.BLOCKY_CHART_FALLBACK,
	callBlockySyncLists = Blocky.callBlockySyncLists,
	callBlockyRefreshLists = Blocky.callBlockyRefreshLists,
	callBlockyHttpRequest = Blocky.callBlockyHttpRequest,
	callBlockyReadQueryLog = Blocky.callBlockyReadQueryLog,
	callBlockyGetVersion = Blocky.callBlockyGetVersion,
	callServiceList = Blocky.callServiceList,
	notify = Blocky.notify,
	actionButton = Blocky.actionButton,
	replaceContent = Blocky.replaceContent,
	applyBlockyApiAccess = Blocky.applyBlockyApiAccess,
	applyBlocklistChanges = Blocky.applyBlocklistChanges,
	refreshBlockyLists = Blocky.refreshBlockyLists,
	execBlockyListsSync = Blocky.execBlockyListsSync,
	execBlockyListsRefresh = Blocky.execBlockyListsRefresh,
	loadBlocklistCatalog = Blocky.loadBlocklistCatalog,
	loadUciBlocklists = Blocky.loadUciBlocklists,
	blockyCloseModal = Blocky.blockyCloseModal,
	blockyOpenModal = Blocky.blockyOpenModal,
	blockyModalFooterCancel = Blocky.blockyModalFooterCancel,
	blockyModalFooterSave = Blocky.blockyModalFooterSave,
	blockyPresetHomeUrl = Blocky.blockyPresetHomeUrl,
	blockyRpcOk = Blocky.blockyRpcOk,
	blockyRpcError = Blocky.blockyRpcError,
	blockyApi = Blocky.blockyApi,
	blockyHttpRequest = Blocky.blockyHttpRequest,
	fetchText = Blocky.fetchText,
	fetchJson = Blocky.fetchJson,
	blockyMetricsUrl = Blocky.blockyMetricsUrl,
	fetchBlockyStats = Blocky.fetchBlockyStats,
	runInit = Blocky.runInit,
	execDnsmasqSync = Blocky.execDnsmasqSync,
	shellQuote = Blocky.shellQuote,
	blockyPill = Blocky.blockyPill,
	blockyStatusDetail = Blocky.blockyStatusDetail,
	blockyLegendDot = Blocky.blockyLegendDot,
	blockyChartColor = Blocky.blockyChartColor,
	blockyChartFill = Blocky.blockyChartFill,
	blockyCssVar = Blocky.blockyCssVar,
	blockyThemeRoot = Blocky.blockyThemeRoot,
	applyBlockyChartPathTheme = Blocky.applyBlockyChartPathTheme,
	blockyAttachThemeSync = Blocky.blockyAttachThemeSync,
	registerBlockingCountdownPoll = Blocky.registerBlockingCountdownPoll,
	topListBarRow = Blocky.topListBarRow,
	mapToBarRows = Blocky.mapToBarRows,
	resolveDenyCount = Blocky.resolveDenyCount,
	bc = Blocky.bc,
	bp = Blocky.bp;

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

function renderBlocklistsTab(statsResult, refreshPage, catalogData, metricsText) {
	catalogData = catalogData || EMPTY_BLOCKLIST_CATALOG;
	metricsText = safeString(metricsText);
	var tableHost = E('div', { 'class': 'table blocky-blocklists-table' });

	function denyCountsMap() {
		var stats = statsResult && statsResult.ok ? statsResult.data : null;
		var fromStats = stats && stats.lists && stats.lists.denylist ? stats.lists.denylist : {};
		var fromMetrics = parseDenylistGroupCounts(metricsText);

		return mergeDenyCounts(fromStats, fromMetrics);
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

return {
	addBlocklistsFromPresets: addBlocklistsFromPresets,
	saveCustomBlocklist: saveCustomBlocklist,
	openCustomBlocklistModal: openCustomBlocklistModal,
	openCatalogModal: openCatalogModal,
	openNewBlocklistModal: openNewBlocklistModal,
	loadUciBlocklists: loadUciBlocklists,
	renderBlocklistsTab: renderBlocklistsTab
};
