'use strict';
'require view';
'require fs';
'require rpc';
'require ui';
'require poll';

var CONFIG_PATH = '/etc/blocky/config.yml';
var API_BASE = 'http://127.0.0.1:4000/api';
var METRICS_URL = 'http://127.0.0.1:4000/metrics';
var RECORD_TYPES = [ 'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR' ];
var PAUSE_PRESETS = [
	[ '5m', _('5 minutes') ],
	[ '15m', _('15 minutes') ],
	[ '30m', _('30 minutes') ],
	[ '0', _('Until manually enabled') ]
];

var BLOCKY_UI_CSS = [
	'.luci-app-blocky{font-size:inherit;}',
	'.blocky-pill{display:inline-block;font-weight:700;font-size:.82em;line-height:1.25;',
	'text-transform:uppercase;letter-spacing:.04em;padding:.2em .65em;border-radius:4px;',
	'color:#fff;vertical-align:middle;}',
	'.blocky-pill-yes{background:#2e7d32;}',
	'.blocky-pill-no{background:#c62828;}',
	'.blocky-pill-warn{background:#ef6c00;}',
	'.blocky-pill-muted{background:#616161;}',
	'.blocky-pill-note{font-weight:500;text-transform:none;letter-spacing:normal;',
	'color:var(--text-primary-high, #333);margin-left:.5em;font-size:.95em;}',
	'body[data-darkmode="1"] .blocky-pill-note{color:var(--text-primary-high, #e0e0e0);}',
	'.blocky-metric-card{background:#e8e8e8;border-radius:10px;box-sizing:border-box;padding:1em;min-width:10em;}',
	'body[data-darkmode="1"] .blocky-metric-card{background:rgba(255,255,255,.08);}',
	'.blocky-status-table .tr{vertical-align:middle;}',
	'.blocky-metric-grid{display:flex;flex-wrap:wrap;gap:.75em;margin:.5em 0 1em;}',
	'.blocky-metric-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.5em;margin-bottom:.35em;}',
	'.blocky-metric-val{font-size:1.85em;font-weight:700;line-height:1.15;margin:.15em 0 .35em;}',
	'.blocky-cache-track{height:6px;border-radius:3px;background:rgba(0,0,0,.12);overflow:hidden;margin-top:.35em;}',
	'body[data-darkmode="1"] .blocky-cache-track{background:rgba(255,255,255,.15);}',
	'.blocky-cache-fill{height:100%;background:#43a047;border-radius:3px;transition:width .35s ease;}',
	'.blocky-dash-row{display:flex;flex-wrap:wrap;gap:.75em;margin:.75em 0 1em;}',
	'.blocky-dash-card{background:#e8e8e8;border-radius:10px;padding:1em;flex:1 1 18em;box-sizing:border-box;}',
	'body[data-darkmode="1"] .blocky-dash-card{background:rgba(255,255,255,.08);}',
	'.blocky-dash-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5em;}',
	'.blocky-btn-grid{display:flex;flex-wrap:wrap;gap:.5em;margin-top:.65em;}',
	'.blocky-time-range{display:flex;flex-wrap:wrap;gap:.35em;justify-content:flex-end;margin:.35em 0;}',
	'.blocky-time-range button.cbi-button{padding:.25em .65em;font-size:.9em;}',
	'.blocky-time-range button.blocky-range-active{background:#fff;color:#111;border-color:#ccc;}',
	'body[data-darkmode="1"] .blocky-time-range button.blocky-range-active{background:#37474f;color:#eceff1;border-color:#546e7a;}',
	'.blocky-chart-card{margin:.75em 0 1em;padding:1em;border-radius:10px;background:#e8e8e8;}',
	'body[data-darkmode="1"] .blocky-chart-card{background:rgba(255,255,255,.06);}',
	'.blocky-chart-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:1em;margin-top:.5em;font-size:.9em;}',
	'.blocky-legend-dot{display:inline-block;width:.65em;height:.65em;border-radius:50%;margin-right:.35em;vertical-align:middle;}',
	'.blocky-bar-chart{margin:.75em 0;padding:.5em 0;}',
	'.blocky-bar-row{display:flex;align-items:center;gap:.65em;margin:.45em 0;font-size:.92em;}',
	'.blocky-bar-label{flex:0 0 7em;}',
	'.blocky-bar-track{flex:1;height:1.1em;border-radius:4px;background:rgba(0,0,0,.1);overflow:hidden;display:flex;}',
	'body[data-darkmode="1"] .blocky-bar-track{background:rgba(255,255,255,.12);}',
	'.blocky-bar-seg{height:100%;}',
	'.blocky-bar-val{flex:0 0 3em;text-align:right;font-variant-numeric:tabular-nums;}',
	'.blocky-vbar-row{display:flex;align-items:flex-end;justify-content:space-between;height:120px;margin-top:.5em;',
	'padding:0 .25em;border-bottom:1px solid rgba(0,0,0,.15);}',
	'body[data-darkmode="1"] .blocky-vbar-row{border-bottom-color:rgba(255,255,255,.15);}',
	'.blocky-vbar-grp{display:flex;flex-direction:row;align-items:flex-end;justify-content:center;',
	'gap:2px;flex:1;max-width:48px;margin:0 .15em;}',
	'.blocky-vbar{flex:1;min-width:4px;border-radius:2px 2px 0 0;}',
	'.blocky-note-soft{opacity:.85;font-size:.92em;margin:.35em 0 .75em;}'
].join('');

