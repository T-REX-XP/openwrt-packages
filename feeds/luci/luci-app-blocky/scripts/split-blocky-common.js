#!/usr/bin/env node
/**
 * Split blocky-common.js into blocky-base.js + tab modules + thin common shell.
 * Run: node scripts/split-blocky-common.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RES = path.join(ROOT, 'htdocs/luci-static/resources');
const COMMON = path.join(RES, 'blocky-common.js');

const MODULES = {
	'blocky-base.js': new Set([
		'formatDuration', 'blockyPathFromUrl', 'blockyPill', 'blockyLegendDot', 'blockyStatusDetail', 'blockyRpcOk', 'blockyRpcError',
		'notify', 'actionButton', 'replaceContent', 'appendContentNode', 'applyBlockyApiAccess',
		'loadBlockyUciAccess', 'loadBlocklistCatalog', 'blockyPresetHomeUrl', 'blockyCloseModal',
		'blockyOpenModal', 'blockyModalFooterCancel', 'blockyModalFooterSave', 'execBlockyListsSync',
		'execBlockyListsRefresh', 'applyBlocklistChanges', 'refreshBlockyLists', 'resolveDenyCount',
		'execDnsmasqSync', 'blockyHttpRequest', 'fetchText', 'unwrapFetchText', 'fetchJson', 'blockyApi',
		'blockyMetricsUrl', 'fetchBlockyStats', 'mapToBarRows', 'topListBarRow',
		'registerBlockingCountdownPoll', 'shellQuote', 'runInit', 'isRunning', 'isNamedServiceRunning',
		'registerBlockyMetricsPolling', 'setBlockyMetricsPollingHook', 'renderTabs', 'loadBlockyPageData',
		'resolveBlockyVersion', 'renderBlockyVersionBadge', 'resolveDefaultTabFromHash'
	]),
	'blocky-tab-blocklists.js': new Set([
		'addBlocklistsFromPresets', 'saveCustomBlocklist', 'openCustomBlocklistModal', 'openCatalogModal',
		'openNewBlocklistModal', 'sanitizeBlocklistId', 'loadUciBlocklists', 'renderBlocklistsTab'
	]),
	'blocky-tab-stats.js': new Set([
		'renderOverview', 'renderStatsHourlyChart', 'renderStatsTopLists', 'renderMapBreakdown',
		'renderStatsBreakdown', 'renderListInventory', 'renderCacheWidget', 'renderStatsDashboard',
		'renderStatusDashboard', 'renderStatisticsTab', 'renderClientTableRows', 'renderTopClientsPanel',
		'renderTopDomainColumn', 'renderTopDomainsStack', 'renderStatRow', 'renderGeneralStatisticsPanel',
		'renderDashboardSummaryGrid', 'gatherOverviewMetrics'
	]),
	'blocky-tab-dashboard.js': new Set([
		'blockyThemeRoot', 'blockyCssVar', 'blockyChartColor', 'blockyChartFill',
		'applyBlockyChartPathTheme', 'blockyAttachThemeSync', 'blockyInjectStyles',
		'renderAdBlockerPipeline', 'buildQueriesChartUnderlay', 'buildQueriesChartAxisLabels',
		'renderDashboardStatsZone', 'renderRealtimeMetrics', 'mountDashboardContent',
		'attachDashboardHostState', 'registerStatsPoll'
	]),
	'blocky-tab-config.js': new Set([
		'renderApiSecuritySection', 'renderRouterDnsIntegration', 'settingsRow', 'settingsPanel',
		'configSectionPage', 'renderBlockyConfigLayout', 'readBlockySettingsForm', 'saveBlockySettingsForm',
		'renderBlockySettingsForm', 'renderBlockySettingsPage', 'renderConfigYamlAdvanced'
	]),
	'blocky-tab-controls.js': new Set([
		'renderBlockingControls', 'renderOperations', 'renderServiceControls'
	]),
	'blocky-tab-query.js': new Set([
		'renderQueryResult', 'renderQuery'
	]),
	'blocky-tab-logs.js': new Set([
		'renderQueryLogsTab'
	])
};

const TAB_KEYS = {
	'blocky-tab-blocklists.js': 'blocklists',
	'blocky-tab-stats.js': 'stats',
	'blocky-tab-dashboard.js': 'dashboard',
	'blocky-tab-config.js': 'config',
	'blocky-tab-controls.js': 'controls',
	'blocky-tab-query.js': 'query',
	'blocky-tab-logs.js': 'logs'
};

const TAB_ALIAS = {
	blocklists: 'tabBlocklists',
	stats: 'tabStats',
	dashboard: 'tabDashboard',
	config: 'tabConfig',
	controls: 'tabControls',
	query: 'tabQuery',
	logs: 'tabLogs'
};

const TAB_REQUIRE = {
	blocklists: 'blocky-tab-blocklists as tabBlocklists',
	stats: 'blocky-tab-stats as tabStats',
	dashboard: 'blocky-tab-dashboard as tabDashboard',
	config: 'blocky-tab-config as tabConfig',
	controls: 'blocky-tab-controls as tabControls',
	query: 'blocky-tab-query as tabQuery',
	logs: 'blocky-tab-logs as tabLogs'
};

/** Skip Blocky destructuring for symbols defined in the same tab file (would overwrite locals). */
function tabLocalExports(file, body) {
	const manual = {
		'blocky-tab-dashboard.js': [
			'blockyThemeRoot', 'blockyCssVar', 'blockyChartColor', 'blockyChartFill',
			'blockyLegendDot', 'applyBlockyChartPathTheme', 'blockyAttachThemeSync'
		]
	};
	const skip = new Set(manual[file] || []);
	for (const m of body.matchAll(/^function (\w+)/gm))
		skip.add(m[1]);
	return skip;
}

