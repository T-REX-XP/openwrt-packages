'use strict';
'require baseclass';

var FLAG_OPTS = [ 'enabled' ];

var ETOPEN_OFFICIAL = 'https://rules.emergingthreats.net/open/suricata-8.0/emerging.rules.tar.gz';

var SKIP_DEV_TYPES = { alias: 1, vrf: 1 };

var SKIP_DEV_NAMES = { lo: 1 };

var STRING_OPTS = {
	mode: /^(ids|ips)$/,
	interface: /^[A-Za-z0-9_.-]+$/,
	home_net: /^\[.*\]$|^[0-9a-fA-F.:/ ,]+$/,
	rule_profile: /^(small|full)$/,
	etopen_url: /^https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/
};

var FORM_KEYS = FLAG_OPTS.concat(Object.keys(STRING_OPTS));

var REQUIRED_FORM_KEYS = [
	'enabled', 'interface', 'home_net', 'rule_profile', 'etopen_url', 'mode'
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
	}
});
