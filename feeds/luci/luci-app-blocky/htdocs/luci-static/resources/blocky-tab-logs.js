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

function renderQueryLogsTab(config) {
	var ql = parseQueryLogConfig(config);
	var tableHost = E('div', {});
	var pageInfoHost = E('span', { 'class': 'blocky-note-soft' });
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
	var filterResponse = E('select', { 'class': 'cbi-input-select' }, [
		E('option', { 'value': '' }, [ _('Any response') ])
	]);
	var pageState = { page: 0, pageSize: 50, rows: [], logPath: '' };



	function filteredRows() {
		var domainNeedle = filterDomain.value.trim().toLowerCase();
		var clientNeedle = filterClient.value.trim().toLowerCase();
		var responseNeedle = filterResponse.value.trim().toLowerCase();

		return pageState.rows.filter(function(row) {
			if (domainNeedle && row.question.toLowerCase().indexOf(domainNeedle) === -1)
				return false;

			if (clientNeedle && row.client.toLowerCase().indexOf(clientNeedle) === -1)
				return false;

			if (responseNeedle) {
				var responseText = safeString(row.response || row.reason).toLowerCase();

				if (responseText.indexOf(responseNeedle) === -1)
					return false;
			}

			return true;
		});
	}

	function updateResponseFilterOptions() {
		var seen = {};
		var options = [ E('option', { 'value': '' }, [ _('Any response') ]) ];
		var i;
		var row;
		var response;

		for (i = 0; i < pageState.rows.length; i++) {
			row = pageState.rows[i];
			response = safeString(row.response || row.reason).trim();

			if (!response || seen[response])
				continue;

			seen[response] = 1;
			options.push(E('option', { 'value': response }, [ response ]));
		}

		replaceContent(filterResponse, options);
	}

	function updatePageInfo() {
		var filtered = filteredRows();
		var totalPages = Math.max(1, Math.ceil(filtered.length / pageState.pageSize));
		var currentPage = Math.min(pageState.page + 1, totalPages);

		replaceContent(pageInfoHost, filtered.length
			? _('Page %d of %d (%d rows, %d per page)').format(
				currentPage,
				totalPages,
				filtered.length,
				pageState.pageSize
			)
			: _('No rows match the current filters.'));
	}

	function renderTable() {
		var filtered = filteredRows();
		var start = pageState.page * pageState.pageSize;
		var slice = filtered.slice(start, start + pageState.pageSize);
		var maxPage = Math.max(0, Math.ceil(filtered.length / pageState.pageSize) - 1);

		if (pageState.page > maxPage)
			pageState.page = maxPage;

		updatePageInfo();

		if (!pageState.rows.length) {
			replaceContent(tableHost, E('em', {}, [ _('No log lines loaded.') ]));
			return;
		}

		if (!slice.length) {
			replaceContent(tableHost, E('em', {}, [ _('No rows match the current filters.') ]));
			return;
		}

		replaceContent(tableHost, E('div', { 'class': 'table blocky-query-log-table' }, [
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

		if (ql.target !== '/tmp/blocky-logs') {
			replaceContent(tableHost, E('div', { 'class': 'alert-message warning' }, [
				_('LuCI can only read CSV logs from /tmp/blocky-logs for security. Update queryLog.target in config.yml or browse logs on the host directly.')
			]));
			return Promise.resolve();
		}

		return callBlockyReadQueryLog(ql.target, 524288).then(function(res) {
			if (!res || !res.ok)
				throw new Error((res && res.error) || _('Failed to read query log'));

			pageState.logPath = res.path || '';
			pageState.rows = bp.parseCsvRows(res.content || '');
			pageState.page = 0;
			updateResponseFilterOptions();
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

	return E('div', { 'class': 'cbi-section blocky-query-logs' }, [
		E('h3', {}, [ _('Query Logs') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Read-only viewer for Blocky tab-separated query logs (%s). Shows the newest daily .log file (tail capped at 512 KiB).').format(ql.type)
		]),
		E('div', { 'class': 'alert-message blocky-query-log-tmpfs-note' }, [
			E('strong', {}, [ _('tmpfs / RAM note:') ]),
			' ',
			_('Default path /tmp/blocky-logs lives in tmpfs on most routers. Logs are lost on reboot and compete with RAM for space. Use a short retention period or disable query logging on memory-constrained devices.')
		]),
		E('div', { 'class': 'blocky-query-log-toolbar' }, [
			filterDomain, ' ',
			filterClient, ' ',
			filterResponse, ' ',
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
		E('div', { 'class': 'blocky-query-log-pagination' }, [
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
			pageInfoHost,
			' ',
			E('button', {
				'class': 'cbi-button',
				'click': ui.createHandlerFn(this, function(ev) {
					ev.preventDefault();
					var maxPage = Math.max(0, Math.ceil(filteredRows().length / pageState.pageSize) - 1);

					if (pageState.page < maxPage) {
						pageState.page++;
						renderTable();
					}
				})
			}, [ _('Next') ])
		])
	]);
}

return {
	renderQueryLogsTab: renderQueryLogsTab
};
