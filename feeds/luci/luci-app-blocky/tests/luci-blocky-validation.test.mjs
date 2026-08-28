#!/usr/bin/env node
/**
 * Validation helpers mirrored from luci.blocky.uc (validate_http, allowed_log_dir).
 */

import assert from 'node:assert/strict';
import { loadBlockyParseCore } from './load-core.mjs';

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
