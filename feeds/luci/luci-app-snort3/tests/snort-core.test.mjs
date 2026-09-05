#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const res = join(dir, '..', 'htdocs', 'luci-static', 'resources');
const ucodePath = join(dir, '..', 'root', 'usr', 'share', 'rpcd', 'ucode', 'luci.snort3.uc');
const viewPath = join(res, 'view', 'services', 'snort.js');

function loadCore() {
	let src = readFileSync(join(res, 'snort-core.js'), 'utf8');
	src = src.replace(/^'use strict';\n?/, '');
	src = src.replace(/^'require baseclass';\n?/, '');
	const fn = new Function('baseclass', src);
	return fn({ extend: (obj) => obj });
}

const core = loadCore();
const ucode = readFileSync(ucodePath, 'utf8');
const view = readFileSync(viewPath, 'utf8');
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

function parseUcodeStringList(src, name) {
	const re = new RegExp('const ' + name + ' = \\[([^\\]]+)\\]');
	const m = src.match(re);
	assert.ok(m, name + ' list missing in ucode');
	return m[1].split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean);
}

function parseUcodeStringOptKeys(src) {
	const m = src.match(/const STRING_OPTS = \{([\s\S]*?)\n\};/);
	assert.ok(m, 'STRING_OPTS missing in ucode');
	return [...m[1].matchAll(/^\s*([A-Za-z0-9_]+):/gm)].map((x) => x[1]);
}

test('unwrapNet strips wrapping brackets and spaces', () => {
	assert.equal(core.unwrapNet('[192.168.8.0/24]'), '192.168.8.0/24');
	assert.equal(core.unwrapNet('[[192.168.8.0/24, 10.0.0.0/8]]'), '192.168.8.0/24,10.0.0.0/8');
	assert.equal(core.unwrapNet('any'), 'any');
	assert.equal(core.unwrapNet('!$HOME_NET'), '!$HOME_NET');
});

test('validateConfig fail-fast on unknown and bad flags', () => {
	assert.equal(core.validateConfig({ enabled: '2' }), 'invalid enabled');
	assert.equal(core.validateConfig({ nope: '1' }), 'invalid nope');
	assert.equal(core.validateConfig({ interface: 'eth0;rm' }), 'invalid interface');
	assert.equal(core.validateConfig(null), 'invalid config');
	assert.equal(core.validateConfig({}), 'invalid config');
});

test('validateConfig accepts CBI/UCI fields', () => {
	assert.equal(core.validateConfig({
		enabled: '1',
		manual: '0',
		logging: '1',
		openappid: '0',
		interface: 'br-lan',
		home_net: '192.168.8.0/24',
		external_net: 'any',
		mode: 'ids',
		method: 'afpacket',
		action: 'alert',
		snaplen: '1518',
		log_dir: '/var/log',
		config_dir: '/etc/snort',
		temp_dir: '/var/snort.d',
		oinkcode: ''
	}), null);
});

test('collectSettings unwraps Suricata-style HOME_NET and keeps enabled', () => {
	const raw = {
		enabled: true,
		manual: false,
		logging: true,
		openappid: false,
		interface: 'br-lan',
		home_net: '[192.168.8.0/24]',
		external_net: ' !$HOME_NET ',
		mode: 'ids',
		method: 'afpacket',
		action: 'alert',
		snaplen: '1518',
		log_dir: '/var/log',
		config_dir: '/etc/snort',
		temp_dir: '/var/snort.d',
		oinkcode: 'Ab12'
	};
	const got = core.collectSettings(raw);
	assert.equal(got.error, undefined);
	assert.equal(got.config.enabled, '1');
	assert.equal(got.config.home_net, '192.168.8.0/24');
	assert.equal(got.config.external_net, '!$HOME_NET');
	assert.equal(got.config.oinkcode, 'Ab12');
});

test('collectSettings fails loudly when form fields are missing', () => {
	const got = core.collectSettings({ enabled: true });
	assert.equal(got.error, 'Settings form is not ready.');
});

test('snaplen range is enforced', () => {
	assert.equal(core.validateField('snaplen', '99999'), 'invalid snaplen');
	assert.equal(core.validateField('snaplen', '-1'), 'invalid snaplen');
	assert.equal(core.validateField('snaplen', '1518'), null);
});

test('FLAG_OPTS and STRING_OPTS match ucode', () => {
	const flags = parseUcodeStringList(ucode, 'FLAG_OPTS');
	assert.deepEqual(flags, core.FLAG_OPTS);
	const keys = parseUcodeStringOptKeys(ucode);
	assert.deepEqual(keys.sort(), Object.keys(core.STRING_OPTS).sort());
});

test('ucode setConfig is fail-fast not silent skip', () => {
	assert.match(ucode, /return \{ error: err \}/);
	assert.doesNotMatch(ucode, /continue;\s*\n\s*\} else if \(k in STRING_OPTS\)/);
	assert.match(ucode, /method: \/\^\(afpacket\|nfq\)\$\//);
	assert.match(ucode, /k == 'method' && v == 'pcap'/);
});

test('view wires footer save and type=button', () => {
	assert.match(view, /handleSave:\s*function/);
	assert.match(view, /handleSaveApply:\s*function/);
	assert.match(view, /handleReset:\s*null/);
	assert.match(view, /'require snort-core as snortCore'/);
	assert.match(view, /expect:\s*\{\s*'':\s*\{\s*\}\s*\}/);
	assert.doesNotMatch(view, /_\('Save & apply'\)/);
	assert.doesNotMatch(view, /cbi-button-save/);
	const buttons = [...view.matchAll(/E\('button',\s*\{([^}]+)\}/g)];
	assert.ok(buttons.length >= 8, 'expected service/settings/rules buttons');
	for (const m of buttons)
		assert.match(m[1], /'type':\s*'button'/);
});

