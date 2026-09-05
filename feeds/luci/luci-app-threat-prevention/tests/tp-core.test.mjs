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
	assert.match(view, /_\('Suricata'\)/);
	assert.doesNotMatch(view, /_\('Threat Prevention'\)/);
	assert.doesNotMatch(view, /CM5/);
	assert.doesNotMatch(view, /2\.5 GbE/);
	assert.match(view, /callSetRuleStates/);
	assert.match(view, /callSetRuleTune/);
	assert.match(view, /callGetPolicies/);
	assert.match(view, /callSetPolicies/);
	assert.match(view, /_\('Rules management'\)/);
	assert.match(view, /_\('Enable selected'\)/);
	assert.match(view, /_\('Disable selected'\)/);
	assert.match(view, /callSetPolicies\(policies\)/);
	assert.match(view, /function collectPolicies/);
	assert.doesNotMatch(view, /_\('Save policies'\)/);
	assert.match(view, /_\('Reset rulesets to profile'\)/);
	assert.match(view, /_\('SID:rev'\)/);
	assert.match(view, /_\('Tags'\)/);
	assert.match(view, /tp-icon-btn/);
	assert.doesNotMatch(view, /tp-rule-quick/);
	assert.doesNotMatch(view, /_\('Quick actions'\)/);
	assert.match(view, /id:\s*'tp-tune-status'/);
	assert.match(view, /id:\s*'tp-tune-threshold'/);
	assert.match(view, /actionSelect\('tp-tune-action'/);
	assert.doesNotMatch(view, /Cluster/);
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
	assert.match(ucode, /setRuleStates:/);
	assert.match(ucode, /setRuleTune:/);
	assert.match(ucode, /setPolicies:/);
	assert.match(ucode, /getPolicies:/);
	assert.match(ucode, /function read_sid_tune/);
	assert.match(ucode, /function replace_policies/);
	assert.doesNotMatch(ucode, /\{[0-9]+,/);
	assert.match(ucode, /reindexRules:/);
	assert.match(ucode, /function like_safe/);
	assert.match(ucode, /function feed_url_ok/);
	assert.doesNotMatch(ucode, /FEED_URL_RE/);
	function fnPos(name) {
		const i = ucode.indexOf('function ' + name);
		assert.ok(i >= 0, name + ' missing');
		return i;
	}
	assert.ok(fnPos('list_etopen_feeds') < fnPos('get_config'), 'list_etopen_feeds before get_config');
	assert.ok(fnPos('distinct_col') < fnPos('get_policies'), 'distinct_col before get_policies');
	assert.ok(fnPos('parse_enabled_flag') < fnPos('replace_policies'), 'parse_enabled_flag before replace_policies');
});

test('rule query helpers', () => {
	assert.equal(core.sanitizeRuleQuery("foo%'bar"), 'foobar');
	assert.equal(core.clampRuleLimit(0), 50);
	assert.equal(core.clampRuleLimit(500), 100);
	assert.equal(core.validSid('2020001'), true);
	assert.equal(core.validSid('sid;drop'), false);
	assert.deepEqual(core.normalizeSidList(['2020001', '2020001', 'x', '9']), ['2020001', '9']);
	assert.equal(core.normalizeSidList([]), null);
	assert.equal(core.normalizeSidList(Array.from({ length: 51 }, function(_, i) { return String(i + 1); })), null);
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

test('parseRuleRaw and tune preview', () => {
	const raw = 'alert dns $HOME_NET any -> any any (msg:"ET MOBILE_MALWARE Foo"; content:"bar"; classtype:trojan-activity; sid:2026369; rev:3; metadata:former_category MALWARE, updated_at 2020_01_01;)';
	const parsed = core.parseRuleRaw(raw);
	assert.equal(parsed.action, 'alert');
	assert.equal(parsed.sid, '2026369');
	assert.equal(parsed.classtype, 'trojan-activity');
	assert.equal(parsed.msg, 'ET MOBILE_MALWARE Foo');
	assert.ok(parsed.tags.some((t) => t.key === 'action' && t.value === 'alert'));
	assert.ok(parsed.tags.some((t) => t.key === 'former_category' && t.value === 'MALWARE'));
	const preview = core.applyRuleTunePreview(raw, { priority: '1', target: 'src_ip', classtype: 'misc-activity' });
	assert.match(preview, /priority:1;/);
	assert.match(preview, /target:src_ip;/);
	assert.match(preview, /classtype:misc-activity;/);
	assert.match(core.applyRuleTunePreview(raw, { action: 'drop' }), /^drop /);
	assert.equal(core.applyRuleTunePreview(raw, {}), raw);
	const pills = core.displayRuleTags(raw, { classtype: 'trojan-activity' });
	assert.ok(pills.some((t) => t.label === 'dns' && t.tone === 'proto'));
	assert.ok(pills.some((t) => t.label === 'malware' && t.tone === 'meta'));
});

test('validateTune and tags', () => {
	assert.equal(core.validateTune({
		sid: '2026369',
		status: 'review',
		priority: '2',
		target: 'dest_ip',
		threshold: 'type limit, track by_src, count 1, seconds 60'
	}), null);
	assert.equal(core.validateTune({ sid: '2026369', status: 'nope' }), 'invalid status');
	assert.equal(core.validateTune({ sid: '2026369', status: 'enabled', priority: '999' }), 'invalid priority');
	assert.equal(core.validateTune({ sid: '2026369', status: 'enabled', threshold: 'count 1' }), 'invalid threshold');
	assert.equal(core.validateTune({ sid: '2026369', status: 'enabled', action: 'drop' }), null);
	assert.equal(core.validateTune({ sid: '2026369', status: 'enabled', action: 'block' }), 'invalid action');
	assert.equal(core.normalizeTag('url: www.example.com'), 'url:www.example.com');
	assert.equal(core.normalizeTag('bad'), null);
	assert.deepEqual(core.normalizeTagList(['a:1', 'a:1', 'b:2']), ['a:1', 'b:2']);
});

test('validatePolicies', () => {
	assert.equal(core.validatePolicies({
		rulesets: [{ file: 'emerging-malware.rules', enabled: '1', action: 'drop' }],
		classtypes: [{ name: 'trojan-activity', action: 'alert' }]
	}), null);
	assert.equal(core.validatePolicies({
		rulesets: [{ file: 'bad.txt', enabled: '1', action: 'alert' }]
	}), 'invalid ruleset');
	assert.equal(core.validatePolicies({
		classtypes: [{ name: 'trojan-activity', action: 'block' }]
	}), 'invalid classtype');
	assert.equal(core.sanitizeRulesetFile('emerging-malware.rules'), 'emerging-malware.rules');
	assert.equal(core.actionOk('reject'), true);
});

console.log(`Results: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
