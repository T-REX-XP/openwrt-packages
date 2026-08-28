'use strict';
'require ui';
'require uci';
'require fs';
'require poll';
'require blocky-base as Blocky';

var safeString = Blocky.safeString,
	execResultStdout = Blocky.execResultStdout,
	blockyCliStdout = Blocky.blockyCliStdout,
	parseDnsForwardFlag = Blocky.parseDnsForwardFlag,
	parseBlockyPortLine = Blocky.parseBlockyPortLine,
	parseBlockyPortValue = Blocky.parseBlockyPortValue,
	isLoopbackHost = Blocky.isLoopbackHost,
	blockyHttpBaseUrl = Blocky.blockyHttpBaseUrl,
	unwrapFsRead = Blocky.unwrapFsRead,
	emptyBlocklistCatalog = Blocky.emptyBlocklistCatalog,
	normalizeBlocklistCatalog = Blocky.normalizeBlocklistCatalog,
	sanitizeBlocklistId = Blocky.sanitizeBlocklistId,
	parseBlockyDnsPort = Blocky.parseBlockyDnsPort,
	formatNumber = Blocky.formatNumber,
	formatPercent = Blocky.formatPercent,
	parseJson = Blocky.parseJson,
	sumMapValues = Blocky.sumMapValues,
	sumDenylistEntries = Blocky.sumDenylistEntries,
	parseQueryLogConfig = Blocky.parseQueryLogConfig,
	parseMetrics = Blocky.parseMetrics,
	mergeDenyCounts = Blocky.mergeDenyCounts,
	parseDenylistGroupCounts = Blocky.parseDenylistGroupCounts,
	metricValue = Blocky.metricValue,
	formatCompactNumber = Blocky.formatCompactNumber,
	deriveOverview = Blocky.deriveOverview,
	deriveCumulative = Blocky.deriveCumulative,
	filterSamplesByWindow = Blocky.filterSamplesByWindow,
	downsampleSamples = Blocky.downsampleSamples,
	bucketAggregateBars = Blocky.bucketAggregateBars,
	padChartTime2 = Blocky.padChartTime2,
	formatChartAxisTime = Blocky.formatChartAxisTime,
	samplesToXY = Blocky.samplesToXY,
	catmullRomPoint = Blocky.catmullRomPoint,
	densifyCatmullRom = Blocky.densifyCatmullRom,
	buildSmoothAreaPath = Blocky.buildSmoothAreaPath,
	buildSmoothLinePath = Blocky.buildSmoothLinePath,
	parseBlockyVersionFromMetrics = Blocky.parseBlockyVersionFromMetrics,
	formatDuration = Blocky.formatDuration,
	blockyPathFromUrl = Blocky.blockyPathFromUrl,
	CONFIG_PATH = Blocky.CONFIG_PATH,
	blockyApiAccess = Blocky.blockyApiAccess,
	RECORD_TYPES = Blocky.RECORD_TYPES,
	PAUSE_PRESETS = Blocky.PAUSE_PRESETS,
	EMPTY_BLOCKLIST_CATALOG = Blocky.EMPTY_BLOCKLIST_CATALOG,
	BLOCKLIST_CATALOG_PATH = Blocky.BLOCKLIST_CATALOG_PATH,
	REALTIME_WINDOWS = Blocky.REALTIME_WINDOWS,
	BLOCKY_CHART_FALLBACK = Blocky.BLOCKY_CHART_FALLBACK,
	callBlockySyncLists = Blocky.callBlockySyncLists,
	callBlockyRefreshLists = Blocky.callBlockyRefreshLists,
	callBlockyHttpRequest = Blocky.callBlockyHttpRequest,
	callBlockyReadQueryLog = Blocky.callBlockyReadQueryLog,
	callBlockyGetVersion = Blocky.callBlockyGetVersion,
	callServiceList = Blocky.callServiceList,
	notify = Blocky.notify,
	actionButton = Blocky.actionButton,
	replaceContent = Blocky.replaceContent,
	applyBlockyApiAccess = Blocky.applyBlockyApiAccess,
	applyBlocklistChanges = Blocky.applyBlocklistChanges,
	refreshBlockyLists = Blocky.refreshBlockyLists,
	execBlockyListsSync = Blocky.execBlockyListsSync,
	execBlockyListsRefresh = Blocky.execBlockyListsRefresh,
	applyBlockyConfigYaml = Blocky.applyBlockyConfigYaml,
	loadBlocklistCatalog = Blocky.loadBlocklistCatalog,
	loadUciBlocklists = Blocky.loadUciBlocklists,
	blockyCloseModal = Blocky.blockyCloseModal,
	blockyOpenModal = Blocky.blockyOpenModal,
	blockyModalFooterCancel = Blocky.blockyModalFooterCancel,
	blockyModalFooterSave = Blocky.blockyModalFooterSave,
	blockyPresetHomeUrl = Blocky.blockyPresetHomeUrl,
	blockyRpcOk = Blocky.blockyRpcOk,
	blockyRpcError = Blocky.blockyRpcError,
	blockyApi = Blocky.blockyApi,
	blockyHttpRequest = Blocky.blockyHttpRequest,
	fetchText = Blocky.fetchText,
	fetchJson = Blocky.fetchJson,
	blockyMetricsUrl = Blocky.blockyMetricsUrl,
	fetchBlockyStats = Blocky.fetchBlockyStats,
	runInit = Blocky.runInit,
	execDnsmasqSync = Blocky.execDnsmasqSync,
	shellQuote = Blocky.shellQuote,
	blockyPill = Blocky.blockyPill,
	blockyStatusDetail = Blocky.blockyStatusDetail,
	blockyLegendDot = Blocky.blockyLegendDot,
	blockyChartColor = Blocky.blockyChartColor,
	blockyChartFill = Blocky.blockyChartFill,
	blockyCssVar = Blocky.blockyCssVar,
	blockyThemeRoot = Blocky.blockyThemeRoot,
	applyBlockyChartPathTheme = Blocky.applyBlockyChartPathTheme,
	blockyAttachThemeSync = Blocky.blockyAttachThemeSync,
	registerBlockingCountdownPoll = Blocky.registerBlockingCountdownPoll,
	topListBarRow = Blocky.topListBarRow,
	mapToBarRows = Blocky.mapToBarRows,
	resolveDenyCount = Blocky.resolveDenyCount,
	bc = Blocky.bc,
	bp = Blocky.bp;

