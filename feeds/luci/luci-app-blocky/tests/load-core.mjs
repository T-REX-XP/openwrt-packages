import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const RES_DIR = join(TEST_DIR, '..', 'htdocs', 'luci-static', 'resources');

function loadLuCiCore(filename) {
	const file = join(RES_DIR, filename);
	let src = readFileSync(file, 'utf8');
	src = src.replace(/^'use strict';\n?/, '');
	src = src.replace(/^'require blocky-parse-core as bp';\n?/, '');
	src = src.replace(/^'require baseclass';\n?/, '');
	const baseclass = { extend: (obj) => obj };
	const fn = new Function('baseclass', src);
	return fn(baseclass);
}

export function loadBlockyParseCore() {
	return loadLuCiCore('blocky-parse-core.js');
}

export function loadBlockyConfigCore(parseCore) {
	const file = join(RES_DIR, 'blocky-config-core.js');
	let src = readFileSync(file, 'utf8');
	src = src.replace(/^'use strict';\n?/, '');
	src = src.replace(/^'require blocky-parse-core as bp';\n?/, '');
	src = src.replace(/^'require baseclass';\n?/, '');
	src = 'function safeString(value) { return bp.safeString(value); }\n' + src;
	const baseclass = { extend: (obj) => obj };
	const fn = new Function('bp', 'baseclass', src);
	return fn(parseCore, baseclass);
}

export function fixturePath(name) {
	return join(TEST_DIR, 'fixtures', name);
}

export function readFixture(name) {
	return readFileSync(fixturePath(name), 'utf8');
}
