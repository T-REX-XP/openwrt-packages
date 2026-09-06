'use strict';
'require baseclass';

var FLAG_OPTS = [ 'enabled', 'manual', 'logging', 'openappid' ];

var STRING_OPTS = {
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

var FORM_KEYS = FLAG_OPTS.concat(Object.keys(STRING_OPTS));

var REQUIRED_FORM_KEYS = [
	'enabled', 'manual', 'logging', 'openappid',
	'interface', 'home_net', 'external_net', 'mode', 'method',
	'action', 'snaplen', 'log_dir', 'config_dir', 'temp_dir'
];

var SKIP_DEV_TYPES = { alias: 1, vrf: 1 };
var SKIP_DEV_NAMES = { lo: 1 };

var COMMUNITY_RULES_URL = 'https://www.snort.org/downloads/community/snort3-community-rules.tar.gz';
var FEED_URL_RE = /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%{}$-]+$/;

function truthyFlag(value) {
	return value === true || value === 1 || value === '1' ||
		value === 'true' || value === 'on' || value === 'yes';
}

return baseclass.extend({
	FLAG_OPTS: FLAG_OPTS,
	STRING_OPTS: STRING_OPTS,
	FORM_KEYS: FORM_KEYS,
	REQUIRED_FORM_KEYS: REQUIRED_FORM_KEYS,

	unwrapNet: function(val) {
		val = String(val == null ? '' : val).trim();
		while (val.length >= 2 && val.charAt(0) === '[' &&
		       val.charAt(val.length - 1) === ']')
			val = val.substring(1, val.length - 1).trim();
		return val.replace(/[ \t]+/g, '');
	},

	normalizeFlag: function(value) {
		if (truthyFlag(value))
			return '1';
		if (value === false || value === 0 || value === '0' ||
		    value === 'false' || value === 'off' || value === 'no' ||
		    value === '' || value == null)
			return '0';
		return String(value);
	},

	normalizeValue: function(key, value) {
		var v;
		if (FLAG_OPTS.indexOf(key) >= 0)
			return this.normalizeFlag(value);
		if (key === 'home_net' || key === 'external_net')
			return this.unwrapNet(value);
		v = String(value == null ? '' : value).trim();
		if (key === 'method' && v === 'pcap')
			return 'afpacket';
		if (key === 'log_dir' && (v === '/var/log' || v === '/var/log/'))
			return '/var/log/snort';
		return v;
	},

	validateField: function(key, value) {
		var v = this.normalizeValue(key, value);
		var n;

		if (FLAG_OPTS.indexOf(key) >= 0) {
			if (v !== '0' && v !== '1')
				return 'invalid ' + key;
			return null;
		}
		if (!STRING_OPTS[key])
			return 'invalid ' + key;
		if (!STRING_OPTS[key].test(v))
			return 'invalid ' + key;
		if (key === 'snaplen') {
			n = parseInt(v, 10);
			if (isNaN(n) || n < 0 || n > 65535)
				return 'invalid ' + key;
		}
		return null;
	},

	normalizeConfig: function(cfg) {
		var out = {};
		var i;
		var key;

		if (!cfg || typeof cfg !== 'object')
			return null;
		for (i = 0; i < FORM_KEYS.length; i++) {
			key = FORM_KEYS[i];
			if (cfg[key] === undefined)
				continue;
			out[key] = this.normalizeValue(key, cfg[key]);
		}
		for (key in cfg) {
			if (FORM_KEYS.indexOf(key) < 0 && key !== 'feeds')
				out[key] = cfg[key];
		}
		return out;
	},

	validateConfig: function(cfg) {
		var keys;
		var i;
		var err;

		if (!cfg || typeof cfg !== 'object')
			return 'invalid config';
		keys = Object.keys(cfg);
		if (!keys.length)
			return 'invalid config';
		for (i = 0; i < keys.length; i++) {
			err = this.validateField(keys[i], cfg[keys[i]]);
			if (err)
				return err;
		}
		return null;
	},

	collectSettings: function(raw) {
		var i;
		var key;
		var cfg;
		var err;

		if (!raw || typeof raw !== 'object')
			return { error: 'Settings form is not ready.' };
		for (i = 0; i < REQUIRED_FORM_KEYS.length; i++) {
			key = REQUIRED_FORM_KEYS[i];
			if (raw[key] === undefined || raw[key] === null)
				return { error: 'Settings form is not ready.' };
		}
		cfg = this.normalizeConfig(raw);
		if (raw.oinkcode === undefined)
			cfg.oinkcode = '';
		else
			cfg.oinkcode = this.normalizeValue('oinkcode', raw.oinkcode);
		err = this.validateConfig(cfg);
		if (err)
			return { error: err };
		if (raw.feeds !== undefined) {
			err = this.validateFeeds(raw.feeds);
			if (err)
				return { error: err };
			cfg.feeds = this.normalizeFeeds(raw.feeds);
		}
		if (raw.pass !== undefined) {
			err = this.validatePass(raw.pass);
			if (err)
				return { error: err };
			cfg.pass = this.normalizePass(raw.pass);
		}
		if (raw.suppress !== undefined) {
			err = this.validateSuppressList(raw.suppress);
			if (err)
				return { error: err };
			cfg.suppress = this.normalizeSuppressList(raw.suppress);
		}
		return { config: cfg };
	},

	memTone: function(percent) {
		percent = Number(percent) || 0;
		if (percent > 80)
			return 'snort-mem--err';
		if (percent > 60)
			return 'snort-mem--warn';
		return 'snort-mem--ok';
	},

	formatKb: function(kb) {
		var n = Number(kb);

		if (!n || n < 0)
			return '—';
		if (n >= 1024)
			return (Math.round(n / 102.4) / 10) + ' MB';
		return Math.round(n) + ' kB';
	},

	formatSysMem: function(usedKb, totalKb, percent) {
		var usedMb;
		var totalMb;
		var p = Number(percent);

		if (!totalKb)
			return '—';
		usedMb = Math.floor((Number(usedKb) || 0) / 1024);
		totalMb = Math.floor(Number(totalKb) / 1024);
		if (isNaN(p))
			p = totalKb ? Math.floor((Number(usedKb) || 0) * 100 / totalKb) : 0;
		return usedMb + ' MB / ' + totalMb + ' MB (' + p + '%)';
	},

	hostCidrToNetwork: function(val) {
		var s = String(val == null ? '' : val).trim();
		var parts = s.split('/');
		var dots;
		var prefix;
		var i;
		var oct;
		var ip;
		var mask;
		var net;

		if (parts.length !== 2)
			return null;
		dots = parts[0].split('.');
		prefix = parseInt(parts[1], 10);
		if (dots.length !== 4 || isNaN(prefix) || prefix < 0 || prefix > 32)
			return null;
		ip = 0;
		for (i = 0; i < 4; i++) {
			oct = parseInt(dots[i], 10);
			if (isNaN(oct) || oct < 0 || oct > 255)
				return null;
			ip = (ip * 256) + oct;
		}
		ip = ip >>> 0;
		mask = prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
		net = (ip & mask) >>> 0;
		return ((net >>> 24) & 255) + '.' +
			((net >>> 16) & 255) + '.' +
			((net >>> 8) & 255) + '.' +
			(net & 255) + '/' + prefix;
	},

	idsDeviceNames: function(devices, current) {
		var names = [];
		var seen = {};
		var i;
		var name;
		var type;
		var cur = String(current == null ? '' : current).trim();

		function add(n) {
			if (!n || seen[n])
				return;
			if (!STRING_OPTS.interface.test(n))
				return;
			seen[n] = 1;
			names.push(n);
		}

		if (Array.isArray(devices)) {
			for (i = 0; i < devices.length; i++) {
				name = devices[i];
				type = '';
				if (name && typeof name === 'object') {
					type = name.type || '';
					name = name.name || '';
				}
				name = String(name || '');
				if (SKIP_DEV_NAMES[name] || SKIP_DEV_TYPES[type])
					continue;
				if (/^(ifb|teql)\d*$/.test(name) || /\.network\d+$/.test(name))
					continue;
				add(name);
			}
		}
		add(cur);
		if (!names.length)
			add('br-lan');
		names.sort();
		return names;
	},

	COMMUNITY_RULES_URL: COMMUNITY_RULES_URL,

	sanitizeFeedId: function(name) {
		var id = String(name == null ? '' : name).toLowerCase()
			.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
		if (!id)
			return '';
		if (/^[0-9]/.test(id) || id === 'snort' || id === 'nfq' ||
		    id === 'pass' || /^s[0-9]+$/.test(id))
			id = 'rs_' + id;
		if (id.length > 32)
			id = id.substring(0, 32);
		return id;
	},

	validateFeed: function(feed) {
		var name;
		var url;
		var enabled;

		if (!feed || typeof feed !== 'object')
			return 'invalid feed';
		name = String(feed.name == null ? '' : feed.name).trim();
		url = String(feed.url == null ? '' : feed.url).trim();
		enabled = this.normalizeFlag(feed.enabled);
		if (!name)
			return 'invalid feed name';
		if (!FEED_URL_RE.test(url))
			return 'invalid feed url';
		if (enabled !== '0' && enabled !== '1')
			return 'invalid feed enabled';
		return null;
	},

	validateFeeds: function(feeds) {
		var i;
		var err;
		var seen;
		var id;

		if (!Array.isArray(feeds))
			return 'invalid feeds';
		seen = {};
		for (i = 0; i < feeds.length; i++) {
			err = this.validateFeed(feeds[i]);
			if (err)
				return err;
			id = this.sanitizeFeedId(feeds[i].id || feeds[i].name);
			if (!id)
				return 'invalid feed id';
			if (seen[id])
				return 'duplicate feed id';
			seen[id] = 1;
		}
		return null;
	},

	normalizeFeeds: function(feeds) {
		var out = [];
		var i;
		var feed;
		var id;
		var used = {};
		var n;

		if (!Array.isArray(feeds))
			return [];
		for (i = 0; i < feeds.length; i++) {
			feed = feeds[i];
			id = this.sanitizeFeedId(feed.id || feed.name);
			n = 2;
			while (used[id]) {
				id = this.sanitizeFeedId((feed.id || feed.name) + '_' + n);
				n++;
			}
			used[id] = 1;
			out.push({
				id: id,
				name: String(feed.name).trim(),
				url: String(feed.url).trim(),
				enabled: this.normalizeFlag(feed.enabled),
				description: String(feed.description == null ? '' : feed.description).trim()
			});
		}
		return out;
	},

	defaultFeeds: function() {
		return [{
			id: 'community',
			name: 'Snort 3 community',
			url: COMMUNITY_RULES_URL,
			enabled: '1',
			description: 'Free Snort 3 community ruleset'
		}];
	},

	knownFeeds: function() {
		return [
			{
				id: 'community',
				name: 'Snort 3 community',
				url: COMMUNITY_RULES_URL,
				description: 'Free Talos community rules for Snort 3'
			},
			{
				id: 'talos',
				name: 'Talos subscriber snapshot',
				url: 'https://www.snort.org/rules/snortrules-snapshot-31470.tar.gz?oinkcode={oinkcode}',
				description: 'Registered/subscriber Talos rules. Needs an Oinkcode on this tab.'
			},
			{
				id: 'feodo',
				name: 'abuse.ch Feodo Tracker',
				url: 'https://feodotracker.abuse.ch/downloads/feodotracker.tar.gz',
				description: 'Botnet C2 hosts tracked by Feodo Tracker (Snort and Suricata).'
			},
			{
				id: 'nf_local',
				name: 'Networkforensic NF IDS',
				url: 'https://networkforensic.dk/SNORT/NF-local.zip',
				description: 'Community Snort rules from networkforensic.dk'
			},
			{
				id: 'nf_scada',
				name: 'Networkforensic SCADA',
				url: 'https://networkforensic.dk/SNORT/NF-SCADA.zip',
				description: 'SCADA/ICS signatures from networkforensic.dk'
			},
			{
				id: 'nf_scanners',
				name: 'Networkforensic scanners',
				url: 'https://networkforensic.dk/SNORT/NF-Scanners.zip',
				description: 'Known scanner and recon actor signatures'
			}
		];
	},

	unusedKnownFeeds: function(existing) {
		var have = {};
		var i;
		var out = [];
		var catalog = this.knownFeeds();
		var row;
		if (Array.isArray(existing)) {
			for (i = 0; i < existing.length; i++) {
				row = existing[i] || {};
				if (row.url)
					have[String(row.url)] = 1;
				if (row.id)
					have[String(row.id)] = 1;
			}
		}
		for (i = 0; i < catalog.length; i++) {
			row = catalog[i];
			if (have[row.url] || have[row.id])
				continue;
			out.push(row);
		}
		return out;
	},

	sanitizeRuleQuery: function(q) {
		q = String(q == null ? '' : q).trim();
		if (q.length > 64)
			q = q.substring(0, 64);
		return q.replace(/[%_'\\]/g, '');
	},

	clampRuleLimit: function(n) {
		n = parseInt(n, 10);
		if (isNaN(n) || n < 1)
			return 50;
		if (n > 100)
			return 100;
		return n;
	},

	validSid: function(sid) {
		return /^[0-9]{1,10}$/.test(String(sid == null ? '' : sid));
	},

	normalizeSidList: function(sids) {
		var out = [];
		var seen = {};
		var i;
		var sid;

		if (!Array.isArray(sids))
			return null;
		for (i = 0; i < sids.length; i++) {
			sid = String(sids[i] == null ? '' : sids[i]).trim();
			if (!this.validSid(sid) || seen[sid])
				continue;
			seen[sid] = 1;
			out.push(sid);
		}
		if (!out.length || out.length > 50)
			return null;
		return out;
	},

	sanitizeRulesetFile: function(file) {
		var f = String(file == null ? '' : file).trim();
		if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.rules$/.test(f) || f.length > 80)
			return '';
		return f;
	},

	validatePolicies: function(p) {
		var i;
		var row;
		var file;
		var seen;

		if (!p || typeof p !== 'object')
			return 'invalid policies';
		if (!Array.isArray(p.rulesets) || p.rulesets.length > 80)
			return 'invalid rulesets';
		seen = {};
		for (i = 0; i < p.rulesets.length; i++) {
			row = p.rulesets[i];
			if (!row || typeof row !== 'object')
				return 'invalid ruleset';
			file = this.sanitizeRulesetFile(row.file);
			if (!file || seen[file])
				return 'invalid ruleset';
			seen[file] = 1;
			if (this.normalizeFlag(row.enabled) !== '0' &&
			    this.normalizeFlag(row.enabled) !== '1')
				return 'invalid ruleset';
		}
		return null;
	},

	parseRuleRaw: function(raw) {
		var out = {
			action: '',
			proto: '',
			src: '',
			sport: '',
			dst: '',
			dport: '',
			msg: '',
			sid: '',
			rev: '',
			classtype: ''
		};
		var m;

		raw = String(raw == null ? '' : raw);
		m = raw.match(/^(alert|drop|pass|reject|rejectsrc|rejectdst)\s+(\S+)\s+(\S+)\s+(\S+)\s+->\s+(\S+)\s+(\S+)/);
		if (m) {
			out.action = m[1];
			out.proto = m[2];
			out.src = m[3];
			out.sport = m[4];
			out.dst = m[5];
			out.dport = m[6];
		} else {
			m = raw.match(/^(alert|drop|pass|reject|rejectsrc|rejectdst)\b/);
			if (m)
				out.action = m[1];
		}
		m = raw.match(/msg:"((?:\\.|[^"\\])*)"/);
		if (m)
			out.msg = m[1].replace(/\\(.)/g, '$1');
		m = raw.match(/\bsid:([0-9]+)/);
		if (m)
			out.sid = m[1];
		m = raw.match(/\brev:([0-9]+)/);
		if (m)
			out.rev = m[1];
		m = raw.match(/\bclasstype:([^;]+)/);
		if (m)
			out.classtype = m[1].trim();
		return out;
	},

	validPassIp: function(s) {
		s = String(s == null ? '' : s).trim();
		if (!s || s.length > 64)
			return false;
		if (/^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)(?:\/(?:3[0-2]|[12]?\d))?$/.test(s))
			return true;
		return /^[0-9a-fA-F:]+(?:\/(?:12[0-8]|1[01]\d|[1-9]?\d))?$/.test(s);
	},

	normalizePassIps: function(raw) {
		var text;
		var parts;
		var i;
		var one;
		var seen = {};
		var out = [];

		if (Array.isArray(raw))
			text = raw.join('\n');
		else
			text = String(raw == null ? '' : raw);
		parts = text.split(/[\s,;]+/);
		for (i = 0; i < parts.length; i++) {
			one = parts[i].trim();
			if (!one || seen[one])
				continue;
			if (!this.validPassIp(one))
				continue;
			seen[one] = 1;
			out.push(one);
			if (out.length >= 64)
				break;
		}
		return out;
	},

	normalizePass: function(raw) {
		raw = raw || {};
		return {
			local_nets: this.normalizeFlag(raw.local_nets),
			wan_gateway: this.normalizeFlag(raw.wan_gateway),
			wan_dns: this.normalizeFlag(raw.wan_dns),
			vpn_addrs: this.normalizeFlag(raw.vpn_addrs),
			ips: this.normalizePassIps(raw.ips)
		};
	},

	validatePass: function(raw) {
		var i;
		var ips;
		if (!raw || typeof raw !== 'object')
			return 'invalid pass list';
		ips = Array.isArray(raw.ips) ? raw.ips : this.normalizePassIps(raw.ips);
		for (i = 0; i < ips.length; i++) {
			if (!this.validPassIp(ips[i]))
				return 'invalid pass ip';
		}
		return null;
	},

	normalizeSuppressList: function(raw) {
		var i;
		var row;
		var out = [];
		var sid;
		var ip;
		var track;
		var gid;
		var comment;
		if (!Array.isArray(raw))
			return out;
		for (i = 0; i < raw.length && out.length < 100; i++) {
			row = raw[i] || {};
			sid = String(row.sid || '').trim();
			ip = String(row.ip || '').trim();
			track = String(row.track || 'by_src').trim();
			gid = String(row.gid || '1').trim();
			comment = String(row.comment || '').replace(/[^A-Za-z0-9 .,_-]/g, '').substring(0, 80);
			if (!this.validSid(sid) || !this.validPassIp(ip))
				continue;
			if (track !== 'by_src' && track !== 'by_dst')
				track = 'by_src';
			if (!/^[0-9]+$/.test(gid))
				gid = '1';
			out.push({ sid: sid, gid: gid, track: track, ip: ip, comment: comment });
		}
		return out;
	},

	validateSuppressList: function(raw) {
		var i;
		var row;
		if (raw == null)
			return null;
		if (!Array.isArray(raw))
			return 'invalid suppress';
		if (raw.length > 100)
			return 'invalid suppress';
		for (i = 0; i < raw.length; i++) {
			row = raw[i] || {};
			if (!this.validSid(String(row.sid || '')))
				return 'invalid sid';
			if (!this.validPassIp(String(row.ip || '')))
				return 'invalid ip';
			if (row.track && row.track !== 'by_src' && row.track !== 'by_dst')
				return 'invalid track';
		}
		return null;
	}
});
