#!/usr/bin/env node
/**
 * Validation helpers mirrored from luci.blocky.uc (validate_http, allowed_log_dir).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBlockyParseCore } from './load-core.mjs';

const ucodeSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)),
	'..', 'root/usr/share/rpcd/ucode/luci.blocky.uc'), 'utf8');

const bp = loadBlockyParseCore();
let pass = 0;
let fail = 0;

function test(name, fn) {
	try {
		fn();
		pass++;
	} catch (e) {
		fail++;
		console.error(`FAIL ${name}:`, e.message);
	}
}

test('validateHttpRequest rejects path traversal', () => {
	assert.equal(bp.validateHttpRequest('GET', '../metrics'), null);
	assert.equal(bp.validateHttpRequest('GET', 'metrics/../stats'), null);
});

test('validateHttpRequest allows api paths', () => {
	assert.deepEqual(bp.validateHttpRequest('GET', 'api/blocking/status'), ['GET', 'api/blocking/status', undefined]);
});

test('allowedLogDir strips trailing slashes', () => {
	assert.equal(bp.allowedLogDir('/tmp/blocky-logs/'), '/tmp/blocky-logs');
	assert.equal(bp.allowedLogDir('/tmp/blocky-logs//'), '/tmp/blocky-logs');
});

test('http_request uses ucode uc() not upper()', () => {
	assert.match(ucodeSrc, /\buc\(ra\.method \|\| 'GET'\)/);
	assert.doesNotMatch(ucodeSrc, /\bupper\s*\(/);
	assert.doesNotMatch(ucodeSrc, /\bString\s*\(/);
	assert.match(ucodeSrc, /function as_str\(/);
});

test('read_query_log treats missing directory as !access()', () => {
	const slice = ucodeSrc.slice(ucodeSrc.indexOf('read_query_log:'));
	assert.match(slice, /if \(!access\(dir\)\)/);
	assert.doesNotMatch(slice.slice(0, 600), /if \(access\(dir\)\)/);
});

test('catalog omits dead download URLs and stays internally consistent', () => {
	const catalog = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),
		'..', 'root/usr/share/luci-app-blocky/blocklist-catalog.json'), 'utf8'));
	const ids = new Set((catalog.presets || []).map((p) => p.id));
	const dead = [
		'hagezi_light', 'hagezi_pro', 'hagezi_tif_medium', 'hagezi_gambling',
		'phishing_database',
		'nextdns_windows', 'nextdns_apple', 'nextdns_samsung', 'nextdns_xiaomi', 'nextdns_huawei'
	];
	const deadUrls = [
		'hagezi/dns-blocklists/main/domains/',
		'mitchellkrogza/Phishing.Database',
		'nextdns/metadata/master/privacy/native/'
	];

	for (const id of dead)
		assert.equal(ids.has(id), false, `catalog still has ${id}`);
	for (const preset of catalog.presets) {
		assert.ok(preset.id && preset.url, `preset missing id/url: ${preset.id}`);
		for (const frag of deadUrls)
			assert.equal(preset.url.includes(frag), false, `${preset.id} still uses ${frag}`);
	}
	for (const group of catalog.catalog || []) {
		assert.ok(group.items.length > 0, `empty catalog group ${group.id}`);
		for (const item of group.items)
			assert.equal(ids.has(item), true, `catalog item ${item} not in presets`);
	}
});

test('ACL read cannot mutate Blocky', () => {
	const acl = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)),
		'..', 'root/usr/share/rpcd/acl.d/luci-app-blocky.json'), 'utf8'));
	const readUbus = acl['luci-app-blocky'].read.ubus['luci.blocky'];
	const writeUbus = acl['luci-app-blocky'].write.ubus['luci.blocky'];
	const readFiles = Object.keys(acl['luci-app-blocky'].read.file);
	const mutating = ['sync_lists', 'refresh_lists', 'http_request', 'validate_config'];

	for (const method of mutating) {
		assert.equal(readUbus.includes(method), false, `read ACL must not include ${method}`);
		assert.equal(writeUbus.includes(method), true, `write ACL must include ${method}`);
	}

	assert.equal(readFiles.some((p) => p.includes('/etc/init.d/blocky')), false);
	assert.equal(readFiles.some((p) => p.includes('blocky-dnsmasq-sync')), false);
	assert.equal(readUbus.includes('getStatus'), true);
	assert.equal(readUbus.includes('getLogs'), true);
	assert.equal(readUbus.includes('read_query_log'), true);
	assert.equal(readUbus.includes('getMetrics'), true);
	assert.equal(writeUbus.includes('queryDns'), true);
	assert.equal(writeUbus.includes('setBlocking'), true);
	assert.equal(writeUbus.includes('flushCache'), true);
});

test('pickLatestLogFilename lexicographic date order', () => {
	const best = bp.pickLatestLogFilename([
		'2025-12-31_old.log',
		'2026-01-01_new.log',
		'2026-01-02_latest.log'
	]);
	assert.equal(best, '2026-01-02_latest.log');
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
