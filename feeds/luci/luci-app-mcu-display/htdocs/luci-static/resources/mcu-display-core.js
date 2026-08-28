'use strict';
'require baseclass';

var FORM_DEFAULTS = {
	enable: '1',
	path: '/dev/ttyS2',
	baud: '115200',
	wire_format: 'json',
	demo_mode: '0',
	pages: '/etc/mcud/pages.json',
	wan_if: 'wan',
	lan_if: 'br-lan',
	wifi_if: 'wlan0',
	interval_system: '1000',
	interval_network: '2000',
	push_alerts: '1',
	max_line: '4096',
	screen_timeout: '60',
	screen_timeout_mode: 'off',
	log_level: 'info',
	debug: '0',
	debug_serial: '0',
	menu_nav_button: 'BTN_2',
	menu_select_button: 'wps',
	menu_wps: '0',
	path_autodiscover: '1'
};

var FLAG_OPTS = [
	'enable', 'demo_mode', 'push_alerts', 'debug', 'debug_serial',
	'menu_wps', 'path_autodiscover'
];

var STRING_OPTS = {
	path: /^\/dev\/[A-Za-z0-9._-]+$/,
	pages: /^\/[ -~]+$/,
	wire_format: /^(json|msgpack)$/,
	wan_if: /^[A-Za-z0-9_.-]+$/,
	lan_if: /^[A-Za-z0-9_.-]+$/,
	wifi_if: /^[A-Za-z0-9_.-]+$/,
	screen_timeout_mode: /^(off|dim|blank)$/,
	log_level: /^(error|warn|info|debug)$/,
	menu_nav_button: /^(BTN_2|wps|none|[A-Za-z0-9_.-]+)$/,
	menu_select_button: /^(BTN_2|wps|none|[A-Za-z0-9_.-]+)$/
};

var UINT_OPTS = [ 'baud', 'interval_system', 'interval_network', 'max_line' ];
var UINT_ZERO_OPTS = [ 'screen_timeout' ];

var ALL_SET_OPTS = [
	'enable', 'demo_mode', 'push_alerts', 'debug', 'debug_serial', 'menu_wps', 'path_autodiscover',
	'path', 'pages', 'wire_format', 'wan_if', 'lan_if', 'wifi_if',
	'baud', 'interval_system', 'interval_network', 'max_line',
	'screen_timeout', 'screen_timeout_mode', 'log_level',
	'menu_nav_button', 'menu_select_button'
];

var PAGE_CONTROL_ACTIONS = [ 'prev', 'next', 'goto', 'boot' ];

