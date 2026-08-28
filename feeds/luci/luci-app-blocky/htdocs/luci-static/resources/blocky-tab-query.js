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

function runDnsQuery(queryInput, typeSelect, resultHost) {
	if (!queryInput.value.trim()) {
		notify(_('Enter a domain name first.'), 'warning');
		return Promise.resolve();
	}

	return blockyApi('/query', 'POST', JSON.stringify({
		query: queryInput.value.trim(),
		type: typeSelect.value
	})).then(function(res) {
		replaceContent(resultHost, renderQueryResult(res));
	}).catch(function(err) {
		replaceContent(resultHost, E('p', { 'class': 'alert-message warning' }, [
			err.message || String(err)
		]));
	});
}

function mountQueryPanel(host, options) {
	options = options || {};
	var query = E('input', {
		'type': 'text',
		'class': 'cbi-input-text blocky-query-input',
		'placeholder': 'example.org',
		'pattern': '^[A-Za-z0-9_.:-]+$',
		'style': 'min-width:22em'
	});
	var type = E('select', { 'class': 'cbi-input-select blocky-query-type' },
		RECORD_TYPES.map(function(recordType) {
			return E('option', { 'value': recordType }, [ recordType ]);
		}));
	var result = E('div', { 'class': 'blocky-query-result' }, [
		E('em', {}, [ _('No query executed yet.') ])
	]);

	function setQuery(domain, recordType) {
		query.value = safeString(domain).trim().replace(/\.$/, '');

		if (recordType && RECORD_TYPES.indexOf(recordType) >= 0)
			type.value = recordType;
	}

	function prefillAndRun(domain, recordType) {
		setQuery(domain, recordType);

		if (query.value.trim())
			return runDnsQuery(query, type, result);

		return Promise.resolve();
	}

	host.appendChild(E('div', { 'class': 'cbi-section blocky-query-panel' }, [
		E('h3', {}, [ _('DNS query test') ]),
		E('p', { 'class': 'blocky-query-toolbar' }, [
			query, ' ', type, ' ',
			E('button', {
				'class': 'cbi-button cbi-button-action',
				'click': ui.createHandlerFn(null, function(ev) {
					ev.preventDefault();
					return runDnsQuery(query, type, result);
				})
			}, [ _('Query') ])
		]),
		result
	]));

	if (options.prefill)
		setQuery(options.prefill.domain, options.prefill.type);

	return {
		setQuery: setQuery,
		prefillAndRun: prefillAndRun,
		runQuery: function() {
			return runDnsQuery(query, type, result);
		}
	};
}

function renderQuery(options) {
	var host = E('div', {});

	mountQueryPanel(host, options || {});
	return host.firstChild;
}

function createQueryPanel(options) {
	var host = E('div', {});
	var controller = mountQueryPanel(host, options || {});

	return {
		node: host.firstChild,
		setQuery: controller.setQuery,
		prefillAndRun: controller.prefillAndRun,
		runQuery: controller.runQuery
	};
}

return {
	renderQueryResult: renderQueryResult,
	mountQueryPanel: mountQueryPanel,
	renderQuery: renderQuery,
	createQueryPanel: createQueryPanel
};