function blockyInjectStyles() {
	return E('style', { 'type': 'text/css' }, [ BLOCKY_UI_CSS ]);
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

function actionButton(label, fn, style) {
	return E('button', {
		'class': 'cbi-button ' + (style || 'cbi-button-action'),
		'click': ui.createHandlerFn(this, function(ev) {
			ev.preventDefault();

			return Promise.resolve().then(fn).then(function() {
				notify(_('Action completed.'));
				return location.reload();
			}).catch(function(err) {
				notify(err.message || String(err), 'danger');
			});
		})
	}, [ label ]);
}

function replaceContent(node, content) {
	while (node.firstChild)
		node.removeChild(node.firstChild);

	node.appendChild(content);
}

function safeString(value) {
	if (value === null || value === undefined)
		return '';

	return String(value);
}

function parseBlockyDnsPort(configYaml) {
	var lines = safeString(configYaml).split(/\n/);
	var inPorts = false;
	var baseIndent = -1;
	var i;
	var line;
	var m;
	var lead;

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

		m = line.match(/^\s+dns\s*:\s*(\d+)\s*$/);
		if (m)
			return Number(m[1]);
	}

	return 5353;
}

function execDnsmasqSync(argv) {
	return fs.exec_direct('/usr/sbin/blocky-dnsmasq-sync', argv || []).then(function(res) {
		var code = res ? Number(res.code) : 0;

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
	return fetchJson(API_BASE + path, method || 'GET', body);
}

function runInit(action) {
	if ([ 'enable', 'disable', 'start', 'stop', 'restart' ].indexOf(action) === -1)
		return Promise.reject(new Error(_('Unsupported service action.')));

	return fs.exec_direct('/etc/init.d/blocky', [ action ]);
}

function isRunning(service) {
	return !!(service && service.blocky && service.blocky.instances &&
		service.blocky.instances.instance1 && service.blocky.instances.instance1.running);
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
		return fetchText(METRICS_URL).then(function(res) {
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

function svgPolygonArea(samples, field, W, H, padL, padR, padT, padB, maxY) {
	var innerW = W - padL - padR;
	var innerH = H - padT - padB;
	var pts;
	var i;
	var x;
	var y;
	var v;

	if (!samples.length || maxY <= 0)
		return padL + ',' + (H - padB) + ' ' + (padL + innerW) + ',' + (H - padB);

	pts = [];

	for (i = 0; i < samples.length; i++) {
		v = samples[i][field];
		x = padL + innerW * (samples.length <= 1 ? 0.5 : i / (samples.length - 1));
		y = padT + innerH * (1 - Math.min(v / maxY, 1));
		pts.push(x + ',' + y);
	}

	return padL + ',' + (H - padB) + ' ' + pts.join(' ') + ' ' +
		(padL + innerW) + ',' + (H - padB);
}

function renderOverview(metricsText) {
	var metrics = parseMetrics(metricsText);
	var overview = deriveOverview(metrics);
	var listedLabel = overview.denylistEntries >= 1000
		? formatCompactNumber(overview.denylistEntries)
		: formatNumber(overview.denylistEntries);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Overview') ]),
		E('p', { 'class': 'cbi-section-descr' }, overview.hasMetrics
			? [
				blockyPill('yes', _('Live')),
				blockyStatusDetail(_('Summary derived from Blocky Prometheus metrics.'))
			]
			: [
				blockyPill('no', _('Limited')),
				blockyStatusDetail(_('No metrics were returned. Enable prometheus in the Blocky configuration to populate this section.'))
			]),
		E('div', { 'class': 'blocky-metric-grid' }, [
			E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Total queries') ]),
					''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ formatNumber(overview.totalQueries) ]),
				E('small', {}, [ _('Cumulative counter') ])
			]),
			E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Blocked') ]),
					overview.hasMetrics && overview.totalQueries > 0
						? blockyPill('no', formatPercent(overview.blockedRate))
						: ''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ formatNumber(overview.blockedQueries) ]),
				E('small', {}, [ _('Matched blocking rules') ])
			]),
			E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Cache hit rate') ]),
					''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ formatPercent(overview.cacheHitRate) ]),
				E('div', { 'class': 'blocky-cache-track' }, [
					E('div', {
						'class': 'blocky-cache-fill',
						'style': 'width:%.1f%%'.format(Math.min(100, Math.max(0, overview.cacheHitRate)))
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
				E('small', {}, [ _('Denylist entries when exported') ])
			])
		])
	]);
}