function renderApiSecuritySection(configYaml, uciAccess, embedded) {
	var httpEp = parseBlockyPortLine(configYaml, 'http', 4000);
	var localBind = isLoopbackHost(httpEp.host);

	var body = [
		E('p', { 'class': 'blocky-config-section-descr' }, [
			_('Blocky v0.32.x does not support API keys or built-in HTTP authentication. Keep ports.http bound to 127.0.0.1 so only processes on the router (LuCI, local scripts) can reach /api and /metrics.')
		]),
		E('div', { 'class': 'table blocky-status-table' }, [
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:33%' }, [ _('HTTP listener') ]),
				E('div', { 'class': 'td left' }, [
					blockyPill(localBind ? 'yes' : 'warn', localBind ? _('Localhost') : _('Exposed')),
					blockyStatusDetail(blockyHttpBaseUrl(configYaml))
				])
			])
		]),
		E('p', { 'class': 'blocky-note-soft' }, [
			_('Recommended config.yml: ports.http: 127.0.0.1:4000 and ports.dns: 127.0.0.1:5353. Do not expose the Blocky API on LAN without an external authenticating reverse proxy.')
		])
	];

	if (embedded)
		return configSectionPage(_('API access'), '', body);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('API access') ])
	].concat(body));
}

function renderRouterDnsIntegration(configYaml, dnsFwdRaw, embedded) {
	var port = parseBlockyDnsPort(configYaml);
	var forwardHost = E('div', { 'class': 'td left' });

	function paintForward(raw) {
		var enabled = parseDnsForwardFlag(raw);

		replaceContent(forwardHost, [
			blockyPill(enabled ? 'yes' : 'no', enabled ? _('Yes') : _('No')),
			blockyStatusDetail(enabled
				? _('dnsmasq uses %s').format('127.0.0.1#' + String(port))
				: _('WAN / resolv upstream only'))
		]);
	}

	function refreshForward() {
		return fs.exec('/usr/sbin/blocky-dnsmasq-sync', [ 'status' ]).then(function(res) {
			paintForward(blockyCliStdout(execResultStdout(res, '0\n')));
		});
	}

	paintForward(dnsFwdRaw);

	var body = [
		E('p', { 'class': 'blocky-config-section-descr' }, [
			_('Phones and laptops on Wi-Fi ask dnsmasq on the router for DNS (UDP/TCP port 53). Blocky uses its own port (%s in config.yml) so it does not replace dnsmasq. Turn this on to chain dnsmasq to Blocky so filtering and block lists apply to every DHCP client without manual DNS settings.').format(String(port))
		]),
		E('div', { 'class': 'table blocky-status-table' }, [
			E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left', 'style': 'width:33%' }, [ _('Forwarding') ]),
				forwardHost
			])
		]),
		E('p', {}, [
			actionButton(_('Use Blocky for all LAN / Wi-Fi DNS'), function() {
				return execDnsmasqSync([ 'enable', String(port) ]);
			}, 'cbi-button-apply', refreshForward),
			' ',
			actionButton(_('Stop forwarding (restore dnsmasq only)'), function() {
				return execDnsmasqSync([ 'disable' ]);
			}, 'cbi-button-negative', refreshForward)
		]),
		E('p', { 'class': 'blocky-note-soft' }, [
			_('After changing the DNS port in YAML, click Save & restart Blocky, then toggle this again so dnsmasq matches. Block list refresh still uses the Controls tab “Refresh lists” API button.')
		])
	];

	if (embedded)
		return configSectionPage(_('Router DNS integration'), '', body);

	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Router DNS integration') ])
	].concat(body));
}