const COMMON_DESTRUCT = [
	'loadBlockyPageData', 'resolveDefaultTabFromHash', 'renderBlockyVersionBadge',
	'resolveBlockyVersion', 'parseBlockyVersionFromMetrics', 'blockyCliStdout', 'execResultStdout',
	'unwrapFetchText', 'EMPTY_BLOCKLIST_CATALOG', 'notify', 'renderTabs', 'BLOCKY_TAB_HASH_KEYS'
];

function extractConstants(text) {
	const lines = text.split('\n');
	const out = [];
	let collecting = false;

	for (const line of lines) {
		if (/^var CONFIG_PATH/.test(line))
			collecting = true;
		if (!collecting)
			continue;
		if (/^function blockyThemeRoot/.test(line))
			break;
		out.push(line);
	}
	return out.join('\n');
}

function moduleForFunction(name) {
	for (const [mod, names] of Object.entries(MODULES)) {
		if (names.has(name))
			return mod;
	}
	return null;
}

function parseSegments(text) {
	const lines = text.split('\n');
	const segments = [];
	let i = 0;

	while (i < lines.length && !/^function formatDuration/.test(lines[i]))
		i++;

	let preamble = [];
	let depth = 0;
	let cur = null;

	function flushPreamble() {
		if (!preamble.length)
			return;
		segments.push({ type: 'vars', lines: preamble.slice() });
		preamble = [];
	}

	for (; i < lines.length; i++) {
		const line = lines[i];

		if (/^function createBlockyView/.test(line))
			break;

		if (/^function ([A-Za-z0-9_]+)/.test(line) && depth === 0) {
			flushPreamble();
			if (cur) {
				segments.push(cur);
				cur = null;
			}
			cur = {
				type: 'function',
				name: line.match(/^function ([A-Za-z0-9_]+)/)[1],
				lines: [line]
			};
		}
		else if (/^var [A-Za-z_][A-Za-z0-9_]*/.test(line) && depth === 0) {
			if (cur) {
				segments.push(cur);
				cur = null;
			}
			preamble.push(line);
		}
		else if (cur) {
			cur.lines.push(line);
		}
		else if (preamble.length) {
			preamble.push(line);
		}
		else if (depth === 0 && line.trim())
			preamble.push(line);

		for (const ch of line) {
			if (ch === '{')
				depth++;
			if (ch === '}')
				depth--;
		}

		if (cur && depth === 0 && cur.lines.length > 1) {
			segments.push(cur);
			cur = null;
		}
	}

	flushPreamble();
	return { segments, createStart: i };
}

function extractHeader(text) {
	const lines = text.split('\n');
	const out = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^function formatDuration/.test(line))
			break;
		if (/^'require baseclass'/.test(line) || /^'require view'/.test(line))
			continue;
		out.push(line);
	}
	return out.join('\n');
}

