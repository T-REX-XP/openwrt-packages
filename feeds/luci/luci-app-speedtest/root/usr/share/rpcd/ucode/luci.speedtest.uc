#!/usr/bin/env ucode

'use strict';

import { access } from 'fs';
import { popen } from 'fs';

const SPEEDTEST_GO = '/usr/bin/speedtest-go';

function run_cmd(cmd) {
	let p = popen(`${cmd} 2>&1`, 'r');
	if (!p)
		return { ok: false, code: 1, output: 'popen failed' };
	let output = p.read('all') || '';
	let code = p.close();
	return { ok: code == 0, code, output };
}

const methods = {
	status: {
		call: function() {
			return {
				available: !!access(SPEEDTEST_GO),
				binary: SPEEDTEST_GO
			};
		}
	},

	run: {
		call: function() {
			if (!access(SPEEDTEST_GO))
				return { ok: false, code: 127, output: `${SPEEDTEST_GO} is missing. Install speedtest-go.` };

			return run_cmd(`${SPEEDTEST_GO}`);
		}
	}
};

return { 'luci.speedtest': methods };
