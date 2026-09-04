'use strict';
'require baseclass';

var FLAG_OPTS = [ 'enabled', 'manual', 'logging', 'openappid' ];

var STRING_OPTS = {
	interface: /^[A-Za-z0-9_.-]+$/,
	home_net: /^[A-Za-z0-9.\/!$,_-]+$/,
	external_net: /^[A-Za-z0-9.\/!$,_-]+$/,
	mode: /^(ids|ips)$/,
	method: /^(pcap|afpacket|nfq)$/,
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
		if (FLAG_OPTS.indexOf(key) >= 0)
			return this.normalizeFlag(value);
		if (key === 'home_net' || key === 'external_net')
			return this.unwrapNet(value);
		return String(value == null ? '' : value).trim();
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
			if (FORM_KEYS.indexOf(key) < 0)
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
	}
});