test('view uses network devices select and advanced paths', () => {
	assert.match(view, /'require network'/);
	assert.match(view, /network\.getDevices\(\)/);
	assert.match(view, /network\.getNetwork\('lan'\)/);
	assert.match(view, /ifaceSelect\('snort-iface'/);
	assert.doesNotMatch(view, /type:\s*'text',\s*id:\s*'snort-iface'/);
	assert.match(view, /type:\s*'number',\s*id:\s*'snort-snaplen'/);
	assert.match(view, /E\('details'/);
	assert.match(view, /option\[value="nfq"\]/);
	assert.match(view, /Use LAN subnet/);
	assert.match(view, /cbi-value-title/);
	assert.match(view, /_\('What to do next'\)/);
	assert.doesNotMatch(view, /CM5/);
	assert.doesNotMatch(view, /2\.5 GbE/);
	assert.doesNotMatch(view, /DEFAULT_LAN_CIDR/);
	assert.doesNotMatch(view, /E\('h3',\s*\{\s*\},\s*_\('Rules management'\)\)/);
	assert.doesNotMatch(view, /_\('Installed rules'\)/);
	assert.doesNotMatch(view, /_\('Snort subscriber code'\)/);
	assert.doesNotMatch(view, /admin\/services\/blocky/);
	assert.doesNotMatch(view, /admin\/services\/threat-prevention/);
	assert.doesNotMatch(view, /snort-cross/);
	assert.match(view, /data-tab-title':\s*_\('Rules'\)/);
	assert.match(view, /_\('Add'\)/);
	assert.match(view, /id:\s*'snort-oink'/);
	assert.match(view, /snort-feeds-table/);
	assert.match(view, /callSetConfig\(payload\)/);
	assert.doesNotMatch(readFileSync(join(res, 'snort-core.js'), 'utf8'), /DEFAULT_LAN_CIDR/);
	assert.equal(core.DEFAULT_LAN_CIDR, undefined);
});

test('idsDeviceNames filters lo/alias and keeps current', () => {
	assert.deepEqual(core.idsDeviceNames([
		{ name: 'lo', type: 'ethernet' },
		{ name: 'br-lan', type: 'bridge' },
		{ name: 'eth0', type: 'ethernet' },
		{ name: 'eth1', type: 'ethernet' },
		{ name: '@lan', type: 'alias' },
		{ name: 'eth0;rm', type: 'ethernet' },
		{ name: 'radio0.network1', type: 'wifi' },
		{ name: 'ifb0', type: 'ethernet' }
	], 'gone0'), ['br-lan', 'eth0', 'eth1', 'gone0']);
	assert.deepEqual(core.idsDeviceNames([], ''), ['br-lan']);
	assert.deepEqual(core.idsDeviceNames([], 'br-lan'), ['br-lan']);
});

test('hostCidrToNetwork converts host CIDR to network', () => {
	assert.equal(core.hostCidrToNetwork('192.168.8.1/24'), '192.168.8.0/24');
	assert.equal(core.hostCidrToNetwork('10.1.2.3/8'), '10.0.0.0/8');
	assert.equal(core.hostCidrToNetwork('192.168.8.0/24'), '192.168.8.0/24');
	assert.equal(core.hostCidrToNetwork('bad'), null);
	assert.equal(core.hostCidrToNetwork('192.168.8.1'), null);
});

test('empty interface is invalid', () => {
	assert.equal(core.validateField('interface', ''), 'invalid interface');
});

test('mem helpers', () => {
	assert.equal(core.memTone(90), 'snort-mem--err');
	assert.equal(core.memTone(70), 'snort-mem--warn');
	assert.equal(core.memTone(10), 'snort-mem--ok');
	assert.equal(core.formatKb(2048), '2 MB');
	assert.equal(core.formatSysMem(1024 * 100, 1024 * 200, 50), '100 MB / 200 MB (50%)');
});

test('feed helpers', () => {
	const def = core.defaultFeeds();
	assert.equal(def.length, 1);
	assert.equal(def[0].url, core.COMMUNITY_RULES_URL);
	assert.equal(core.sanitizeFeedId('snort'), 'rs_snort');
	assert.equal(core.sanitizeFeedId('nfq'), 'rs_nfq');
	const url = 'https://www.snort.org/rules/x.tar.gz?oinkcode={oinkcode}';
	assert.equal(core.validateFeed({ name: 'Talos', url: url, enabled: '1' }), null);
	assert.equal(core.validateFeeds(def), null);
	const raw = {
		enabled: true,
		manual: false,
		logging: true,
		openappid: false,
		interface: 'br-lan',
		home_net: '192.168.8.0/24',
		external_net: 'any',
		mode: 'ids',
		method: 'afpacket',
		action: 'alert',
		snaplen: '1518',
		log_dir: '/var/log',
		config_dir: '/etc/snort',
		temp_dir: '/var/snort.d',
		oinkcode: '',
		feeds: def
	};
	const got = core.collectSettings(raw);
	assert.equal(got.error, undefined);
	assert.equal(got.config.feeds[0].id, 'community');
});

test('legacy pcap and /var/log are remapped', () => {
	assert.equal(core.normalizeValue('method', 'pcap'), 'afpacket');
	assert.equal(core.normalizeValue('log_dir', '/var/log'), '/var/log/snort');
	assert.equal(core.validateField('method', 'pcap'), null);
});

console.log(`Results: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
