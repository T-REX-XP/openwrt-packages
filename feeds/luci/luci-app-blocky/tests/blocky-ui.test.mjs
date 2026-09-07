#!/usr/bin/env node
/**
 * Static checks for luci-app-blocky LuCI chrome (native tabs, footer save).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'htdocs/luci-static/resources');
const common = readFileSync(join(res, 'blocky-common.js'), 'utf8');
const base = readFileSync(join(res, 'blocky-base.js'), 'utf8');
const config = readFileSync(join(res, 'blocky-tab-config.js'), 'utf8');
const lists = readFileSync(join(res, 'blocky-tab-blocklists.js'), 'utf8');
const dashboard = readFileSync(join(res, 'blocky-tab-dashboard.js'), 'utf8');
const controls = readFileSync(join(res, 'blocky-tab-controls.js'), 'utf8');
const logs = readFileSync(join(res, 'blocky-tab-logs.js'), 'utf8');
const css = readFileSync(join(res, 'blocky-theme.css'), 'utf8');
const enPo = readFileSync(join(root, 'po/en/blocky.po'), 'utf8');
const ukPo = readFileSync(join(root, 'po/uk/blocky.po'), 'utf8');

let pass = 0;
let fail = 0;

function test(name, fn) {
	try {
		fn();
		pass++;
	}
	catch (e) {
		fail++;
		console.error(`FAIL ${name}:`, e.message);
	}
}

test('native Status / Settings / Query tabs', () => {
	assert.match(common, /data-tab-title':\s*_\('Status'\)/);
	assert.match(common, /data-tab-title':\s*_\('Statistics'\)/);
	assert.match(common, /data-tab-title':\s*_\('Block lists'\)/);
	assert.match(common, /data-tab-title':\s*_\('Settings'\)/);
	assert.match(common, /data-tab-title':\s*_\('Query'\)/);
	assert.match(common, /data-tab-title':\s*_\('Logs'\)/);
	assert.doesNotMatch(common, /title:\s*_\('Overview'\)/);
	assert.doesNotMatch(common, /title:\s*_\('Statistics'\)/);
	assert.doesNotMatch(common, /mountInnerTabs\(/);
	assert.match(common, /initTabGroup\(tabHost\.childNodes\)/);
	assert.doesNotMatch(common, /renderTabs\(/);
	assert.doesNotMatch(common, /blocky-tab-debug/);
	assert.doesNotMatch(common, /data-tab-title':\s*_\('Debug'\)/);
	assert.doesNotMatch(common, /data-tab-title':\s*_\('Configuration'\)/);
	assert.doesNotMatch(common, /data-tab-title':\s*_\('Dashboard'\)/);
});

test('footer Save & Apply writes settings', () => {
	assert.match(common, /handleSave:\s*function/);
	assert.match(common, /handleSaveApply:\s*function/);
	assert.match(common, /runSettingsApply\(false\)/);
	assert.match(common, /runSettingsApply\(true\)/);
	assert.match(common, /handleReset:\s*function/);
	assert.match(common, /uci\.revert\('blocky'\)/);
	assert.match(common, /_blockyRefreshPage/);
	const saveApply = common.slice(common.indexOf('handleSaveApply:'), common.indexOf('handleReset:'));
	assert.match(saveApply, /self\._blockyRefreshPage\(\)/);
	assert.doesNotMatch(saveApply, /return self\._blockyRefreshPage\(\)/);
	assert.match(base, /callBlockyGetMetrics\(\)/);
	assert.match(base, /fetchBlockyStats\(\)/);
	assert.doesNotMatch(base.slice(base.indexOf('function fetchBlockyStats'), base.indexOf('function setBlocking')), /callBlockyGetStatus/);
	assert.doesNotMatch(common, /handleReset:\s*null/);
	assert.match(base, /function setSettingsApplyHandler/);
	assert.match(base, /function runSettingsApply/);
	assert.match(config, /setSettingsApplyHandler/);
	assert.match(config, /_\('Apply this YAML'\)/);
	assert.doesNotMatch(config, /_\('Save settings'\)/);
	assert.doesNotMatch(config, /_\('Save YAML'\)/);
	assert.doesNotMatch(config, /_\('Save & restart Blocky'\)/);
	assert.doesNotMatch(lists, /_\('Save & restart Blocky'\)/);
	assert.doesNotMatch(common, /cbi-button-save/);
	assert.doesNotMatch(common, /admin\/services\/snort/);
	assert.doesNotMatch(common, /admin\/services\/suricata/);
});

test('inner Logs tabs and hero chrome', () => {
	assert.match(logs, /mountInnerTabs/);
	assert.match(logs, /id:\s*'querylog'/);
	assert.match(logs, /id:\s*'service'/);
	assert.doesNotMatch(logs, /function renderLogsSubTabs/);
	assert.match(css, /\.blocky-hero\b/);
	assert.match(css, /\.blocky-lead\b/);
	assert.match(css, /\.blocky-inner-tabs\b/);
	assert.match(base, /blocky-inner-tabs-panes/);
	assert.match(base, /initTabGroup\(wrap\.childNodes\)/);
	assert.match(base, /'class': 'blocky-inner-tabs'/);
	assert.match(base, /'type': 'button'/);
	assert.match(base, /expect:\s*\{\s*'':\s*\{\s*\}\s*\}/);
	assert.match(logs, /no query log files found/i);
	assert.match(logs, /No query log file yet/);
	assert.doesNotMatch(logs, /tmpfs \/ RAM note/);
	assert.doesNotMatch(logs, /blocky-query-log-tmpfs-note/);
});

test('Settings Logging includes query log fields', () => {
	const logging = config.slice(config.indexOf("id: 'logging'"), config.indexOf("id: 'security'"));

	assert.match(logging, /queryLogTarget/);
	assert.match(logging, /queryLogRetention/);
	assert.match(logging, /queryLogFlush/);
	assert.match(logging, /tmpfs \(RAM\)/);
	assert.doesNotMatch(config, /id:\s*'querylog'/);
	assert.doesNotMatch(config, /DNS query logging is configured separately below/);
	assert.match(logs, /Settings → Logging/);
});

test('Settings DNS tab merges router, upstream, bootstrap, cache, and listeners', () => {
	const dns = config.slice(config.indexOf("id: 'dns'"), config.indexOf("id: 'lists'"));

	assert.match(dns, /title:\s*_\('DNS'\)/);
	assert.match(dns, /renderRouterDnsIntegration/);
	assert.match(dns, /_\('Upstream DNS'\)/);
	assert.match(dns, /_\('Bootstrap DNS'\)/);
	assert.match(dns, /_\('DNS cache'\)/);
	assert.match(dns, /_\('Listeners'\)/);
	assert.doesNotMatch(config, /id:\s*'router'/);
	assert.doesNotMatch(config, /id:\s*'upstream'/);
	assert.doesNotMatch(config, /id:\s*'bootstrap'/);
	assert.doesNotMatch(config, /id:\s*'cache'/);
	assert.doesNotMatch(config, /id:\s*'listeners'/);
});

test('Settings Lists and Security absorb leftover sidebar items', () => {
	assert.match(config, /id:\s*'lists'/);
	assert.match(config, /title:\s*_\('Lists'\)/);
	assert.match(config, /_\('Hosts file sources'\)/);
	assert.match(config, /renderApiSecuritySection/);
	assert.doesNotMatch(config, /id:\s*'downloads'/);
	assert.doesNotMatch(config, /id:\s*'hosts'/);
	assert.doesNotMatch(config, /id:\s*'api'/);
});

test('Block lists grid stages UCI until Save & Apply', () => {
	assert.match(lists, /function labeledActionBtn/);
	assert.match(lists, /function iconBtn/);
	assert.match(lists, /ICON_GLYPHS/);
	assert.match(lists, /blocky-icon-row/);
	assert.match(lists, /blocky-col-actions/);
	assert.match(lists, /blocky-blocklists-wrap/);
	assert.match(lists, /_\('Add'\)/);
	assert.match(lists, /iconBtn\(_\('Edit'\), 'edit'/);
	assert.match(lists, /iconBtn\(_\('Delete'\), 'delete'/);
	assert.match(lists, /Save & Apply/);
	assert.match(lists, /uci\.set\('blocky', entry\.id, 'enabled'/);
	assert.doesNotMatch(lists, /function rowActionBtn/);
	assert.doesNotMatch(lists, /blocky-row-actions/);
	assert.doesNotMatch(lists, /applyBlocklistChanges/);
	assert.doesNotMatch(lists, /execBlockyListsSyncConfirmed/);
	assert.doesNotMatch(lists, /UCI block lists differ from config.yml/);
	assert.doesNotMatch(lists, /E\('svg'/);
	assert.doesNotMatch(lists, /cbi-button-edit/);
	assert.doesNotMatch(lists, /_\('Add blocklist'\)/);
	assert.match(css, /\.blocky-icon-btn\b/);
	assert.match(css, /\.blocky-icon-row\b/);
	assert.match(css, /\.blocky-col-actions\b/);
	assert.match(css, /\.blocky-blocklists-wrap\b/);
	assert.doesNotMatch(css, /\.blocky-row-actions\b/);
	assert.doesNotMatch(css, /\.blocky-col-actions \{[^}]*position:\s*sticky/);
});

test('no board-specific copy', () => {
	assert.doesNotMatch(common, /CM5/);
	assert.doesNotMatch(common, /2\.5 GbE/);
	assert.doesNotMatch(config, /CM5/);
});

test('service enable matches Snort/Suricata', () => {
	assert.match(dashboard, /function renderServiceStatus/);
	assert.match(dashboard, /_\('Service status'\)/);
	assert.match(dashboard, /_\('What to do next'\)/);
	assert.match(config, /_\('Enable Blocky'\)/);
	assert.match(config, /id': 'blocky-enabled'/);
	assert.match(base, /options.enabled === false/);
	assert.doesNotMatch(common, /System → Startup/);
	assert.doesNotMatch(dashboard, /Blocky filters DNS on the router/);
	assert.doesNotMatch(dashboard, /Clients keep using dnsmasq/);
	assert.doesNotMatch(dashboard, /actionButton\(_\('Start'\)/);
	assert.doesNotMatch(dashboard, /actionButton\(_\('Stop'\)/);
	assert.doesNotMatch(dashboard, /actionButton\(_\('Restart'\)/);
	assert.doesNotMatch(dashboard, /Enable at boot/);
	assert.doesNotMatch(dashboard, /Disable at boot/);
	assert.doesNotMatch(controls, /renderServiceControls/);
	assert.doesNotMatch(controls, /Enable at boot/);
	assert.doesNotMatch(dashboard, /renderServiceControls/);
	assert.doesNotMatch(lists, /UCI changed — sync to config.yml/);
	assert.doesNotMatch(lists, /UCI and config.yml in sync/);
	assert.doesNotMatch(lists, /repaintSyncPill/);
	assert.doesNotMatch(css, /blocky-blocklists-sync-host/);
	assert.doesNotMatch(enPo, /UCI and config.yml in sync/);
	assert.doesNotMatch(ukPo, /UCI and config.yml in sync/);
});

test('Status is glance-only; Statistics holds charts and operations', () => {
	const mountStatus = dashboard.slice(
		dashboard.indexOf('function mountDashboardContent'),
		dashboard.indexOf('function mountStatisticsContent')
	);
	const mountStats = dashboard.slice(
		dashboard.indexOf('function mountStatisticsContent'),
		dashboard.indexOf('function attachDashboardHostState')
	);

	assert.match(mountStatus, /renderServiceStatus/);
	assert.match(mountStatus, /renderDashboardStatsZone/);
	assert.match(mountStatus, /renderBlockingGlance/);
	assert.doesNotMatch(mountStatus, /renderOperations/);
	assert.doesNotMatch(mountStatus, /renderRealtimeMetrics/);
	assert.doesNotMatch(mountStatus, /renderAdBlockerPipeline/);
	assert.doesNotMatch(mountStatus, /renderStatsDashboard/);
	assert.match(mountStats, /renderOperations/);
	assert.match(mountStats, /renderStatisticsChartsZone/);
	assert.match(mountStats, /renderRealtimeMetrics/);
	assert.match(controls, /function renderBlockingGlance/);
	assert.match(controls, /_\('Refresh lists'\)/);
	assert.match(controls, /_\('Flush cache'\)/);
	assert.doesNotMatch(controls, /Maintenance actions are restricted/);
	const renderOps = controls.slice(controls.indexOf('function renderOperations'));
	assert.match(renderOps, /execBlockyListsRefresh\(\)/);
	assert.doesNotMatch(renderOps, /execBlockyListsSync\(\)/);
	assert.match(base, /'statistics': 1/);
});

test('metrics banner distinguishes RPC failure from empty samples', () => {
	assert.match(dashboard, /Could not read Blocky \/metrics/);
	assert.match(dashboard, /Waiting for Prometheus samples/);
	assert.match(dashboard, /Metrics payload was truncated/);
	assert.doesNotMatch(dashboard, /Enable prometheus in Blocky and confirm \/metrics responds/);
	assert.match(base, /blockyRtMetricsHook\(unwrapFetchText\(res\), '', !!\(res && res.truncated\)\)/);
});

test('Query tab uses named queryDns RPC', () => {
	const query = readFileSync(join(res, 'blocky-tab-query.js'), 'utf8');
	assert.match(query, /Blocky\.queryDns\(/);
	assert.doesNotMatch(query, /blockyApi\('\/query'/);
	assert.match(base, /method:\s*'queryDns'/);
	assert.match(base, /method:\s*'getMetrics'/);
	assert.match(base, /method:\s*'setBlocking'/);
	assert.match(base, /method:\s*'flushCache'/);
});

test('query and log placeholders use _()', () => {
	const query = readFileSync(join(res, 'blocky-tab-query.js'), 'utf8');
	assert.match(query, /'placeholder':\s*_\('example\.org'\)/);
	assert.match(logs, /'placeholder':\s*_\('example\.org'\)/);
	assert.match(logs, /'placeholder':\s*_\('192\.168\.1\.10'\)/);
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
