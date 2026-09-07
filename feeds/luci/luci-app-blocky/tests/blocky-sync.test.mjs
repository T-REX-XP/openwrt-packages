#!/usr/bin/env node
/**
 * Tests for UCI/YAML blocklist sync detection (blocky-parse-core.js).
 */

import assert from 'node:assert/strict';
import { loadBlockyParseCore, readFixture } from './load-core.mjs';

const bp = loadBlockyParseCore();
const configYaml = readFixture('config.yml');
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

test('parseYamlDenylists', () => {
	const map = bp.parseYamlDenylists(configYaml);
	assert.deepEqual(Object.keys(map).sort(), [ 'urlhaus' ]);
	assert.equal(map.urlhaus.length, 1);
	assert.match(map.urlhaus[0], /urlhaus/);
});

test('denylistFingerprintFromYaml matches fixture UCI entries', () => {
	const uciEntries = [
		{ id: 'urlhaus', enabled: true, url: 'https://urlhaus.abuse.ch/downloads/hostfile/' }
	];

	assert.equal(bp.blocklistsSyncNeeded(uciEntries, configYaml), false);
});

test('blocklistsSyncNeeded detects UCI drift', () => {
	const uciEntries = [
		{ id: 'urlhaus', enabled: true, url: 'https://example.com/other.txt' }
	];

	assert.equal(bp.blocklistsSyncNeeded(uciEntries, configYaml), true);
});

test('blocklistsSyncNeeded ignores disabled UCI lists', () => {
	const uciEntries = [
		{ id: 'urlhaus', enabled: false, url: 'https://urlhaus.abuse.ch/downloads/hostfile/' }
	];

	assert.equal(bp.blocklistsSyncNeeded(uciEntries, configYaml), true);
});

test('normalizeValidateResponse', () => {
	assert.deepEqual(bp.normalizeValidateResponse({ ok: true, output: '' }), { ok: true, output: '' });
	assert.deepEqual(bp.normalizeValidateResponse({ ok: false, output: 'invalid yaml' }), {
		ok: false,
		output: 'invalid yaml'
	});
	assert.deepEqual(bp.normalizeValidateResponse(null), { ok: false, output: '' });
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