function settingsRow(label, descr, control) {
	return E('div', { 'class': 'blocky-settings-row' }, [
		E('div', { 'class': 'blocky-settings-meta' }, [
			E('label', { 'class': 'blocky-settings-label' }, [ label ]),
			descr ? E('p', { 'class': 'blocky-settings-hint' }, [ descr ]) : ''
		]),
		E('div', { 'class': 'blocky-settings-control' }, [ control ])
	]);
}

function settingsPanel(title, descr, rows) {
	return E('div', { 'class': 'blocky-dash-panel blocky-settings-panel' }, [
		E('div', { 'class': 'blocky-dash-panel-head' }, [
			E('div', {}, [
				E('h3', { 'class': 'blocky-dash-panel-title' }, [ title ]),
				descr ? E('p', { 'class': 'blocky-dash-panel-subtitle' }, [ descr ]) : ''
			])
		]),
		E('div', { 'class': 'blocky-settings-body' }, rows)
	]);
}

function configSectionPage(title, descr, rows) {
	var nodes = [
		E('h3', { 'class': 'blocky-config-section-title' }, [ title ])
	];

	if (descr)
		nodes.push(E('p', { 'class': 'blocky-config-section-descr' }, [ descr ]));

	nodes.push(E('div', { 'class': 'blocky-config-section-form' }, rows));

	return E('div', { 'class': 'blocky-config-section' }, nodes);
}

function renderBlockyConfigLayout(sections, toolbar, activeIndex) {
	var mainHost = E('div', { 'class': 'blocky-config-main' });
	var navItems = [];

	function activate(index) {
		if (!sections[index])
			return;

		navItems.forEach(function(item, pos) {
			item.classList.toggle('active', pos === index);
		});
		replaceContent(mainHost, sections[index].content);
	}

	var nav = E('nav', { 'class': 'blocky-config-nav', 'role': 'navigation' });

	sections.forEach(function(section, index) {
		var item = E('button', {
			'type': 'button',
			'class': 'blocky-config-nav-item' + (index === activeIndex ? ' active' : ''),
			'click': function(ev) {
				ev.preventDefault();
				activate(index);
			}
		}, [ section.title ]);

		navItems.push(item);
		nav.appendChild(item);
	});

	activate(activeIndex || 0);

	return E('div', { 'class': 'blocky-config-layout' }, [
		E('aside', { 'class': 'blocky-config-sidebar' }, [ nav ]),
		E('div', { 'class': 'blocky-config-content' }, [
			toolbar,
			mainHost
		])
	]);
}

