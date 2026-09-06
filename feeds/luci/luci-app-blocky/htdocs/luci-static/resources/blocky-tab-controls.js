'use strict';
'require ui';
'require uci';
'require fs';
'require poll';
'require blocky-base as Blocky';
'require baseclass';

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

function renderBlockingGlance(status, onRefresh) {
	var refresh = onRefresh || function() {};
	var pauseNoteHost = E('p', { 'class': 'blocky-note-soft' });
	var pause = E('select', { 'class': 'cbi-input-select' },
		PAUSE_PRESETS.map(function(preset) {
			return E('option', { 'value': preset[0] }, [ preset[1] ]);
		}));

	function paintPauseNote(next) {
		if (next && next.autoEnableInSec > 0) {
			replaceContent(pauseNoteHost, E('span', {}, [
				blockyPill('warn', _('Paused')),
				' ',
				blockyStatusDetail(_('auto-enables in %s').format(formatDuration(next.autoEnableInSec)))
			]));
			registerBlockingCountdownPoll(paintPauseNote, true, 'dashboard');
		}
		else {
			while (pauseNoteHost.firstChild)
				pauseNoteHost.removeChild(pauseNoteHost.firstChild);
			registerBlockingCountdownPoll(paintPauseNote, false, 'dashboard');
		}
	}

	paintPauseNote(status);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Blocking') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Turn filtering on or off without stopping Blocky.')
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
			E('label', {}, [ _('Duration'), ' ', pause ]),
			' ',
			actionButton(_('Pause'), function() {
				return blockyApi('/blocking/disable?duration=' + encodeURIComponent(pause.value));
			}, 'cbi-button-action', refresh)
		])
	]);
}

function renderBlockingControls(status, onRefresh) {
	return renderBlockingGlance(status, onRefresh);
}

function renderOperations(service, onRefresh) {
	var refresh = onRefresh || function() {};

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Operations') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Refresh denylists in Blocky or flush the DNS cache.')
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
			}, 'cbi-button-action', refresh)
		])
	]);
}

return baseclass.extend({
	renderBlockingGlance: renderBlockingGlance,
	renderBlockingControls: renderBlockingControls,
	renderOperations: renderOperations
});
