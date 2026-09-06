#!/usr/bin/env ucode

'use strict';

import { readfile, popen } from 'fs';

function shell_quote(val) {
	val = `${val}`;
	let out = "'";
	for (let i = 0; i < length(val); i++) {
		let c = substr(val, i, 1);
		out += c == "'" ? "'\\''" : c;
	}
	out += "'";
	return out;
}

function run_cmd(cmd) {
	let p = popen(`${cmd} 2>&1`, 'r');
	if (!p)
		return { code: 1, output: 'popen failed' };
	let output = trim(p.read('all') || '');
	let code = p.close();
	return { code, output };
}

function file_test(flag, path) {
	let p = popen(`test ${flag} ${shell_quote(path)} && echo yes`, 'r');
	let ok = trim(p ? (p.read('all') || '') : '') == 'yes';
	if (p)
		p.close();
	return ok;
}

function uci_get(sect, opt, fallback) {
	let r = run_cmd(`uci -q get snort.${sect}.${opt}`);
	if (r.code != 0 || r.output == '')
		return fallback;
	return r.output;
}

function unwrap_net(val) {
	val = trim(`${val}`);
	while (length(val) >= 2 && substr(val, 0, 1) == '[' &&
	       substr(val, length(val) - 1, 1) == ']')
		val = trim(substr(val, 1, length(val) - 2));
	return replace(val, /[ \t]+/g, '');
}

function first_pid(raw) {
	let parts = split(trim(`${raw}`), /[ \n\t]+/);
	let pid = parts[0] || '';
	if (!match(pid, /^[0-9]+$/))
		return '';
	return pid;
}

function parse_rss_kb(pid) {
	if (pid == '')
		return 0;
	let txt = readfile(`/proc/${pid}/status`) || '';
	let m = match(txt, /VmRSS:\s+([0-9]+)/);
	return m ? int(m[1]) : 0;
}

function parse_meminfo() {
	let txt = readfile('/proc/meminfo') || '';
	let tot = match(txt, /MemTotal:\s+([0-9]+)/);
	let avail = match(txt, /MemAvailable:\s+([0-9]+)/);
	let free = match(txt, /MemFree:\s+([0-9]+)/);
	let total_kb = tot ? int(tot[1]) : 0;
	let free_kb = avail ? int(avail[1]) : (free ? int(free[1]) : 0);
	let used_kb = total_kb > free_kb ? total_kb - free_kb : 0;
	let percent = total_kb > 0 ? int(used_kb * 100 / total_kb) : 0;
	return {
		mem_total_kb: total_kb,
		mem_free_kb: free_kb,
		mem_used_kb: used_kb,
		mem_percent: percent
	};
}

const FLAG_OPTS = [ 'enabled', 'manual', 'logging', 'openappid' ];
const STRING_OPTS = {
	interface: /^[A-Za-z0-9_.-]+$/,
	home_net: /^[A-Za-z0-9.\/!$,_-]+$/,
	external_net: /^[A-Za-z0-9.\/!$,_-]+$/,
	mode: /^(ids|ips)$/,
	method: /^(afpacket|nfq)$/,
	action: /^(default|alert|block|drop|reject)$/,
	log_dir: /^\/[ -~]+$/,
	config_dir: /^\/[ -~]+$/,
	temp_dir: /^\/[ -~]+$/,
	oinkcode: /^[A-Za-z0-9]*$/,
	snaplen: /^\d+$/
};

function normalize_flag(v) {
	v = `${v}`;
	if (v == 'true' || v == '1' || v == 'on' || v == 'yes')
		return '1';
	if (v == 'false' || v == '0' || v == 'off' || v == 'no' || v == '')
		return '0';
	return v;
}

function normalize_value(k, v) {
	if (index(FLAG_OPTS, k) >= 0)
		return normalize_flag(v);
	if (k == 'home_net' || k == 'external_net')
		return unwrap_net(v);
	v = trim(`${v}`);
	if (k == 'method' && v == 'pcap')
		return 'afpacket';
	if (k == 'log_dir' && (v == '/var/log' || v == '/var/log/'))
		return '/var/log/snort';
	return v;
}

function snort_log_dir() {
	return normalize_value('log_dir', uci_get('snort', 'log_dir', '/var/log/snort'));
}

function validate_field(k, v) {
	v = normalize_value(k, v);
	if (index(FLAG_OPTS, k) >= 0) {
		if (v != '0' && v != '1')
			return `invalid ${k}`;
		return null;
	}
	if (!(k in STRING_OPTS))
		return `invalid ${k}`;
	if (!match(v, STRING_OPTS[k]))
		return `invalid ${k}`;
	if (k == 'snaplen') {
		let n = int(v);
		if (n < 0 || n > 65535)
			return `invalid ${k}`;
	}
	return null;
}

function parse_enabled_flag(v) {
	v = `${v}`;
	if (v == 'true' || v == '1' || v == 'on' || v == 'yes')
		return '1';
	if (v == 'false' || v == '0' || v == 'off' || v == 'no')
		return '0';
	return null;
}

function valid_pass_ip(s) {
	s = trim(`${s}`);
	if (s == '' || length(s) > 64)
		return false;
	return match(s, /^[0-9A-Fa-f.:/]+$/) != null;
}

