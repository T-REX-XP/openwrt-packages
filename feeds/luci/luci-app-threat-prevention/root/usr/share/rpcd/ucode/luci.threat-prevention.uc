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

function read_json_file(path) {
	if (!file_test('-f', path))
		return {};
	let raw = readfile(path);
	if (!raw)
		return {};
	try {
		return json(raw);
	} catch (e) {
		return {};
	}
}

function sqlite3_bin() {
	if (file_test('-x', '/usr/bin/sqlite3'))
		return '/usr/bin/sqlite3';
	if (file_test('-x', '/usr/sbin/sqlite3'))
		return '/usr/sbin/sqlite3';
	return 'sqlite3';
}

const const_defaults = {
	enabled: '0',
	mode: 'ids',
	interface: 'br-lan',
	home_net: '[192.168.8.0/24]',
	eve_path: '/var/log/suricata/eve.json',
	rule_dir: '/etc/suricata/rules',
	rule_profile: 'small',
	fail_open: '1'
};

const ETOPEN_OFFICIAL = 'https://rules.emergingthreats.net/open/suricata-8.0/emerging.rules.tar.gz';

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

const FLAG_OPTS = [ 'enabled', 'fail_open' ];
const STRING_OPTS = {
	mode: /^(ids|ips)$/,
	interface: /^[A-Za-z0-9_.-]+$/,
	home_net: /^\[.*\]$|^[0-9a-fA-F.:/ ,]+$/,
	eve_path: /^\/[ -~]+$/,
	rule_dir: /^\/[ -~]+$/,
	rule_profile: /^(small|full)$/
};

function uci_get(opt, fallback) {
	let r = run_cmd(`uci -q get suricata.main.${opt}`);
	if (r.code != 0 || r.output == '')
		return fallback;
	return r.output;
}

const SMALL_RULE_FILES = {
	'emerging-malware.rules': 1,
	'emerging-mobile_malware.rules': 1,
	'emerging-trojan.rules': 1,
	'emerging-worm.rules': 1,
	'emerging-exploit.rules': 1,
	'emerging-web_server.rules': 1
};

const RULES_DB = '/var/lib/threat-prevention/rules.sqlite';

function get_config() {
	let cfg = {};
	for (let k in const_defaults)
		cfg[k] = uci_get(k, const_defaults[k]);
	let classes = [];
	let idx = run_cmd("uci -q show suricata | sed -n 's/^suricata\\.@classtype\\[\\([0-9]*\\)\\]=classtype/\\1/p'");
	if (idx.output) {
		for (let line in split(idx.output, '\n')) {
			if (line == '')
				continue;
			let name = run_cmd(`uci -q get suricata.@classtype[${line}].name`).output;
			let action = run_cmd(`uci -q get suricata.@classtype[${line}].action`).output;
			push(classes, { name, action: action || 'alert' });
		}
	}
	cfg.classtypes = classes;
	cfg.feeds = list_etopen_feeds();
	return cfg;
}

function feed_id_ok(id) {
	if (!match(`${id}`, /^[A-Za-z_][A-Za-z0-9_]*$/))
		return false;
	if (id == 'main' || match(`${id}`, /^s[0-9]+$/))
		return false;
	return true;
}

