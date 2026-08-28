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
	const fn = new Function(src);
	return fn();
}

export function loadBlockyParseCore() {
	return loadLuCiCore('blocky-parse-core.js');
}

export function loadBlockyConfigCore(parseCore) {
	const file = join(RES_DIR, 'blocky-config-core.js');
	let src = readFileSync(file, 'utf8');
	src = src.replace(/^'use strict';\n?/, '');
	src = src.replace(/^'require blocky-parse-core as bp';\n?/, '');
	src = 'function safeString(value) { return bp.safeString(value); }\n' + src;
	const fn = new Function('bp', src);
	return fn(parseCore);
}

export function fixturePath(name) {
	return join(TEST_DIR, 'fixtures', name);
}

export function readFixture(name) {
	return readFileSync(fixturePath(name), 'utf8');
}