return baseclass.extend({
	FORM_DEFAULTS: FORM_DEFAULTS,

	rpcData: function(data, fallback) {
		if (Array.isArray(data)) {
			if (data.length > 1 && data[0] === 0 && data[1] != null)
				return data[1];
			if (data.length && data[0] != null && typeof data[0] === 'object')
				return data[0];
			return fallback || {};
		}
		if (data && data.result != null)
			return this.rpcData(data.result, fallback);
		return data || fallback || {};
	},

	optionSelected: function(value, current) {
		return String(value) === String(current) ? 'selected' : null;
	},

	disableIf: function(cond) {
		return cond ? true : null;
	},

	pick: function(cfg, key) {
		cfg = cfg || {};
		return cfg[key] != null && cfg[key] !== '' ?
			String(cfg[key]) : String(FORM_DEFAULTS[key] || '');
	},

	serialPortEffectivePath: function(cfg) {
		cfg = cfg || {};
		if (cfg.effective_path)
			return cfg.effective_path;
		if (cfg.path_valid !== false && cfg.path)
			return cfg.path;
		return cfg.discovered_path || this.pick(cfg, 'path');
	},

	serialPortOptions: function(cfg, naturalCompare) {
		cfg = cfg || {};
		naturalCompare = naturalCompare || function(a, b) {
			return a < b ? -1 : (a > b ? 1 : 0);
		};
		var ports = (cfg.serial_ports || []).slice();
		var current = this.serialPortEffectivePath(cfg);
		var opts = [];
		var seen = {};
		var i;

		if (current && ports.indexOf(current) < 0)
			ports.unshift(current);

		ports.sort(naturalCompare);

		for (i = 0; i < ports.length; i++) {
			if (!ports[i] || seen[ports[i]])
				continue;
			seen[ports[i]] = true;
			opts.push([ ports[i], ports[i] ]);
		}

		if (!opts.length)
			opts.push([ current || '/dev/ttyS2', current || '/dev/ttyS2' ]);

		return opts;
	},

	statusFingerprint: function(st) {
		st = st || {};
		return [
			st.running, st.port_exists, st.fifo_ok, st.boot_stage,
			st.page_id, st.page_idx, st.page_title
		].join('|');
	},

	navBlocked: function(isReadonly, running) {
		return !!isReadonly || !running;
	},

	enabledPages: function(cfg) {
		var out = [];
		var screens;
		var i;
		var p;

		if (!cfg || !Array.isArray(cfg.screens))
			return out;

		screens = cfg.screens;
		for (i = 0; i < screens.length; i++) {
			p = screens[i];
			if (p && p.enabled !== false)
				out.push(p);
		}
		return out;
	},

	pageIndexById: function(cfg, id) {
		var pages = this.enabledPages(cfg);
		var i;

		for (i = 0; i < pages.length; i++) {
			if (pages[i].id === id)
				return i;
		}
		return -1;
	},

	pageTitleForId: function(cfg, id) {
		var pages = this.enabledPages(cfg);
		var i;

		for (i = 0; i < pages.length; i++) {
			if (pages[i].id === id)
				return pages[i].title || pages[i].id;
		}
		return id;
	},

	pageSummaryList: function(cfg) {
		var pages = this.enabledPages(cfg);
		var out = [];
		var i;

		for (i = 0; i < pages.length; i++) {
			out.push({
				id: pages[i].id,
				title: pages[i].title || pages[i].id,
				scope: pages[i].scope || ''
			});
		}
		return out;
	},

	resolveActiveScreen: function(active, bootStage, pagesCfg) {
		active = active ? String(active).trim() : '';
		if (!active)
			return bootStage === 'ready' ? 'router_system' : 'router_boot';
		if (pagesCfg && active !== 'router_boot' &&
		    this.pageIndexById(pagesCfg, active) < 0)
			return bootStage === 'ready' ? 'router_system' : 'router_boot';
		return active;
	},

	buildStatusSnapshot: function(input) {
		input = input || {};
		var pagesCfg = input.pagesCfg || null;
		var bootStage = input.bootStage || '';
		var active = this.resolveActiveScreen(input.active || '', bootStage, pagesCfg);
		var pageIdx = pagesCfg ? this.pageIndexById(pagesCfg, active) : -1;

		return {
			active_screen: active,
			page_id: active,
			page_idx: pageIdx >= 0 ? pageIdx : null,
			page_title: pagesCfg ? this.pageTitleForId(pagesCfg, active) : active,
			page_count: pagesCfg ? this.enabledPages(pagesCfg).length : 0,
			pages: pagesCfg ? this.pageSummaryList(pagesCfg) : []
		};
	},

	shellQuote: function(val) {
		val = String(val == null ? '' : val);
		var out = "'";
		var i;
		var c;

		for (i = 0; i < val.length; i++) {
			c = val.charAt(i);
			out += c === "'" ? "'\\''" : c;
		}
		out += "'";
		return out;
	},

	normalizeConfig: function(raw) {
		if (typeof raw === 'string' && raw.length) {
			try {
				raw = JSON.parse(raw);
			} catch (e) {
				return null;
			}
		}
		if (typeof raw !== 'object' || raw === null)
			return null;
		if (raw.config && typeof raw.config === 'object')
			raw = raw.config;
		else if (raw.config && typeof raw.config === 'string' && raw.config.length) {
			try {
				raw = JSON.parse(raw.config);
			} catch (e) {
				return null;
			}
		}
		return raw;
	},

	validateSetConfig: function(config) {
		config = this.normalizeConfig(config);
		if (typeof config !== 'object' || config === null)
			return 'invalid config';

		var keys = Object.keys(config);
		var i;
		var k;
		var n;

		if (!keys.length)
			return 'empty config';

		for (i = 0; i < keys.length; i++) {
			k = keys[i];
			if (ALL_SET_OPTS.indexOf(k) < 0)
				return 'unknown option ' + k;
			if (FLAG_OPTS.indexOf(k) >= 0) {
				if (config[k] !== '0' && config[k] !== '1')
					return k + ' must be 0 or 1';
			} else if (STRING_OPTS[k]) {
				if (!STRING_OPTS[k].test(String(config[k])))
					return 'invalid ' + k;
			} else if (UINT_OPTS.indexOf(k) >= 0) {
				n = +config[k];
				if (n !== +config[k] || n <= 0)
					return 'invalid ' + k;
			} else if (UINT_ZERO_OPTS.indexOf(k) >= 0) {
				n = +config[k];
				if (n !== +config[k] || n < 0 || n > 3600)
					return 'invalid ' + k;
			}
		}
		return null;
	},

	parsePageControl: function(action, pageId) {
		action = action ? String(action).trim() : '';
		if (!action)
			return { error: 'invalid_action' };
		if (PAGE_CONTROL_ACTIONS.indexOf(action) < 0)
			return { error: 'invalid_action' };
		if (action === 'goto') {
			pageId = pageId ? String(pageId).trim() : '';
			if (!pageId)
				return { error: 'missing_page_id' };
			return { ok: true, action: action, page_id: pageId, via: 'fifo' };
		}
		return { ok: true, action: action, via: 'fifo' };
	},

	pageNeighbor: function(screenId, dir, pageIds) {
		pageIds = pageIds || [
			'router_system', 'router_network', 'router_clients',
			'router_storage', 'router_wifi', 'router_security'
		];
		var idx;
		var count = pageIds.length;

		if (!screenId || screenId === 'router_boot')
			return pageIds[0];

		idx = pageIds.indexOf(screenId);
		if (idx < 0)
			idx = 0;
		if (!dir || dir === 'left')
			return pageIds[(idx + 1) % count];
		return pageIds[(idx + count - 1) % count];
	},

	screenIdKnown: function(screenId, pageIds) {
		pageIds = pageIds || [
			'router_system', 'router_network', 'router_clients',
			'router_storage', 'router_wifi', 'router_security'
		];
		if (!screenId)
			return false;
		if (screenId === 'router_boot')
			return true;
		return pageIds.indexOf(screenId) >= 0;
	},

	parseLogLimit: function(raw, fallback) {
		var n = parseInt(raw, 10);
		if (!n || n < 1)
			n = fallback || 200;
		if (n > 2000)
			n = 2000;
		return n;
	},

	countLogLines: function(text) {
		if (!text)
			return 0;
		return String(text).split('\n').filter(function(line) {
			return line.length > 0;
		}).length;
	}
});