function readUpstreamGroupsFromState(state) {
	var groups = {};

	state.upstreamGroupRows.forEach(function(row) {
		var name = safeString(row.nameInput.value).trim().replace(/[^A-Za-z0-9_*[\].-]/g, '_').replace(/^-+/, '');
		var resolvers;

		if (!name)
			return;

		resolvers = row.resolversInput.value.split(/\n/).map(function(line) {
			return line.trim();
		}).filter(Boolean);

		groups[name] = resolvers;
	});

	if (!groups.default)
		groups.default = [];

	return groups;
}

function readBlockySettingsForm(state) {
	return {
		upstreamGroups: readUpstreamGroupsFromState(state),
		upstreamResolvers: (state.upstreamGroupRows[0] && state.upstreamGroupRows[0].resolversInput.value) || '',
		upstreamInitStrategy: state.upstreamInitStrategy.value,
		upstreamTimeout: state.upstreamTimeout.value,
		bootstrapResolvers: state.bootstrapResolvers.value,
		bootstrapUseWan: state.bootstrapUseWan.checked,
		listRefreshPeriod: state.listRefreshPeriod.value,
		loadingStrategy: state.loadingStrategy.value,
		listCachePath: state.listCachePath.value.trim(),
		listDownloadTimeout: state.listDownloadTimeout.value,
		listWriteTimeout: state.listWriteTimeout.value,
		listReadTimeout: state.listReadTimeout.value,
		listDownloadAttempts: state.listDownloadAttempts.value,
		listCooldown: state.listCooldown.value,
		listConcurrency: state.listConcurrency.value,
		cachingMinTime: state.cachingMinTime.value,
		cachingMaxTime: state.cachingMaxTime.value,
		cachingPrefetch: state.cachingPrefetch.checked,
		hostsSources: state.hostsSources.value,
		logLevel: state.logLevel.value,
		logPrivacy: state.logPrivacy.checked,
		queryLogType: 'csv',
		queryLogTarget: state.queryLogTarget.value,
		queryLogRetention: state.queryLogRetention.value,
		queryLogFlush: state.queryLogFlush.value,
		portDns: state.portDns.value.trim(),
		portHttp: state.portHttp.value.trim(),
		rebindingEnable: state.rebindingEnable.checked,
		prometheusEnable: state.prometheusEnable.checked,
		prometheusPath: state.prometheusPath.value.trim(),
		statisticsEnable: state.statisticsEnable.checked,
		blockingSection: state.blockingSection
	};
}

function saveBlockySettingsForm(state, currentYaml, restart) {
	var fields = readBlockySettingsForm(state);

	fields.blockingSection = bc.patchBlockingLoadingSection(fields.blockingSection, fields);

	if (!/^127\.0\.0\.1:|^localhost:|^\[::1\]:/.test(fields.portDns) ||
	    !/^127\.0\.0\.1:|^localhost:|^\[::1\]:/.test(fields.portHttp))
		throw new Error(_('Keep DNS and HTTP listeners on localhost (127.0.0.1) on the router.'));

	var yaml = bc.buildBlockySettingsYaml(fields, currentYaml);

	return applyBlockyConfigYaml(yaml, {
		restart: restart,
		onUciPatch: function() {
			return uci.load('blocky').then(function() {
				uci.set('blocky', 'main', 'refresh_period', fields.listRefreshPeriod || '4h');
				return uci.save();
			});
		}
	});
}

