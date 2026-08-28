'use strict';

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

function sanitizeBlocklistId(raw) {
	return safeString(raw).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '');
}

function parseBlockyDnsPort(configYaml) {
	return parseBlockyPortLine(configYaml, 'dns', 5353).port;
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

function parseLabeledMetricGauge(text, metricNames, labelName) {
	var map = {};
	var lines = safeString(text).split(/\n/);
	var names = Array.isArray(metricNames) ? metricNames : [ metricNames ];
	var labelRe = new RegExp(labelName + '="([^"]+)"');
	var i;
	var line;
	var match;
	var labels;
	var labelMatch;
	var value;

	for (i = 0; i < lines.length; i++) {
		line = lines[i];

		if (!line || line.charAt(0) === '#')
			continue;

		match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/);
		if (!match || names.indexOf(match[1]) === -1)
			continue;

		labels = match[2] || '';
		labelMatch = labels.match(labelRe);
		value = Number(match[3]);

		if (!labelMatch || !isFinite(value))
			continue;

		map[labelMatch[1]] = value;
	}

	return map;
}

function parseDenylistGroupCounts(metricsText) {
	return parseLabeledMetricGauge(metricsText, [
		'blocky_denylist_cache_entries',
		'blocky_denylist_cache'
	], 'group');
}

function mergeDenyCounts(primary, fallback) {
	var map = {};
	var key;

	Object.keys(fallback || {}).forEach(function(name) {
		map[name] = fallback[name];
	});

	Object.keys(primary || {}).forEach(function(name) {
		map[name] = primary[name];
	});

	return map;
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

function parseBlockyVersionFromMetrics(text) {
	var match = safeString(text).match(/blocky_build_info\{[^}]*version="([^"]+)"/);

	return match ? match[1] : '';
}

function formatDuration(seconds, notScheduledLabel) {
	var value = Number(seconds || 0);
	var minutes;
	var sec;

	if (!isFinite(value) || value <= 0)
		return notScheduledLabel || 'not scheduled';

	minutes = Math.floor(value / 60);
	sec = value % 60;

	return minutes + 'm ' + (sec < 10 ? '0' : '') + sec + 's';
}