function list_etopen_feeds() {
	let feeds = [];
	let r = run_cmd("uci -q show suricata | sed -n 's/^suricata\\.\\([^=]*\\)=etopen$/\\1/p'");
	if (r.output) {
		for (let line in split(r.output, '\n')) {
			if (line == '')
				continue;
			let name = run_cmd(`uci -q get suricata.${line}.name`).output || line;
			let url = run_cmd(`uci -q get suricata.${line}.url`).output;
			let enabled = run_cmd(`uci -q get suricata.${line}.enabled`).output;
			let description = run_cmd(`uci -q get suricata.${line}.description`).output;
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
		let old = uci_get('etopen_url', '');
		push(feeds, {
			id: 'official',
			name: 'Official ET Open 8.0',
			url: old != '' ? old : ETOPEN_OFFICIAL,
			enabled: '1',
			description: 'Proofpoint Emerging Threats Open for Suricata 8.0'
		});
	}
	return feeds;
}

function replace_etopen_feeds(feeds) {
	if (type(feeds) != 'array')
		return 'invalid feeds';
	let seen = {};
	let i = 0;
	for (let feed in feeds) {
		if (type(feed) != 'object')
			return 'invalid feed';
		let name = trim(`${feed.name || ''}`);
		let url = trim(`${feed.url || ''}`);
		let enabled = `${feed.enabled}`;
		if (enabled == 'true' || enabled == '1' || enabled == 'on' || enabled == 'yes')
			enabled = '1';
		else
			enabled = '0';
		if (name == '' || !feed_url_ok(url))
			return 'invalid feed';
		let id = trim(`${feed.id || ''}`);
		if (!feed_id_ok(id))
			id = 'etopen' + i;
		if (seen[id])
			return 'duplicate feed id';
		seen[id] = 1;
		i++;
	}
	let cur = run_cmd("uci -q show suricata | sed -n 's/^suricata\\.\\([^=]*\\)=etopen$/\\1/p'");
	if (cur.output) {
		for (let line in split(cur.output, '\n')) {
			if (line != '')
				run_cmd(`uci -q delete suricata.${line}`);
		}
	}
	run_cmd('uci -q delete suricata.main.etopen_url');
	i = 0;
	for (let feed in feeds) {
		let id = trim(`${feed.id || ''}`);
		if (!feed_id_ok(id))
			id = 'etopen' + i;
		let enabled = `${feed.enabled}`;
		if (enabled == 'true' || enabled == '1' || enabled == 'on' || enabled == 'yes')
			enabled = '1';
		else
			enabled = '0';
		run_cmd(`uci set suricata.${id}=etopen`);
		run_cmd(`uci set suricata.${id}.name=${shell_quote(trim(`${feed.name}`))}`);
		run_cmd(`uci set suricata.${id}.url=${shell_quote(trim(`${feed.url}`))}`);
		run_cmd(`uci set suricata.${id}.enabled=${enabled}`);
		run_cmd(`uci set suricata.${id}.description=${shell_quote(trim(`${feed.description || ''}`))}`);
		i++;
	}
	return null;
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
	let r = run_cmd("uci -q show suricata | sed -n 's/^suricata\\.s\\([0-9][0-9]*\\)=sid$/\\1/p'");
	if (!r.output)
		return out;
	for (let line in split(r.output, '\n')) {
		if (line == '')
			continue;
		let en = run_cmd(`uci -q get suricata.s${line}.enabled`).output;
		let st = run_cmd(`uci -q get suricata.s${line}.status`).output;
		if (en == '')
			en = '1';
		if (st == '')
			st = en == '0' ? 'disabled' : 'enabled';
		out[line] = { enabled: en, status: st };
	}
	return out;
}

function disabled_sids() {
	let out = {};
	let map = sid_map();
	for (let sid in map) {
		let row = map[sid];
		if (row.enabled == '0' || row.status == 'disabled' || row.status == 'expired')
			out[sid] = 1;
	}
	return out;
}

function read_sid_tune(sid) {
	let sec = `s${sid}`;
	let exists = run_cmd(`uci -q get suricata.${sec}`).code == 0;
	let tags = [];
	let raw_tags;
	if (!exists)
		return {
			enabled: '1',
			status: 'enabled',
			category: '',
			priority: '',
			target: '',
			threshold: '',
			tags
		};
	raw_tags = run_cmd(`uci -q get suricata.${sec}.tags`).output;
	if (raw_tags != '')
		tags = split(raw_tags, ',');
	let enabled = run_cmd(`uci -q get suricata.${sec}.enabled`).output || '1';
	let status = run_cmd(`uci -q get suricata.${sec}.status`).output;
	if (status == '')
		status = enabled == '0' ? 'disabled' : 'enabled';
	return {
		enabled,
		status,
		category: run_cmd(`uci -q get suricata.${sec}.category`).output,
		priority: run_cmd(`uci -q get suricata.${sec}.priority`).output,
		target: run_cmd(`uci -q get suricata.${sec}.target`).output,
		threshold: run_cmd(`uci -q get suricata.${sec}.threshold`).output,
		tags
	};
}

function sql_in_list(map) {
	let ids = [];
	for (let sid in map)
		push(ids, sid);
	if (!length(ids))
		return '';
	return join(',', ids);
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
	let profile = uci_get('rule_profile', 'small');
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
	let sql = `SELECT gid, sid, rev, action, classtype, file, msg FROM rules WHERE ${where} ORDER BY sid LIMIT ${limit} OFFSET ${offset};`;
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
		let fname = `${row.file || ''}`;
		let in_profile = profile == 'full' || SMALL_RULE_FILES[fname] == 1;
		push(rules, {
			gid: `${row.gid}`,
			sid,
			rev: `${row.rev}`,
			action: row.action || '',
			classtype: row.classtype || '',
			file: fname,
			msg: row.msg || '',
			enabled: disabled[sid] ? '0' : '1',
			status: (overrides[sid] && overrides[sid].status) ? overrides[sid].status : (disabled[sid] ? 'disabled' : 'enabled'),
			in_profile
		});
	}
	empty.rules = rules;
	empty.total = total;
	return empty;
}