function renderUpstreamGroupsEditor(parsed) {
	var listHost = E('div', { 'class': 'blocky-upstream-groups-list' });
	var rows = [];

	function sanitizeGroupName(raw) {
		return safeString(raw).trim().replace(/[^A-Za-z0-9_*[\].-]/g, '_').replace(/^-+/, '');
	}

	function repaint() {
		replaceContent(listHost, rows.map(function(row) {
			return row.panel;
		}));
	}

	function addGroup(name, resolvers) {
		var isDefault = name === 'default';
		var nameInput = E('input', {
			'class': 'cbi-input-text blocky-upstream-group-name',
			'value': name || '',
			'placeholder': _('Group name'),
			'readonly': isDefault ? 'readonly' : null
		});
		var resolversInput = E('textarea', {
			'class': 'cbi-input-textarea blocky-settings-textarea blocky-upstream-group-resolvers',
			'rows': 4,
			'placeholder': _('One resolver per line')
		}, [ (resolvers || []).join('\n') ]);
		var row = { nameInput: nameInput, resolversInput: resolversInput, panel: null };
		var panel = E('div', { 'class': 'blocky-upstream-group' }, [
			E('div', { 'class': 'blocky-upstream-group-head' }, [
				E('label', { 'class': 'blocky-upstream-group-label' }, [ _('Group') ]),
				nameInput,
				isDefault ? '' : E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-negative blocky-upstream-group-remove',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						rows = rows.filter(function(entry) {
							return entry !== row;
						});
						repaint();
					})
				}, [ _('Remove') ])
			]),
			resolversInput
		]);

		row.panel = panel;
		rows.push(row);
		repaint();
		return row;
	}

	Object.keys(parsed.upstreamGroups || { default: parsed.upstreamResolvers }).sort(function(a, b) {
		if (a === 'default')
			return -1;
		if (b === 'default')
			return 1;
		return a.localeCompare(b);
	}).forEach(function(name) {
		addGroup(name, (parsed.upstreamGroups && parsed.upstreamGroups[name]) || (name === 'default' ? parsed.upstreamResolvers : []));
	});

	if (!rows.length)
		addGroup('default', parsed.upstreamResolvers || []);

	return {
		host: E('div', { 'class': 'blocky-upstream-groups' }, [
			listHost,
			E('p', { 'class': 'blocky-upstream-groups-actions' }, [
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-add',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						var base = 'group_' + String(rows.length + 1);
						var name = base;

						while (rows.some(function(entry) {
							return sanitizeGroupName(entry.nameInput.value) === name;
						}))
							name = base + '_' + String(Date.now());

						addGroup(name, []);
					})
				}, [ _('Add upstream group') ])
			]),
			E('p', { 'class': 'blocky-note-soft' }, [
				_('The default group is used for most clients. Additional groups can be referenced from blocking clientGroupsBlock in Advanced YAML.')
			])
		]),
		rows: rows
	};
}

