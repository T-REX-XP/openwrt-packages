#!/usr/bin/env node
/**
 * LuCI poll.add() returns boolean; poll.remove() requires the function ref.
 */

import assert from 'node:assert/strict';

let pass = 0;
let fail = 0;

function test(name, fn) {
	try {
		fn();
		pass++;
	} catch (e) {
		fail++;
		console.error('FAIL ' + name + ':', e.message);
	}
}

const queue = [];

const poll = {
	add(fn, interval) {
		if (typeof fn !== 'function' || isNaN(interval))
			throw new TypeError('Invalid argument to LuCI.poll.add()');
		if (queue.some((e) => e.fn === fn))
			return false;
		queue.push({ fn, interval });
		return true;
	},
	remove(fn) {
		if (typeof fn !== 'function')
			throw new TypeError('Invalid argument to LuCI.poll.remove()');
		const before = queue.length;
		for (let i = queue.length; i > 0; i--) {
			if (queue[i - 1].fn === fn)
				queue.splice(i - 1, 1);
		}
		return queue.length !== before;
	}
};

test('remove accepts function reference from add', () => {
	let pollFn = function() {};
	assert.equal(poll.add(pollFn, 1), true);
	assert.doesNotThrow(() => poll.remove(pollFn));
	assert.equal(queue.length, 0);
});

test('remove rejects boolean return value of add (LuCI bug pattern)', () => {
	let pollFn = function() {};
	let added = poll.add(pollFn, 1);
	assert.equal(typeof added, 'boolean');
	assert.throws(() => poll.remove(added), /Invalid argument to LuCI\.poll\.remove\(\)/);
	poll.remove(pollFn);
});

console.log('\nResults: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
