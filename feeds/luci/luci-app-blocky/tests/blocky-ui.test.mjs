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
	const logging = config.slice(config.indexOf("id: 'logging'"), config.indexOf("id: 'listeners'"));

	assert.match(logging, /queryLogTarget/);
	assert.match(logging, /queryLogRetention/);
	assert.match(logging, /queryLogFlush/);
	assert.match(logging, /tmpfs \(RAM\)/);
	assert.doesNotMatch(config, /id:\s*'querylog'/);
	assert.doesNotMatch(config, /DNS query logging is configured separately below/);
	assert.match(logs, /Settings → Logging/);
});

test('Settings DNS tab merges router, upstream, and bootstrap', () => {
	const dns = config.slice(config.indexOf("id: 'dns'"), config.indexOf("id: 'downloads'"));

	assert.match(dns, /title:\s*_\('DNS'\)/);
	assert.match(dns, /renderRouterDnsIntegration/);
	assert.match(dns, /_\('Upstream DNS'\)/);
	assert.match(dns, /_\('Bootstrap DNS'\)/);
	assert.doesNotMatch(config, /id:\s*'router'/);
	assert.doesNotMatch(config, /id:\s*'upstream'/);
	assert.doesNotMatch(config, /id:\s*'bootstrap'/);
});

test('Block lists grid stages UCI until Save & Apply', () => {
	assert.match(lists, /function labeledActionBtn/);
	assert.match(lists, /function rowActionBtn/);
	assert.match(lists, /blocky-row-actions/);
	assert.match(lists, /blocky-col-actions/);
	assert.match(lists, /blocky-blocklists-wrap/);
	assert.match(lists, /_\('Add'\)/);
	assert.match(lists, /cbi-button-neutral/);
	assert.match(lists, /cbi-button-negative/);
	assert.match(lists, /_\('Edit'\)/);
	assert.match(lists, /_\('Delete'\)/);
	assert.match(lists, /Save & Apply/);
	assert.match(lists, /uci\.set\('blocky', entry\.id, 'enabled'/);
	assert.doesNotMatch(lists, /ICON_GLYPHS/);
	assert.doesNotMatch(lists, /function iconBtn/);
	assert.doesNotMatch(lists, /blocky-icon-btn/);
	assert.doesNotMatch(lists, /applyBlocklistChanges/);
	assert.doesNotMatch(lists, /execBlockyListsSyncConfirmed/);
	assert.doesNotMatch(lists, /UCI block lists differ from config.yml/);
	assert.doesNotMatch(lists, /E\('svg'/);
	assert.doesNotMatch(lists, /cbi-button-edit/);
	assert.doesNotMatch(lists, /_\('Add blocklist'\)/);
	assert.match(css, /\.blocky-row-actions\b/);
	assert.match(css, /\.blocky-col-actions\b/);
	assert.match(css, /\.blocky-blocklists-wrap\b/);
	assert.doesNotMatch(css, /\.blocky-icon-btn\b/);
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
	assert.doesNotMatch(dashboard, /Enable prometheus in Blocky and confirm \/metrics responds/);
	assert.match(base, /blockyRtMetricsHook\(unwrapFetchText\(res\), ''\)/);
});

test('query and log placeholders use _()', () => {
	const query = readFileSync(join(res, 'blocky-tab-query.js'), 'utf8');
	assert.match(query, /'placeholder':\s*_\('example\.org'\)/);
	assert.match(logs, /'placeholder':\s*_\('example\.org'\)/);
	assert.match(logs, /'placeholder':\s*_\('192\.168\.1\.10'\)/);
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
