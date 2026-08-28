#!/usr/bin/env node
/**
 * Round-trip tests for blocky-config-core.js
 */

import assert from 'node:assert/strict';
import { loadBlockyParseCore, loadBlockyConfigCore, readFixture } from './load-core.mjs';

const bp = loadBlockyParseCore();
const bc = loadBlockyConfigCore(bp);
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

const FIXTURE = readFixture('config.yml');

test('extractYamlSection returns blocking block', () => {
	const section = bc.extractYamlSection(FIXTURE, 'blocking');
	assert.match(section, /^blocking:/);
	assert.match(section, /denylists:/);
});

test('parseYamlScalar and parseYamlBool', () => {
	const caching = bc.extractYamlSection(FIXTURE, 'caching');
	assert.equal(bc.parseYamlScalar(caching, 'minTime', '0'), '5m');
	assert.equal(bc.parseYamlBool(caching, 'prefetching', true), false);
});

test('parseYamlListItems bootstrapDns', () => {
	const bootstrap = bc.extractYamlSection(FIXTURE, 'bootstrapDns');
	const items = bc.parseYamlListItems(bootstrap);
	assert.ok(items.length >= 2);
	assert.match(items[0], /1\.1\.1\.1/);
});

test('parseBlockySettings reads CM5 defaults', () => {
	const s = bc.parseBlockySettings(FIXTURE);
	assert.equal(s.portDns, '127.0.0.1:5353');
	assert.equal(s.portHttp, '127.0.0.1:4000');
	assert.equal(s.listRefreshPeriod, '4h');
	assert.equal(s.queryLogTarget, '/tmp/blocky-logs');
	assert.ok(s.upstreamResolvers.length >= 1);
	assert.ok(s.upstreamGroups.default.length >= 1);
	assert.equal(s.bootstrapUseWan, false);
});

test('parseUpstreamGroups reads multiple groups', () => {
	const upstreams = [
		'upstreams:',
		'  init:',
		'    strategy: fast',
		'  timeout: 5s',
		'  groups:',
		'    default:',
		'      - 1.1.1.1',
		'    privacy:',
		'      - 9.9.9.9'
	].join('\n');
	const groups = bc.parseUpstreamGroups(upstreams);
	assert.deepEqual(groups.default, [ '1.1.1.1' ]);
	assert.deepEqual(groups.privacy, [ '9.9.9.9' ]);
});

test('buildBlockySettingsYaml writes upstream groups', () => {
	const built = bc.buildBlockySettingsYaml({
		upstreamGroups: {
			default: [ '1.1.1.1' ],
			privacy: [ '9.9.9.9' ]
		},
		upstreamInitStrategy: 'fast',
		upstreamTimeout: '5s',
		bootstrapResolvers: 'tcp+udp:1.1.1.1',
		bootstrapUseWan: false,
		hostsSources: '/etc/hosts',
		blockingSection: bc.extractYamlSection(FIXTURE, 'blocking'),
		cachingMinTime: '5m',
		cachingMaxTime: '30m',
		cachingPrefetch: false,
		logLevel: 'warn',
		logPrivacy: false,
		queryLogType: 'csv',
		queryLogTarget: '/tmp/blocky-logs',
		queryLogRetention: '7',
		queryLogFlush: '30s',
		portDns: '127.0.0.1:5353',
		portHttp: '127.0.0.1:4000',
		rebindingEnable: true,
		prometheusEnable: true,
		prometheusPath: '/metrics',
		statisticsEnable: true,
		listRefreshPeriod: '4h',
		loadingStrategy: 'fast',
		listCachePath: '/var/lib/blocky/lists',
		listDownloadTimeout: '60s',
		listWriteTimeout: '60s',
		listReadTimeout: '60s',
		listDownloadAttempts: '5',
		listCooldown: '10s',
		listConcurrency: '4'
	}, FIXTURE);
	assert.match(built, /privacy:/);
	assert.match(built, /9\.9\.9\.9/);
});

test('yamlQuote escapes special chars', () => {
	assert.equal(bc.yamlQuote('plain'), 'plain');
	assert.equal(bc.yamlQuote('has space'), '"has space"');
	assert.equal(bc.yamlQuote(''), '""');
});

test('buildBlockySettingsYaml preserves blocking section', () => {
	const parsed = bc.parseBlockySettings(FIXTURE);
	const fields = Object.assign({}, parsed, {
		upstreamResolvers: parsed.upstreamResolvers.join('\n'),
		bootstrapResolvers: parsed.bootstrapResolvers.join('\n'),
		hostsSources: parsed.hostsSources.join('\n')
	});
	const built = bc.buildBlockySettingsYaml(fields, FIXTURE);
	assert.match(built, /^upstreams:/);
	assert.match(built, /queryLog:/);
	assert.match(built, /127\.0\.0\.1:5353/);
	const reparsed = bc.parseBlockySettings(built);
	assert.equal(reparsed.portDns, parsed.portDns);
	assert.equal(reparsed.listRefreshPeriod, parsed.listRefreshPeriod);
});

test('patchBlockingLoadingSection updates concurrency', () => {
	const blocking = bc.extractYamlSection(FIXTURE, 'blocking');
	const patched = bc.patchBlockingLoadingSection(blocking, {
		listRefreshPeriod: '6h',
		loadingStrategy: 'parallel',
		listCachePath: '/var/lib/blocky/lists',
		listDownloadTimeout: '60s',
		listWriteTimeout: '60s',
		listReadTimeout: '60s',
		listDownloadAttempts: '5',
		listCooldown: '10s',
		listConcurrency: '8'
	});
	assert.match(patched, /refreshPeriod: 6h/);
	assert.match(patched, /concurrency: 8/);
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
