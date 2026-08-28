#!/usr/bin/env node
/**
 * Tests for getStatus shaping helpers (blocky-parse-core.js).
 */

import assert from 'node:assert/strict';
import { loadBlockyParseCore, readFixture } from './load-core.mjs';

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

test('parseBlockingStatusJson', () => {
	assert.deepEqual(bp.parseBlockingStatusJson(''), { enabled: false, autoEnableInSec: 0 });
	assert.deepEqual(bp.parseBlockingStatusJson('{"enabled":true,"autoEnableInSec":120}'), {
		enabled: true,
		autoEnableInSec: 120
	});
});

test('statsResultFromStatus', () => {
	const stats = readFixture('stats.json');
	const ok = bp.statsResultFromStatus({ stats_ok: true, stats_json: stats });
	assert.equal(ok.ok, true);
	assert.equal(ok.data.lists.denylist.hagezi_light, 45000);

	assert.equal(bp.statsResultFromStatus({ stats_disabled: true }).disabled, true);
	assert.equal(bp.statsResultFromStatus({ stats_ok: false }).ok, false);
});

test('serviceObjectFromStatus', () => {
	assert.deepEqual(bp.serviceObjectFromStatus({ service_running: false }), {});
	assert.equal(bp.serviceObjectFromStatus({ service_running: true }).blocky.instances.instance1.running, true);
});

test('shapeBlockyStatusBar', () => {
	const bar = bp.shapeBlockyStatusBar({
		service_running: true,
		dnsmasq_forward: true,
		api_ok: true,
		stats_ok: true,
		version: '0.34.0',
		log_level: 'warn',
		blocking: { enabled: true, autoEnableInSec: 0 },
		ports: { dns: 5353, http: 4000 }
	});
	assert.equal(bar.serviceOk, true);
	assert.equal(bar.blockingOk, true);
	assert.equal(bar.dnsmasqOk, true);
	assert.equal(bar.version, '0.34.0');

	const paused = bp.shapeBlockyStatusBar({
		service_running: true,
		blocking: { enabled: false, autoEnableInSec: 90 }
	});
	assert.equal(paused.blockingPaused, true);
	assert.equal(paused.blockingOk, false);
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
