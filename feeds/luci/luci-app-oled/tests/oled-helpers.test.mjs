#!/usr/bin/env node
/**
 * Host tests for LuCI oled.js helpers and luci.oled.uc subst_tokens mirror.
 * Run: node oled-helpers.test.mjs
 */

import assert from 'node:assert/strict';

function optionSelected(value, current) {
	return String(value) === String(current) ? 'selected' : null;
}

function disableIf(cond) {
	return cond ? true : null;
}

function subst_tokens(text, metrics) {
	if (typeof text !== 'string' || !text.length)
		return text || '';
	let out = '';
	let i = 0;
	while (i < text.length) {
		if (text[i] !== '{') {
			out += text[i];
			i++;
			continue;
		}
		let j = i + 1;
		while (j < text.length && text[j] !== '}')
			j++;
		if (j < text.length) {
			const tok = text.slice(i + 1, j);
			out += metrics[tok] != null ? `${metrics[tok]}` : '';
			i = j + 1;
		} else {
			out += text[i];
			i++;
		}
	}
	return out;
}

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

test('optionSelected matches string', () => {
	assert.equal(optionSelected('wps', 'wps'), 'selected');
	assert.equal(optionSelected('BTN_2', 'wps'), null);
	assert.equal(optionSelected(5, 5), 'selected');
});

test('disableIf returns null when false', () => {
	assert.equal(disableIf(false), null);
	assert.equal(disableIf(true), true);
});

test('subst_tokens replaces braces', () => {
	const m = { time: '09:15', cpu_temp: '42C' };
	assert.equal(subst_tokens('@{time}', m), '@09:15');
	assert.equal(subst_tokens('{cpu_temp} ok', m), '42C ok');
	assert.equal(subst_tokens('plain', m), 'plain');
});

console.log(`\nResults: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
