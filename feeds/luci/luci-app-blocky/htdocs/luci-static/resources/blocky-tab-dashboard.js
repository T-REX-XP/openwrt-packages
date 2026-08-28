'use strict';
'require ui';
'require uci';
'require fs';
'require poll';
'require blocky-base as Blocky';
'require blocky-tab-stats as tabStats';
'require blocky-tab-controls as tabControls';
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
	unwrapFetchText = Blocky.unwrapFetchText,
	fetchJson = Blocky.fetchJson,
	blockyMetricsUrl = Blocky.blockyMetricsUrl,
	fetchBlockyStats = Blocky.fetchBlockyStats,
	runInit = Blocky.runInit,
	isRunning = Blocky.isRunning,
	isNamedServiceRunning = Blocky.isNamedServiceRunning,
	setBlockyMetricsPollingHook = Blocky.setBlockyMetricsPollingHook,
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
			detail: running ? _('Listening on UDP/TCP port %d').format(port) : _('Start Blocky from the Dashboard controls below or reboot.')
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

function renderDashboardStatsZone(statsResult, metricsPayload, status, service, refreshPage) {
	var overview = tabStats.gatherOverviewMetrics(statsResult, metricsPayload);
	var stats = statsResult && statsResult.ok ? statsResult.data : null;
	var nodes = [
		tabStats.renderDashboardSummaryGrid(overview, statsResult),
		E('div', { 'class': 'blocky-dash-grid' }, [
			tabStats.renderGeneralStatisticsPanel(overview, statsResult, status, service, refreshPage),
			tabStats.renderTopClientsPanel(statsResult, 10)
		])
	];

	if (stats)
		nodes.push(tabStats.renderStatsDashboard(statsResult, refreshPage));
	else
		nodes.push(E('div', { 'class': 'alert-message warning' }, [
			statsResult && statsResult.disabled
				? _('Statistics API is disabled. Add statistics.enable: true to /etc/blocky/config.yml and restart Blocky.')
				: _('Statistics are not available yet. Ensure Blocky is running and statistics are enabled.')
		]));

	return E('div', { 'class': 'blocky-dash-stats-zone' }, nodes);
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
		]),
		E('div', { 'class': 'blocky-dash-full blocky-dash-controls-section' }, [
			E('div', { 'class': 'blocky-dash-section-head' }, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Controls') ]),
				E('p', { 'class': 'blocky-dash-panel-subtitle' }, [
					_('Blocking, list maintenance, cache flush, and OpenWrt service actions.')
				])
			]),
			E('div', { 'class': 'blocky-dash-controls-grid' }, [
				tabControls.renderBlockingControls(status, refreshPage),
				tabControls.renderOperations(service, refreshPage),
				tabControls.renderServiceControls(service, refreshPage)
			])
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

return baseclass.extend({
	blockyThemeRoot: blockyThemeRoot,
	blockyCssVar: blockyCssVar,
	blockyChartColor: blockyChartColor,
	blockyChartFill: blockyChartFill,
	blockyLegendDot: blockyLegendDot,
	applyBlockyChartPathTheme: applyBlockyChartPathTheme,
	blockyAttachThemeSync: blockyAttachThemeSync,
	blockyInjectStyles: blockyInjectStyles,
	renderAdBlockerPipeline: renderAdBlockerPipeline,
	buildQueriesChartUnderlay: buildQueriesChartUnderlay,
	buildQueriesChartAxisLabels: buildQueriesChartAxisLabels,
	renderDashboardStatsZone: renderDashboardStatsZone,
	renderRealtimeMetrics: renderRealtimeMetrics,
	mountDashboardContent: mountDashboardContent,
	attachDashboardHostState: attachDashboardHostState,
	registerStatsPoll: registerStatsPoll
});
