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
const logs = readFileSync(join(res, 'blocky-tab-logs.js'), 'utf8');
const css = readFileSync(join(res, 'blocky-theme.css'), 'utf8');

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
	assert.match(common, /data-tab-title':\s*_\('Block lists'\)/);
	assert.match(common, /data-tab-title':\s*_\('Settings'\)/);
	assert.match(common, /data-tab-title':\s*_\('Query'\)/);
	assert.match(common, /data-tab-title':\s*_\('Logs'\)/);
	assert.match(common, /title:\s*_\('Overview'\)/);
	assert.match(common, /title:\s*_\('Statistics'\)/);
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
	assert.match(base, /'type': 'button'/);
	assert.match(base, /expect:\s*\{\s*'':\s*\{\s*\}\s*\}/);
});

test('no board-specific copy', () => {
	assert.doesNotMatch(common, /CM5/);
	assert.doesNotMatch(common, /2\.5 GbE/);
	assert.doesNotMatch(config, /CM5/);
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
