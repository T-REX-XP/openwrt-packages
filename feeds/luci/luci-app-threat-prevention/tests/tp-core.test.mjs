#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const res = join(dir, '..', 'htdocs', 'luci-static', 'resources');
const viewPath = join(res, 'view', 'services', 'threat-prevention.js');
const ucodePath = join(dir, '..', 'root', 'usr', 'share', 'rpcd', 'ucode', 'luci.threat-prevention.uc');

function loadCore() {
	let src = readFileSync(join(res, 'threat-prevention-core.js'), 'utf8');
	src = src.replace(/^'use strict';\n?/, '');
	src = src.replace(/^'require baseclass';\n?/, '');
	const fn = new Function('baseclass', src);
	return fn({ extend: (obj) => obj });
}

const core = loadCore();
const view = readFileSync(viewPath, 'utf8');
const ucode = readFileSync(ucodePath, 'utf8');
let pass = 0;
let fail = 0;

function test(name, fn) {
	try {
		fn();
		pass++;
	} catch (e) {
		fail++;
		console.error('FAIL', name + ':', e.message);
	}
}

test('collectSettings wraps HOME_NET and keeps enabled', () => {
	const got = core.collectSettings({
		enabled: true,
		interface: 'br-lan',
		home_net: '192.168.8.0/24',
		rule_profile: 'small',
		feeds: core.defaultFeeds(),
		mode: 'ids'
	});
	assert.equal(got.error, undefined);
	assert.equal(got.config.enabled, '1');
	assert.equal(got.config.home_net, '[192.168.8.0/24]');
	assert.equal(got.config.interface, 'br-lan');
	assert.equal(got.config.mode, 'ids');
	assert.equal(got.config.feeds.length, 1);
	assert.equal(got.config.etopen_url, undefined);
});

test('collectSettings unwraps already-bracketed HOME_NET', () => {
	const got = core.collectSettings({
		enabled: false,
		interface: 'eth0',
		home_net: '[192.168.8.0/24]',
		rule_profile: 'small',
		feeds: core.defaultFeeds(),
		mode: 'ids'
	});
	assert.equal(got.config.home_net, '[192.168.8.0/24]');
	assert.equal(got.config.enabled, '0');
});

test('empty interface and HOME_NET are invalid', () => {
	assert.equal(core.validateField('interface', ''), 'invalid interface');
	assert.equal(core.validateField('home_net', ''), 'invalid home_net');
	assert.equal(core.validateField('home_net', '[]'), 'invalid home_net');
	assert.equal(core.validateField('interface', 'eth0;rm'), 'invalid interface');
});

test('idsDeviceNames filters lo/alias and keeps current', () => {
	assert.deepEqual(core.idsDeviceNames([
		{ name: 'lo', type: 'ethernet' },
		{ name: 'br-lan', type: 'bridge' },
		{ name: 'eth0', type: 'ethernet' },
		{ name: '@lan', type: 'alias' },
		{ name: 'radio0.network1', type: 'wifi' }
	], 'gone0'), ['br-lan', 'eth0', 'gone0']);
	assert.deepEqual(core.idsDeviceNames([], ''), ['br-lan']);
});

test('hostCidrToNetwork converts host CIDR to network', () => {
	assert.equal(core.hostCidrToNetwork('192.168.8.1/24'), '192.168.8.0/24');
	assert.equal(core.hostCidrToNetwork('bad'), null);
});

test('view uses network devices select and footer save', () => {
	assert.match(view, /'require network'/);
	assert.match(view, /'require threat-prevention-core as tpCore'/);
	assert.match(view, /network\.getDevices\(\)/);
	assert.match(view, /ifaceSelect\('tp-iface'/);
	assert.doesNotMatch(view, /type:\s*'text',\s*id:\s*'tp-iface'/);
	assert.match(view, /handleSave:\s*function/);
	assert.match(view, /handleSaveApply:\s*function/);
	assert.doesNotMatch(view, /_\('Save & apply'\)/);
	assert.doesNotMatch(view, /cbi-button-save/);
	assert.doesNotMatch(view, /admin\/services\/blocky/);
	assert.doesNotMatch(view, /admin\/services\/snort/);
	assert.doesNotMatch(view, /tp-cross/);
	assert.match(view, /expect:\s*\{\s*'':\s*\{\s*\}\s*\}/);
	assert.match(view, /id:\s*'tp-mode'/);
	assert.doesNotMatch(view, /id:\s*'tp-url-preset'/);
	assert.doesNotMatch(view, /id:\s*'tp-url'/);
	assert.match(view, /data-tab-title':\s*_\('Rules'\)/);
	assert.match(view, /_\('Add'\)/);
	assert.match(view, /_\('Fetch now'\)/);
	assert.match(view, /callSetConfig\(\{ feeds:/);
	assert.match(view, /cbi-value-title/);
	assert.match(view, /_\('What to do next'\)/);
	assert.doesNotMatch(view, /CM5/);
	assert.doesNotMatch(view, /2\.5 GbE/);
	assert.match(view, /callSetRuleState/);
	assert.doesNotMatch(view, /DEFAULT_LAN_CIDR/);
	assert.doesNotMatch(view, /Prefer the small profile on CM5/);
	assert.doesNotMatch(readFileSync(join(res, 'threat-prevention-core.js'), 'utf8'), /DEFAULT_LAN_CIDR/);
	const buttons = [...view.matchAll(/E\('button',\s*\{([^}]+)\}/g)];
	assert.ok(buttons.length >= 3, 'expected settings/service buttons');
	for (const m of buttons)
		assert.match(m[1], /'type':\s*'button'/);
});

test('ucode still validates interface names', () => {
	assert.ok(ucode.includes('interface: /^[A-Za-z0-9_.-]+$/'));
	assert.match(ucode, /getRules:/);
	assert.match(ucode, /setRuleState:/);
	assert.match(ucode, /reindexRules:/);
	assert.match(ucode, /function like_safe/);
	assert.match(ucode, /function feed_url_ok/);
	assert.doesNotMatch(ucode, /FEED_URL_RE/);
});

test('rule query helpers', () => {
	assert.equal(core.sanitizeRuleQuery("foo%'bar"), 'foobar');
	assert.equal(core.clampRuleLimit(0), 50);
	assert.equal(core.clampRuleLimit(500), 100);
	assert.equal(core.validSid('2020001'), true);
	assert.equal(core.validSid('sid;drop'), false);
});

test('feed helpers', () => {
	const def = core.defaultFeeds();
	assert.equal(def.length, 1);
	assert.equal(def[0].url, core.ETOPEN_OFFICIAL);
	assert.equal(core.sanitizeFeedId('Official ET Open 8.0'), 'official_et_open_8_0');
	assert.equal(core.sanitizeFeedId('main'), 'et_main');
	assert.equal(core.sanitizeFeedId('s2020001'), 'et_s2020001');
	assert.equal(core.validateFeed({ name: 'x', url: 'http://x', enabled: '1' }), 'invalid feed url');
	assert.equal(core.validateFeeds(def), null);
});

console.log(`Results: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