function renderBlockySettingsForm(configYaml, dnsFwdRaw, uciAccess, refreshPage) {
	var parsed = bc.parseBlockySettings(configYaml);
	var upstreamEditor = renderUpstreamGroupsEditor(parsed);
	var state = {
		upstreamGroupRows: upstreamEditor.rows,
		upstreamInitStrategy: E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'fast', 'selected': parsed.upstreamInitStrategy === 'fast' ? '' : null }, [ 'fast' ]),
			E('option', { 'value': 'blocking', 'selected': parsed.upstreamInitStrategy === 'blocking' ? '' : null }, [ 'blocking' ]),
			E('option', { 'value': 'failOnError', 'selected': parsed.upstreamInitStrategy === 'failOnError' ? '' : null }, [ 'failOnError' ])
		]),
		upstreamTimeout: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.upstreamTimeout,
			'placeholder': '5s'
		}),
		bootstrapResolvers: E('textarea', {
			'class': 'cbi-input-textarea blocky-settings-textarea',
			'rows': 3
		}, [ parsed.bootstrapResolvers.join('\n') ]),
		bootstrapUseWan: E('input', {
			'type': 'checkbox',
			'checked': parsed.bootstrapUseWan ? '' : null
		}),
		listRefreshPeriod: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listRefreshPeriod,
			'placeholder': '4h'
		}),
		listDownloadTimeout: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listDownloadTimeout,
			'placeholder': '60s'
		}),
		listDownloadAttempts: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listDownloadAttempts,
			'placeholder': '5'
		}),
		loadingStrategy: E('select', { 'class': 'cbi-input-select' }, [
			E('option', { 'value': 'fast', 'selected': parsed.loadingStrategy === 'fast' ? '' : null }, [ 'fast' ]),
			E('option', { 'value': 'blocking', 'selected': parsed.loadingStrategy === 'blocking' ? '' : null }, [ 'blocking' ]),
			E('option', { 'value': 'failOnError', 'selected': parsed.loadingStrategy === 'failOnError' ? '' : null }, [ 'failOnError' ])
		]),
		listCachePath: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listCachePath,
			'style': 'width:100%'
		}),
		listWriteTimeout: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listWriteTimeout,
			'placeholder': '60s'
		}),
		listReadTimeout: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listReadTimeout,
			'placeholder': '60s'
		}),
		listCooldown: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listCooldown,
			'placeholder': '10s'
		}),
		listConcurrency: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.listConcurrency,
			'placeholder': '4'
		}),
		cachingMinTime: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.cachingMinTime,
			'placeholder': '5m'
		}),
		cachingMaxTime: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.cachingMaxTime,
			'placeholder': '30m'
		}),
		cachingPrefetch: E('input', {
			'type': 'checkbox',
			'checked': parsed.cachingPrefetch ? '' : null
		}),
		hostsSources: E('textarea', {
			'class': 'cbi-input-textarea blocky-settings-textarea',
			'rows': 3
		}, [ parsed.hostsSources.join('\n') ]),
		logLevel: E('select', { 'class': 'cbi-input-select' }, [
			'trace', 'debug', 'info', 'warn', 'error'
		].map(function(level) {
			return E('option', {
				'value': level,
				'selected': parsed.logLevel === level ? '' : null
			}, [ level ]);
		})),
		logPrivacy: E('input', {
			'type': 'checkbox',
			'checked': parsed.logPrivacy ? '' : null
		}),
		queryLogTarget: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.queryLogTarget,
			'style': 'width:100%'
		}),
		queryLogRetention: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.queryLogRetention,
			'placeholder': '7'
		}),
		queryLogFlush: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.queryLogFlush,
			'placeholder': '30s'
		}),
		portDns: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.portDns,
			'style': 'width:100%'
		}),
		portHttp: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.portHttp,
			'style': 'width:100%'
		}),
		rebindingEnable: E('input', {
			'type': 'checkbox',
			'checked': parsed.rebindingEnable ? '' : null
		}),
		prometheusEnable: E('input', {
			'type': 'checkbox',
			'checked': parsed.prometheusEnable ? '' : null
		}),
		prometheusPath: E('input', {
			'class': 'cbi-input-text',
			'value': parsed.prometheusPath,
			'style': 'width:100%'
		}),
		statisticsEnable: E('input', {
			'type': 'checkbox',
			'checked': parsed.statisticsEnable ? '' : null
		}),
		blockingSection: parsed.blockingSection
	};

	function saveHandler(restart) {
		return saveBlockySettingsForm(state, configYaml, restart).then(function() {
			notify(restart
				? _('Settings saved and Blocky restarted.')
				: _('Settings saved.'));
			if (typeof refreshPage === 'function')
				return refreshPage();
		}).catch(function(err) {
			notify(err.message || String(err), 'danger');
		});
	}

	var toolbar = E('div', { 'class': 'blocky-settings-toolbar' }, [
		E('button', {
			'class': 'cbi-button cbi-button-save',
			'click': ui.createHandlerFn(this, function(ev) {
				ev.preventDefault();
				return saveHandler(false);
			})
		}, [ _('Save settings') ]),
		' ',
		E('button', {
			'class': 'cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, function(ev) {
				ev.preventDefault();
				return saveHandler(true);
			})
		}, [ _('Save & restart Blocky') ])
	]);

	var sections = [
		{
			id: 'router',
			title: _('Router DNS'),
			content: renderRouterDnsIntegration(configYaml, dnsFwdRaw, true)
		},
		{
			id: 'upstream',
			title: _('Upstream DNS'),
			content: configSectionPage(
				_('Upstream DNS'),
				_('External resolvers Blocky uses after filtering. Supports plain IP, tcp-tls:, and https: DoH URLs.'),
				[
					settingsRow(
						_('Resolver groups'),
						_('One resolver per line per group. Supports plain IP, tcp-tls:, and https: DoH URLs.'),
						upstreamEditor.host
					),
					settingsRow(_('Startup strategy'), _('fast = start quickly; blocking = wait for upstreams.'), state.upstreamInitStrategy),
					settingsRow(_('Query timeout'), '', state.upstreamTimeout)
				]
			)
		},
		{
			id: 'bootstrap',
			title: _('Bootstrap DNS'),
			content: configSectionPage(
				_('Bootstrap DNS'),
				_('Used to resolve upstream hostnames and denylist download URLs.'),
				[
					settingsRow(
						_('Bootstrap resolvers'),
						_('One entry per line (e.g. tcp+udp:1.1.1.1).'),
						state.bootstrapResolvers
					),
					settingsRow(
						_('Use WAN resolvers'),
						_('Also read /tmp/resolv.conf.auto (OpenWrt DHCP WAN DNS).'),
						state.bootstrapUseWan
					)
				]
			)
		},
		{
			id: 'downloads',
			title: _('List downloads'),
			content: configSectionPage(
				_('Block lists & downloads'),
				_('Denylist URLs are managed on the Block lists tab. These options control refresh timing.'),
				[
					E('p', { 'class': 'blocky-note-soft' }, [
						_('Edit denylist sources under '),
						E('strong', {}, [ _('Block lists') ]),
						_(' — saving here preserves your lists and re-syncs config.yml.')
					]),
					settingsRow(_('List refresh period'), _('How often Blocky re-downloads lists (e.g. 4h).'), state.listRefreshPeriod),
					settingsRow(_('List load strategy'), _('How Blocky waits for lists at startup.'), state.loadingStrategy),
					settingsRow(_('List cache directory'), _('On-disk cache for downloaded blocklists.'), state.listCachePath),
					settingsRow(_('Download timeout'), _('Per-URL download timeout.'), state.listDownloadTimeout),
					settingsRow(_('Write timeout'), _('Timeout writing list data to disk.'), state.listWriteTimeout),
					settingsRow(_('Read timeout'), _('Timeout reading list data from disk.'), state.listReadTimeout),
					settingsRow(_('Download attempts'), _('Retries when a list URL fails.'), state.listDownloadAttempts),
					settingsRow(_('Retry cooldown'), _('Pause between failed download retries.'), state.listCooldown),
					settingsRow(_('Download concurrency'), _('Parallel list downloads (1–8).'), state.listConcurrency)
				]
			)
		},
		{
			id: 'cache',
			title: _('DNS cache'),
			content: configSectionPage(
				_('DNS cache'),
				_('Response cache limits. Prefetching increases upstream traffic.'),
				[
					settingsRow(_('Minimum cache time'), '', state.cachingMinTime),
					settingsRow(_('Maximum cache time'), '', state.cachingMaxTime),
					settingsRow(_('Enable prefetching'), '', state.cachingPrefetch)
				]
			)
		},
		{
			id: 'hosts',
			title: _('Hosts sources'),
			content: configSectionPage(
				_('Hosts file sources'),
				_('Additional static hostname blocks (paths or URLs).'),
				[
					settingsRow(_('Sources'), _('/etc/hosts is included by default.'), state.hostsSources)
				]
			)
		},
		{
			id: 'logging',
			title: _('Logging'),
			content: configSectionPage(
				_('Logging'),
				_('Blocky service log level. DNS query logging is configured separately below.'),
				[
					settingsRow(_('Log level'), '', state.logLevel),
					settingsRow(_('Obfuscate log output'), _('Mask domains in Blocky logs.'), state.logPrivacy)
				]
			)
		},
		{
			id: 'querylog',
			title: _('Query log'),
			content: configSectionPage(
				_('Query log'),
				_('CSV query logs for the Logs tab.'),
				[
					settingsRow(_('Target directory'), '', state.queryLogTarget),
					settingsRow(_('Retention (days)'), '', state.queryLogRetention),
					settingsRow(_('Flush interval'), '', state.queryLogFlush)
				]
			)
		},
		{
			id: 'listeners',
			title: _('Listeners'),
			content: configSectionPage(
				_('Listeners'),
				_('Keep both listeners on 127.0.0.1 — dnsmasq forwards LAN DNS here.'),
				[
					settingsRow(_('DNS port'), _('Format: 127.0.0.1:5353'), state.portDns),
					settingsRow(_('HTTP port (API / metrics)'), _('Format: 127.0.0.1:4000'), state.portHttp)
				]
			)
		},
		{
			id: 'security',
			title: _('Security'),
			content: configSectionPage(
				_('Security & observability'),
				_('Rebinding protection, Prometheus metrics, and in-memory statistics.'),
				[
					settingsRow(_('DNS rebinding protection'), '', state.rebindingEnable),
					settingsRow(_('Prometheus metrics'), '', state.prometheusEnable),
					settingsRow(_('Metrics path'), '', state.prometheusPath),
					settingsRow(_('In-memory statistics (/api/stats)'), _('Powers the Dashboard 24h widgets.'), state.statisticsEnable)
				]
			)
		},
		{
			id: 'api',
			title: _('API access'),
			content: renderApiSecuritySection(configYaml, uciAccess, true)
		},
		{
			id: 'advanced',
			title: _('Advanced YAML'),
			content: renderConfigYamlAdvanced(configYaml, refreshPage, true)
		}
	];

	return E('div', { 'class': 'blocky-settings-page' }, [
		renderBlockyConfigLayout(sections, toolbar, 0)
	]);
}

