'use strict';
'require baseclass';

var FLAG_OPTS = [ 'enabled' ];

var ETOPEN_OFFICIAL = 'https://rules.emergingthreats.net/open/suricata-8.0/emerging.rules.tar.gz';
var CATALOG_PATH = '/usr/share/luci-app-suricata/ruleset-catalog.json';

var FEED_URL_RE = /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%{}$-]+$/;

var SKIP_DEV_TYPES = { alias: 1, vrf: 1 };

var SKIP_DEV_NAMES = { lo: 1 };

var STRING_OPTS = {
	mode: /^(ids|ips)$/,
	interface: /^[A-Za-z0-9_.-]+$/,
	home_net: /^\[.*\]$|^[0-9a-fA-F.:/ ,]+$/,
	rule_profile: /^(small|full)$/
};

var FORM_KEYS = FLAG_OPTS.concat(Object.keys(STRING_OPTS));

var REQUIRED_FORM_KEYS = [
	'enabled', 'interface', 'home_net', 'rule_profile', 'mode'
];

function truthyFlag(value) {
	return value === true || value === 1 || value === '1' ||
		value === 'true' || value === 'on' || value === 'yes';
}

return baseclass.extend({
	FLAG_OPTS: FLAG_OPTS,
	STRING_OPTS: STRING_OPTS,
	FORM_KEYS: FORM_KEYS,
	REQUIRED_FORM_KEYS: REQUIRED_FORM_KEYS,
	ETOPEN_OFFICIAL: ETOPEN_OFFICIAL,
	CATALOG_PATH: CATALOG_PATH,

	unwrapNet: function(val) {
		val = String(val == null ? '' : val).trim();
		while (val.length >= 2 && val.charAt(0) === '[' &&
		       val.charAt(val.length - 1) === ']')
			val = val.substring(1, val.length - 1).trim();
		return val.replace(/[ \t]+/g, '');
	},

	wrapHomeNet: function(val) {
		val = this.unwrapNet(val);
		if (!val)
			return '';
		return '[' + val + ']';
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
		if (FLAG_OPTS.indexOf(key) >= 0)
			return this.normalizeFlag(value);
		if (key === 'home_net')
			return this.wrapHomeNet(value);
		return String(value == null ? '' : value).trim();
	},

	validateField: function(key, value) {
		var v = this.normalizeValue(key, value);

		if (FLAG_OPTS.indexOf(key) >= 0) {
			if (v !== '0' && v !== '1')
				return 'invalid ' + key;
			return null;
		}
		if (!STRING_OPTS[key])
			return 'invalid ' + key;
		if (key === 'home_net' && (v === '' || v === '[]'))
			return 'invalid ' + key;
		if (!STRING_OPTS[key].test(v))
			return 'invalid ' + key;
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

	sanitizeFeedId: function(name) {
		var id = String(name == null ? '' : name).toLowerCase()
			.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
		if (!id)
			return '';
		if (/^[0-9]/.test(id) || id === 'main' || /^s[0-9]+$/.test(id))
			id = 'et_' + id;
		if (id.length > 32)
			id = id.substring(0, 32);
		return id;
	},

	THRESHOLD_RE: /^type (limit|threshold|both), track (by_src|by_dst), count [0-9]{1,8}, seconds [0-9]{1,8}$/,

	parseRuleTags: function(raw) {
		var tags = [];
		var seen = {};
		var meta;
		var parts;
		var i;
		var tok;
		var key;
		var val;
		var m;
		var action;

		raw = String(raw == null ? '' : raw);
		m = raw.match(/^(alert|drop|pass|reject|rejectsrc|rejectdst)\b/);
		action = m ? m[1] : '';
		if (action)
			tags.push({ key: 'action', value: action });
		meta = raw.match(/\bmetadata:([^;]+)/);
		if (meta) {
			parts = meta[1].split(',');
			for (i = 0; i < parts.length; i++) {
				tok = parts[i].trim();
				if (!tok)
					continue;
				if (tok.indexOf(':') >= 0) {
					key = tok.substring(0, tok.indexOf(':')).trim();
					val = tok.substring(tok.indexOf(':') + 1).trim();
				} else {
					m = tok.match(/^([A-Za-z0-9_]+)\s+(.*)$/);
					if (!m)
						continue;
					key = m[1];
					val = m[2].trim();
				}
				if (!key || !val)
					continue;
				key = key.replace(/[^A-Za-z0-9_]/g, '');
				val = val.replace(/[^A-Za-z0-9._:\/-]/g, '').substring(0, 80);
				if (!key || !val || seen[key + ':' + val])
					continue;
				seen[key + ':' + val] = 1;
				tags.push({ key: key, value: val });
			}
		}
		return tags;
	},

	TAG_SKIP: {
		action: 1,
		created_at: 1,
		updated_at: 1,
		affected_product: 1,
		deployment: 1,
		performance_impact: 1,
		former_sid: 1,
		mitigated: 1
	},

	displayRuleTags: function(raw, opts) {
		var out = [];
		var seen = {};
		var parsed;
		var extra;
		var m;
		var proto;
		var i;
		var key;
		var val;
		var label;
		var t;

		function add(text, tone) {
			label = String(text == null ? '' : text).trim().replace(/_/g, '-');
			if (!label)
				return;
			if (seen[label.toLowerCase()])
				return;
			seen[label.toLowerCase()] = 1;
			out.push({ label: label, tone: tone || 'meta' });
		}

		opts = opts || {};
		raw = String(raw == null ? '' : raw);
		m = raw.match(/^(?:alert|drop|pass|reject|rejectsrc|rejectdst)\s+([A-Za-z0-9_-]+)/);
		proto = m ? m[1].toLowerCase() : '';
		if (proto && proto !== 'tcp' && proto !== 'udp' && proto !== 'ip' &&
		    proto !== 'icmp' && proto !== 'any')
			add(proto, 'proto');

		parsed = this.parseRuleTags(raw);
		for (i = 0; i < parsed.length && out.length < 4; i++) {
			key = parsed[i].key;
			val = parsed[i].value;
			if (!key || !val || this.TAG_SKIP[key])
				continue;
			if (key === 'former_category')
				add(String(val).toLowerCase(), 'meta');
			else if (key === 'signature_severity')
				add(val, 'sev');
			else if (key === 'attack_target')
				add(String(val).toLowerCase(), 'meta');
		}

		extra = opts.tags;
		if (Array.isArray(extra)) {
			for (i = 0; i < extra.length && out.length < 4; i++) {
				t = this.normalizeTag(extra[i]);
				if (!t)
					continue;
				add(t.substring(t.indexOf(':') + 1), 'meta');
			}
		}
		return out;
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
			classtype: '',
			priority: '',
			target: '',
			tags: []
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
		m = raw.match(/\bpriority:([0-9]+)/);
		if (m)
			out.priority = m[1];
		m = raw.match(/\btarget:(src_ip|dest_ip)/);
		if (m)
			out.target = m[1];
		out.tags = this.parseRuleTags(raw);
		return out;
	},

	upsertKeyword: function(raw, key, value) {
		var re;

		raw = String(raw == null ? '' : raw);
		key = String(key || '');
		value = String(value == null ? '' : value).trim();
		if (!key)
			return raw;
		re = new RegExp('\\b' + key + ':[^;]+;');
		if (!value)
			return raw.replace(re, '');
		if (re.test(raw))
			return raw.replace(re, key + ':' + value + ';');
		if (/\)$/.test(raw))
			return raw.replace(/\)$/, ' ' + key + ':' + value + ';)');
		return raw + ' ' + key + ':' + value + ';';
	},

	applyRuleTunePreview: function(raw, tune) {
		var out = String(raw == null ? '' : raw);
		var t = tune || {};

		if (t.classtype)
			out = this.upsertKeyword(out, 'classtype', t.classtype);
		if (t.priority)
			out = this.upsertKeyword(out, 'priority', t.priority);
		if (t.target)
			out = this.upsertKeyword(out, 'target', t.target);
		if (t.action && /^(alert|drop|pass|reject|rejectsrc|rejectdst)\b/.test(out))
			out = out.replace(/^(alert|drop|pass|reject|rejectsrc|rejectdst)\b/, t.action);
		return out.replace(/[ \t]+;/g, ';').replace(/[ \t]+\)/g, ')');
	},

	normalizeTag: function(s) {
		var t = String(s == null ? '' : s).trim();
		var key;
		var val;
		var i;

		if (!t)
			return null;
		i = t.indexOf(':');
		if (i < 1)
			i = t.indexOf(' ');
		if (i < 1)
			return null;
		key = t.substring(0, i).trim().replace(/[^A-Za-z0-9_]/g, '');
		val = t.substring(i + 1).trim().replace(/[^A-Za-z0-9._:\/-]/g, '');
		if (!key || !val || key.length > 32 || val.length > 80)
			return null;
		return key + ':' + val;
	},

	normalizeTagList: function(tags) {
		var out = [];
		var seen = {};
		var i;
		var t;

		if (!Array.isArray(tags))
			return [];
		for (i = 0; i < tags.length && out.length < 20; i++) {
			t = this.normalizeTag(tags[i]);
			if (!t || seen[t])
				continue;
			seen[t] = 1;
			out.push(t);
		}
		return out;
	},

	validateTune: function(tune) {
		var status;
		var priority;
		var n;

		if (!tune || typeof tune !== 'object')
			return 'invalid tune';
		if (!this.validSid(tune.sid))
			return 'invalid sid';
		status = String(tune.status == null ? 'enabled' : tune.status);
		if (status !== 'enabled' && status !== 'review' &&
		    status !== 'expired' && status !== 'disabled')
			return 'invalid status';
		if (tune.target && tune.target !== 'src_ip' && tune.target !== 'dest_ip')
			return 'invalid target';
		priority = String(tune.priority == null ? '' : tune.priority).trim();
		if (priority) {
			n = parseInt(priority, 10);
			if (isNaN(n) || n < 1 || n > 255)
				return 'invalid priority';
		}
		if (tune.category && !/^[A-Za-z0-9._-]{1,64}$/.test(String(tune.category)))
			return 'invalid category';
		if (tune.threshold && !this.THRESHOLD_RE.test(String(tune.threshold).trim()))
			return 'invalid threshold';
		if (tune.action && !this.actionOk(tune.action))
			return 'invalid action';
		return null;
	},

	RULE_ACTIONS: [ 'alert', 'drop', 'reject', 'pass' ],
	RULE_STATUSES: [ 'enabled', 'review', 'expired', 'disabled' ],
	SMALL_RULE_FILES: [
		'emerging-malware.rules',
		'emerging-mobile_malware.rules',
		'emerging-trojan.rules',
		'emerging-worm.rules',
		'emerging-exploit.rules',
		'emerging-web_server.rules'
	],

	actionOk: function(action) {
		return this.RULE_ACTIONS.indexOf(String(action == null ? '' : action)) >= 0;
	},

	statusOk: function(status) {
		return this.RULE_STATUSES.indexOf(String(status == null ? '' : status)) >= 0;
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
		var name;

		if (!p || typeof p !== 'object')
			return 'invalid policies';
		if (p.rulesets != null) {
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
				if (!this.actionOk(row.action || 'alert'))
					return 'invalid ruleset';
			}
		}
		if (p.classtypes != null) {
			if (!Array.isArray(p.classtypes) || p.classtypes.length > 80)
				return 'invalid classtypes';
			seen = {};
			for (i = 0; i < p.classtypes.length; i++) {
				row = p.classtypes[i];
				if (!row || typeof row !== 'object')
					return 'invalid classtype';
				name = String(row.name == null ? '' : row.name).trim();
				if (!/^[A-Za-z0-9._-]{1,64}$/.test(name) || seen[name])
					return 'invalid classtype';
				seen[name] = 1;
				if (!this.actionOk(row.action || 'alert'))
					return 'invalid classtype';
			}
		}
		return null;
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

	parseCatalog: function(raw) {
		var data = null;
		var text = '';
		var rows;
		var i;
		var row;
		var out = [];

		if (typeof raw === 'string')
			text = raw.trim();
		else if (raw && typeof raw === 'object') {
			if (typeof raw.stdout === 'string')
				text = String(raw.stdout).trim();
			else if (Array.isArray(raw.rulesets))
				data = raw;
			else if (Array.isArray(raw))
				data = { rulesets: raw };
		}
		if (!data && text) {
			try {
				data = JSON.parse(text);
			}
			catch (e) {
				data = null;
			}
		}
		rows = (data && Array.isArray(data.rulesets)) ? data.rulesets : [];
		for (i = 0; i < rows.length; i++) {
			row = rows[i] || {};
			if (!row.id || !row.name || !row.url)
				continue;
			if (!FEED_URL_RE.test(String(row.url).trim()))
				continue;
			out.push({
				id: String(row.id),
				name: String(row.name),
				url: String(row.url).trim(),
				description: String(row.description == null ? '' : row.description),
				homeUrl: String(row.homeUrl == null ? '' : row.homeUrl),
				'default': !!row['default']
			});
		}
		this._catalog = out;
		return out;
	},

	knownFeeds: function(catalog) {
		if (catalog !== undefined)
			return this.parseCatalog(catalog);
		return this._catalog || [];
	},

	defaultFeeds: function() {
		var rows = this.knownFeeds();
		var i;
		var row;
		for (i = 0; i < rows.length; i++) {
			row = rows[i];
			if (row['default'])
				return [{
					id: row.id,
					name: row.name,
					url: row.url,
					enabled: '1',
					description: row.description || ''
				}];
		}
		if (rows[0])
			return [{
				id: rows[0].id,
				name: rows[0].name,
				url: rows[0].url,
				enabled: '1',
				description: rows[0].description || ''
			}];
		return [{
			id: 'official',
			name: 'Official ET Open 8.0',
			url: ETOPEN_OFFICIAL,
			enabled: '1',
			description: 'Proofpoint Emerging Threats Open for Suricata 8.0'
		}];
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