function renderStatusDashboard(status, service) {
	var enabled = status && status.enabled;
	var paused = status && status.autoEnableInSec > 0;
	var running = isRunning(service);
	var blockingTail;

	if (paused)
		blockingTail = blockyStatusDetail(_('auto-enables in %s').format(formatDuration(status.autoEnableInSec)));
	else
		blockingTail = blockyStatusDetail(enabled ? _('enabled') : _('disabled'));

	return E('div', { 'class': 'blocky-dash-row' }, [
		E('div', { 'class': 'blocky-dash-card' }, [
			E('div', { 'class': 'blocky-dash-card-head' }, [
				E('strong', {}, [ _('Server status') ]),
				running && enabled && !paused ? blockyPill('yes', _('Enabled')) :
					paused ? blockyPill('warn', _('Paused')) :
						blockyPill('muted', running ? _('Running') : _('Stopped'))
			]),
			E('p', { 'class': 'blocky-note-soft' }, [
				running
					? _('DNS server is running and processing queries.')
					: _('DNS server is not running.')
			]),
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
						paused ? blockyPill('warn', _('Paused')) :
							blockyPill(enabled ? 'yes' : 'no', enabled ? _('Yes') : _('No')),
						blockingTail
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
				}),
				actionButton(_('Pause %s').format(_('15 minutes')), function() {
					return blockyApi('/blocking/disable?duration=15m');
				}),
				actionButton(_('Pause %s').format(_('30 minutes')), function() {
					return blockyApi('/blocking/disable?duration=30m');
				}),
				actionButton(_('Disable'), function() {
					return blockyApi('/blocking/disable');
				}, 'cbi-button-negative')
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
				}),
				actionButton(_('Reload allow/deny lists'), function() {
					return blockyApi('/lists/refresh', 'POST');
				})
			])
		])
	]);
}