function write_sid_state(sid, gid, enabled) {
	run_cmd(`uci -q get suricata.s${sid} >/dev/null || uci set suricata.s${sid}=sid`);
	run_cmd(`uci set suricata.s${sid}.sid=${shell_quote(sid)}`);
	run_cmd(`uci set suricata.s${sid}.gid=${shell_quote(gid)}`);
	run_cmd(`uci set suricata.s${sid}.enabled=${enabled}`);
	if (enabled == '0')
		run_cmd(`uci set suricata.s${sid}.status=disabled`);
	else {
		let st = run_cmd(`uci -q get suricata.s${sid}.status`).output;
		if (st == '' || st == 'disabled' || st == 'expired')
			run_cmd(`uci set suricata.s${sid}.status=enabled`);
	}
}

function commit_rule_states() {
	run_cmd('uci commit suricata');
	if (file_test('-x', '/usr/sbin/tp-rules-apply'))
		run_cmd('/usr/sbin/tp-rules-apply');
	let running = run_cmd('pidof suricata >/dev/null && echo 1 || echo 0').output == '1';
	if (running)
		run_cmd('/etc/init.d/suricata reload');
}

function parse_enabled_flag(v) {
	v = `${v}`;
	if (v == 'true' || v == '1' || v == 'on' || v == 'yes')
		return '1';
	if (v == 'false' || v == '0' || v == 'off' || v == 'no')
		return '0';
	return null;
}

