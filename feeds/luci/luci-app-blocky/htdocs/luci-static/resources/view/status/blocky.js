'use strict';
'require view';
'require fs';
'require rpc';
'require ui';
'require poll';

var API_BASE = 'http://127.0.0.1:4000/api';
var METRICS_URL = 'http://127.0.0.1:4000/metrics';

var REALTIME_WINDOWS = [
	[ '1h', _('1h'), 3600000 ],
	[ '24h', _('24h'), 86400000 ],
	[ '7d', _('7d'), 604800000 ],
	[ '30d', _('30d'), 2592000000 ]
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
	'.blocky-dashboard{display:flex;flex-direction:column;gap:1.15em;margin:.35em 0 1.25em;}',
	'.blocky-dash-widget{background:#e8e8e8;border-radius:12px;padding:1em 1.1em 1.15em;box-sizing:border-box;',
	'border:1px solid rgba(0,0,0,.08);}',
	'body[data-darkmode="1"] .blocky-dash-widget{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);}',
	'.blocky-dash-widget-title{margin:0;font-size:1.05em;font-weight:700;line-height:1.25;}',
	'.blocky-dash-widget-descr{margin:.35em 0 .65em;opacity:.88;font-size:.92em;line-height:1.4;}',
	'.blocky-dash-widget-head-row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.75em;align-items:flex-start;margin-bottom:.5em;}',
	'.blocky-metric-card{background:#e8e8e8;border-radius:10px;box-sizing:border-box;}',
	'body[data-darkmode="1"] .blocky-metric-card{background:rgba(255,255,255,.08);}',
	'.blocky-status-table .tr{vertical-align:middle;}',
	'.blocky-time-range{display:flex;flex-wrap:wrap;gap:.35em;justify-content:flex-end;margin:.35em 0;}',
	'.blocky-time-range button.cbi-button{padding:.25em .65em;font-size:.9em;}',
	'.blocky-time-range button.blocky-range-active{background:#fff;color:#111;border-color:#ccc;}',
	'body[data-darkmode="1"] .blocky-time-range button.blocky-range-active{background:#37474f;color:#eceff1;border-color:#546e7a;}',
	'.blocky-queries-widget--embedded{margin:0;padding:0;border:none;background:transparent;}',
	'.blocky-queries-widget-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.65em;align-items:flex-start;margin-bottom:.35em;}',
	'.blocky-chart-svg-wrap{margin:.35em 0 .15em;}',
	'.blocky-chart-plot-bg{stroke:rgba(0,0,0,.06);}',
	'body[data-darkmode="1"] .blocky-chart-plot-bg{stroke:rgba(255,255,255,.08);}',
	'.blocky-chart-grid line{stroke:rgba(0,0,0,.12);stroke-width:1;}',
	'body[data-darkmode="1"] .blocky-chart-grid line{stroke:rgba(255,255,255,.14);}',
	'.blocky-chart-axis text{fill:currentColor;opacity:.75;font-size:11px;font-variant-numeric:tabular-nums;}',
	'.blocky-chart-legend{display:flex;flex-wrap:wrap;justify-content:center;gap:1em;margin-top:.5em;font-size:.9em;}',
	'.blocky-legend-dot{display:inline-block;width:.65em;height:.65em;border-radius:50%;margin-right:.35em;vertical-align:middle;}',
	'.blocky-bar-chart{margin:.75em 0;padding:.5em 0;}',
	'.blocky-bar-row{display:flex;align-items:center;gap:.65em;margin:.45em 0;font-size:.92em;}',
	'.blocky-bar-label{flex:0 0 7em;}',
	'.blocky-bar-track{flex:1;height:1.1em;border-radius:4px;background:rgba(0,0,0,.1);overflow:hidden;display:flex;}',
	'body[data-darkmode="1"] .blocky-bar-track{background:rgba(255,255,255,.12);}',
	'.blocky-bar-seg{height:100%;}',
	'.blocky-bar-val{flex:0 0 3em;text-align:right;font-variant-numeric:tabular-nums;}',
	'.blocky-note-soft{opacity:.85;font-size:.92em;margin:.35em 0 .75em;}',
	'.blocky-toplists-grid{display:flex;flex-wrap:wrap;gap:1.15em;align-items:flex-start;margin:.35em 0 1em;}',
	'.blocky-toplist-col{flex:1 1 17em;min-width:14em;max-width:100%;}',
	'.blocky-toplist-toolbar{display:flex;flex-wrap:wrap;gap:.65em;align-items:center;margin:.35em 0 .65em;}',
	'.blocky-toplist-toolbar label{display:inline-flex;align-items:center;gap:.35em;margin:0;}'
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

function notify(message, level) {
	ui.addNotification(null, E('p', {}, [ message ]), level || 'info');
}

function replaceContent(node, content) {
	while (node.firstChild)
		node.removeChild(node.firstChild);

	node.appendChild(content);
}

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

function safeString(value) {
	if (value === null || value === undefined)
		return '';

	return String(value);
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
	var hours;
	var minutes;

	if (!isFinite(value) || value <= 0)
		return _('not scheduled');

	hours = Math.floor(value / 3600);
	minutes = Math.floor((value % 3600) / 60);

	if (hours > 0)
		return '%dh %02dm %02ds'.format(hours, minutes, value % 60);

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

function unwrapFetchText(res) {
	if (res == null || res === '')
		return '';

	if (typeof res === 'string')
		return res;

	if (res.stdout != null)
		return safeString(res.stdout);

	return safeString(res.stderr || '');
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

function fetchJson(url, method, body) {
	return fetchText(url, method, body).then(function(res) {
		return parseJson(unwrapFetchText(res));
	});
}

function blockyApi(path, method, body) {
	return fetchJson(API_BASE + path, method || 'GET', body);
}

function isRunning(service) {
	return !!(service && service.blocky && service.blocky.instances &&
		service.blocky.instances.instance1 && service.blocky.instances.instance1.running);
}

function parseLabels(text) {
	var labels = {};
	var index = 0;
	var key = '';
	var value = '';
	var inKey = true;
	var inQuote = false;
	var escapeNext = false;

	if (!text)
		return labels;

	function commit() {
		if (key)
			labels[key] = value;

		key = '';
		value = '';
		inKey = true;
	}

	while (index < text.length) {
		var chr = text.charAt(index++);

		if (escapeNext) {
			value += chr;
			escapeNext = false;
			continue;
		}

		if (!inKey && chr === '\\') {
			escapeNext = true;
			continue;
		}

		if (!inKey && chr === '"') {
			inQuote = !inQuote;
			continue;
		}

		if (inKey && chr === '=') {
			inKey = false;
			continue;
		}

		if (!inQuote && chr === ',') {
			commit();
			continue;
		}

		if (inKey)
			key += chr;
		else
			value += chr;
	}

	commit();

	return labels;
}

function parseMetricsFamilies(text) {
	var families = {};
	var order = [];
	var lines = safeString(text).split(/\n/);

	function family(name) {
		if (!families[name]) {
			families[name] = {
				name: name,
				type: '',
				help: '',
				total: 0,
				samples: []
			};
			order.push(name);
		}

		return families[name];
	}

	lines.forEach(function(line) {
		var comment;
		var match;
		var item;
		var value;

		if (!line)
			return;

		comment = line.match(/^#\s+(HELP|TYPE)\s+([^\s]+)\s+(.+)$/);
		if (comment) {
			item = family(comment[2]);

			if (comment[1] === 'HELP')
				item.help = comment[3];
			else
				item.type = comment[3];

			return;
		}

		if (line.charAt(0) === '#')
			return;

		match = line.match(/^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(?:\s+\d+)?$/);
		if (!match)
			return;

		value = Number(match[3]);
		if (!isFinite(value))
			return;

		item = family(match[1]);
		item.total += value;
		item.samples.push({
			labels: parseLabels(match[2]),
			value: value
		});
	});

	return {
		order: order,
		families: families
	};
}

function findTotal(metrics, exactNames, patterns) {
	var i;
	var name;
	var family;

	for (i = 0; i < exactNames.length; i++) {
		family = metrics.families[exactNames[i]];
		if (family)
			return family.total;
	}

	for (i = 0; i < metrics.order.length; i++) {
		name = metrics.order[i];

		if (patterns.some(function(pattern) { return pattern.test(name); }))
			return metrics.families[name].total;
	}

	return 0;
}

function deriveOverviewFamilies(metrics) {
	var totalQueries = findTotal(metrics, [
		'blocky_query_total',
		'blocky_queries_total'
	], [ /blocky.*quer.*total/i ]);
	var blockedQueries = findTotal(metrics, [
		'blocky_query_blocked_total',
		'blocky_blocked_total'
	], [ /blocky.*block.*total/i, /blocky.*quer.*block/i ]);
	var cacheHits = findTotal(metrics, [
		'blocky_cache_hit_total',
		'blocky_cache_hits_total'
	], [ /blocky.*cache.*hit/i ]);
	var cacheMisses = findTotal(metrics, [
		'blocky_cache_miss_total',
		'blocky_cache_misses_total'
	], [ /blocky.*cache.*miss/i ]);
	var denylistEntries = findTotal(metrics, [
		'blocky_blocking_denylists_entries',
		'blocky_denylists_entries'
	], [ /blocky.*deny.*entr/i, /blocky.*list.*entr/i ]);

	return {
		totalQueries: totalQueries,
		blockedQueries: blockedQueries,
		blockedRate: totalQueries > 0 ? blockedQueries / totalQueries * 100 : 0,
		cacheHitRate: cacheHits + cacheMisses > 0 ? cacheHits / (cacheHits + cacheMisses) * 100 : 0,
		denylistEntries: denylistEntries
	};
}

function parseMetricsCounters(text) {
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

function prometheusParseLabels(text) {
	var labels = {};
	var index = 0;
	var key = '';
	var value = '';
	var inKey = true;
	var inQuote = false;
	var escapeNext = false;
	var chr;

	if (!text)
		return labels;

	function commit() {
		if (key)
			labels[key.trim()] = value;

		key = '';
		value = '';
		inKey = true;
	}

	while (index < text.length) {
		chr = text.charAt(index++);

		if (escapeNext) {
			value += chr;
			escapeNext = false;
			continue;
		}

		if (!inKey && chr === '\\') {
			escapeNext = true;
			continue;
		}

		if (!inKey && chr === '"') {
			inQuote = !inQuote;
			continue;
		}

		if (inKey && chr === '=') {
			inKey = false;
			continue;
		}

		if (!inQuote && chr === ',') {
			commit();
			continue;
		}

		if (inKey)
			key += chr;
		else
			value += chr;
	}

	commit();

	return labels;
}

function parsePrometheusSamplesAll(text) {
	var out = [];
	var lines = safeString(text).split(/\n/);
	var withLbl = /^([a-zA-Z_:][a-zA-Z0-9_:]*)\{([^}]*)\}\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;
	var plain = /^([a-zA-Z_:][a-zA-Z0-9_:]*)\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;

	lines.forEach(function(line) {
		var m;
		var value;

		if (!line || line.charAt(0) === '#')
			return;

		m = line.match(withLbl);
		if (m) {
			value = Number(m[3]);

			if (!isFinite(value))
				return;

			out.push({
				name: m[1],
				labels: prometheusParseLabels(m[2]),
				value: value
			});

			return;
		}

		m = line.match(plain);
		if (m) {
			value = Number(m[2]);

			if (!isFinite(value))
				return;

			out.push({ name: m[1], labels: {}, value: value });
		}
	});

	return out;
}

function aggregateCounterByLabel(samples, metricNames, labelKey) {
	var map = {};
	var accept = {};
	var i;
	var k;
	var v;

	for (i = 0; i < metricNames.length; i++)
		accept[metricNames[i]] = true;

	samples.forEach(function(s) {
		if (!accept[s.name])
			return;

		k = s.labels[labelKey];

		if (k === undefined || k === null || k === '')
			k = _('unknown');

		v = Number(s.value || 0);

		if (!isFinite(v))
			v = 0;

		map[k] = (map[k] || 0) + v;
	});

	return map;
}

function mapToTopRows(map, n) {
	var rows = [];

	Object.keys(map).forEach(function(key) {
		rows.push({ label: key, val: map[key] });
	});

	rows.sort(function(a, b) {
		return b.val - a.val;
	});

	return rows.slice(0, Math.max(1, n));
}

function topListBarRow(label, val, maxVal, color) {
	var pct = Math.round(100 * val / Math.max(1, maxVal));

	return E('div', { 'class': 'blocky-bar-row' }, [
		E('div', {
			'class': 'blocky-bar-label',
			'style': 'flex:0 0 9em;overflow:hidden;text-overflow:ellipsis',
			'title': label
		}, [ label ]),
		E('div', { 'class': 'blocky-bar-track' }, [
			E('div', {
				'class': 'blocky-bar-seg',
				'style': 'width:%d%%;background:%s'.format(Math.min(100, pct), color),
				'title': formatNumber(val)
			})
		]),
		E('div', { 'class': 'blocky-bar-val' }, [ formatNumber(val) ])
	]);
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

function deriveOverviewCounters(metrics) {
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

var blockyStatusRtMetricsHook = null;

function registerBlockyStatusMetricsPolling() {
	if (registerBlockyStatusMetricsPolling.done)
		return;

	registerBlockyStatusMetricsPolling.done = true;

	poll.add(function() {
		return fetchText(METRICS_URL).then(function(res) {
			if (blockyStatusRtMetricsHook)
				blockyStatusRtMetricsHook(unwrapFetchText(res));
		});
	}, 10);
}

function setBlockyStatusMetricsPollingHook(fn) {
	blockyStatusRtMetricsHook = fn;
	registerBlockyStatusMetricsPolling();
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
		'fill': 'rgba(128,128,128,.07)'
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
function renderStatusChartsAndTopLists(initialMetricsText) {
	var viewCtx = this;
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
	var topClientsInner = E('div', { 'class': 'blocky-bar-chart' });
	var topTypesInner = E('div', { 'class': 'blocky-bar-chart' });
	var rowsSel = E('select', { 'class': 'cbi-input-select', 'style': 'min-width:4.5em' }, [
		E('option', { 'value': '5' }, [ '5' ]),
		E('option', { 'value': '10' }, [ '10' ]),
		E('option', { 'value': '15' }, [ '15' ])
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
		var metrics = parseMetricsCounters(text);
		var overview = deriveOverviewCounters(metrics);
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


	function redrawTopLists(text) {
		var live = deriveOverviewCounters(parseMetricsCounters(text)).hasMetrics;
		var n = Number(rowsSel.value) || 5;
		var samples;
		var clientsMap;
		var typesMap;
		var cr;
		var tr;
		var maxC;
		var maxT;
		var QUERY_METRICS = [ 'blocky_query_total', 'blocky_queries_total' ];

		if (!live) {
			replaceContent(topClientsInner, E('em', {}, [ _('Enable Prometheus on Blocky to rank clients.') ]));
			replaceContent(topTypesInner, E('em', {}, [ _('Enable Prometheus on Blocky to rank query types.') ]));
			return;
		}

		samples = parsePrometheusSamplesAll(text);
		clientsMap = aggregateCounterByLabel(samples, QUERY_METRICS, 'client');
		typesMap = aggregateCounterByLabel(samples, QUERY_METRICS, 'type');

		if (!Object.keys(typesMap).length)
			typesMap = aggregateCounterByLabel(samples, QUERY_METRICS, 'dns_request_type');
		cr = mapToTopRows(clientsMap, n);
		tr = mapToTopRows(typesMap, n);
		maxC = 1;
		maxT = 1;

		cr.forEach(function(r) {
			maxC = Math.max(maxC, r.val);
		});

		tr.forEach(function(r) {
			maxT = Math.max(maxT, r.val);
		});

		if (!cr.length)
			replaceContent(topClientsInner, E('em', {}, [ _('No per-client samples yet (waiting for DNS queries).') ]));
		else
			replaceContent(topClientsInner, E('div', {}, cr.map(function(r) {
				return topListBarRow(r.label, r.val, maxC, '#2196f3');
			})));

		if (!tr.length)
			replaceContent(topTypesInner, E('em', {}, [ _('No per-type samples yet.') ]));
		else
			replaceContent(topTypesInner, E('div', {}, tr.map(function(r) {
				return topListBarRow(r.label, r.val, maxT, '#43a047');
			})));
	}

	function redrawAll() {
		var live = deriveOverviewCounters(parseMetricsCounters(state.lastRaw)).hasMetrics;

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
			redrawTopLists(state.lastRaw);
			return;
		}

		var filtered = filterSamplesByWindow(state.samples, state.windowMs);

		if (!filtered.length) {
			redrawMixRow(null);
			replaceContent(vBarHost, E('div', { 'style': 'padding:.75em 0' }, [
				E('em', {}, [ _('Waiting for the next metrics sample…') ])
			]));
			redrawSmoothChart([]);
			redrawTopLists(state.lastRaw);
			return;
		}

		redrawChart(filtered);
		redrawGroupedBars(filtered);
		redrawMixRow(filtered[filtered.length - 1]);
		redrawTopLists(state.lastRaw);
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

	rowsSel.addEventListener('change', function() {
		redrawTopLists(state.lastRaw);
	});

	setBlockyStatusMetricsPollingHook(hook);
	state.lastRaw = safeString(initialMetricsText);
	ingestMetrics(state.lastRaw);
	redrawAll();
	redrawTopLists(state.lastRaw);

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
		E('div', { 'class': 'blocky-dash-widget' }, [
			E('div', { 'class': 'blocky-dash-widget-head-row' }, [
				E('div', {}, [
					E('h3', { 'class': 'blocky-dash-widget-title' }, [ _('Top lists') ]),
					E('p', { 'class': 'blocky-dash-widget-descr', 'style': 'margin:.35em 0 0' }, [
						_('Busiest clients and DNS record types (not domain names — those need query logging).')
					])
				]),
				E('div', { 'class': 'blocky-toplist-toolbar', 'style': 'margin:0' }, [
					E('label', {}, [
						_('Rows'),
						' ',
						rowsSel
					]),
					E('button', {
						'class': 'cbi-button cbi-button-action',
						'click': ui.createHandlerFn(viewCtx, function(ev) {
							ev.preventDefault();

							return blockyApi('/lists/refresh', 'POST').then(function() {
								notify(_('Block lists refresh requested.'));
							}).catch(function(err) {
								notify(err.message || String(err), 'danger');
							});
						})
					}, [ _('Refresh lists') ])
				])
			]),
			E('div', { 'class': 'blocky-toplists-grid', 'style': 'margin-bottom:0' }, [
				E('div', { 'class': 'blocky-toplist-col' }, [
					E('strong', {}, [ _('Top clients') ]),
					E('p', { 'class': 'cbi-section-descr', 'style': 'margin:.25em 0 .5em;font-size:.88em' }, [
						_('By query count (blocky_query_total).')
					]),
					topClientsInner
				]),
				E('div', { 'class': 'blocky-toplist-col' }, [
					E('strong', {}, [ _('Top query types') ]),
					E('p', { 'class': 'cbi-section-descr', 'style': 'margin:.25em 0 .5em;font-size:.88em' }, [
						_('A, AAAA, PTR, … — not hostnames.')
					]),
					topTypesInner
				])
			])
		])
	]);
}function renderCard(title, value, description) {
	return E('div', { 'class': 'td left blocky-metric-card', 'style': 'min-width:12em; padding:1em' }, [
		E('strong', {}, [ title ]),
		E('div', { 'style': 'font-size:1.8em; margin:.25em 0' }, [ value ]),
		E('small', {}, [ description ])
	]);
}

function renderStatus(status, service, metrics) {
	var running = isRunning(service);
	var enabled = status && status.enabled;
	var paused = status && status.autoEnableInSec > 0;
	var blockingTail;
	var sampleTotal;

	if (paused)
		blockingTail = blockyStatusDetail(_('auto-enables in %s').format(formatDuration(status.autoEnableInSec)));
	else
		blockingTail = blockyStatusDetail(enabled ? _('enabled') : _('disabled'));

	sampleTotal = metrics.order.reduce(function(total, name) {
		return total + metrics.families[name].samples.length;
	}, 0);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Server status') ]),
		E('div', { 'class': 'table blocky-status-table' }, [
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:25%' }, [ _('Service') ]),
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
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left' }, [ _('Prometheus metrics') ]),
				E('div', { 'class': 'td left' }, [
					blockyPill('yes', _('Yes')),
					blockyStatusDetail(_('%d families, %s samples').format(
						metrics.order.length,
						formatNumber(sampleTotal)
					))
				])
			])
		])
	]);
}

function renderOverview(metrics) {
	var overview = deriveOverviewFamilies(metrics);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('At a glance') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			blockyPill('yes', _('Live')),
			blockyStatusDetail(_('Key counters from the Prometheus exporter'))
		]),
		E('div', { 'class': 'table' }, [
			E('div', { 'class': 'tr' }, [
				renderCard(_('Queries'), formatNumber(overview.totalQueries), _('Total query counter, when exposed')),
				renderCard(_('Blocked'), formatNumber(overview.blockedQueries), formatPercent(overview.blockedRate)),
				renderCard(_('Cache hit rate'), formatPercent(overview.cacheHitRate), _('From hit/miss counters')),
				renderCard(_('Listed domains'), formatNumber(overview.denylistEntries), _('From denylist metrics'))
			])
		])
	]);
}