function blockyPathFromUrl(url, baseUrl) {
	var path = safeString(url).trim();
	baseUrl = safeString(baseUrl).trim();

	if (!path)
		return 'metrics';

	if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) {
		if (baseUrl && path.indexOf(baseUrl) === 0)
			path = path.slice(baseUrl.length);
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

function parseBlockyStatsResponse(res) {
	var text = safeString(res && res.stdout).trim();
	var errText = safeString(res && res.stderr).trim();
	var ok = !!(res && typeof res === 'object' && res.ok);

	if (!ok) {
		if (/statistics are disabled/i.test(errText || text))
			return { ok: false, disabled: true, data: null };

		return { ok: false, disabled: false, data: null };
	}

	if (!text)
		return { ok: false, disabled: false, data: null };

	try {
		var data = parseJson(text);

		if (!data || typeof data !== 'object')
			return { ok: false, disabled: false, data: null };

		if (!data.summary && !(data.lists && (data.lists.denylist || data.lists.allowlist)))
			return { ok: false, disabled: false, data: null };

		return { ok: true, disabled: false, data: data };
	}
	catch (err) {
		return { ok: false, disabled: false, data: null };
	}
}

function validateHttpRequest(method, path, body) {
	method = safeString(method || 'GET').toUpperCase();

	if (method !== 'GET' && method !== 'POST')
		return null;

	path = safeString(path || 'metrics').trim();

	if (!/^[A-Za-z0-9_\/.-]+$/.test(path) || path.indexOf('..') !== -1)
		return null;

	if (body != null)
		body = String(body);

	return [ method, path, body ];
}

function allowedLogDir(target, allowRoot) {
	allowRoot = allowRoot || '/tmp/blocky-logs';
	target = safeString(target || allowRoot).replace(/\/+$/, '');

	if (target !== allowRoot)
		return null;

	return target;
}

function isValidQueryLogFilename(name) {
	return /^[0-9]{4}-[0-9]{2}-[0-9]{2}_.*\.log$/.test(safeString(name));
}

function pickLatestLogFilename(names) {
	var best = null;
	var i;
	var name;

	for (i = 0; i < (names || []).length; i++) {
		name = names[i];

		if (!name || name === '.' || name === '..')
			continue;

		if (!isValidQueryLogFilename(name))
			continue;

		if (!best || name > best)
			best = name;
	}

	return best;
}

function parseBlockingStatusJson(text) {
	var data = parseJson(text);

	if (!data || typeof data !== 'object')
		return { enabled: false, autoEnableInSec: 0 };

	return {
		enabled: !!data.enabled,
		autoEnableInSec: Number(data.autoEnableInSec) || 0
	};
}

function shapeBlockyStatusBar(status) {
	status = status || {};
	var blocking = status.blocking || {};
	var paused = blocking.autoEnableInSec > 0;

	return {
		serviceOk: !!status.service_running,
		blockingOk: !!blocking.enabled && !paused,
		blockingPaused: paused,
		blockingResumeSec: paused ? blocking.autoEnableInSec : 0,
		dnsmasqOk: !!status.dnsmasq_forward && !!status.service_running,
		apiOk: !!status.api_ok,
		statsOk: !!status.stats_ok,
		statsDisabled: !!status.stats_disabled,
		version: safeString(status.version),
		logLevel: safeString(status.log_level || 'warn'),
		ports: status.ports || { dns: 5353, http: 4000 }
	};
}

function serviceObjectFromStatus(st) {
	if (!st || !st.service_running)
		return {};

	return {
		blocky: {
			instances: {
				instance1: { running: true }
			}
		}
	};
}

function statsResultFromStatus(st) {
	if (!st)
		return { ok: false, disabled: false, data: null };

	if (st.stats_disabled)
		return { ok: false, disabled: true, data: null };

	if (st.stats_ok && st.stats_json) {
		try {
			var data = parseJson(st.stats_json);

			if (data && (data.summary || (data.lists && (data.lists.denylist || data.lists.allowlist))))
				return { ok: true, disabled: false, data: data };
		}
		catch (err) {
			/* ignore */
		}
	}

	return { ok: false, disabled: false, data: null };
}

return {
	safeString: safeString,
	execResultStdout: execResultStdout,
	blockyCliStdout: blockyCliStdout,
	parseDnsForwardFlag: parseDnsForwardFlag,
	parseBlockyPortLine: parseBlockyPortLine,
	parseBlockyPortValue: parseBlockyPortValue,
	isLoopbackHost: isLoopbackHost,
	blockyHttpBaseUrl: blockyHttpBaseUrl,
	unwrapFsRead: unwrapFsRead,
	emptyBlocklistCatalog: emptyBlocklistCatalog,
	normalizeBlocklistCatalog: normalizeBlocklistCatalog,
	sanitizeBlocklistId: sanitizeBlocklistId,
	parseBlockyDnsPort: parseBlockyDnsPort,
	formatNumber: formatNumber,
	formatPercent: formatPercent,
	parseJson: parseJson,
	sumMapValues: sumMapValues,
	sumDenylistEntries: sumDenylistEntries,
	parseQueryLogConfig: parseQueryLogConfig,
	parseMetrics: parseMetrics,
	parseLabeledMetricGauge: parseLabeledMetricGauge,
	parseDenylistGroupCounts: parseDenylistGroupCounts,
	mergeDenyCounts: mergeDenyCounts,
	metricValue: metricValue,
	formatCompactNumber: formatCompactNumber,
	deriveCumulative: deriveCumulative,
	deriveOverview: deriveOverview,
	filterSamplesByWindow: filterSamplesByWindow,
	downsampleSamples: downsampleSamples,
	bucketAggregateBars: bucketAggregateBars,
	padChartTime2: padChartTime2,
	formatChartAxisTime: formatChartAxisTime,
	samplesToXY: samplesToXY,
	catmullRomPoint: catmullRomPoint,
	densifyCatmullRom: densifyCatmullRom,
	buildSmoothAreaPath: buildSmoothAreaPath,
	buildSmoothLinePath: buildSmoothLinePath,
	parseBlockyVersionFromMetrics: parseBlockyVersionFromMetrics,
	formatDuration: formatDuration,
	blockyPathFromUrl: blockyPathFromUrl,
	parseCsvRows: parseCsvRows,
	parseBlockyStatsResponse: parseBlockyStatsResponse,
	validateHttpRequest: validateHttpRequest,
	allowedLogDir: allowedLogDir,
	isValidQueryLogFilename: isValidQueryLogFilename,
	pickLatestLogFilename: pickLatestLogFilename,
	parseBlockingStatusJson: parseBlockingStatusJson,
	shapeBlockyStatusBar: shapeBlockyStatusBar,
	serviceObjectFromStatus: serviceObjectFromStatus,
	statsResultFromStatus: statsResultFromStatus
};
