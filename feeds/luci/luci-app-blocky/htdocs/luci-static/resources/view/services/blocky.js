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
	'.blocky-metric-card{background:#e8e8e8;border-radius:12px;box-sizing:border-box;padding:1em 1.05em;min-width:10em;',
	'border:1px solid rgba(0,0,0,.06);}',
	'body[data-darkmode="1"] .blocky-metric-card{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.1);}',
	'.blocky-dashboard{display:flex;flex-direction:column;gap:1.15em;margin:.35em 0 1.25em;}',
	'.blocky-dash-widget{background:#e8e8e8;border-radius:12px;padding:1em 1.1em 1.15em;box-sizing:border-box;',
	'border:1px solid rgba(0,0,0,.08);}',
	'body[data-darkmode="1"] .blocky-dash-widget{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.1);}',
	'.blocky-dash-widget-title{margin:0;font-size:1.05em;font-weight:700;line-height:1.25;}',
	'.blocky-dash-widget-descr{margin:.35em 0 .65em;opacity:.88;font-size:.92em;line-height:1.4;}',
	'.blocky-dash-widget-head-row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.75em;align-items:flex-start;margin-bottom:.5em;}',
	'.blocky-metric-strip{display:flex;flex-wrap:wrap;gap:.5em;align-items:center;margin:0 0 .75em;font-size:.92em;}',
	'.blocky-dashboard-metrics-row{margin:0;}',
	'.blocky-dashboard-metrics-row .blocky-metric-grid{margin:.25em 0 0;}',
	'.blocky-status-table .tr{vertical-align:middle;}',
	'.blocky-metric-grid{display:flex;flex-wrap:wrap;gap:.75em;margin:.5em 0 1em;}',
	'.blocky-metric-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:.5em;margin-bottom:.35em;}',
	'.blocky-metric-val{font-size:1.85em;font-weight:700;line-height:1.15;margin:.15em 0 .35em;}',
	'.blocky-cache-track{height:6px;border-radius:3px;background:rgba(0,0,0,.12);overflow:hidden;margin-top:.35em;}',
	'body[data-darkmode="1"] .blocky-cache-track{background:rgba(255,255,255,.15);}',
	'.blocky-cache-fill{height:100%;background:#43a047;border-radius:3px;transition:width .35s ease;}',
	'.blocky-dash-row{display:flex;flex-wrap:wrap;gap:.75em;margin:0;}',
	'.blocky-dash-card{background:#e8e8e8;border-radius:12px;padding:1em;flex:1 1 18em;box-sizing:border-box;',
	'border:1px solid rgba(0,0,0,.08);}',
	'body[data-darkmode="1"] .blocky-dash-card{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.1);}',
	'.blocky-dash-card-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:.5em;}',
	'.blocky-btn-grid{display:flex;flex-wrap:wrap;gap:.5em;margin-top:.65em;}',
	'.blocky-time-range{display:flex;flex-wrap:wrap;gap:.35em;justify-content:flex-end;margin:.35em 0;}',
	'.blocky-time-range button.cbi-button{padding:.25em .65em;font-size:.9em;}',
	'.blocky-time-range button.blocky-range-active{background:#fff;color:#111;border-color:#ccc;}',
	'body[data-darkmode="1"] .blocky-time-range button.blocky-range-active{background:#37474f;color:#eceff1;border-color:#546e7a;}',
	'.blocky-chart-card{margin:.75em 0 1em;padding:1em;border-radius:10px;background:#e8e8e8;}',
	'body[data-darkmode="1"] .blocky-chart-card{background:rgba(255,255,255,.06);}',
	'.blocky-queries-widget{border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:1em 1.1em 1.15em;margin:.35em 0 1em;',
	'background:rgba(255,255,255,.35);box-sizing:border-box;}',
	'body[data-darkmode="1"] .blocky-queries-widget{border-color:rgba(255,255,255,.12);background:rgba(255,255,255,.04);}',
	'.blocky-queries-widget--embedded{margin:0;padding:0;border:none;background:transparent;}',
	'.blocky-queries-widget-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:.65em;align-items:flex-start;margin-bottom:.35em;}',
	'.blocky-queries-widget-head h3{margin:.1em 0 .15em;display:flex;align-items:center;gap:.35em;}',
	'.blocky-queries-widget-icon{font-size:1.1em;opacity:.85;line-height:1;}',
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
	'.blocky-vbar-row{display:flex;align-items:flex-end;justify-content:space-between;height:120px;margin-top:.5em;',
	'padding:0 .25em;border-bottom:1px solid rgba(0,0,0,.15);}',
	'body[data-darkmode="1"] .blocky-vbar-row{border-bottom-color:rgba(255,255,255,.15);}',
	'.blocky-vbar-grp{display:flex;flex-direction:row;align-items:flex-end;justify-content:center;',
	'gap:2px;flex:1;max-width:48px;margin:0 .15em;}',
	'.blocky-vbar{flex:1;min-width:4px;border-radius:2px 2px 0 0;}',
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

	line = safeString(line).trim();

	return line === '1';
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

function renderOverview(metricsText) {
	var metrics = parseMetrics(metricsText);
	var overview = deriveOverview(metrics);
	var listedLabel = overview.denylistEntries >= 1000
		? formatCompactNumber(overview.denylistEntries)
		: formatNumber(overview.denylistEntries);

	return E('div', { 'class': 'blocky-dashboard-metrics-row' }, [
		E('div', { 'class': 'blocky-metric-strip' }, [
			overview.hasMetrics ? blockyPill('yes', _('Live')) : blockyPill('no', _('Limited')),
			blockyStatusDetail(overview.hasMetrics
				? _('Counters refresh from Blocky while this page is open.')
				: _('Enable prometheus in Blocky configuration for full dashboard data.'))
		]),
		E('div', { 'class': 'blocky-metric-grid', 'style': 'margin:0' }, [
			E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Total queries') ]),
					''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ formatNumber(overview.totalQueries) ]),
				E('small', {}, [ _('Since Blocky started') ])
			]),
			E('div', { 'class': 'blocky-metric-card', 'style': 'flex:1 1 11em' }, [
				E('div', { 'class': 'blocky-metric-card-head' }, [
					E('strong', {}, [ _('Blocked') ]),
					overview.hasMetrics && overview.totalQueries > 0
						? blockyPill('no', formatPercent(overview.blockedRate))
						: ''
				]),
				E('div', { 'class': 'blocky-metric-val' }, [ formatNumber(overview.blockedQueries) ]),
				E('small', {}, [ _('Matched rules') ])
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
				E('small', {}, [ _('Denylist entries') ])
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

	function redrawTopLists(text) {
		var live = deriveOverview(parseMetrics(text)).hasMetrics;
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

	setBlockyMetricsPollingHook(hook);
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
	var enabled = parseDnsForwardFlag(dnsFwdRaw);

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

		dnsFwdRaw = blockyCliStdout(dnsFwdRaw);
		var metricsPayload = unwrapFetchText(metrics);

		return E('div', { 'class': 'luci-app-blocky' }, [
			blockyInjectStyles(),
			E('h2', {}, [ _('Blocky DNS') ]),
			E('p', { 'class': 'cbi-section-descr' }, [
				_('Dashboard for Blocky on your router — metrics, blocking controls, and DNS integration without a separate BlockyUI server.')
			]),
			renderTabs([
				{
					title: _('Dashboard'),
					nodes: [
						E('div', { 'class': 'blocky-dashboard' }, [
							renderOverview(metricsPayload),
							renderStatusDashboard(status, service),
							renderRealtimeMetrics.call(this, metricsPayload)
						])
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