function rewriteCrossModuleCalls(body, currentModule) {
	let out = body;
	const groups = [
		['blocky-tab-blocklists.js', 'blocklists', MODULES['blocky-tab-blocklists.js']],
		['blocky-tab-stats.js', 'stats', MODULES['blocky-tab-stats.js']],
		['blocky-tab-dashboard.js', 'dashboard', MODULES['blocky-tab-dashboard.js']],
		['blocky-tab-config.js', 'config', MODULES['blocky-tab-config.js']],
		['blocky-tab-controls.js', 'controls', MODULES['blocky-tab-controls.js']]
	];
	const useBlockyTabs = currentModule === 'blocky-common.js';

	for (const [mod, key, names] of groups) {
		if (currentModule === mod)
			continue;
		const prefix = useBlockyTabs ? ('BlockyTabs.' + key) : TAB_ALIAS[key];
		for (const name of names)
			out = out.replace(new RegExp('\\b' + name + '\\(', 'g'), prefix + '.' + name + '(');
	}
	if (currentModule !== 'blocky-tab-query.js') {
		const queryPrefix = useBlockyTabs ? 'BlockyTabs.query' : TAB_ALIAS.query;
		out = out.replace(/\brenderQuery\(/g, queryPrefix + '.renderQuery(');
		out = out.replace(/\brenderQueryResult\(/g, queryPrefix + '.renderQueryResult(');
	}
	if (currentModule !== 'blocky-tab-logs.js') {
		const logsPrefix = useBlockyTabs ? 'BlockyTabs.logs' : TAB_ALIAS.logs;
		out = out.replace(/\brenderQueryLogsTab\(/g, logsPrefix + '.renderQueryLogsTab(');
	}

	if (useBlockyTabs) {
		out = out.replace(/\bblockyInjectStyles\(/g, 'BlockyTabs.dashboard.blockyInjectStyles(');
		for (const name of MODULES['blocky-base.js']) {
			if (COMMON_DESTRUCT.indexOf(name) >= 0)
				continue;
			out = out.replace(new RegExp('\\b' + name + '\\(', 'g'), 'Blocky.' + name + '(');
		}
	}

	return out;
}

function crossTabRequires(currentModule, body) {
	const keys = new Set();

	for (const [key, alias] of Object.entries(TAB_ALIAS)) {
		if (TAB_KEYS[currentModule] === key)
			continue;
		if (new RegExp('\\b' + alias + '\\.').test(body))
			keys.add(key);
	}

	return [...keys].sort().map((key) => "'require " + TAB_REQUIRE[key] + "';").join('\n');
}

function tabDestructuring(file, body) {
	const skip = tabLocalExports(file, body);
	const names = [
		'safeString', 'execResultStdout', 'blockyCliStdout', 'parseDnsForwardFlag', 'parseBlockyPortLine',
		'parseBlockyPortValue', 'isLoopbackHost', 'blockyHttpBaseUrl', 'unwrapFsRead', 'emptyBlocklistCatalog',
		'normalizeBlocklistCatalog', 'sanitizeBlocklistId', 'parseBlockyDnsPort', 'formatNumber', 'formatPercent',
		'parseJson', 'sumMapValues', 'sumDenylistEntries', 'parseQueryLogConfig', 'parseMetrics',
		'mergeDenyCounts', 'parseDenylistGroupCounts', 'metricValue', 'formatCompactNumber', 'deriveOverview',
		'deriveCumulative', 'filterSamplesByWindow', 'downsampleSamples', 'bucketAggregateBars', 'padChartTime2',
		'formatChartAxisTime', 'samplesToXY', 'catmullRomPoint', 'densifyCatmullRom', 'buildSmoothAreaPath',
		'buildSmoothLinePath', 'parseBlockyVersionFromMetrics', 'formatDuration', 'blockyPathFromUrl',
		'CONFIG_PATH', 'blockyApiAccess', 'RECORD_TYPES', 'PAUSE_PRESETS', 'EMPTY_BLOCKLIST_CATALOG',
		'BLOCKLIST_CATALOG_PATH', 'REALTIME_WINDOWS', 'BLOCKY_CHART_FALLBACK', 'callBlockySyncLists',
		'callBlockyRefreshLists', 'callBlockyHttpRequest', 'callBlockyReadQueryLog', 'callBlockyGetVersion',
		'callServiceList', 'notify', 'actionButton', 'replaceContent', 'applyBlockyApiAccess', 'applyBlocklistChanges',
		'refreshBlockyLists', 'execBlockyListsSync', 'execBlockyListsRefresh', 'loadBlocklistCatalog',
		'loadUciBlocklists', 'blockyCloseModal', 'blockyOpenModal', 'blockyModalFooterCancel', 'blockyModalFooterSave',
		'blockyPresetHomeUrl', 'blockyRpcOk', 'blockyRpcError', 'blockyApi', 'blockyHttpRequest', 'fetchText',
		'unwrapFetchText', 'fetchJson', 'blockyMetricsUrl', 'fetchBlockyStats', 'runInit', 'isRunning',
		'isNamedServiceRunning', 'setBlockyMetricsPollingHook', 'execDnsmasqSync', 'shellQuote',
		'blockyPill', 'blockyStatusDetail', 'blockyLegendDot', 'blockyChartColor', 'blockyChartFill',
		'blockyCssVar', 'blockyThemeRoot', 'applyBlockyChartPathTheme', 'blockyAttachThemeSync',
		'registerBlockingCountdownPoll', 'topListBarRow', 'mapToBarRows', 'resolveDenyCount', 'bc', 'bp'
	].filter((n) => !skip.has(n));
	return 'var ' + names.map((n) => n + ' = Blocky.' + n).join(',\n\t') + ';\n';
}

function main() {
	const text = fs.readFileSync(COMMON, 'utf8');
	const header = extractHeader(text);
	const { segments, createStart } = parseSegments(text);
	const byModule = {};

	for (const seg of segments) {
		if (seg.type === 'vars') {
			byModule['blocky-base.js'] = (byModule['blocky-base.js'] || []);
			byModule['blocky-base.js'].push(seg);
			continue;
		}
		const mod = moduleForFunction(seg.name);
		if (!mod)
			throw new Error('Unassigned function: ' + seg.name);
		if (!byModule[mod])
			byModule[mod] = [];
		byModule[mod].push(seg);
	}

	const baseRequires = `'use strict';
'require fs';
'require rpc';
'require ui';
'require poll';
'require uci';
'require blocky-parse-core as bp';
'require blocky-config-core as bc';
'require baseclass';
`;

	const baseParts = (byModule['blocky-base.js'] || [])
		.filter((seg) => !(seg.type === 'vars' && /^var CONFIG_PATH/.test(seg.lines[0])))
		.map((seg) => seg.lines.join('\n'));
	const baseExports = (byModule['blocky-base.js'] || [])
		.filter((seg) => seg.type === 'function')
		.map((seg) => seg.name);
	const constants = extractConstants(text);
	const baseFile = baseRequires + '\n' +
		header.replace(/^'use strict';\n/, '').replace(/^('require [^']+';\n)+/m, '') + '\n' +
		constants + '\n' +
		baseParts.join('\n\n') + '\n\nreturn baseclass.extend({\n' +
		baseExports.map((n) => '\t' + n + ': ' + n).join(',\n') +
		',\n\tCONFIG_PATH: CONFIG_PATH,\n\tblockyApiAccess: blockyApiAccess,\n\tRECORD_TYPES: RECORD_TYPES,\n\tPAUSE_PRESETS: PAUSE_PRESETS,\n\tEMPTY_BLOCKLIST_CATALOG: EMPTY_BLOCKLIST_CATALOG,\n\tBLOCKLIST_CATALOG_PATH: BLOCKLIST_CATALOG_PATH,\n\tBLOCKY_CHART_FALLBACK: BLOCKY_CHART_FALLBACK,\n\tBLOCKY_TAB_HASH: BLOCKY_TAB_HASH,\n\tBLOCKY_TAB_HASH_KEYS: BLOCKY_TAB_HASH_KEYS,\n\tREALTIME_WINDOWS: REALTIME_WINDOWS,\n\tcallServiceList: callServiceList,\n\tcallBlockySyncLists: callBlockySyncLists,\n\tcallBlockyRefreshLists: callBlockyRefreshLists,\n\tcallBlockyHttpRequest: callBlockyHttpRequest,\n\tcallBlockyReadQueryLog: callBlockyReadQueryLog,\n\tcallBlockyGetVersion: callBlockyGetVersion,\n\tbp: bp,\n\tbc: bc,\n\t' +
		'safeString: bp.safeString,\n\texecResultStdout: bp.execResultStdout,\n\tblockyCliStdout: bp.blockyCliStdout,\n\t' +
		'parseDnsForwardFlag: bp.parseDnsForwardFlag,\n\tparseBlockyPortLine: bp.parseBlockyPortLine,\n\t' +
		'parseBlockyPortValue: bp.parseBlockyPortValue,\n\tisLoopbackHost: bp.isLoopbackHost,\n\t' +
		'blockyHttpBaseUrl: bp.blockyHttpBaseUrl,\n\tunwrapFsRead: bp.unwrapFsRead,\n\t' +
		'emptyBlocklistCatalog: bp.emptyBlocklistCatalog,\n\tnormalizeBlocklistCatalog: bp.normalizeBlocklistCatalog,\n\t' +
		'sanitizeBlocklistId: bp.sanitizeBlocklistId,\n\tparseBlockyDnsPort: bp.parseBlockyDnsPort,\n\t' +
		'formatNumber: bp.formatNumber,\n\tformatPercent: bp.formatPercent,\n\tparseJson: bp.parseJson,\n\t' +
		'sumMapValues: bp.sumMapValues,\n\tsumDenylistEntries: bp.sumDenylistEntries,\n\t' +
		'parseQueryLogConfig: bp.parseQueryLogConfig,\n\tparseMetrics: bp.parseMetrics,\n\t' +
		'parseDenylistGroupCounts: bp.parseDenylistGroupCounts,\n\tmergeDenyCounts: bp.mergeDenyCounts,\n\t' +
		'metricValue: bp.metricValue,\n\tformatCompactNumber: bp.formatCompactNumber,\n\t' +
		'deriveCumulative: bp.deriveCumulative,\n\tderiveOverview: bp.deriveOverview,\n\t' +
		'filterSamplesByWindow: bp.filterSamplesByWindow,\n\t' +
		'downsampleSamples: bp.downsampleSamples,\n\tbucketAggregateBars: bp.bucketAggregateBars,\n\t' +
		'padChartTime2: bp.padChartTime2,\n\tformatChartAxisTime: bp.formatChartAxisTime,\n\t' +
		'samplesToXY: bp.samplesToXY,\n\tcatmullRomPoint: bp.catmullRomPoint,\n\t' +
		'densifyCatmullRom: bp.densifyCatmullRom,\n\tbuildSmoothAreaPath: bp.buildSmoothAreaPath,\n\t' +
		'buildSmoothLinePath: bp.buildSmoothLinePath,\n\tparseBlockyVersionFromMetrics: bp.parseBlockyVersionFromMetrics\n});\n';
	fs.writeFileSync(path.join(RES, 'blocky-base.js'), baseFile);

	const tabRequires = `'use strict';
'require ui';
'require uci';
'require fs';
'require poll';
'require blocky-base as Blocky';
'require baseclass';
`;

	for (const [file, key] of Object.entries(TAB_KEYS)) {
		const list = byModule[file] || [];
		const body = list.map((seg) => rewriteCrossModuleCalls(seg.lines.join('\n'), file)).join('\n\n');
		const exports = list.filter((seg) => seg.type === 'function').map((seg) => seg.name);
		const extraRequires = crossTabRequires(file, body);
		const tabFile = tabRequires +
			(extraRequires ? extraRequires + '\n' : '') +
			tabDestructuring(file, body) + '\n' + body + '\n\nreturn baseclass.extend({\n' +
			exports.map((n) => '\t' + n + ': ' + n).join(',\n') + '\n});\n';
		fs.writeFileSync(path.join(RES, file), tabFile);
	}

	const createLines = text.split('\n').slice(createStart);
	let createBody = createLines.join('\n');
	createBody = rewriteCrossModuleCalls(createBody, 'blocky-common.js');

	const commonDestruct = 'var ' + COMMON_DESTRUCT.map((n) => n + ' = Blocky.' + n).join(',\n\t') + ';\n';

	const commonFile = `'use strict';
'require view';
'require blocky-base as Blocky';
'require blocky-tab-blocklists as tabBlocklists';
'require blocky-tab-stats as tabStats';
'require blocky-tab-dashboard as tabDashboard';
'require blocky-tab-config as tabConfig';
'require blocky-tab-controls as tabControls';
'require blocky-tab-query as tabQuery';
'require blocky-tab-logs as tabLogs';
'require baseclass';

var BlockyTabs = {
	blocklists: tabBlocklists,
	stats: tabStats,
	dashboard: tabDashboard,
	config: tabConfig,
	controls: tabControls,
	query: tabQuery,
	logs: tabLogs
};

` + commonDestruct + '\n' + createBody + '\n';

	fs.writeFileSync(COMMON, commonFile);

	for (const file of ['blocky-base.js', ...Object.keys(TAB_KEYS), 'blocky-common.js']) {
		const p = path.join(RES, file);
		console.log(fs.readFileSync(p, 'utf8').split('\n').length + '\t' + file);
	}
}

main();