function renderRealtimeMetrics(initialMetricsText) {
	var W = 820;
	var H = 220;
	var padL = 44;
	var padR = 16;
	var padT = 14;
	var padB = 36;
	var polyTotal = E('polygon', {
		'fill': 'rgba(33,150,243,0.22)',
		'stroke': '#2196f3',
		'stroke-width': '1.5'
	});
	var polyBlocked = E('polygon', {
		'fill': 'rgba(229,57,53,0.22)',
		'stroke': '#e53935',
		'stroke-width': '1.5'
	});
	var polyCached = E('polygon', {
		'fill': 'rgba(67,160,71,0.22)',
		'stroke': '#43a047',
		'stroke-width': '1.5'
	});
	var svg = E('svg', {
		'width': '100%',
		'height': '240',
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
		polyTotal,
		polyBlocked,
		polyCached
	]);
	var rangeButtons = [];
	var vBarHost = E('div', { 'class': 'blocky-vbar-row', 'style': 'min-height:124px' });
	var mixHost = E('div', { 'class': 'blocky-bar-chart' });
	var metricsBannerHost = E('div', {});
	var topListsNote = E('div', { 'class': 'blocky-bar-chart' }, [
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Per-domain and per-client rankings require Blocky query logs (SQL/CSV). This dashboard charts Prometheus counter deltas instead.')
		])
	]);
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

		replaceContent(vBarHost, E('div', { 'style': 'display:flex;width:100%;align-items:flex-end;justify-content:space-between;height:120px;padding:0 .25em;border-bottom:1px solid rgba(128,128,128,.35)' }, buckets.map(function(bucket) {
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

	function redrawChart(filtered) {
		var series = downsampleSamples(filtered, 160);
		var maxY = 1;
		var s;
		var i;

		for (i = 0; i < series.length; i++) {
			s = series[i];
			maxY = Math.max(maxY, s.total, s.blocked, s.cached);
		}

		polyTotal.setAttribute('points', svgPolygonArea(series, 'total', W, H, padL, padR, padT, padB, maxY));
		polyBlocked.setAttribute('points', svgPolygonArea(series, 'blocked', W, H, padL, padR, padT, padB, maxY));
		polyCached.setAttribute('points', svgPolygonArea(series, 'cached', W, H, padL, padR, padT, padB, maxY));
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
			polyTotal.setAttribute('points', svgPolygonArea([], 'total', W, H, padL, padR, padT, padB, 1));
			polyBlocked.setAttribute('points', svgPolygonArea([], 'blocked', W, H, padL, padR, padT, padB, 1));
			polyCached.setAttribute('points', svgPolygonArea([], 'cached', W, H, padL, padR, padT, padB, 1));
			return;
		}

		var filtered = filterSamplesByWindow(state.samples, state.windowMs);

		if (!filtered.length) {
			redrawMixRow(null);
			replaceContent(vBarHost, E('div', { 'style': 'padding:.75em 0' }, [
				E('em', {}, [ _('Waiting for the next metrics sample…') ])
			]));
			polyTotal.setAttribute('points', svgPolygonArea([], 'total', W, H, padL, padR, padT, padB, 1));
			polyBlocked.setAttribute('points', svgPolygonArea([], 'blocked', W, H, padL, padR, padT, padB, 1));
			polyCached.setAttribute('points', svgPolygonArea([], 'cached', W, H, padL, padR, padT, padB, 1));
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

	return E('div', { 'class': 'cbi-section blocky-chart-card' }, [
		E('div', { 'style': 'display:flex;flex-wrap:wrap;justify-content:space-between;gap:.5em;align-items:flex-start' }, [
			E('div', {}, [
				E('h3', { 'style': 'margin:.15em 0' }, [ _('Queries over time') ]),
				E('p', { 'class': 'cbi-section-descr', 'style': 'margin:0' }, [
					_('Estimated DNS query volume from Prometheus counter deltas (%s).').format(_('this browser session'))
				])
			]),
			E('div', { 'class': 'blocky-time-range' }, rangeButtons)
		]),
		E('p', { 'class': 'blocky-note-soft' }, [
			_('Long ranges fill as samples accumulate while this page stays open. Historical data beyond the session is not stored in LuCI.')
		]),
		metricsBannerHost,
		svg,
		E('div', { 'class': 'blocky-chart-legend' }, [
			E('span', {}, [
				E('span', { 'class': 'blocky-legend-dot', 'style': 'background:#2196f3' }),
				_('Total Δ')
			]),
			' ',
			E('span', {}, [
				E('span', { 'class': 'blocky-legend-dot', 'style': 'background:#e53935' }),
				_('Blocked Δ')
			]),
			' ',
			E('span', {}, [
				E('span', { 'class': 'blocky-legend-dot', 'style': 'background:#43a047' }),
				_('Cache hit Δ')
			])
		]),
		E('h4', {}, [ _('Bucketed totals (visible window)') ]),
		vBarHost,
		E('h4', { 'style': 'margin-top:1em' }, [ _('Top lists') ]),
		topListsNote,
		mixHost
	]);
}

function renderBlockingControls(status) {
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

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Blocking Controls') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Controls mirror the Blocky API: enable blocking, disable it temporarily, or disable specific groups.')
		]),
		E('p', {}, [
			actionButton(_('Enable blocking'), function() {
				return blockyApi('/blocking/enable');
			}),
			' ',
			actionButton(_('Disable blocking'), function() {
				return blockyApi('/blocking/disable');
			}, 'cbi-button-negative'),
			' ',
			E('label', { 'style': 'margin-left:1em' }, [ _('Preset'), ' ', pause ]),
			' ',
			E('label', {}, [ _('Custom'), ' ', customPause ]),
			' ',
			E('label', {}, [ _('Groups'), ' ', groups ]),
			' ',
			actionButton(_('Pause'), function() {
				return blockyApi('/blocking/disable?duration=' + encodeURIComponent(pauseDuration()) + groupQuery());
			})
		]),
		status && status.disabledGroups && status.disabledGroups.length
			? E('p', {}, [ _('Currently disabled groups: %s').format(status.disabledGroups.join(', ')) ])
			: ''
	]);
}