function read_pass() {
	let ips = [];
	let raw = run_cmd('uci -q get snort.pass.ip').output;
	let one;
	let exists = run_cmd('uci -q get snort.pass').code == 0;
	let auto = exists ? '0' : '1';
	if (raw != '') {
		for (one in split(raw, /[ \t\n]+/)) {
			one = trim(`${one}`);
			if (one != '' && valid_pass_ip(one))
				push(ips, one);
		}
	}
	return {
		local_nets: parse_enabled_flag(run_cmd('uci -q get snort.pass.local_nets').output) || auto,
		wan_gateway: parse_enabled_flag(run_cmd('uci -q get snort.pass.wan_gateway').output) || auto,
		wan_dns: parse_enabled_flag(run_cmd('uci -q get snort.pass.wan_dns').output) || auto,
		vpn_addrs: parse_enabled_flag(run_cmd('uci -q get snort.pass.vpn_addrs').output) || '0',
		ips
	};
}

function read_suppress() {
	let out = [];
	let idx = run_cmd("uci -q show snort | sed -n 's/^snort\\.@suppress\\[\\([0-9]*\\)\\]=suppress/\\1/p'");
	if (!idx.output)
		return out;
	for (let line in split(idx.output, '\n')) {
		if (line == '')
			continue;
		let sid = run_cmd(`uci -q get snort.@suppress[${line}].sid`).output;
		let gid = run_cmd(`uci -q get snort.@suppress[${line}].gid`).output;
		let track = run_cmd(`uci -q get snort.@suppress[${line}].track`).output;
		let ip = run_cmd(`uci -q get snort.@suppress[${line}].ip`).output;
		let comment = run_cmd(`uci -q get snort.@suppress[${line}].comment`).output;
		if (!match(sid, /^[0-9]+$/) || !valid_pass_ip(ip))
			continue;
		if (gid == '' || !match(gid, /^[0-9]+$/))
			gid = '1';
		if (track != 'by_src' && track != 'by_dst')
			track = 'by_src';
		push(out, { sid, gid, track, ip, comment: comment || '' });
	}
	return out;
}

function replace_pass(p) {
	let ips;
	let one;
	if (type(p) != 'object')
		return 'invalid pass list';
	ips = p.ips;
	if (type(ips) != 'array')
		ips = [];
	run_cmd('uci -q delete snort.pass');
	run_cmd('uci set snort.pass=pass');
	run_cmd(`uci set snort.pass.local_nets=${parse_enabled_flag(p.local_nets) || '0'}`);
	run_cmd(`uci set snort.pass.wan_gateway=${parse_enabled_flag(p.wan_gateway) || '0'}`);
	run_cmd(`uci set snort.pass.wan_dns=${parse_enabled_flag(p.wan_dns) || '0'}`);
	run_cmd(`uci set snort.pass.vpn_addrs=${parse_enabled_flag(p.vpn_addrs) || '0'}`);
	for (one in ips) {
		one = trim(`${one}`);
		if (!valid_pass_ip(one))
			return 'invalid pass ip';
		run_cmd(`uci add_list snort.pass.ip=${shell_quote(one)}`);
	}
	return null;
}

function replace_suppress(rows) {
	let row;
	let sid;
	let gid;
	let track;
	let ip;
	let comment;
	if (type(rows) != 'array')
		return 'invalid suppress';
	if (length(rows) > 100)
		return 'invalid suppress';
	while (run_cmd('uci -q get snort.@suppress[0]').code == 0)
		run_cmd('uci -q delete snort.@suppress[0]');
	for (row in rows) {
		if (type(row) != 'object')
			return 'invalid suppress';
		sid = trim(`${row.sid || ''}`);
		gid = trim(`${row.gid || '1'}`);
		track = trim(`${row.track || 'by_src'}`);
		ip = trim(`${row.ip || ''}`);
		comment = trim(`${row.comment || ''}`);
		if (!match(sid, /^[0-9]+$/) || !valid_pass_ip(ip))
			return 'invalid suppress';
		if (!match(gid, /^[0-9]+$/))
			gid = '1';
		if (track != 'by_src' && track != 'by_dst')
			track = 'by_src';
		if (length(comment) > 80)
			comment = substr(comment, 0, 80);
		run_cmd('uci add snort suppress');
		run_cmd(`uci set snort.@suppress[-1].sid=${shell_quote(sid)}`);
		run_cmd(`uci set snort.@suppress[-1].gid=${shell_quote(gid)}`);
		run_cmd(`uci set snort.@suppress[-1].track=${shell_quote(track)}`);
		run_cmd(`uci set snort.@suppress[-1].ip=${shell_quote(ip)}`);
		run_cmd(`uci set snort.@suppress[-1].comment=${shell_quote(comment)}`);
	}
	return null;
}

const RULES_DB = '/var/lib/snort/rules.sqlite';

function sqlite3_bin() {
	if (file_test('-x', '/usr/bin/sqlite3'))
		return '/usr/bin/sqlite3';
	if (file_test('-x', '/usr/sbin/sqlite3'))
		return '/usr/sbin/sqlite3';
	return 'sqlite3';
}