function renderBlockySettingsPage(configYaml, dnsFwdRaw, uciAccess, refreshPage) {
	return E('div', { 'class': 'blocky-config-page' }, [
		E('p', { 'class': 'cbi-section-descr blocky-config-intro' }, [
			_('Choose a settings section on the left. Block list URLs stay under the Block lists tab.')
		]),
		renderBlockySettingsForm(configYaml, dnsFwdRaw, uciAccess, refreshPage)
	]);
}

function renderConfigYamlAdvanced(content, refreshPage, embedded) {
	var editor = E('textarea', {
		'class': 'cbi-input-textarea blocky-settings-yaml',
		'style': 'width:100%; min-height:22em; font-family:monospace'
	}, [ content || '' ]);

	function saveYaml(restart) {
		if (!editor.value.trim()) {
			notify(_('Configuration cannot be empty.'), 'danger');
			return;
		}

		return applyBlockyConfigYaml(editor.value, { restart: restart }).then(function() {
			notify(restart
				? _('Configuration saved and Blocky restarted.')
				: _('Configuration saved.'));
			if (typeof refreshPage === 'function')
				return refreshPage();
		}).catch(function(err) {
			notify(err.message || String(err), 'danger');
		});
	}

	var buttons = E('p', {}, [
		E('button', {
			'class': 'cbi-button cbi-button-save',
			'click': ui.createHandlerFn(this, function(ev) {
				ev.preventDefault();
				return saveYaml(false);
			})
		}, [ _('Save YAML') ]),
		' ',
		E('button', {
			'class': 'cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, function(ev) {
				ev.preventDefault();
				return saveYaml(true);
			})
		}, [ _('Save YAML & restart') ])
	]);
	var body = [
		E('p', { 'class': 'blocky-config-section-descr' }, [
			_('Edit %s directly. Prefer the settings sections — the blocking: section is overwritten when block lists sync.').format(CONFIG_PATH)
		]),
		editor,
		buttons
	];

	if (embedded)
		return configSectionPage(_('Advanced YAML editor'), '', body);

	return E('details', { 'class': 'blocky-settings-advanced cbi-section' }, [
		E('summary', { 'class': 'blocky-settings-advanced-summary' }, [ _('Advanced YAML editor') ])
	].concat(body));
}

return {
	renderApiSecuritySection: renderApiSecuritySection,
	renderRouterDnsIntegration: renderRouterDnsIntegration,
	settingsRow: settingsRow,
	settingsPanel: settingsPanel,
	configSectionPage: configSectionPage,
	renderBlockyConfigLayout: renderBlockyConfigLayout,
	readBlockySettingsForm: readBlockySettingsForm,
	saveBlockySettingsForm: saveBlockySettingsForm,
	renderBlockySettingsForm: renderBlockySettingsForm,
	renderBlockySettingsPage: renderBlockySettingsPage,
	renderConfigYamlAdvanced: renderConfigYamlAdvanced
};