function renderNoMetrics(raw) {
	return E('div', { 'class': 'alert-message warning' }, [
		E('p', {}, [
			blockyPill('no', _('No')),
			blockyStatusDetail(_('metrics endpoint unreachable or prometheus disabled'))
		]),
		E('p', {}, [
			_('No metrics were returned from %s. Ensure Blocky is running and prometheus.enable is true in /etc/blocky/config.yml.').format(METRICS_URL)
		]),
		raw ? E('pre', { 'style': 'white-space:pre-wrap; margin-top:1em' }, [ raw ]) : ''
	]);
}

return view.extend({
	load: function() {
		return Promise.all([
			L.resolveDefault(callServiceList('blocky'), {}),
			L.resolveDefault(blockyApi('/blocking/status'), { enabled: false }),
			L.resolveDefault(fetchText(METRICS_URL), '')
		]);
	},

	render: function(data) {
		var service = data[0];
		var status = data[1];
		var rawMetricsWrapped = data[2];
		var rawMetricsText = unwrapFetchText(rawMetricsWrapped);
		var metrics = parseMetricsFamilies(rawMetricsText);
		var content = [
			blockyInjectStyles(),
			E('h2', {}, [ _('Blocky Status') ]),
			E('p', { 'class': 'cbi-section-descr' }, [
				_('Live charts and rankings from Prometheus. Configuration and DNS integration live under Services → Blocky.')
			])
		];

		if (metrics.order.length) {
			content = content.concat([
				renderStatus(status, service, metrics),
				renderOverview(metrics),
				E('div', { 'class': 'blocky-dashboard' }, [
					renderStatusChartsAndTopLists.call(this, rawMetricsText)
				])
			]);
		} else {
			content.push(renderNoMetrics(rawMetricsText));
		}

		return E('div', { 'class': 'luci-app-blocky' }, content);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
