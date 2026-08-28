#!/usr/bin/env node
/**
 * One-shot helper: extract pure logic from blocky-common.js into core modules.
 * Run from repo: node feeds/luci/luci-app-blocky/scripts/extract-blocky-cores.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COMMON = path.join(ROOT, 'htdocs/luci-static/resources/blocky-common.js');
const PARSE_OUT = path.join(ROOT, 'htdocs/luci-static/resources/blocky-parse-core.js');
const CONFIG_OUT = path.join(ROOT, 'htdocs/luci-static/resources/blocky-config-core.js');

const src = fs.readFileSync(COMMON, 'utf8');
const lines = src.split('\n');

function slice(start, end) {
	return lines.slice(start - 1, end).join('\n');
}

const parseFns = [
	[255, 260, 'safeString'],
	[262, 274, 'execResultStdout'],
	[276, 297, 'blockyCliStdout'],
	[299, 306, 'parseDnsForwardFlag'],
	[308, 342, 'parseBlockyPortLine'],
	[344, 358, 'parseBlockyPortValue'],
	[360, 364, 'isLoopbackHost'],
	[366, 374, 'blockyHttpBaseUrl'],
	[398, 400, 'unwrapFsRead'],
	[402, 404, 'emptyBlocklistCatalog'],
	[406, 441, 'normalizeBlocklistCatalog'],
	[810, 812, 'sanitizeBlocklistId'],
	[1023, 1025, 'parseBlockyDnsPort'],
	[1038, 1045, 'formatNumber'],
	[1047, 1054, 'formatPercent'],
	[1068, 1078, 'parseJson'],
	[1185, 1196, 'sumMapValues'],
	[1198, 1203, 'sumDenylistEntries'],
	[1280, 1292, 'parseQueryLogConfig'],
	[1406, 1444, 'parseMetrics'],
	[1446, 1479, 'parseLabeledMetricGauge'],
	[1481, 1486, 'parseDenylistGroupCounts'],
	[1488, 1501, 'mergeDenyCounts'],
	[1503, 1512, 'metricValue'],
	[1514, 1530, 'formatCompactNumber'],
	[1532, 1566, 'deriveCumulative'],
	[1568, 1584, 'deriveOverview'],
	[1614, 1620, 'filterSamplesByWindow'],
	[1622, 1636, 'downsampleSamples'],
	[1638, 1671, 'bucketAggregateBars'],
	[1673, 1677, 'padChartTime2'],
	[1679, 1683, 'formatChartAxisTime'],
	[1685, 1702, 'samplesToXY'],
	[1704, 1718, 'catmullRomPoint'],
	[1720, 1749, 'densifyCatmullRom'],
	[1751, 1766, 'buildSmoothAreaPath'],
	[1768, 1781, 'buildSmoothLinePath'],
	[4464, 4468, 'parseBlockyVersionFromMetrics'],
];

const configFns = [
	[3435, 3461, 'extractYamlSection'],
	[3463, 3470, 'parseYamlScalar'],
	[3472, 3481, 'parseYamlBool'],
	[3483, 3496, 'parseYamlListItems'],
	[3498, 3518, 'parseUpstreamGroupResolvers'],
	[3520, 3589, 'parseBlockySettings'],
	[3591, 3601, 'yamlQuote'],
	[3603, 3611, 'yamlListLines'],
	[3613, 3680, 'buildBlockySettingsYaml'],
	[3682, 3786, 'patchBlockingLoadingSection'],
];

function buildCore(header, fnBlocks, exportNames, extra) {
	const body = fnBlocks.map(([start, end]) => slice(start, end)).join('\n\n');
	const exports = exportNames.map((n) => `\t${n}: ${n}`).join(',\n');
	return `'use strict';\n\n${header}\n\n${body}\n\n${extra || ''}\nreturn {\n${exports}\n};\n`;
}

const formatDuration = `function formatDuration(seconds, notScheduledLabel) {
	var value = Number(seconds || 0);
	var minutes;
	var sec;

	if (!isFinite(value) || value <= 0)
		return notScheduledLabel || 'not scheduled';

	minutes = Math.floor(value / 60);
	sec = value % 60;

	return minutes + 'm ' + (sec < 10 ? '0' : '') + sec + 's';
}`;

const blockyPathFromUrl = `function blockyPathFromUrl(url, baseUrl) {
	var path = safeString(url).trim();
	baseUrl = safeString(baseUrl).trim();

	if (!path)
		return 'metrics';

	if (path.indexOf('http://') === 0 || path.indexOf('https://') === 0) {
		if (baseUrl && path.indexOf(baseUrl) === 0)
			path = path.slice(baseUrl.length);
		else {
			var m = path.match(/\\/\\/[^/]+(\\/.*)?$/);

			path = m && m[1] ? m[1] : '/metrics';
		}
	}

	path = path.replace(/^\\//, '');

	if (path === 'metrics' || path.indexOf('metrics?') === 0)
		return 'metrics';

	if (path.indexOf('api/') === 0)
		return path;

	return 'api/' + path;
}`;

const parseCsvRows = `function parseCsvRows(text) {
	var lines = safeString(text).split(/\\n/);
	var rows = [];
	var i;

	for (i = 0; i < lines.length; i++) {
		var line = lines[i].trim();

		if (!line || line.charAt(0) === '#')
			continue;

		var cols = line.split('\\t');
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
}`;

const parseBlockyStatsResponse = `function parseBlockyStatsResponse(res) {
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
}`;

const validateHttpRequest = `function validateHttpRequest(method, path, body) {
	method = safeString(method || 'GET').toUpperCase();

	if (method !== 'GET' && method !== 'POST')
		return null;

	path = safeString(path || 'metrics').trim();

	if (!/^[A-Za-z0-9_\\/.\-]+$/.test(path) || path.indexOf('..') !== -1)
		return null;

	if (body != null)
		body = String(body);

	return [ method, path, body ];
}`;

const allowedLogDir = `function allowedLogDir(target, allowRoot) {
	allowRoot = allowRoot || '/tmp/blocky-logs';
	target = safeString(target || allowRoot).replace(/\\/+$/, '');

	if (target !== allowRoot)
		return null;

	return target;
}`;

const isValidQueryLogFilename = `function isValidQueryLogFilename(name) {
	return /^[0-9]{4}-[0-9]{2}-[0-9]{2}_.*\\.log$/.test(safeString(name));
}`;

const pickLatestLogFilename = `function pickLatestLogFilename(names) {
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
}`;

const parseExportNames = parseFns.map((f) => f[2]).concat([
	'formatDuration',
	'blockyPathFromUrl',
	'parseCsvRows',
	'parseBlockyStatsResponse',
	'validateHttpRequest',
	'allowedLogDir',
	'isValidQueryLogFilename',
	'pickLatestLogFilename',
]);

const parseBody = parseFns.map(([start, end]) => slice(start, end)).join('\n\n');
const parseCore = `'use strict';\n\n${parseBody}\n\n${formatDuration}\n\n${blockyPathFromUrl}\n\n${parseCsvRows}\n\n${parseBlockyStatsResponse}\n\n${validateHttpRequest}\n\n${allowedLogDir}\n\n${isValidQueryLogFilename}\n\n${pickLatestLogFilename}\n\nreturn {\n${parseExportNames.map((n) => `\t${n}: ${n}`).join(',\n')}\n};\n`;

const configHeader = `'require blocky-parse-core as bp';

function safeString(value) {
	return bp.safeString(value);
}`;

const configBody = configFns.map(([start, end]) => {
	let block = slice(start, end);
	block = block.replace(/\bparseBlockyPortLine\b/g, 'bp.parseBlockyPortLine');
	return block;
}).join('\n\n');

const configExportNames = configFns.map((f) => f[2]);
const configCore = `'use strict';\n\n${configHeader}\n\n${configBody}\n\nreturn {\n${configExportNames.map((n) => `\t${n}: ${n}`).join(',\n')}\n};\n`;

fs.writeFileSync(PARSE_OUT, parseCore);
fs.writeFileSync(CONFIG_OUT, configCore);

console.log('Wrote', PARSE_OUT);
console.log('Wrote', CONFIG_OUT);
