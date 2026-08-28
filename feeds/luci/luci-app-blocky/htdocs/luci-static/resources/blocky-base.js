'use strict';
'require fs';
'require rpc';
'require ui';
'require poll';
'require uci';
'require blocky-parse-core as bp';
'require blocky-config-core as bc';


var safeString = bp.safeString;
var execResultStdout = bp.execResultStdout;
var blockyCliStdout = bp.blockyCliStdout;
var parseDnsForwardFlag = bp.parseDnsForwardFlag;
var parseBlockyPortLine = bp.parseBlockyPortLine;
var parseBlockyPortValue = bp.parseBlockyPortValue;
var isLoopbackHost = bp.isLoopbackHost;
var blockyHttpBaseUrl = bp.blockyHttpBaseUrl;
var unwrapFsRead = bp.unwrapFsRead;
var emptyBlocklistCatalog = bp.emptyBlocklistCatalog;
var normalizeBlocklistCatalog = bp.normalizeBlocklistCatalog;
var sanitizeBlocklistId = bp.sanitizeBlocklistId;
var parseBlockyDnsPort = bp.parseBlockyDnsPort;
var formatNumber = bp.formatNumber;
var formatPercent = bp.formatPercent;
var parseJson = bp.parseJson;
var sumMapValues = bp.sumMapValues;
var sumDenylistEntries = bp.sumDenylistEntries;
var parseQueryLogConfig = bp.parseQueryLogConfig;
var parseMetrics = bp.parseMetrics;
var parseLabeledMetricGauge = bp.parseLabeledMetricGauge;
var parseDenylistGroupCounts = bp.parseDenylistGroupCounts;
var mergeDenyCounts = bp.mergeDenyCounts;
var metricValue = bp.metricValue;
var formatCompactNumber = bp.formatCompactNumber;
var deriveCumulative = bp.deriveCumulative;
var deriveOverview = bp.deriveOverview;
var filterSamplesByWindow = bp.filterSamplesByWindow;
var downsampleSamples = bp.downsampleSamples;
var bucketAggregateBars = bp.bucketAggregateBars;
var padChartTime2 = bp.padChartTime2;
var formatChartAxisTime = bp.formatChartAxisTime;
var samplesToXY = bp.samplesToXY;
var catmullRomPoint = bp.catmullRomPoint;
var densifyCatmullRom = bp.densifyCatmullRom;
var buildSmoothAreaPath = bp.buildSmoothAreaPath;
var buildSmoothLinePath = bp.buildSmoothLinePath;
var parseBlockyVersionFromMetrics = bp.parseBlockyVersionFromMetrics;
var parseBlockingStatusJson = bp.parseBlockingStatusJson;
var shapeBlockyStatusBar = bp.shapeBlockyStatusBar;
var serviceObjectFromStatus = bp.serviceObjectFromStatus;
var statsResultFromStatus = bp.statsResultFromStatus;
var normalizeValidateResponse = bp.normalizeValidateResponse;
var blocklistsSyncNeeded = bp.blocklistsSyncNeeded;

