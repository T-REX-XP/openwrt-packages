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
	unwrapFetchText = Blocky.unwrapFetchText,
	fetchJson = Blocky.fetchJson,
	blockyMetricsUrl = Blocky.blockyMetricsUrl,
	fetchBlockyStats = Blocky.fetchBlockyStats,
	runInit = Blocky.runInit,
	isRunning = Blocky.isRunning,
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
	var summaryBreakdown = stats && stats.summary ? bp.normalizeStatsSummary(stats.summary) : null;
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
		summaryBreakdown: summaryBreakdown,
		statsWindow: stats && stats.start && stats.end
			? stats.start + ' — ' + stats.end
			: '',
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
				stats ? _('Last 24 hours') : _('Since Blocky started'),
				overview.avgMs !== null
					? (' · ' + _('avg %s ms').format(formatNumber(overview.avgMs)))
					: ''
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
			E('span', {}, [ BlockyTabs.dashboard.blockyLegendDot('total'), _('Total') ]),
			' ',
			E('span', {}, [ BlockyTabs.dashboard.blockyLegendDot('blocked'), _('Blocked') ])
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

function renderStatsOutcomePanel(stats) {
	var summary = bp.normalizeStatsSummary(stats && stats.summary);
	var rows = [
		[ _('Cached responses'), formatNumber(summary.cached) ],
		[ _('Forwarded to upstream'), formatNumber(summary.forwarded) ],
		[ _('Blocked (denylist / rebind)'), formatNumber(summary.blocked) ],
		[ _('Filtered (query type / NOTFQDN)'), formatNumber(summary.filtered) ],
		[ _('Local / authoritative'), formatNumber(summary.local) ],
		[ _('Dropped'), formatNumber(summary.dropped) ],
		[ _('Resolver / DNSSEC errors'), formatNumber(summary.errors) ]
	];
	var windowNote = stats && stats.start && stats.end
		? _('UTC window: %s → %s').format(stats.start, stats.end)
		: _('Rolling 24-hour window (Blocky 0.34+ curated summary categories).');

	return E('div', { 'class': 'blocky-dash-panel blocky-stats-outcome-panel' }, [
		E('div', { 'class': 'blocky-dash-panel-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ _('Query outcome breakdown') ]),
				E('p', { 'class': 'blocky-dash-panel-subtitle' }, [ windowNote ])
			])
		]),
		E('div', { 'class': 'blocky-stat-table' }, rows.map(function(row) {
			return renderStatRow(row[0], row[1]);
		}))
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
		renderStatsOutcomePanel(stats),
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

function renderStatisticsTab(data, refreshPage) {
	var service = data[0];
	var status = data[1];
	var metricsPayload = unwrapFetchText(data[3]);
	var statsResult = data[5];

	return E('div', { 'class': 'blocky-statistics-tab' }, [
		E('p', { 'class': 'cbi-section-descr' }, [
			_('24-hour in-memory statistics from Blocky /api/stats. For live Prometheus counter deltas, see the Dashboard tab.')
		]),
		renderStatusDashboard(status, service, refreshPage),
		renderStatsDashboard(statsResult, refreshPage)
	]);
}

return baseclass.extend({
	gatherOverviewMetrics: gatherOverviewMetrics,
	renderDashboardSummaryGrid: renderDashboardSummaryGrid,
	renderStatRow: renderStatRow,
	renderGeneralStatisticsPanel: renderGeneralStatisticsPanel,
	renderClientTableRows: renderClientTableRows,
	renderTopClientsPanel: renderTopClientsPanel,
	renderTopDomainColumn: renderTopDomainColumn,
	renderTopDomainsStack: renderTopDomainsStack,
	renderOverview: renderOverview,
	renderStatsHourlyChart: renderStatsHourlyChart,
	renderStatsTopLists: renderStatsTopLists,
	renderMapBreakdown: renderMapBreakdown,
	renderStatsBreakdown: renderStatsBreakdown,
	renderStatsOutcomePanel: renderStatsOutcomePanel,
	renderListInventory: renderListInventory,
	renderCacheWidget: renderCacheWidget,
	renderStatsDashboard: renderStatsDashboard,
	renderStatusDashboard: renderStatusDashboard,
	renderStatisticsTab: renderStatisticsTab
});
