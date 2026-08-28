#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const COMMON = path.join(__dirname, '..', 'htdocs/luci-static/resources/blocky-common.js');

const DELETE_RANGES = [
	[255, 260],
	[262, 274],
	[276, 297],
	[299, 306],
	[308, 342],
	[344, 358],
	[360, 364],
	[366, 374],
	[398, 400],
	[402, 404],
	[406, 441],
	[810, 812],
	[1023, 1025],
	[1038, 1045],
	[1047, 1054],
	[1056, 1066],
	[1068, 1078],
	[1080, 1107],
	[1185, 1196],
	[1198, 1203],
	[1280, 1292],
	[1406, 1444],
	[1446, 1479],
	[1481, 1486],
	[1488, 1501],
	[1503, 1512],
	[1514, 1530],
	[1532, 1566],
	[1568, 1584],
	[1614, 1620],
	[1622, 1636],
	[1638, 1671],
	[1673, 1677],
	[1679, 1683],
	[1685, 1702],
	[1704, 1718],
	[1720, 1749],
	[1751, 1766],
	[1768, 1781],
	[3435, 3786],
	[4464, 4468],
];

const ALIASES = `
var safeString = bp.safeString;
var execResultStdout = bp.execResultStdout;
var blockyCliStdout = bp.blockyCliStdout;
var parseDnsForwardFlag = bp.parseDnsForwardFlag;
var parseBlockyPortLine = bp.parseBlockyPortLine;
var parseBlockyPortValue = bp.parseBlockyPortValue;
var isLoopbackHost = bp.isLoopbackHost;
var blockyHttpBaseUrl = bp.blockyHttpBaseUrl;
var unwrapFsRead = bp.unwrapFsRead;
var emptyBlocklistCatalog = bp.emptyBlocklistCatalog;
var normalizeBlocklistCatalog = bp.normalizeBlocklistCatalog;
var sanitizeBlocklistId = bp.sanitizeBlocklistId;
var parseBlockyDnsPort = bp.parseBlockyDnsPort;
var formatNumber = bp.formatNumber;
var formatPercent = bp.formatPercent;
var parseJson = bp.parseJson;
var sumMapValues = bp.sumMapValues;
var sumDenylistEntries = bp.sumDenylistEntries;
var parseQueryLogConfig = bp.parseQueryLogConfig;
var parseMetrics = bp.parseMetrics;
var parseLabeledMetricGauge = bp.parseLabeledMetricGauge;
var parseDenylistGroupCounts = bp.parseDenylistGroupCounts;
var mergeDenyCounts = bp.mergeDenyCounts;
var metricValue = bp.metricValue;
var formatCompactNumber = bp.formatCompactNumber;
var deriveCumulative = bp.deriveCumulative;
var deriveOverview = bp.deriveOverview;
var filterSamplesByWindow = bp.filterSamplesByWindow;
var downsampleSamples = bp.downsampleSamples;
var bucketAggregateBars = bp.bucketAggregateBars;
var padChartTime2 = bp.padChartTime2;
var formatChartAxisTime = bp.formatChartAxisTime;
var samplesToXY = bp.samplesToXY;
var catmullRomPoint = bp.catmullRomPoint;
var densifyCatmullRom = bp.densifyCatmullRom;
var buildSmoothAreaPath = bp.buildSmoothAreaPath;
var buildSmoothLinePath = bp.buildSmoothLinePath;
var parseBlockyVersionFromMetrics = bp.parseBlockyVersionFromMetrics;

function formatDuration(seconds) {
	return bp.formatDuration(seconds, _('not scheduled'));
}

function blockyPathFromUrl(url) {
	return bp.blockyPathFromUrl(url, blockyApiAccess.baseUrl);
}
`;

let lines = fs.readFileSync(COMMON, 'utf8').split('\n');

DELETE_RANGES.sort((a, b) => b[0] - a[0]).forEach(([start, end]) => {
	lines.splice(start - 1, end - start + 1);
});

let text = lines.join('\n');

if (!text.includes("'require blocky-parse-core as bp';")) {
	text = text.replace(
		"'require uci';\n",
		"'require uci';\n'require blocky-parse-core as bp';\n'require blocky-config-core as bc';\n"
	);
}

if (!text.includes('var safeString = bp.safeString;')) {
	text = text.replace(
		/(\nvar CONFIG_PATH =)/,
		ALIASES + '\n$1'
	);
}

text = text.replace(
	/function fetchBlockyStats\(\) \{[\s\S]*?\}\)\.catch\(function\(\) \{\n\t\treturn \{ ok: false, disabled: false, data: null \};\n\t\}\);\n\}/,
	`function fetchBlockyStats() {
\treturn callBlockyHttpRequest('GET', 'api/stats', '').then(function(res) {
\t\treturn bp.parseBlockyStatsResponse(res);
\t}).catch(function() {
\t\treturn { ok: false, disabled: false, data: null };
\t});
}`
);

text = text.replace(
	/\tfunction parseCsvRows\(text\) \{[\s\S]*?\t\treturn rows\.reverse\(\);\n\t\}/,
	''
);

text = text.replace(
	/pageState\.rows = parseCsvRows\(res\.content \|\| ''\);/,
	'pageState.rows = bp.parseCsvRows(res.content || \'\');'
);

const REPLACEMENTS = [
	['extractYamlSection(', 'bc.extractYamlSection('],
	['parseYamlScalar(', 'bc.parseYamlScalar('],
	['parseYamlBool(', 'bc.parseYamlBool('],
	['parseYamlListItems(', 'bc.parseYamlListItems('],
	['parseUpstreamGroupResolvers(', 'bc.parseUpstreamGroupResolvers('],
	['parseBlockySettings(', 'bc.parseBlockySettings('],
	['yamlQuote(', 'bc.yamlQuote('],
	['yamlListLines(', 'bc.yamlListLines('],
	['buildBlockySettingsYaml(', 'bc.buildBlockySettingsYaml('],
	['patchBlockingLoadingSection(', 'bc.patchBlockingLoadingSection('],
];

REPLACEMENTS.forEach(([from, to]) => {
	const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
	text = text.replace(re, to);
});

fs.writeFileSync(COMMON, text);
console.log('Patched blocky-common.js');
