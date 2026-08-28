#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const res = join(dir, '..', 'htdocs', 'luci-static', 'resources');

function loadCore() {
	let src = readFileSync(join(res, 'mcu-display-core.js'), 'utf8');
	src = src.replace(/^'use strict';\n?/, '');
	src = src.replace(/^'require baseclass';\n?/, '');
	const fn = new Function('baseclass', src);
	return fn({ extend: (obj) => obj });
}

const mcu = loadCore();
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

test('parseLogLimit defaults', () => {
	assert.equal(mcu.parseLogLimit('', 200), 200);
	assert.equal(mcu.parseLogLimit('50', 200), 50);
	assert.equal(mcu.parseLogLimit('99999', 200), 2000);
});

test('countLogLines ignores trailing empty', () => {
	assert.equal(mcu.countLogLines('a\nb\n'), 2);
	assert.equal(mcu.countLogLines(''), 0);
});

test('statusFingerprint includes version fields', () => {
	const fp = mcu.statusFingerprint({
		running: true,
		host_version_label: '1.0.0+31',
		firmware_version_label: '1.0.0+31',
		version_synced: true
	});
	assert.ok(fp.includes('1.0.0+31'));
	assert.ok(fp.includes('true'));
});

test('parsePageControl version action', () => {
	const r = mcu.parsePageControl('version');
	assert.equal(r.ok, true);
	assert.equal(r.action, 'version');
	assert.equal(r.via, 'fifo');
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
