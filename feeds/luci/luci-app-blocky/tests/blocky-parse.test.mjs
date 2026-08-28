#!/usr/bin/env node
/**
 * Host tests for blocky-parse-core.js (LuCI pure logic).
 * Run: node blocky-parse.test.mjs
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

test('safeString handles nullish', () => {
	assert.equal(bp.safeString(null), '');
	assert.equal(bp.safeString(undefined), '');
	assert.equal(bp.safeString(42), '42');
});

test('blockyCliStdout and execResultStdout', () => {
	assert.equal(bp.blockyCliStdout('ok'), 'ok');
	assert.equal(bp.execResultStdout({ stdout: 'line' }), 'line');
});

test('parseDnsForwardFlag', () => {
	assert.equal(bp.parseDnsForwardFlag('1\n'), true);
	assert.equal(bp.parseDnsForwardFlag('0'), false);
	assert.equal(bp.parseDnsForwardFlag('true'), true);
});

test('parseBlockyPortValue variants', () => {
	assert.deepEqual(bp.parseBlockyPortValue('5353'), { host: '0.0.0.0', port: 5353 });
	assert.deepEqual(bp.parseBlockyPortValue(':4000'), { host: '0.0.0.0', port: 4000 });
	assert.deepEqual(bp.parseBlockyPortValue('127.0.0.1:4000'), { host: '127.0.0.1', port: 4000 });
	assert.deepEqual(bp.parseBlockyPortValue('[::1]:8080'), { host: '[::1]', port: 8080 });
});

test('parseBlockyPortLine reads ports section', () => {
	const yaml = readFixture('config.yml');
	const dns = bp.parseBlockyPortLine(yaml, 'dns', 5353);
	const http = bp.parseBlockyPortLine(yaml, 'http', 4000);
	assert.equal(dns.port, 5353);
	assert.equal(http.port, 4000);
});

test('blockyHttpBaseUrl normalizes wildcard bind', () => {
	const yaml = 'ports:\n  http: 0.0.0.0:4000\n';
	assert.equal(bp.blockyHttpBaseUrl(yaml), 'http://127.0.0.1:4000');
});

test('isLoopbackHost', () => {
	assert.equal(bp.isLoopbackHost('127.0.0.1'), true);
	assert.equal(bp.isLoopbackHost('::1'), true);
	assert.equal(bp.isLoopbackHost('0.0.0.0'), false);
});

test('sanitizeBlocklistId', () => {
	assert.equal(bp.sanitizeBlocklistId('HaGeZi Light!'), 'hagezi_light');
});

test('normalizeBlocklistCatalog', () => {
	const raw = JSON.stringify({
		presets: [
			{ id: 'a', name: 'A', url: 'https://example.com/a.txt' },
			{ id: '', name: 'bad', url: 'x' }
		],
		catalog: [{ title: 'G', items: ['a'] }]
	});
	const cat = bp.normalizeBlocklistCatalog(raw);
	assert.equal(cat.presets.length, 1);
	assert.equal(cat.presetMap.a.name, 'A');
});

test('formatNumber and formatPercent', () => {
	assert.equal(bp.formatNumber(NaN), '0');
	assert.equal(bp.formatPercent(12.345), '12.3%');
});

test('formatDuration', () => {
	assert.equal(bp.formatDuration(0), 'not scheduled');
	assert.equal(bp.formatDuration(65), '1m 05s');
	assert.equal(bp.formatDuration(0, 'never'), 'never');
});

test('blockyPathFromUrl', () => {
	const base = 'http://127.0.0.1:4000';
	assert.equal(bp.blockyPathFromUrl('/metrics', base), 'metrics');
	assert.equal(bp.blockyPathFromUrl(base + '/api/stats', base), 'api/stats');
	assert.equal(bp.blockyPathFromUrl('blocking/status', base), 'api/blocking/status');
});

test('parseMetrics golden file', () => {
	const text = readFixture('metrics.prom.txt');
	const metrics = bp.parseMetrics(text);
	assert.equal(metrics.blocky_query_total, 1000);
	assert.equal(metrics['blocky_response_total:BLOCKED'], 120);
	const overview = bp.deriveOverview(metrics);
	assert.equal(overview.totalQueries, 1000);
	assert.equal(overview.blockedQueries, 120);
	assert.equal(overview.blockedRate, 12);
	assert.equal(overview.hasMetrics, true);
});

test('parseDenylistGroupCounts', () => {
	const text = readFixture('metrics.prom.txt');
	const counts = bp.parseDenylistGroupCounts(text);
	assert.equal(counts.hagezi_light, 45000);
	assert.equal(counts.urlhaus, 1200);
	assert.equal(bp.mergeDenyCounts({ a: 1 }, { b: 2 }).a, 1);
	assert.equal(bp.mergeDenyCounts({ a: 5 }, { a: 2 }).a, 5);
});

test('normalizeStatsSummary maps Blocky 0.34 fields', () => {
	const stats = JSON.parse(readFixture('stats.json'));
	const s = bp.normalizeStatsSummary(stats.summary);
	assert.equal(s.queries, 1000);
	assert.equal(s.cached, 420);
	assert.equal(s.filtered, 45);
	assert.equal(s.errors, 15);
	assert.equal(s.avgResponseMs, 12);
	assert.equal(s.cacheHitRate, 42.5);
});

test('parseBlockyStatsResponse', () => {
	const ok = bp.parseBlockyStatsResponse({
		ok: true,
		stdout: readFixture('stats.json')
	});
	assert.equal(ok.ok, true);
	assert.equal(ok.data.lists.denylist.hagezi_light, 45000);

	const disabled = bp.parseBlockyStatsResponse({
		ok: false,
		stderr: 'statistics are disabled in config'
	});
	assert.equal(disabled.disabled, true);

	const bad = bp.parseBlockyStatsResponse({ ok: true, stdout: '{}' });
	assert.equal(bad.ok, false);
});

test('parseCsvRows tab and comma', () => {
	const tab = '2026-01-01 12:00:00\t192.168.8.1\t-\tCACHED\t-\texample.com\tA\t1.2.3.4';
	const rows = bp.parseCsvRows(tab);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].question, 'example.com');

	const csv = readFixture('query-log.csv');
	const csvRows = bp.parseCsvRows(csv);
	assert.ok(csvRows.length >= 1);
	assert.match(csvRows[0].question, /example\.com|ads\.example\.com/);

	const tsv = readFixture('query-log-tab.tsv');
	const tsvRows = bp.parseCsvRows(tsv);
	assert.equal(tsvRows.length, 2);
	assert.equal(tsvRows[0].question, 'ads.example.com');
	assert.equal(tsvRows[0].response, 'BLOCKED');
	assert.equal(tsvRows[1].response, 'CACHED');
});

test('formatQueryLogRowsText', () => {
	const text = bp.formatQueryLogRowsText([
		{ time: 't', client: 'c', question: 'q', type: 'A', response: 'CACHED', answer: '1.2.3.4' }
	]);
	assert.match(text, /t\tc\tq\tA\tCACHED/);
});

test('parseQueryLogConfig', () => {
	const yaml = readFixture('config.yml');
	const ql = bp.parseQueryLogConfig(yaml);
	assert.equal(ql.type, 'csv');
	assert.equal(ql.target, '/tmp/blocky-logs');
});

test('parseBlockyVersionFromMetrics', () => {
	const text = readFixture('metrics.prom.txt');
	assert.equal(bp.parseBlockyVersionFromMetrics(text), '0.34.0');
});

test('validateHttpRequest mirrors luci.blocky.uc', () => {
	assert.deepEqual(bp.validateHttpRequest('get', 'metrics'), ['GET', 'metrics', undefined]);
	assert.deepEqual(bp.validateHttpRequest('POST', 'api/lists/refresh', ''), ['POST', 'api/lists/refresh', '']);
	assert.equal(bp.validateHttpRequest('DELETE', 'metrics'), null);
	assert.equal(bp.validateHttpRequest('GET', '../../../etc/passwd'), null);
});

test('allowedLogDir and pickLatestLogFilename', () => {
	assert.equal(bp.allowedLogDir('/tmp/blocky-logs'), '/tmp/blocky-logs');
	assert.equal(bp.allowedLogDir('/etc/passwd'), null);
	assert.equal(bp.isValidQueryLogFilename('2026-01-02_foo.log'), true);
	assert.equal(bp.isValidQueryLogFilename('bad.log'), false);
	assert.equal(
		bp.pickLatestLogFilename(['2026-01-01_a.log', '2026-01-02_b.log', 'bad.log']),
		'2026-01-02_b.log'
	);
});

test('chart math helpers', () => {
	const now = Date.now();
	const samples = [
		{ t: now - 2000, total: 1, blocked: 0, cached: 0 },
		{ t: now - 1000, total: 3, blocked: 1, cached: 1 },
		{ t: now - 500, total: 5, blocked: 2, cached: 2 }
	];
	const windowed = bp.filterSamplesByWindow(samples, 1500);
	assert.equal(windowed.length, 2);
	const down = bp.downsampleSamples(samples, 2);
	assert.equal(down.length, 2);
	const buckets = bp.bucketAggregateBars(samples, 2);
	assert.equal(buckets.length, 2);
	const pts = bp.samplesToXY(samples, 'total', 100, 50, 5, 5, 5, 5, 10);
	assert.equal(pts.length, 3);
	const dense = bp.densifyCatmullRom(pts, 4);
	assert.ok(dense.length > pts.length);
	assert.match(bp.buildSmoothLinePath(dense), /^M /);
	assert.match(bp.buildSmoothAreaPath(dense, 40), / Z$/);
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