function file_ok(file) {
	file = trim(`${file}`);
	if (!match(file, /^[A-Za-z0-9][A-Za-z0-9._-]*\.rules$/))
		return false;
	if (length(file) > 80)
		return false;
	return true;
}

function like_safe(s) {
	s = trim(`${s}`);
	s = replace(s, /[%_\\']/g, '');
	if (length(s) > 64)
		s = substr(s, 0, 64);
	return s;
}

function ident_safe(s) {
	s = trim(`${s}`);
	if (!match(s, /^[A-Za-z0-9._-]*$/))
		return '';
	if (length(s) > 80)
		return '';
	return s;
}

function int_arg(v, dflt, lo, hi) {
	let n = int(v);
	if (n < lo)
		return dflt;
	if (n > hi)
		return hi;
	return n;
}

function sid_map() {
	let out = {};
	let r = run_cmd("uci -q show snort | sed -n 's/^snort\\.s\\([0-9][0-9]*\\)=sid$/\\1/p'");
	if (!r.output)
		return out;
	for (let line in split(r.output, '\n')) {
		if (line == '')
			continue;
		let en = run_cmd(`uci -q get snort.s${line}.enabled`).output;
		let st = run_cmd(`uci -q get snort.s${line}.status`).output;
		if (en == '')
			en = '1';
		if (st == '')
			st = en == '0' ? 'disabled' : 'enabled';
		out[line] = { enabled: en, status: st };
	}
	return out;
}

function distinct_col(col) {
	if (col != 'file' && col != 'classtype')
		return [];
	let bin = sqlite3_bin();
	let r = run_cmd(`${bin} -separator '|' ${shell_quote(RULES_DB)} ${shell_quote(`SELECT DISTINCT ${col} FROM rules WHERE ${col} != '' ORDER BY ${col};`)}`);
	let out = [];
	if (r.code != 0 || !r.output)
		return out;
	for (let line in split(r.output, '\n')) {
		if (line != '')
			push(out, line);
	}
	return out;
}

function file_counts() {
	let out = {};
	if (!file_test('-f', RULES_DB))
		return out;
	let bin = sqlite3_bin();
	let r = run_cmd(`${bin} -separator '|' ${shell_quote(RULES_DB)} "SELECT file, COUNT(*) FROM rules GROUP BY file;"`);
	if (r.code != 0 || !r.output)
		return out;
	for (let line in split(r.output, '\n')) {
		if (line == '')
			continue;
		let p = split(line, '|');
		if (length(p) < 2 || !file_ok(p[0]))
			continue;
		out[p[0]] = int(p[1]) || 0;
	}
	return out;
}

function get_policies() {
	let counts = file_counts();
	let uci_rs = {};
	let custom = false;
	let i = 0;
	while (run_cmd(`uci -q get snort.@rulefile[${i}]`).code == 0) {
		let file = run_cmd(`uci -q get snort.@rulefile[${i}].file`).output;
		let enabled = run_cmd(`uci -q get snort.@rulefile[${i}].enabled`).output;
		i++;
		if (!file_ok(file))
			continue;
		custom = true;
		uci_rs[file] = enabled == '0' ? '0' : '1';
	}
	let files = [];
	for (let f in counts)
		push(files, f);
	let rulesets = [];
	for (let file in files) {
		let enabled = '1';
		if (uci_rs[file])
			enabled = uci_rs[file];
		else if (custom)
			enabled = '0';
		push(rulesets, {
			file,
			enabled,
			count: `${counts[file] || 0}`
		});
	}
	return { custom: custom ? '1' : '0', rulesets };
}

function replace_policies(rulesets) {
	let seen;
	let i;
	let file;
	let enabled;
	if (type(rulesets) != 'array')
		return 'invalid rulesets';
	if (length(rulesets) > 80)
		return 'invalid rulesets';
	seen = {};
	for (i = 0; i < length(rulesets); i++) {
		if (type(rulesets[i]) != 'object')
			return 'invalid ruleset';
		file = trim(`${rulesets[i].file || ''}`);
		if (!file_ok(file) || seen[file])
			return 'invalid ruleset';
		seen[file] = 1;
	}
	while (run_cmd('uci -q get snort.@rulefile[0]').code == 0)
		run_cmd('uci -q delete snort.@rulefile[0]');
	for (i = 0; i < length(rulesets); i++) {
		file = trim(`${rulesets[i].file}`);
		enabled = parse_enabled_flag(rulesets[i].enabled);
		if (enabled == null)
			enabled = '1';
		run_cmd('uci add snort rulefile');
		run_cmd(`uci set snort.@rulefile[-1].file=${shell_quote(file)}`);
		run_cmd(`uci set snort.@rulefile[-1].enabled=${enabled}`);
	}
	return null;
}

function sql_in_list(map) {
	let ids = [];
	for (let sid in map)
		push(ids, sid);
	if (!length(ids))
		return '';
	return join(',', ids);
}

function query_rules(args) {
	let query = like_safe(args?.query || '');
	let classtype = ident_safe(args?.classtype || '');
	let file = ident_safe(args?.file || '');
	let state = trim(`${args?.state || 'all'}`);
	if (state != 'enabled' && state != 'disabled' && state != 'review' && state != 'expired')
		state = 'all';
	let offset = int_arg(args?.offset, 0, 0, 1000000);
	let limit = int_arg(args?.limit, 50, 1, 100);
	let overrides = sid_map();
	let disabled = {};
	let review = {};
	let expired = {};
	for (let sid in overrides) {
		let row = overrides[sid];
		if (row.status == 'review')
			review[sid] = 1;
		if (row.status == 'expired')
			expired[sid] = 1;
		if (row.enabled == '0' || row.status == 'disabled' || row.status == 'expired')
			disabled[sid] = 1;
	}
	let dis_sql = sql_in_list(disabled);
	let review_sql = sql_in_list(review);
	let expired_sql = sql_in_list(expired);
	let indexed = file_test('-f', RULES_DB);
	let empty = {
		rules: [],
		total: 0,
		offset,
		limit,
		files: [],
		classtypes: [],
		indexed,
		indexed_count: 0,
		disabled_count: length(disabled)
	};
	if (!indexed)
		return empty;

	let bin = sqlite3_bin();
	let count_r = run_cmd(`${bin} ${shell_quote(RULES_DB)} 'SELECT COUNT(*) FROM rules;'`);
	empty.indexed_count = int(count_r.output) || 0;
	empty.files = distinct_col('file');
	empty.classtypes = distinct_col('classtype');

	if (state == 'disabled' && dis_sql == '')
		return empty;
	if (state == 'review' && review_sql == '')
		return empty;
	if (state == 'expired' && expired_sql == '')
		return empty;

	let where = '1=1';
	if (query != '') {
		let like = `'%${query}%'`;
		where += ` AND (msg LIKE ${like} OR file LIKE ${like} OR classtype LIKE ${like} OR CAST(sid AS TEXT) LIKE ${like}`;
		if (match(query, /^[0-9]+$/))
			where += ` OR sid = ${query}`;
		where += ')';
	}
	if (classtype != '')
		where += ` AND classtype = '${classtype}'`;
	if (file != '')
		where += ` AND file = '${file}'`;
	if (state == 'disabled')
		where += ` AND sid IN (${dis_sql})`;
	else if (state == 'enabled' && dis_sql != '')
		where += ` AND sid NOT IN (${dis_sql})`;
	else if (state == 'review')
		where += ` AND sid IN (${review_sql})`;
	else if (state == 'expired')
		where += ` AND sid IN (${expired_sql})`;

	let total_sql = `SELECT COUNT(*) FROM rules WHERE ${where};`;
	let total_r = run_cmd(`${bin} ${shell_quote(RULES_DB)} ${shell_quote(total_sql)}`);
	let total = int(total_r.output) || 0;
	let sql = `SELECT gid, sid, rev, action, classtype, file, msg, raw FROM rules WHERE ${where} ORDER BY sid LIMIT ${limit} OFFSET ${offset};`;
	let r = run_cmd(`${bin} -json ${shell_quote(RULES_DB)} ${shell_quote(sql)}`);
	let rows = [];
	if (r.code == 0 && r.output) {
		try {
			rows = json(r.output);
		} catch (e) {
			rows = [];
		}
	}
	if (type(rows) != 'array')
		rows = [];
	let rules = [];
	for (let row in rows) {
		let sid = `${row.sid}`;
		push(rules, {
			gid: `${row.gid}`,
			sid,
			rev: `${row.rev}`,
			action: row.action || '',
			classtype: row.classtype || '',
			file: `${row.file || ''}`,
			msg: row.msg || '',
			raw: row.raw || '',
			enabled: disabled[sid] ? '0' : '1',
			status: (overrides[sid] && overrides[sid].status) ? overrides[sid].status : (disabled[sid] ? 'disabled' : 'enabled')
		});
	}
	empty.rules = rules;
	empty.total = total;
	return empty;
}

function write_sid_status(sid, gid, status) {
	let enabled = (status == 'disabled' || status == 'expired') ? '0' : '1';
	run_cmd(`uci -q get snort.s${sid} >/dev/null || uci set snort.s${sid}=sid`);
	run_cmd(`uci set snort.s${sid}.sid=${shell_quote(sid)}`);
	run_cmd(`uci set snort.s${sid}.gid=${shell_quote(gid)}`);
	run_cmd(`uci set snort.s${sid}.enabled=${enabled}`);
	run_cmd(`uci set snort.s${sid}.status=${shell_quote(status)}`);
}

function write_sid_state(sid, gid, enabled) {
	if (enabled == '0')
		write_sid_status(sid, gid, 'disabled');
	else
		write_sid_status(sid, gid, 'enabled');
}

function commit_rule_states() {
	run_cmd('uci commit snort');
	if (file_test('-x', '/usr/sbin/snort-rules-apply'))
		run_cmd('/usr/sbin/snort-rules-apply');
	let running = run_cmd('pidof snort >/dev/null && echo 1 || echo 0').output == '1';
	if (running)
		run_cmd('/etc/init.d/snort restart');
}

function feed_id_ok(id) {
	if (!match(`${id}`, /^[A-Za-z_][A-Za-z0-9_]*$/))
		return false;
	if (id == 'snort' || id == 'nfq' || id == 'pass')
		return false;
	if (match(`${id}`, /^s[0-9]+$/))
		return false;
	return true;
}

function feed_url_ok(url) {
	let s = trim(`${url}`);
	let out = '';
	let i = 0;
	let n = length(s);
	while (i < n) {
		let ch = substr(s, i, 1);
		if (ch == chr(123)) {
			let j = i + 1;
			while (j < n && substr(s, j, 1) != chr(125))
				j++;
			if (j >= n)
				return false;
			out += 'x';
			i = j + 1;
			continue;
		}
		out += ch;
		i++;
	}
	return match(out, /^https:\/\/[-A-Za-z0-9._~:/?#@!$&()*+,;=%]+$/) != null;
}

const COMMUNITY_RULES_URL = 'https://www.snort.org/downloads/community/snort3-community-rules.tar.gz';

function list_rulesets() {
	let feeds = [];
	let r = run_cmd("uci -q show snort | sed -n 's/^snort\\.\\([^=]*\\)=ruleset$/\\1/p'");
	if (r.output) {
		for (let line in split(r.output, '\n')) {
			if (line == '' || line == 'snort' || line == 'nfq' || line == 'pass')
				continue;
			let name = run_cmd(`uci -q get snort.${line}.name`).output || line;
			let url = run_cmd(`uci -q get snort.${line}.url`).output;
			let enabled = run_cmd(`uci -q get snort.${line}.enabled`).output;
			let description = run_cmd(`uci -q get snort.${line}.description`).output;
			if (url == '')
				continue;
			push(feeds, {
				id: line,
				name,
				url,
				enabled: enabled == '' ? '1' : enabled,
				description: description || ''
			});
		}
	}
	if (!length(feeds)) {
		push(feeds, {
			id: 'community',
			name: 'Snort 3 community',
			url: COMMUNITY_RULES_URL,
			enabled: '1',
			description: 'Free Snort 3 community ruleset'
		});
	}
	return feeds;
}

function replace_rulesets(feeds) {
	if (type(feeds) != 'array')
		return 'invalid feeds';
	let seen = {};
	let i = 0;
	for (let feed in feeds) {
		if (type(feed) != 'object')
			return 'invalid feed';
		let name = trim(`${feed.name || ''}`);
		let url = trim(`${feed.url || ''}`);
		if (name == '' || !feed_url_ok(url))
			return 'invalid feed';
		let id = trim(`${feed.id || ''}`);
		if (!feed_id_ok(id) || id == 'snort' || id == 'nfq' || id == 'pass')
			id = 'ruleset' + i;
		if (seen[id])
			return 'duplicate feed id';
		seen[id] = 1;
		i++;
	}
	let cur = run_cmd("uci -q show snort | sed -n 's/^snort\\.\\([^=]*\\)=ruleset$/\\1/p'");
	if (cur.output) {
		for (let line in split(cur.output, '\n')) {
			if (line != '' && line != 'snort' && line != 'nfq' && line != 'pass')
				run_cmd(`uci -q delete snort.${line}`);
		}
	}
	i = 0;
	for (let feed in feeds) {
		let id = trim(`${feed.id || ''}`);
		if (!feed_id_ok(id) || id == 'snort' || id == 'nfq' || id == 'pass')
			id = 'ruleset' + i;
		let enabled = `${feed.enabled}`;
		if (enabled == 'true' || enabled == '1' || enabled == 'on' || enabled == 'yes')
			enabled = '1';
		else
			enabled = '0';
		run_cmd(`uci set snort.${id}=ruleset`);
		run_cmd(`uci set snort.${id}.name=${shell_quote(trim(`${feed.name}`))}`);
		run_cmd(`uci set snort.${id}.url=${shell_quote(trim(`${feed.url}`))}`);
		run_cmd(`uci set snort.${id}.enabled=${enabled}`);
		run_cmd(`uci set snort.${id}.description=${shell_quote(trim(`${feed.description || ''}`))}`);
		i++;
	}
	return null;
}

function get_config() {
	return {
		enabled: uci_get('snort', 'enabled', '0'),
		manual: uci_get('snort', 'manual', '0'),
		interface: uci_get('snort', 'interface', 'br-lan'),
		home_net: uci_get('snort', 'home_net', '192.168.8.0/24'),
		external_net: uci_get('snort', 'external_net', 'any'),
		mode: uci_get('snort', 'mode', 'ids'),
		method: uci_get('snort', 'method', 'afpacket'),
		action: uci_get('snort', 'action', 'alert'),
		snaplen: uci_get('snort', 'snaplen', '1518'),
		logging: uci_get('snort', 'logging', '1'),
		openappid: uci_get('snort', 'openappid', '0'),
		log_dir: snort_log_dir(),
		config_dir: uci_get('snort', 'config_dir', '/etc/snort'),
		temp_dir: uci_get('snort', 'temp_dir', '/var/snort.d'),
		oinkcode: uci_get('snort', 'oinkcode', ''),
		feeds: list_rulesets(),
		pass: read_pass(),
		suppress: read_suppress()
	};
}

function rules_info() {
	let config_rules = '/etc/snort/rules';
	let temp_rules = '/var/snort.d/rules';
	let symlink = file_test('-L', config_rules);
	let target = '';
	if (symlink)
		target = run_cmd(`readlink ${shell_quote(config_rules)}`).output;
	let count = run_cmd("find -L /etc/snort/rules -type f -name '*.rules' 2>/dev/null | wc -l").output;
	return {
		symlink,
		target,
		temp_exists: file_test('-d', temp_rules),
		config_exists: file_test('-d', config_rules) || symlink,
		rule_files: int(trim(count)) || 0
	};
}

function endpoint_host(ip, port, keep) {
	ip = trim(`${ip}`);
	port = trim(`${port}`);
	if (keep && ip != '' && port != '' && port != '0')
		return ip + '(' + port + ')';
	return ip;
}

function sort_by_count(rows) {
	let n = length(rows);
	let i;
	let j;
	let best;
	let tmp;
	for (i = 0; i < n; i++) {
		best = i;
		j = i + 1;
		while (j < n) {
			if (rows[j].count > rows[best].count)
				best = j;
			j++;
		}
		if (best != i) {
			tmp = rows[i];
			rows[i] = rows[best];
			rows[best] = tmp;
		}
	}
	return rows;
}

function list_alert_json(dir) {
	let files = [];
	let r = run_cmd(`find -L ${shell_quote(dir)} -maxdepth 2 -type f -name '*alert_json.txt' 2>/dev/null`);
	if (!r.output)
		return files;
	for (let line in split(r.output, '\n')) {
		if (line != '')
			push(files, line);
	}
	return files;
}

function lookup_triggered_rules(pairs) {
	let out = [];
	let bin = sqlite3_bin();
	if (!file_test('-f', RULES_DB))
		return out;
	let seen = {};
	for (let pair in pairs) {
		let gid = trim(`${pair.gid}`);
		let sid = trim(`${pair.sid}`);
		if (!match(gid, /^[0-9]+$/) || !match(sid, /^[0-9]+$/))
			continue;
		let key = gid + ':' + sid;
		if (seen[key])
			continue;
		seen[key] = 1;
		let sql = 'SELECT gid, sid, file, msg, raw FROM rules WHERE gid = ' + gid +
			' AND sid = ' + sid + ' LIMIT 1;';
		let r = run_cmd(`${bin} -json ${shell_quote(RULES_DB)} ${shell_quote(sql)}`);
		let rows = [];
		if (r.code == 0 && r.output) {
			try {
				rows = json(r.output);
			}
			catch (e) {
				rows = [];
			}
		}
		if (type(rows) != 'array' || length(rows) < 1) {
			push(out, {
				gid,
				sid,
				file: '',
				msg: '',
				snippet: ''
			});
			continue;
		}
		let row = rows[0];
		let raw = `${row.raw || ''}`;
		if (length(raw) > 160)
			raw = substr(raw, 0, 160);
		push(out, {
			gid: `${row.gid || gid}`,
			sid: `${row.sid || sid}`,
			file: `${row.file || ''}`,
			msg: `${row.msg || ''}`,
			snippet: raw
		});
		if (length(out) >= 40)
			break;
	}
	return out;
}

function build_incident_report(limit, pattern) {
	limit = int_arg(limit, 50, 1, 200);
	pattern = trim(`${pattern}`);
	if (length(pattern) > 64)
		pattern = substr(pattern, 0, 64);
	let log_dir = snort_log_dir();
	let logging = uci_get('snort', 'logging', '1');
	let files = list_alert_json(log_dir);
	let file_info = [];
	let buckets = {};
	let total = 0;
	let scanned = 0;
	let max_lines = 4000;
	let file;
	let lines;
	let line;
	let obj;
	let msg;
	let src;
	let dst;
	let dir;
	let gid;
	let sid;
	let key;
	let hay;
	let pat_lc = lc(pattern);
	for (file in files) {
		let bytes = int(run_cmd(`wc -c < ${shell_quote(file)}`).output) || 0;
		let nlines = int(run_cmd(`wc -l < ${shell_quote(file)}`).output) || 0;
		push(file_info, { path: file, bytes, lines: nlines });
		total += nlines;
		if (scanned >= max_lines)
			continue;
		let take = max_lines - scanned;
		lines = run_cmd(`tail -n ${take} ${shell_quote(file)}`).output;
		if (!lines)
			continue;
		for (line in split(lines, '\n')) {
			if (line == '')
				continue;
			scanned++;
			try {
				obj = json(line);
			}
			catch (e) {
				continue;
			}
			if (type(obj) != 'object')
				continue;
			msg = trim(`${obj.msg || ''}`);
			dir = trim(`${obj.dir || ''}`);
			gid = trim(`${obj.gid || ''}`);
			sid = trim(`${obj.sid || ''}`);
			src = endpoint_host(obj.src_addr, obj.src_port, dir == 'S2C');
			dst = endpoint_host(obj.dst_addr, obj.dst_port, dir == 'C2S');
			key = msg + '\t' + src + '\t' + dst + '\t' + dir + '\t' + gid + '\t' + sid;
			if (pattern != '') {
				hay = lc(key);
				if (index(hay, pat_lc) < 0)
					continue;
			}
			if (buckets[key])
				buckets[key].count++;
			else
				buckets[key] = {
					count: 1,
					msg,
					src,
					dst,
					dir,
					gid,
					sid
				};
		}
	}
	let rows = [];
	let k;
	for (k in buckets)
		push(rows, buckets[k]);
	rows = sort_by_count(rows);
	if (length(rows) > limit) {
		let clipped = [];
		let i = 0;
		while (i < limit) {
			push(clipped, rows[i]);
			i++;
		}
		rows = clipped;
	}
	let shown = 0;
	for (let row in rows)
		shown += row.count;
	let status = '';
	if (file_test('-x', '/usr/bin/snort-mgr'))
		status = run_cmd('/usr/bin/snort-mgr status').output;
	let fast = log_dir + '/alert_fast.txt';
	return {
		ok: true,
		logging: logging == '1',
		log_dir,
		total,
		scanned,
		shown_events: shown,
		limit,
		pattern,
		fast_alert: file_test('-f', fast) ? fast : '',
		files: file_info,
		incidents: rows,
		rules: lookup_triggered_rules(rows),
		status
	};
}

const methods = {
	getStatus: {
		call: function() {
			let running = run_cmd('pidof snort >/dev/null && echo 1 || echo 0').output == '1';
			let pid = running ? first_pid(run_cmd('pidof snort').output) : '';
			let log_dir = snort_log_dir();
			let alert = `${log_dir}/alert_fast.txt`;
			let alert_count = 0;
			if (file_test('-f', alert))
				alert_count = int(run_cmd(`wc -l < ${shell_quote(alert)}`).output) || 0;
			let enabled_boot = run_cmd('/etc/init.d/snort enabled && echo 1 || echo 0').output == '1';
			let mem = parse_meminfo();
			return {
				running,
				pid,
				alert_count,
				enabled_boot,
				present: file_test('-x', '/usr/bin/snort'),
				interface: uci_get('snort', 'interface', 'br-lan'),
				mode: uci_get('snort', 'mode', 'ids'),
				method: uci_get('snort', 'method', 'afpacket'),
				enabled: uci_get('snort', 'enabled', '0'),
				mem_rss_kb: parse_rss_kb(pid),
				mem_total_kb: mem.mem_total_kb,
				mem_used_kb: mem.mem_used_kb,
				mem_free_kb: mem.mem_free_kb,
				mem_percent: mem.mem_percent,
				rules: rules_info()
			};
		}
	},

	getConfig: {
		call: function() {
			try {
				return get_config();
			} catch (e) {
				return { error: `get_config ${e}` };
			}
		}
	},

	setConfig: {
		args: { config: {} },
		call: function(req) {
			let cfg = req.args?.config;
			if (type(cfg) != 'object')
				return { error: 'invalid config' };
			let keys = [];
			for (let k in cfg)
				push(keys, k);
			if (length(keys) == 0)
				return { error: 'invalid config' };
			run_cmd('uci -q get snort.snort >/dev/null || uci set snort.snort=snort');
			if ('feeds' in cfg) {
				let ferr = replace_rulesets(cfg.feeds);
				if (ferr)
					return { error: ferr };
			}
			if ('pass' in cfg) {
				let perr = replace_pass(cfg.pass);
				if (perr)
					return { error: perr };
			}
			if ('suppress' in cfg) {
				let serr = replace_suppress(cfg.suppress);
				if (serr)
					return { error: serr };
			}
			for (let k in cfg) {
				if (k == 'feeds' || k == 'pass' || k == 'suppress')
					continue;
				let err = validate_field(k, cfg[k]);
				if (err)
					return { error: err };
				let v = normalize_value(k, cfg[k]);
				run_cmd(`uci set snort.snort.${k}=${shell_quote(v)}`);
			}
			run_cmd('uci commit snort');
			return { ok: true, config: get_config() };
		}
	},

	serviceControl: {
		args: { action: '' },
		call: function(req) {
			let action = req.args?.action || '';
			if (action != 'start' && action != 'stop' && action != 'restart' &&
			    action != 'enable' && action != 'disable')
				return { error: 'invalid action' };
			if ((action == 'start' || action == 'restart') &&
			    uci_get('snort', 'enabled', '0') != '1')
				return {
					ok: false,
					output: 'snort.snort.enabled is 0; enable the service in Settings first'
				};
			let r = run_cmd(`/etc/init.d/snort ${action}`);
			return { ok: r.code == 0, output: r.output };
		}
	},

	getAlerts: {
		args: { limit: 50 },
		call: function(req) {
			let limit = int(req.args?.limit) || 50;
			if (limit < 1)
				limit = 1;
			if (limit > 200)
				limit = 200;
			let log_dir = uci_get('snort', 'log_dir', '/var/log');
			let alert = `${log_dir}/alert_fast.txt`;
			let alerts = '';
			if (file_test('-f', alert))
				alerts = run_cmd(`tail -n ${limit} ${shell_quote(alert)}`).output;
			let logs = run_cmd(`logread -e snort | tail -n 20`).output;
			return { alerts, logs };
		}
	},

	updateRules: {
		call: function() {
			if (!file_test('-x', '/usr/bin/snort-rules'))
				return { error: 'snort-rules not installed' };
			if (file_test('-f', '/tmp/snort_rules_update.lock'))
				return { ok: false, running: true, error: 'update already in progress' };
			run_cmd('touch /tmp/snort_rules_update.lock');
			run_cmd("( /usr/bin/snort-rules > /tmp/snort_rules_update.log 2>&1; /usr/sbin/snort-rules-index >> /tmp/snort_rules_update.log 2>&1; /usr/sbin/snort-rules-apply >> /tmp/snort_rules_update.log 2>&1; rm -f /var/snort.d/*.tar.gz /tmp/snort*.tar.gz /var/snort.d/rules/*.tar.gz; rm -f /tmp/snort_rules_update.lock; echo FINISHED >> /tmp/snort_rules_update.log ) >/dev/null 2>&1 &");
			return { ok: true, running: true };
		}
	},

	updateStatus: {
		call: function() {
			let running = file_test('-f', '/tmp/snort_rules_update.lock');
			let log = '';
			let finished = false;
			if (file_test('-f', '/tmp/snort_rules_update.log')) {
				log = run_cmd('tail -n 20 /tmp/snort_rules_update.log').output;
				finished = index(log, 'FINISHED') >= 0;
			}
			return { running: running && !finished, finished, log };
		}
	},

	fixRules: {
		call: function() {
			let config_rules = '/etc/snort/rules';
			let temp_rules = '/var/snort.d/rules';
			if (!file_test('-d', temp_rules))
				return { ok: false, error: 'missing /var/snort.d/rules' };
			if (file_test('-d', config_rules) && !file_test('-L', config_rules))
				run_cmd(`mv ${shell_quote(config_rules)} ${shell_quote(config_rules)}.backup`);
			else if (file_test('-L', config_rules))
				run_cmd(`rm -f ${shell_quote(config_rules)}`);
			let r = run_cmd(`ln -sf ${shell_quote(temp_rules)} ${shell_quote(config_rules)}`);
			return { ok: r.code == 0, output: r.output, rules: rules_info() };
		}
	},

	cleanupTemp: {
		call: function() {
			if (file_test('-f', '/tmp/snort_rules_update.lock'))
				return { ok: false, error: 'update already in progress' };
			run_cmd('rm -f /var/snort.d/*.tar.gz /tmp/snort*.tar.gz /var/snort.d/rules/*.tar.gz');
			run_cmd('rm -f /tmp/snort_rules_update.lock');
			return { ok: true };
		}
	},

	getRules: {
		args: {
			query: '',
			classtype: '',
			file: '',
			state: '',
			offset: 0,
			limit: 50
		},
		call: function(req) {
			return query_rules(req.args || {});
		}
	},

	setRuleStates: {
		args: { sids: [], gid: '', enabled: '', status: '' },
		call: function(req) {
			let sids = req.args?.sids;
			let gid = trim(`${req.args?.gid || '1'}`);
			let enabled = parse_enabled_flag(req.args?.enabled);
			let status = trim(`${req.args?.status || ''}`);
			let i;
			let sid;
			let seen = {};
			let out = [];
			if (type(sids) != 'array')
				return { error: 'invalid sids' };
			if (!match(gid, /^[0-9]+$/))
				return { error: 'invalid sid' };
			if (status != '' && status != 'enabled' && status != 'review' &&
			    status != 'expired' && status != 'disabled')
				return { error: 'invalid status' };
			if (status == '' && enabled == null)
				return { error: 'invalid enabled' };
			if (length(sids) < 1 || length(sids) > 50)
				return { error: 'invalid sids' };
			for (i = 0; i < length(sids); i++) {
				sid = trim(`${sids[i]}`);
				if (!match(sid, /^[0-9]+$/) || seen[sid])
					return { error: 'invalid sids' };
				seen[sid] = 1;
				push(out, sid);
			}
			run_cmd('uci -q get snort.snort >/dev/null || uci set snort.snort=snort');
			for (i = 0; i < length(out); i++) {
				if (status != '')
					write_sid_status(out[i], gid, status);
				else
					write_sid_state(out[i], gid, enabled);
			}
			commit_rule_states();
			return { ok: true, sids: out, gid, enabled, status };
		}
	},

	reindexRules: {
		call: function() {
			if (!file_test('-x', '/usr/sbin/snort-rules-index'))
				return { error: 'snort-rules-index not installed' };
			let dir = uci_get('snort', 'config_dir', '/etc/snort') + '/rules';
			let r = run_cmd(`/usr/sbin/snort-rules-index ${shell_quote(dir)}`);
			return {
				ok: r.code == 0,
				output: r.output,
				error: r.code == 0 ? '' : r.output
			};
		}
	},

	getPolicies: {
		call: function() {
			try {
				return get_policies();
			} catch (e) {
				return { error: `get_policies ${e}` };
			}
		}
	},

	setPolicies: {
		args: { policies: {} },
		call: function(req) {
			let p = req.args?.policies;
			if (type(p) != 'object')
				return { error: 'invalid policies' };
			run_cmd('uci -q get snort.snort >/dev/null || uci set snort.snort=snort');
			let err = replace_policies(p.rulesets);
			if (err)
				return { error: err };
			run_cmd('uci commit snort');
			if (file_test('-x', '/usr/sbin/snort-rules-apply'))
				run_cmd('/usr/sbin/snort-rules-apply');
			return { ok: true, policies: get_policies() };
		}
	}
};

return { 'luci.snort3': methods };