const methods = {
	getStatus: {
		call: function() {
			let st = read_json_file('/tmp/tp_status.json');
			let et = read_json_file('/tmp/tp_etopen.json');
			for (let k in et)
				st[k] = et[k];
			let running = run_cmd('pidof suricata >/dev/null && echo 1 || echo 0').output == '1';
			st.suricata_running = running;
			st.suricata_present = file_test('-x', '/usr/bin/suricata');
			st.etopen_present = file_test('-x', '/usr/sbin/suricata-etopen-fetch');
			st.mode = uci_get('mode', 'ids');
			st.interface = uci_get('interface', 'br-lan');
			st.enabled = uci_get('enabled', '0');
			st.rule_profile = uci_get('rule_profile', 'small');
			return st;
		}
	},

	getEvents: {
		args: { limit: 50 },
		call: function(req) {
			let limit = int(req.args?.limit) || 50;
			if (limit < 1)
				limit = 1;
			if (limit > 200)
				limit = 200;
			let db = '/var/lib/threat-prevention/events.sqlite';
			if (!file_test('-f', db))
				return { events: [] };
			let bin = sqlite3_bin();
			let sql = `SELECT id, ts, sid, msg, classtype, src, dst, sport, dport, proto, severity FROM events ORDER BY id DESC LIMIT ${limit};`;
			let r = run_cmd(`${bin} -separator '|' ${shell_quote(db)} ${shell_quote(sql)}`);
			let events = [];
			if (r.code == 0 && r.output) {
				for (let line in split(r.output, '\n')) {
					if (line == '')
						continue;
					let p = split(line, '|');
					push(events, {
						id: p[0],
						ts: p[1],
						sid: p[2],
						msg: p[3],
						classtype: p[4],
						src: p[5],
						dst: p[6],
						sport: p[7],
						dport: p[8],
						proto: p[9],
						severity: p[10]
					});
				}
			}
			return { events };
		}
	},

	getConfig: {
		call: function() {
			return get_config();
		}
	},

	setConfig: {
		args: { config: {} },
		call: function(req) {
			let cfg = req.args?.config;
			if (type(cfg) != 'object')
				return { error: 'invalid config' };
			run_cmd('uci -q get suricata.main >/dev/null || uci set suricata.main=suricata');
			if ('feeds' in cfg) {
				let ferr = replace_etopen_feeds(cfg.feeds);
				if (ferr)
					return { error: ferr };
			}
			for (let k in const_defaults) {
				if (!(k in cfg))
					continue;
				let v = `${cfg[k]}`;
				if (k == 'home_net' && !match(v, /^\[/))
					v = '[' + v + ']';
				if (index(FLAG_OPTS, k) >= 0) {
					if (v != '0' && v != '1')
						continue;
				} else if (k in STRING_OPTS) {
					if (!match(v, STRING_OPTS[k]))
						continue;
				}
				run_cmd(`uci set suricata.main.${k}=${shell_quote(v)}`);
			}
			run_cmd('uci commit suricata');
			return { ok: true, config: get_config() };
		}
	},

	serviceControl: {
		args: { action: '' },
		call: function(req) {
			let action = req.args?.action || '';
			if (action != 'start' && action != 'stop' && action != 'reload' && action != 'restart')
				return { error: 'invalid action' };
			let r = run_cmd(`/etc/init.d/suricata ${action}`);
			run_cmd(`/etc/init.d/tp-eventd ${action == 'stop' ? 'stop' : 'restart'}`);
			return { ok: r.code == 0, output: r.output };
		}
	},

	fetchRules: {
		call: function() {
			if (!file_test('-x', '/usr/sbin/suricata-etopen-fetch'))
				return { error: 'suricata-etopen not installed' };
			let st = read_json_file('/tmp/tp_etopen.json');
			if (st.etopen_state == 'fetching')
				return { ok: true, started: true };
			run_cmd('printf \'{"etopen_state":"fetching","etopen_error":""}\\n\' > /tmp/tp_etopen.json');
			if (file_test('-x', '/etc/init.d/suricata-etopen')) {
				let r = run_cmd('/etc/init.d/suricata-etopen start');
				if (r.code != 0)
					return { ok: false, error: r.output || 'failed to start ET Open fetch' };
				return { ok: true, started: true };
			}
			let r = run_cmd('/usr/sbin/suricata-etopen-fetch');
			return { ok: r.code == 0, output: r.output, error: r.code == 0 ? '' : r.output };
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

	getRule: {
		args: { sid: '', gid: '' },
		call: function(req) {
			let sid = trim(`${req.args?.sid || ''}`);
			let gid = trim(`${req.args?.gid || '1'}`);
			if (!match(sid, /^[0-9]+$/) || !match(gid, /^[0-9]+$/))
				return { error: 'invalid sid' };
			if (!file_test('-f', RULES_DB))
				return { error: 'rules not indexed' };
			let bin = sqlite3_bin();
			let sql = `SELECT gid, sid, rev, action, classtype, file, msg, raw FROM rules WHERE gid = ${gid} AND sid = ${sid} LIMIT 1;`;
			let r = run_cmd(`${bin} -json ${shell_quote(RULES_DB)} ${shell_quote(sql)}`);
			if (r.code != 0 || !r.output)
				return { error: 'rule not found' };
			let rows;
			try {
				rows = json(r.output);
			} catch (e) {
				return { error: 'rule not found' };
			}
			if (type(rows) != 'array' || !length(rows))
				return { error: 'rule not found' };
			let row = rows[0];
			let tune = read_sid_tune(`${row.sid}`);
			return {
				gid: `${row.gid}`,
				sid: `${row.sid}`,
				rev: `${row.rev}`,
				action: row.action || '',
				classtype: row.classtype || '',
				file: row.file || '',
				msg: row.msg || '',
				raw: row.raw || '',
				enabled: tune.enabled == '0' || tune.status == 'disabled' || tune.status == 'expired' ? '0' : '1',
				status: tune.status,
				category: tune.category,
				priority: tune.priority,
				target: tune.target,
				threshold: tune.threshold,
				tags: tune.tags,
				classtypes: distinct_col('classtype')
			};
		}
	},

	setRuleTune: {
		args: { tune: {} },
		call: function(req) {
			let t = req.args?.tune;
			let sid;
			let gid;
			let status;
			let enabled;
			let category;
			let priority;
			let target;
			let threshold;
			let tags;
			let tag_s;
			let i;
			let one;
			if (type(t) != 'object')
				return { error: 'invalid tune' };
			sid = trim(`${t.sid || ''}`);
			gid = trim(`${t.gid || '1'}`);
			status = trim(`${t.status || 'enabled'}`);
			if (!match(sid, /^[0-9]+$/) || !match(gid, /^[0-9]+$/))
				return { error: 'invalid sid' };
			if (status != 'enabled' && status != 'review' && status != 'expired' && status != 'disabled')
				return { error: 'invalid status' };
			enabled = (status == 'disabled' || status == 'expired') ? '0' : '1';
			category = trim(`${t.category || ''}`);
			priority = trim(`${t.priority || ''}`);
			target = trim(`${t.target || ''}`);
			threshold = trim(`${t.threshold || ''}`);
			if (category != '' && !match(category, /^[A-Za-z0-9._-]+$/))
				return { error: 'invalid category' };
			if (priority != '') {
				if (!match(priority, /^[0-9]+$/))
					return { error: 'invalid priority' };
				if (int(priority) < 1 || int(priority) > 255)
					return { error: 'invalid priority' };
			}
			if (target != '' && target != 'src_ip' && target != 'dest_ip')
				return { error: 'invalid target' };
			if (threshold != '' && !match(threshold, /^type (limit|threshold|both), track (by_src|by_dst), count [0-9]+, seconds [0-9]+$/))
				return { error: 'invalid threshold' };
			tags = [];
			if (type(t.tags) == 'array') {
				for (i = 0; i < length(t.tags); i++) {
					one = trim(`${t.tags[i]}`);
					if (one == '')
						continue;
					if (!match(one, /^[A-Za-z0-9_]+:[A-Za-z0-9._:/-]+$/))
						return { error: 'invalid tag' };
					push(tags, one);
					if (length(tags) > 20)
						return { error: 'invalid tag' };
				}
			}
			run_cmd('uci -q get suricata.main >/dev/null || uci set suricata.main=suricata');
			run_cmd(`uci set suricata.s${sid}=sid`);
			run_cmd(`uci set suricata.s${sid}.sid=${shell_quote(sid)}`);
			run_cmd(`uci set suricata.s${sid}.gid=${shell_quote(gid)}`);
			run_cmd(`uci set suricata.s${sid}.enabled=${enabled}`);
			run_cmd(`uci set suricata.s${sid}.status=${shell_quote(status)}`);
			if (category != '')
				run_cmd(`uci set suricata.s${sid}.category=${shell_quote(category)}`);
			else
				run_cmd(`uci -q delete suricata.s${sid}.category`);
			if (priority != '')
				run_cmd(`uci set suricata.s${sid}.priority=${shell_quote(priority)}`);
			else
				run_cmd(`uci -q delete suricata.s${sid}.priority`);
			if (target != '')
				run_cmd(`uci set suricata.s${sid}.target=${shell_quote(target)}`);
			else
				run_cmd(`uci -q delete suricata.s${sid}.target`);
			if (threshold != '')
				run_cmd(`uci set suricata.s${sid}.threshold=${shell_quote(threshold)}`);
			else
				run_cmd(`uci -q delete suricata.s${sid}.threshold`);
			run_cmd(`uci -q delete suricata.s${sid}.tags`);
			tag_s = join(',', tags);
			if (tag_s != '')
				run_cmd(`uci set suricata.s${sid}.tags=${shell_quote(tag_s)}`);
			commit_rule_states();
			return { ok: true, sid, gid, enabled, status };
		}
	},

	setRuleState: {
		args: { sid: '', gid: '', enabled: '' },
		call: function(req) {
			let sid = trim(`${req.args?.sid || ''}`);
			let gid = trim(`${req.args?.gid || '1'}`);
			let enabled = parse_enabled_flag(req.args?.enabled);
			if (!match(sid, /^[0-9]+$/) || !match(gid, /^[0-9]+$/))
				return { error: 'invalid sid' };
			if (enabled == null)
				return { error: 'invalid enabled' };
			run_cmd('uci -q get suricata.main >/dev/null || uci set suricata.main=suricata');
			write_sid_state(sid, gid, enabled);
			commit_rule_states();
			return { ok: true, sid, gid, enabled };
		}
	},

	setRuleStates: {
		args: { sids: [], gid: '', enabled: '' },
		call: function(req) {
			let sids = req.args?.sids;
			let gid = trim(`${req.args?.gid || '1'}`);
			let enabled = parse_enabled_flag(req.args?.enabled);
			let i;
			let sid;
			let seen = {};
			let out = [];
			if (type(sids) != 'array')
				return { error: 'invalid sids' };
			if (!match(gid, /^[0-9]+$/))
				return { error: 'invalid sid' };
			if (enabled == null)
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
			run_cmd('uci -q get suricata.main >/dev/null || uci set suricata.main=suricata');
			for (i = 0; i < length(out); i++)
				write_sid_state(out[i], gid, enabled);
			commit_rule_states();
			return { ok: true, sids: out, gid, enabled };
		}
	},

	reindexRules: {
		call: function() {
			if (!file_test('-x', '/usr/sbin/tp-rules-index'))
				return { error: 'tp-rules-index not installed' };
			let dir = uci_get('rule_dir', '/etc/suricata/rules');
			let r = run_cmd(`/usr/sbin/tp-rules-index ${shell_quote(dir)}`);
			return {
				ok: r.code == 0,
				output: r.output,
				error: r.code == 0 ? '' : r.output
			};
		}
	}
};

return { 'luci.threat-prevention': methods };