function renderOperations(service) {
	var running = isRunning(service);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Operations') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Maintenance actions are restricted to the local Blocky service and API endpoint.')
		]),
		E('p', {}, [
			actionButton(_('Refresh lists'), function() {
				return blockyApi('/lists/refresh', 'POST');
			}),
			' ',
			actionButton(_('Flush cache'), function() {
				return blockyApi('/cache/flush', 'POST');
			}),
			' ',
			actionButton(_('Restart service'), function() {
				return runInit('restart');
			}, 'cbi-button-apply')
		])
	]);
}

function renderServiceControls(service) {
	var running = isRunning(service);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Service') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Enable, start, stop, or restart the OpenWrt service wrapper.')
		]),
		E('p', {}, [
			actionButton(_('Enable on boot'), function() {
				return runInit('enable');
			}),
			' ',
			actionButton(_('Disable on boot'), function() {
				return runInit('disable');
			}, 'cbi-button-negative'),
			' ',
			actionButton(running ? _('Restart') : _('Start'), function() {
				return runInit(running ? 'restart' : 'start');
			}, 'cbi-button-apply'),
			' ',
			actionButton(_('Stop'), function() {
				return runInit('stop');
			}, 'cbi-button-negative')
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

function renderMetrics(metrics) {
	var text = metrics || '';
	var lines = text.split(/\n/).filter(function(line) {
		return line && line.charAt(0) !== '#';
	}).slice(0, 20);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Metrics') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Shows the first Prometheus samples if Blocky metrics are enabled.')
		]),
		E('pre', { 'style': 'white-space:pre-wrap; max-height:20em; overflow:auto' }, [
			lines.length ? lines.join('\n') : _('No metrics returned. Enable prometheus in the Blocky configuration to use this section.')
		])
	]);
}

function renderQueryLogsNotice(config) {
	var hasQueryLog = /\n?queryLog\s*:/.test(config || '');

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Query Logs') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('The standalone BlockyUI projects can read query logs from SQL databases or CSV files. This LuCI app does not ship an extra database client or backend service, so it keeps logs disabled unless you inspect them through Blocky itself or add a separate log pipeline.')
		]),
		E('p', {}, [
			hasQueryLog ? blockyPill('yes', _('Configured')) : blockyPill('no', _('Off')),
			blockyStatusDetail(hasQueryLog
				? _('queryLog section present in YAML')
				: _('query logging not configured in YAML'))
		]),
		E('div', { 'class': hasQueryLog ? 'alert-message' : 'alert-message warning' }, [
			hasQueryLog
				? _('A queryLog section exists in the config. Log analytics are intentionally not parsed in LuCI to avoid broad filesystem or database permissions.')
				: _('No queryLog section was found in the current config.')
		])
	]);
}