var CONFIG_PATH = '/etc/blocky/config.yml';
var blockyApiAccess = {
	baseUrl: 'http://127.0.0.1:4000',
	user: '',
	password: ''
};
var RECORD_TYPES = [ 'A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'PTR' ];
var PAUSE_PRESETS = [
	[ '5m', _('5 minutes') ],
	[ '15m', _('15 minutes') ],
	[ '30m', _('30 minutes') ],
	[ '0', _('Until manually enabled') ]
];

var BLOCKY_CHART_FALLBACK = {
	total: '#2196f3',
	blocked: '#e53935',
	cached: '#43a047'
};

function formatDuration(seconds) {
	return bp.formatDuration(seconds, _('not scheduled'));
}

function blockyPathFromUrl(url) {
	return bp.blockyPathFromUrl(url, blockyApiAccess.baseUrl);
}

function blockyPill(kind, label) {
	var cls = 'blocky-pill ';

	if (kind === 'yes')
		cls += 'blocky-pill-yes';
	else if (kind === 'no')
		cls += 'blocky-pill-no';
	else if (kind === 'warn')
		cls += 'blocky-pill-warn';
	else
		cls += 'blocky-pill-muted';

	return E('span', { 'class': cls }, [ label ]);
}

function blockyStatusDetail(text) {
	return E('span', { 'class': 'blocky-pill-note' }, [ text ]);
}

var callServiceList = rpc.declare({
	object: 'service',
	method: 'list',
	params: [ 'name' ],
	expect: { '': {} }
});

var callBlockySyncLists = rpc.declare({
	object: 'luci.blocky',
	method: 'sync_lists',
	expect: { '': {} }
});

var callBlockyRefreshLists = rpc.declare({
	object: 'luci.blocky',
	method: 'refresh_lists',
	expect: { '': {} }
});

var callBlockyHttpRequest = rpc.declare({
	object: 'luci.blocky',
	method: 'http_request',
	params: [ 'method', 'path', 'body' ],
	expect: { '': {} }
});

var callBlockyReadQueryLog = rpc.declare({
	object: 'luci.blocky',
	method: 'read_query_log',
	params: [ 'target', 'max_bytes' ],
	expect: { '': {} }
});

var callBlockyGetVersion = rpc.declare({
	object: 'luci.blocky',
	method: 'get_version',
	expect: { '': {} }
});

var callBlockyGetStatus = rpc.declare({
	object: 'luci.blocky',
	method: 'getStatus',
	expect: { '': {} }
});

var callBlockyGetLogs = rpc.declare({
	object: 'luci.blocky',
	method: 'getLogs',
	params: [ 'limit', 'max_bytes' ],
	expect: { '': {} }
});

var callBlockyValidateConfig = rpc.declare({
	object: 'luci.blocky',
	method: 'validate_config',
	params: [ 'yaml' ],
	expect: { '': {} }
});


function blockyRpcOk(res) {
	return !!(res && typeof res === 'object' && res.ok);
}

function blockyRpcError(res, fallback) {
	if (res && typeof res === 'object') {
		if (res.output)
			return res.output;
		if (res.stderr)
			return res.stderr;
		if (res.stdout)
			return res.stdout;
		if (res.error)
			return res.error;
	}

	return fallback;
}

var BLOCKY_TAB_HASH = {
	'dashboard': 0,
	'statistics': 1,
	'blocklists': 2,
	'block-lists': 2,
	'configuration': 3,
	'config': 3,
	'controls': 4,
	'query': 5,
	'dns-query': 5,
	'logs': 6,
	'debug': 7
};

var BLOCKY_TAB_HASH_KEYS = [
	'dashboard',
	'statistics',
	'blocklists',
	'configuration',
	'controls',
	'query',
	'logs',
	'debug'
];


function notify(message, level) {
	ui.addNotification(null, E('p', {}, [ message ]), level || 'info');
}

function actionButton(label, fn, style, onSuccess) {
	return E('button', {
		'class': 'cbi-button ' + (style || 'cbi-button-action'),
		'click': ui.createHandlerFn(this, function(ev) {
			ev.preventDefault();

			return Promise.resolve().then(fn).then(function() {
				notify(_('Action completed.'));
				if (typeof onSuccess === 'function')
					return onSuccess();
			}).catch(function(err) {
				notify(err.message || String(err), 'danger');
			});
		})
	}, [ label ]);
}

function replaceContent(node, content) {
	while (node.firstChild)
		node.removeChild(node.firstChild);

	if (content == null || content === false)
		return;

	if (Array.isArray(content)) {
		for (var i = 0; i < content.length; i++)
			appendContentNode(node, content[i]);
		return;
	}

	appendContentNode(node, content);
}

function appendContentNode(node, content) {
	if (content == null || content === false || content === '')
		return;

	if (typeof content === 'string' || typeof content === 'number')
		node.appendChild(document.createTextNode(String(content)));
	else
		node.appendChild(content);
}

function applyBlockyApiAccess(configYaml, access) {
	blockyApiAccess.baseUrl = blockyHttpBaseUrl(configYaml);
	blockyApiAccess.user = access && access.user ? access.user : '';
	blockyApiAccess.password = access && access.password ? access.password : '';
}

function loadBlockyUciAccess() {
	return uci.load('blocky').then(function() {
		return {
			user: uci.get('blocky', 'main', 'api_user') || '',
			password: uci.get('blocky', 'main', 'api_password') || '',
			localOnly: uci.get('blocky', 'main', 'api_local_only') !== '0'
		};
	}).catch(function() {
		return { user: '', password: '', localOnly: true };
	});
}

var BLOCKLIST_CATALOG_PATH = '/usr/share/luci-app-blocky/blocklist-catalog.json';
var EMPTY_BLOCKLIST_CATALOG = { presets: [], catalog: [], presetMap: {} };
var blocklistCatalogPromise = null;





function loadBlocklistCatalog(forceReload) {
	if (forceReload)
		blocklistCatalogPromise = null;

	if (blocklistCatalogPromise)
		return blocklistCatalogPromise;

	blocklistCatalogPromise = L.resolveDefault(fs.read(BLOCKLIST_CATALOG_PATH), '').then(function(raw) {
		return normalizeBlocklistCatalog(raw);
	});

	return blocklistCatalogPromise;
}

function blockyPresetHomeUrl(preset) {
	if (!preset || !preset.url)
		return '#';

	if (preset.homeUrl)
		return preset.homeUrl;

	var cleaned = safeString(preset.url).replace(/[#?].*$/, '');

	return cleaned.replace(/\/[^/]*$/, '/') || cleaned;
}

function blockyCloseModal(overlay) {
	if (overlay && overlay.parentNode)
		overlay.parentNode.removeChild(overlay);
}

function blockyOpenModal(title, bodyNodes, footerNodes, options) {
	options = options || {};
	var overlay = E('div', { 'class': 'blocky-modal-overlay' });
	var dialog = E('div', {
		'class': 'blocky-modal' + (options.wide ? ' blocky-modal-wide' : '')
	});
	var closeBtn = E('button', {
		'type': 'button',
		'class': 'blocky-modal-close',
		'title': _('Close'),
		'click': function(ev) {
			ev.preventDefault();
			blockyCloseModal(overlay);
		}
	}, [ '×' ]);

	dialog.appendChild(E('div', { 'class': 'blocky-modal-header' }, [
		E('h4', { 'class': 'blocky-modal-title' }, [ title ]),
		closeBtn
	]));
	dialog.appendChild(E('div', { 'class': 'blocky-modal-body' }, bodyNodes));
	dialog.appendChild(E('div', { 'class': 'blocky-modal-footer' }, footerNodes));

	overlay.appendChild(dialog);
	if (!options.noBackdropClose) {
		overlay.addEventListener('click', function(ev) {
			if (ev.target === overlay)
				blockyCloseModal(overlay);
		});
	}
	dialog.addEventListener('click', function(ev) {
		ev.stopPropagation();
	});

	document.body.appendChild(overlay);
	return overlay;
}

function blockyModalFooterCancel(onCancel) {
	return E('button', {
		'type': 'button',
		'class': 'cbi-button cbi-button-neutral',
		'click': function(ev) {
			ev.preventDefault();
			if (typeof onCancel === 'function')
				onCancel();
		}
	}, [ _('Cancel') ]);
}

function blockyModalFooterSave(label, onSave, style) {
	return E('button', {
		'type': 'button',
		'class': 'cbi-button ' + (style || 'cbi-button-save'),
		'click': ui.createHandlerFn(null, function(ev) {
			ev.preventDefault();
			return Promise.resolve().then(onSave).catch(function(err) {
				notify(err.message || String(err), 'danger');
			});
		})
	}, [ label || _('Save') ]);
}

function execBlockyListsSync() {
	return callBlockySyncLists().then(function(res) {
		if (!blockyRpcOk(res))
			throw new Error(blockyRpcError(res, _('Failed to sync block lists to config.yml')));

		return res;
	});
}

function execBlockyListsRefresh() {
	return callBlockyRefreshLists().then(function(res) {
		if (!blockyRpcOk(res))
			throw new Error(blockyRpcError(res, _('Failed to refresh block lists in Blocky.')));

		return res;
	});
}

function execBlockyListsSyncConfirmed(configYaml) {
	if (!configYaml)
		return execBlockyListsSync();

	return uci.load('blocky').then(function() {
		return confirmBlocklistsYamlSync(configYaml, uciBlocklistEntries());
	}).then(function() {
		return execBlockyListsSync();
	});
}

function uciBlocklistEntries() {
	return uci.sections('blocky', 'blocklist').map(function(section) {
		var id = section['.name'];

		return {
			id: id,
			name: uci.get('blocky', id, 'name') || id,
			url: uci.get('blocky', id, 'url') || '',
			enabled: uci.get('blocky', id, 'enabled') !== '0'
		};
	});
}

function confirmBlocklistsYamlSync(configYaml, entries) {
	if (!configYaml || !blocklistsSyncNeeded(entries, configYaml))
		return Promise.resolve(true);

	var enabled = entries.filter(function(entry) {
		return entry && entry.enabled;
	}).length;

	if (!confirm(_('UCI block lists differ from config.yml. Sync will overwrite the blocking: denylist section with %d enabled UCI list(s). Continue?').format(enabled)))
		return Promise.reject(new Error(_('Sync cancelled.')));

	return Promise.resolve(true);
}

function applyBlockyConfigYaml(yaml, options) {
	options = options || {};
	var restart = !!options.restart;

	yaml = safeString(yaml);
	if (!yaml.trim())
		return Promise.reject(new Error(_('Configuration cannot be empty.')));

	return callBlockyValidateConfig(yaml).then(function(res) {
		var validated = normalizeValidateResponse(res);

		if (!validated.ok)
			throw new Error(validated.output.trim() || _('Configuration validation failed.'));

		return fs.write(CONFIG_PATH, yaml);
	}).then(function() {
		if (typeof options.onUciPatch === 'function')
			return options.onUciPatch();
	}).then(function() {
		return execBlockyListsSync();
	}).then(function() {
		if (restart)
			return runInit('restart');
	});
}

function applyBlocklistChanges(restart, options) {
	options = options || {};

	function doApply() {
		return uci.load('blocky').then(function() {
			return uci.save();
		}).then(function() {
			return execBlockyListsSync();
		}).then(function() {
			if (restart)
				return runInit('restart').then(refreshBlockyLists);

			return refreshBlockyLists();
		});
	}

	if (!options.configYaml || options.skipConfirm)
		return doApply();

	return uci.load('blocky').then(function() {
		return confirmBlocklistsYamlSync(options.configYaml, uciBlocklistEntries());
	}).then(function() {
		return doApply();
	});
}

function refreshBlockyLists() {
	return execBlockyListsRefresh();
}

function resolveDenyCount(counts, entry) {
	var keys;
	var i;

	if (!counts || !entry)
		return null;

	keys = [ entry.id, sanitizeBlocklistId(entry.id), sanitizeBlocklistId(entry.name) ];

	for (i = 0; i < keys.length; i++) {
		if (keys[i] && counts[keys[i]] != null)
			return counts[keys[i]];
	}

	return null;
}

function execDnsmasqSync(argv) {
	return fs.exec('/usr/sbin/blocky-dnsmasq-sync', argv || []).then(function(res) {
		var code = res != null ? Number(res.code) : NaN;

		if (code)
			throw new Error((res.stderr || res.stdout || '').trim() || _('blocky-dnsmasq-sync failed.'));

		return res;
	});
}

function blockyHttpRequest(method, path, body) {
	return callBlockyHttpRequest(method || 'GET', path || 'metrics', body != null ? String(body) : '').then(function(res) {
		var text = res && res.stdout ? res.stdout : '';

		if (!blockyRpcOk(res))
			throw new Error(blockyRpcError(res, _('Request to Blocky failed.')));

		return text;
	});
}

function fetchText(url, method, body) {
	return blockyHttpRequest(method || 'GET', blockyPathFromUrl(url), body);
}

function unwrapFetchText(res) {
	if (res == null || res === '')
		return '';

	if (typeof res === 'string')
		return res;

	if (typeof res === 'object' && res.stdout !== undefined)
		return execResultStdout(res, '');

	return safeString(res.stderr || res);
}

function fetchJson(url, method, body) {
	return fetchText(url, method, body).then(function(res) {
		return parseJson(unwrapFetchText(res));
	});
}

function blockyApi(path, method, body) {
	return fetchJson(blockyApiAccess.baseUrl + '/api' + path, method || 'GET', body);
}

function blockyMetricsUrl() {
	return blockyApiAccess.baseUrl + '/metrics';
}

function fetchBlockyStats() {
	return callBlockyHttpRequest('GET', 'api/stats', '').then(function(res) {
		return bp.parseBlockyStatsResponse(res);
	}).catch(function() {
		return { ok: false, disabled: false, data: null };
	});
}

function mapToBarRows(items, limit) {
	var rows = (items || []).slice(0, limit || 10);
	var max = 1;

	rows.forEach(function(row) {
		max = Math.max(max, Number(row.count) || 0);
	});

	return { rows: rows, max: max };
}

function topListBarRow(label, val, maxVal, tone) {
	var pct = Math.round(100 * val / Math.max(1, maxVal));

	tone = tone || 'queries';

	return E('div', { 'class': 'blocky-bar-row' }, [
		E('div', { 'class': 'blocky-bar-label', 'title': label }, [ label ]),
		E('div', { 'class': 'blocky-bar-track' }, [
			E('div', {
				'class': 'blocky-bar-seg blocky-bar-seg--' + tone,
				'style': 'width:%d%%'.format(Math.min(100, pct))
			})
		]),
		E('div', { 'class': 'blocky-bar-val' }, [ formatNumber(val) ])
	]);
}

var blockingCountdownChannels = {};
var blockingCountdownPollRegistered = false;


function registerBlockingCountdownPoll(onStatus, active, channel) {
	if (typeof onStatus !== 'function' || !channel)
		return;

	blockingCountdownChannels[channel] = {
		fn: onStatus,
		active: !!active
	};

	if (blockingCountdownPollRegistered)
		return;

	blockingCountdownPollRegistered = true;

	poll.add(function() {
		var hasActive = false;

		Object.keys(blockingCountdownChannels).forEach(function(key) {
			if (blockingCountdownChannels[key].active)
				hasActive = true;
		});

		if (!hasActive)
			return;

		return blockyApi('/blocking/status').then(function(status) {
			var paused = !!(status && status.autoEnableInSec > 0);

			Object.keys(blockingCountdownChannels).forEach(function(key) {
				var entry = blockingCountdownChannels[key];

				if (entry.active)
					entry.fn(status || { enabled: false });
			});

			if (!paused) {
				Object.keys(blockingCountdownChannels).forEach(function(key) {
					blockingCountdownChannels[key].active = false;
				});
			}
		});
	}, 1);
}

function shellQuote(value) {
	return "'" + safeString(value).replace(/'/g, "'\\''") + "'";
}

function runInit(action) {
	if ([ 'enable', 'disable', 'start', 'stop', 'restart' ].indexOf(action) === -1)
		return Promise.reject(new Error(_('Unsupported service action.')));

	return fs.exec('/etc/init.d/blocky', [ action ]).then(function(res) {
		var code = res != null ? Number(res.code) : NaN;

		if (code)
			throw new Error((res.stderr || res.stdout || '').trim() || _('blocky init failed.'));

		return res;
	});
}

function isRunning(service) {
	return isNamedServiceRunning(service, 'blocky');
}

function isNamedServiceRunning(service, name) {
	return !!(service && service[name] && service[name].instances &&
		service[name].instances.instance1 && service[name].instances.instance1.running);
}

var REALTIME_WINDOWS = [
	[ '1h', _('1h'), 3600000 ],
	[ '24h', _('24h'), 86400000 ],
	[ '7d', _('7d'), 604800000 ],
	[ '30d', _('30d'), 2592000000 ]
];

var blockyRtMetricsHook = null;


function registerBlockyMetricsPolling() {
	if (registerBlockyMetricsPolling.done)
		return;

	registerBlockyMetricsPolling.done = true;

	poll.add(function() {
		return fetchText(blockyMetricsUrl()).then(function(res) {
			if (blockyRtMetricsHook)
				blockyRtMetricsHook(unwrapFetchText(res));
		}).catch(function() {});
	}, 10);
}

function setBlockyMetricsPollingHook(fn) {
	blockyRtMetricsHook = fn;
	registerBlockyMetricsPolling();
}

function renderTabs(tabs, activeIndex) {
	var tabButtons = [];
	var tabPanels = [];
	activeIndex = activeIndex || 0;

	function activate(index) {
		tabButtons.forEach(function(button, pos) {
			button.className = pos === index ? 'cbi-tab' : 'cbi-tab-disabled';
		});

		tabPanels.forEach(function(panel, pos) {
			panel.style.display = pos === index ? '' : 'none';
		});

		if (BLOCKY_TAB_HASH_KEYS[index])
			window.location.hash = BLOCKY_TAB_HASH_KEYS[index];
	}

	tabs.forEach(function(tab, index) {
		var button = E('li', {
			'class': index === activeIndex ? 'cbi-tab' : 'cbi-tab-disabled',
			'role': 'tab',
			'click': function(ev) {
				ev.preventDefault();
				activate(index);
			}
		}, [
			E('a', { 'href': '#' }, [ tab.title ])
		]);
		var panel = E('div', {
			'role': 'tabpanel',
			'style': index === activeIndex ? '' : 'display:none'
		}, tab.nodes);

		tabButtons.push(button);
		tabPanels.push(panel);
	});

	return E('div', {}, [
		E('ul', { 'class': 'cbi-tabmenu', 'role': 'tablist' }, tabButtons)
	].concat(tabPanels));
}

function loadBlockyPageData() {
	return Promise.all([
		L.resolveDefault(callBlockyGetStatus(), {}),
		L.resolveDefault(fs.read_direct(CONFIG_PATH), ''),
		loadBlockyUciAccess(),
		L.resolveDefault(callServiceList('adblock'), {}),
		loadBlocklistCatalog(),
		L.resolveDefault(fetchText(blockyMetricsUrl()), '')
	]).then(function(parts) {
		var status = parts[0] || {};

		applyBlockyApiAccess(parts[1], parts[2]);

		return [
			serviceObjectFromStatus(status),
			status.blocking || { enabled: false },
			parts[1],
			parts[5],
			{ code: 0, stdout: status.dnsmasq_forward ? '1\n' : '0\n' },
			statsResultFromStatus(status),
			parts[3],
			parts[2],
			parts[4],
			status
		];
	});
}

function renderBlockyStatusBar(pageStatus, onJumpTab) {
	var bar = shapeBlockyStatusBar(pageStatus);
	var dnsPort = bar.ports.dns || 5353;

	function jumpTab(hash) {
		return function(ev) {
			ev.preventDefault();
			if (typeof onJumpTab === 'function')
				onJumpTab(hash);
		};
	}

	function item(label, ok, detail, hash) {
		return E('div', { 'class': 'blocky-status-bar-item' }, [
			E('span', { 'class': 'blocky-status-bar-label' }, [ label ]),
			blockyPill(ok ? 'yes' : (bar.blockingPaused && label === _('Blocking') ? 'warn' : 'no'),
				ok ? _('OK') : _('Check')),
			detail ? blockyStatusDetail(detail) : '',
			hash ? E('a', {
				'href': '#' + hash,
				'class': 'blocky-status-bar-link',
				'click': jumpTab(hash)
			}, [ _('Details') ]) : ''
		]);
	}

	var blockingDetail = bar.blockingOk
		? _('Active')
		: (bar.blockingPaused
			? _('Paused — resumes in %s').format(formatDuration(bar.blockingResumeSec))
			: _('Disabled'));

	return E('div', { 'class': 'blocky-status-bar', 'role': 'status' }, [
		item(_('Blocky'), bar.serviceOk, bar.serviceOk
			? _('UDP/TCP :%d').format(dnsPort) : _('Start from Controls'), 'controls'),
		item(_('Blocking'), bar.blockingOk || bar.blockingPaused, blockingDetail, 'controls'),
		item(_('Router DNS'), bar.dnsmasqOk, bar.dnsmasqOk
			? _('dnsmasq → Blocky') : _('Enable in Configuration'), 'configuration'),
		item(_('HTTP API'), bar.apiOk, bar.apiOk
			? _(':%d reachable').format(bar.ports.http || 4000) : _('Not reachable'), 'debug'),
		bar.version ? E('span', { 'class': 'blocky-status-bar-version' }, [
			_('Blocky %s').format(bar.version)
		]) : ''
	]);
}

function resolveBlockyVersion(metricsText) {
	var fromMetrics = parseBlockyVersionFromMetrics(metricsText);

	if (fromMetrics)
		return Promise.resolve(fromMetrics);

	return L.resolveDefault(callBlockyGetVersion(), {}).then(function(res) {
		if (res && res.ok && res.version)
			return res.version;

		return '';
	});
}

function renderBlockyVersionBadge(version) {
	if (!version)
		return '';

	return E('span', { 'class': 'blocky-version-badge' }, [
		_('Blocky %s').format(version)
	]);
}

function resolveDefaultTabFromHash(fallback) {
	var hash = safeString(window.location.hash).replace(/^#/, '').toLowerCase();

	if (hash && Object.prototype.hasOwnProperty.call(BLOCKY_TAB_HASH, hash))
		return BLOCKY_TAB_HASH[hash];

	return fallback || 0;
}

return {
	formatDuration: formatDuration,
	blockyPathFromUrl: blockyPathFromUrl,
	blockyPill: blockyPill,
	blockyStatusDetail: blockyStatusDetail,
	blockyRpcOk: blockyRpcOk,
	blockyRpcError: blockyRpcError,
	notify: notify,
	actionButton: actionButton,
	replaceContent: replaceContent,
	appendContentNode: appendContentNode,
	applyBlockyApiAccess: applyBlockyApiAccess,
	loadBlockyUciAccess: loadBlockyUciAccess,
	loadBlocklistCatalog: loadBlocklistCatalog,
	blockyPresetHomeUrl: blockyPresetHomeUrl,
	blockyCloseModal: blockyCloseModal,
	blockyOpenModal: blockyOpenModal,
	blockyModalFooterCancel: blockyModalFooterCancel,
	blockyModalFooterSave: blockyModalFooterSave,
	execBlockyListsSync: execBlockyListsSync,
	execBlockyListsSyncConfirmed: execBlockyListsSyncConfirmed,
	execBlockyListsRefresh: execBlockyListsRefresh,
	applyBlockyConfigYaml: applyBlockyConfigYaml,
	confirmBlocklistsYamlSync: confirmBlocklistsYamlSync,
	applyBlocklistChanges: applyBlocklistChanges,
	refreshBlockyLists: refreshBlockyLists,
	resolveDenyCount: resolveDenyCount,
	execDnsmasqSync: execDnsmasqSync,
	blockyHttpRequest: blockyHttpRequest,
	fetchText: fetchText,
	unwrapFetchText: unwrapFetchText,
	fetchJson: fetchJson,
	blockyApi: blockyApi,
	blockyMetricsUrl: blockyMetricsUrl,
	fetchBlockyStats: fetchBlockyStats,
	mapToBarRows: mapToBarRows,
	topListBarRow: topListBarRow,
	registerBlockingCountdownPoll: registerBlockingCountdownPoll,
	shellQuote: shellQuote,
	runInit: runInit,
	isRunning: isRunning,
	isNamedServiceRunning: isNamedServiceRunning,
	registerBlockyMetricsPolling: registerBlockyMetricsPolling,
	setBlockyMetricsPollingHook: setBlockyMetricsPollingHook,
	renderTabs: renderTabs,
	loadBlockyPageData: loadBlockyPageData,
	renderBlockyStatusBar: renderBlockyStatusBar,
	callBlockyGetStatus: callBlockyGetStatus,
	callBlockyGetLogs: callBlockyGetLogs,
	callBlockyValidateConfig: callBlockyValidateConfig,
	resolveBlockyVersion: resolveBlockyVersion,
	renderBlockyVersionBadge: renderBlockyVersionBadge,
	resolveDefaultTabFromHash: resolveDefaultTabFromHash,
	CONFIG_PATH: CONFIG_PATH,
	blockyApiAccess: blockyApiAccess,
	RECORD_TYPES: RECORD_TYPES,
	PAUSE_PRESETS: PAUSE_PRESETS,
	EMPTY_BLOCKLIST_CATALOG: EMPTY_BLOCKLIST_CATALOG,
	BLOCKLIST_CATALOG_PATH: BLOCKLIST_CATALOG_PATH,
	BLOCKY_CHART_FALLBACK: BLOCKY_CHART_FALLBACK,
	BLOCKY_TAB_HASH: BLOCKY_TAB_HASH,
	BLOCKY_TAB_HASH_KEYS: BLOCKY_TAB_HASH_KEYS,
	REALTIME_WINDOWS: REALTIME_WINDOWS,
	callServiceList: callServiceList,
	callBlockySyncLists: callBlockySyncLists,
	callBlockyRefreshLists: callBlockyRefreshLists,
	callBlockyHttpRequest: callBlockyHttpRequest,
	callBlockyReadQueryLog: callBlockyReadQueryLog,
	callBlockyGetVersion: callBlockyGetVersion,
	bp: bp,
	bc: bc,
	safeString: bp.safeString,
	execResultStdout: bp.execResultStdout,
	blockyCliStdout: bp.blockyCliStdout,
	parseDnsForwardFlag: bp.parseDnsForwardFlag,
	parseBlockyPortLine: bp.parseBlockyPortLine,
	parseBlockyPortValue: bp.parseBlockyPortValue,
	isLoopbackHost: bp.isLoopbackHost,
	blockyHttpBaseUrl: bp.blockyHttpBaseUrl,
	unwrapFsRead: bp.unwrapFsRead,
	emptyBlocklistCatalog: bp.emptyBlocklistCatalog,
	normalizeBlocklistCatalog: bp.normalizeBlocklistCatalog,
	sanitizeBlocklistId: bp.sanitizeBlocklistId,
	parseBlockyDnsPort: bp.parseBlockyDnsPort,
	formatNumber: bp.formatNumber,
	formatPercent: bp.formatPercent,
	parseJson: bp.parseJson,
	sumMapValues: bp.sumMapValues,
	sumDenylistEntries: bp.sumDenylistEntries,
	parseQueryLogConfig: bp.parseQueryLogConfig,
	parseMetrics: bp.parseMetrics,
	parseDenylistGroupCounts: bp.parseDenylistGroupCounts,
	mergeDenyCounts: bp.mergeDenyCounts,
	metricValue: bp.metricValue,
	formatCompactNumber: bp.formatCompactNumber,
	deriveCumulative: bp.deriveCumulative,
	deriveOverview: bp.deriveOverview,
	filterSamplesByWindow: bp.filterSamplesByWindow,
	downsampleSamples: bp.downsampleSamples,
	bucketAggregateBars: bp.bucketAggregateBars,
	padChartTime2: bp.padChartTime2,
	formatChartAxisTime: bp.formatChartAxisTime,
	samplesToXY: bp.samplesToXY,
	catmullRomPoint: bp.catmullRomPoint,
	densifyCatmullRom: bp.densifyCatmullRom,
	buildSmoothAreaPath: bp.buildSmoothAreaPath,
	buildSmoothLinePath: bp.buildSmoothLinePath,
	parseBlockyVersionFromMetrics: bp.parseBlockyVersionFromMetrics,
	parseBlockingStatusJson: bp.parseBlockingStatusJson,
	shapeBlockyStatusBar: bp.shapeBlockyStatusBar,
	serviceObjectFromStatus: bp.serviceObjectFromStatus,
	statsResultFromStatus: bp.statsResultFromStatus,
	parseYamlDenylists: bp.parseYamlDenylists,
	denylistFingerprintFromUci: bp.denylistFingerprintFromUci,
	denylistFingerprintFromYaml: bp.denylistFingerprintFromYaml,
	blocklistsSyncNeeded: bp.blocklistsSyncNeeded,
	normalizeValidateResponse: bp.normalizeValidateResponse
};