function renderRouterDnsIntegration(configYaml, dnsFwdRaw) {
	var port = parseBlockyDnsPort(configYaml);
	var enabled = safeString(dnsFwdRaw).trim() === '1';

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Router DNS integration') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Phones and laptops on Wi-Fi ask dnsmasq on the router for DNS (UDP/TCP port 53). Blocky uses its own port (%s in config.yml) so it does not replace dnsmasq. Turn this on to chain dnsmasq to Blocky so filtering and block lists apply to every DHCP client without manual DNS settings.').format(String(port))
		]),
		E('div', { 'class': 'table blocky-status-table' }, [
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:33%' }, [ _('Forwarding') ]),
				E('div', { 'class': 'td left' }, [
					blockyPill(enabled ? 'yes' : 'no', enabled ? _('Yes') : _('No')),
					blockyStatusDetail(enabled
						? _('dnsmasq uses %s').format('127.0.0.1#' + String(port))
						: _('WAN / resolv upstream only'))
				])
			])
		]),
		E('p', {}, [
			actionButton(_('Use Blocky for all LAN / Wi-Fi DNS'), function() {
				return execDnsmasqSync([ 'enable', String(port) ]);
			}, 'cbi-button-apply'),
			' ',
			actionButton(_('Stop forwarding (restore dnsmasq only)'), function() {
				return execDnsmasqSync([ 'disable' ]);
			}, 'cbi-button-negative')
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
			_('Edit %s directly. Save and restart Blocky for changes to take effect.').format(CONFIG_PATH)
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
						return location.reload();
					}).catch(function(err) {
						notify(err.message || String(err), 'danger');
					});
				})
			}, [ _('Save & restart') ])
		])
	]);
}

function renderTabs(tabs) {
	var tabButtons = [];
	var tabPanels = [];
	var activeIndex = 0;

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

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callServiceList('blocky'), {}),
			L.resolveDefault(blockyApi('/blocking/status'), { enabled: false }),
			L.resolveDefault(fs.read_direct(CONFIG_PATH), ''),
			L.resolveDefault(fetchText(METRICS_URL), ''),
			L.resolveDefault(fs.exec_direct('/usr/sbin/blocky-dnsmasq-sync', [ 'status' ]), { stdout: '0\n' })
		]);
	},

	render: function(data) {
		var service = data[0];
		var status = data[1];
		var config = data[2];
		var metrics = data[3];
		var dnsFwd = data[4];
		var dnsFwdRaw = dnsFwd && dnsFwd.stdout !== undefined ? dnsFwd.stdout : '0\n';
		var metricsPayload = unwrapFetchText(metrics);

		return E('div', { 'class': 'luci-app-blocky' }, [
			blockyInjectStyles(),
			E('h2', {}, [ _('Blocky DNS') ]),
			E('p', { 'class': 'cbi-section-descr' }, [
				_('Manage the local Blocky DNS proxy and ad-blocker. This LuCI-native dashboard implements the practical controls from Blocky UI projects without adding a separate web service.')
			]),
			renderTabs([
				{
					title: _('Status'),
					nodes: [
						renderOverview(metricsPayload),
						renderStatusDashboard(status, service),
						renderRealtimeMetrics(metricsPayload)
					]
				},
				{
					title: _('Configuration'),
					nodes: [
						renderRouterDnsIntegration(config, dnsFwdRaw),
						renderConfig(config)
					]
				},
				{
					title: _('Controls'),
					nodes: [
						renderBlockingControls(status),
						renderOperations(service),
						renderServiceControls(service)
					]
				},
				{
					title: _('DNS Query'),
					nodes: [ renderQuery() ]
				},
				{
					title: _('Metrics'),
					nodes: [ renderMetrics(metricsPayload) ]
				},
				{
					title: _('Logs'),
					nodes: [ renderQueryLogsNotice(config) ]
				}
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
