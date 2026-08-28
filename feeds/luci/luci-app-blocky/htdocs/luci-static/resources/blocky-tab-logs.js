'use strict';
'require ui';
'require poll';
'require blocky-base as Blocky';

var safeString = Blocky.safeString,
	parseQueryLogConfig = Blocky.parseQueryLogConfig,
	callBlockyReadQueryLog = Blocky.callBlockyReadQueryLog,
	callBlockyGetLogs = Blocky.callBlockyGetLogs,
	notify = Blocky.notify,
	replaceContent = Blocky.replaceContent,
	bp = Blocky.bp;

var QUERY_LOG_COPY_MAX_ROWS = 2000;

function copyPlainText(text, okMessage, failMessage) {
	text = safeString(text);
	if (!text)
		return Promise.resolve();

	var done = function(ok) {
		notify(ok ? okMessage : failMessage, ok ? 'info' : 'warning');
	};

	if (navigator.clipboard && navigator.clipboard.writeText) {
		return navigator.clipboard.writeText(text).then(function() {
			done(true);
		}).catch(function() {
			done(false);
		});
	}

	done(false);
	return Promise.resolve();
}

function renderLogsSubTabs(panels, activeIndex) {
	var navItems = [];
	var mainHost = E('div', { 'class': 'blocky-logs-subtab-main' });
	var nav = E('nav', { 'class': 'blocky-logs-subtabs', 'role': 'navigation' });

	function activate(index) {
		if (!panels[index])
			return;

		navItems.forEach(function(item, pos) {
			item.classList.toggle('active', pos === index);
		});
		replaceContent(mainHost, panels[index].content);

		if (typeof panels[index].onShow === 'function')
			panels[index].onShow();
	}

	panels.forEach(function(panel, index) {
		var item = E('button', {
			'type': 'button',
			'class': 'blocky-logs-subtab-item' + (index === activeIndex ? ' active' : ''),
			'click': function(ev) {
				ev.preventDefault();
				activate(index);
			}
		}, [ panel.title ]);

		navItems.push(item);
		nav.appendChild(item);
	});

	activate(activeIndex || 0);

	return E('div', { 'class': 'blocky-logs-subtabs-wrap' }, [ nav, mainHost ]);
}

function renderQueryLogPanel(config) {
	var ql = parseQueryLogConfig(config);
	var tableHost = E('div', {});
	var pageInfoHost = E('span', { 'class': 'blocky-note-soft' });
	var truncatedBanner = E('p', {
		'class': 'alert-message warning blocky-query-log-truncated',
		'style': 'display:none'
	}, [ _('Log tail was truncated at 512 KiB. Use SSH or copy all for the loaded portion only.') ]);
	var filterDomain = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'placeholder': 'example.org',
		'style': 'min-width:14em'
	});
	var filterClient = E('input', {
		'type': 'text',
		'class': 'cbi-input-text',
		'placeholder': '192.168.1.10',
		'style': 'min-width:12em'
	});
	var filterResponse = E('select', { 'class': 'cbi-input-select' }, [
		E('option', { 'value': '' }, [ _('Any response') ])
	]);
	var autoRefresh = E('input', { 'type': 'checkbox' });
	var sourceHost = E('p', { 'class': 'blocky-note-soft' });
	var pollId = null;
	var pageState = { page: 0, pageSize: 50, rows: [], logPath: '', truncated: false };

	function stopAutoRefresh() {
		if (pollId != null) {
			poll.remove(pollId);
			pollId = null;
		}
	}

	function startAutoRefresh() {
		stopAutoRefresh();
		if (!autoRefresh.checked)
			return;

		pollId = poll.add(function() {
			return loadCsvLogs();
		}, 30);
	}

	function filteredRows() {
		var domainNeedle = filterDomain.value.trim().toLowerCase();
		var clientNeedle = filterClient.value.trim().toLowerCase();
		var responseNeedle = filterResponse.value.trim().toLowerCase();

		return pageState.rows.filter(function(row) {
			if (domainNeedle && row.question.toLowerCase().indexOf(domainNeedle) === -1)
				return false;

			if (clientNeedle && row.client.toLowerCase().indexOf(clientNeedle) === -1)
				return false;

			if (responseNeedle) {
				var responseText = safeString(row.response || row.reason).toLowerCase();

				if (responseText.indexOf(responseNeedle) === -1)
					return false;
			}

			return true;
		});
	}

	function visibleRows() {
		var filtered = filteredRows();
		var start = pageState.page * pageState.pageSize;

		return filtered.slice(start, start + pageState.pageSize);
	}

	function updateResponseFilterOptions() {
		var seen = {};
		var options = [ E('option', { 'value': '' }, [ _('Any response') ]) ];
		var i;
		var row;
		var response;

		for (i = 0; i < pageState.rows.length; i++) {
			row = pageState.rows[i];
			response = safeString(row.response || row.reason).trim();

			if (!response || seen[response])
				continue;

			seen[response] = 1;
			options.push(E('option', { 'value': response }, [ response ]));
		}

		replaceContent(filterResponse, options);
	}

	function updatePageInfo() {
		var filtered = filteredRows();
		var totalPages = Math.max(1, Math.ceil(filtered.length / pageState.pageSize));
		var currentPage = Math.min(pageState.page + 1, totalPages);

		replaceContent(pageInfoHost, filtered.length
			? _('Page %d of %d (%d rows, %d per page)').format(
				currentPage,
				totalPages,
				filtered.length,
				pageState.pageSize
			)
			: _('No rows match the current filters.'));
	}

	function renderTable() {
		var filtered = filteredRows();
		var slice = visibleRows();
		var maxPage = Math.max(0, Math.ceil(filtered.length / pageState.pageSize) - 1);

		if (pageState.page > maxPage)
			pageState.page = maxPage;

		updatePageInfo();
		truncatedBanner.style.display = pageState.truncated ? '' : 'none';

		if (!pageState.rows.length) {
			replaceContent(tableHost, E('em', {}, [ _('No log lines loaded.') ]));
			return;
		}

		if (!slice.length) {
			replaceContent(tableHost, E('em', {}, [ _('No rows match the current filters.') ]));
			return;
		}

		replaceContent(tableHost, E('div', { 'class': 'table blocky-query-log-table' }, [
			E('div', { 'class': 'tr table-titles' }, [
				E('div', { 'class': 'td left' }, [ _('Time') ]),
				E('div', { 'class': 'td left' }, [ _('Client') ]),
				E('div', { 'class': 'td left' }, [ _('Query') ]),
				E('div', { 'class': 'td left' }, [ _('Type') ]),
				E('div', { 'class': 'td left' }, [ _('Response') ])
			])
		].concat(slice.map(function(row) {
			return E('div', { 'class': 'tr' }, [
				E('div', { 'class': 'td left' }, [ row.time ]),
				E('div', { 'class': 'td left' }, [ row.client ]),
				E('div', { 'class': 'td left' }, [ row.question ]),
				E('div', { 'class': 'td left' }, [ row.type ]),
				E('div', { 'class': 'td left' }, [ row.response || row.reason ])
			]);
		}))));
	}

	function loadCsvLogs() {
		if (!ql || ql.type !== 'csv' || !ql.target) {
			replaceContent(tableHost, E('div', { 'class': 'alert-message' }, [
				_('Query log viewer supports queryLog.type: csv with a directory target. Other backends (MySQL, PostgreSQL, VictoriaLogs) require blocky-ui or external tools.')
			]));
			return Promise.resolve();
		}

		if (ql.target !== '/tmp/blocky-logs') {
			replaceContent(tableHost, E('div', { 'class': 'alert-message warning' }, [
				_('LuCI can only read CSV logs from /tmp/blocky-logs for security. Update queryLog.target in config.yml or browse logs on the host directly.')
			]));
			return Promise.resolve();
		}

		return callBlockyReadQueryLog(ql.target, 524288).then(function(res) {
			if (!res || !res.ok)
				throw new Error((res && res.error) || _('Failed to read query log'));

			pageState.logPath = res.path || '';
			pageState.truncated = !!res.truncated;
			pageState.rows = bp.parseCsvRows(res.content || '');
			pageState.page = 0;
			replaceContent(sourceHost, pageState.logPath
				? [ _('Source file: %s').format(pageState.logPath) ]
				: []);
			updateResponseFilterOptions();
			renderTable();
		}).catch(function(err) {
			replaceContent(tableHost, E('p', { 'class': 'alert-message warning' }, [
				err.message || String(err)
			]));
		});
	}

	function applyQuickFilter(value) {
		filterResponse.value = value;
		pageState.page = 0;
		renderTable();
	}

	if (!ql) {
		return {
			title: _('Query log'),
			content: E('div', { 'class': 'cbi-section' }, [
				E('p', { 'class': 'cbi-section-descr' }, [
					_('No queryLog section in config.yml. Add queryLog with type csv and a target directory to browse logs here.')
				])
			])
		};
	}

	loadCsvLogs();
	autoRefresh.addEventListener('change', startAutoRefresh);

	return {
		title: _('Query log'),
		onShow: function() {
			startAutoRefresh();
		},
		content: E('div', { 'class': 'blocky-query-logs-panel' }, [
			E('p', { 'class': 'cbi-section-descr' }, [
				_('Read-only viewer for Blocky query logs (%s). Shows the newest daily .log file (tail capped at 512 KiB).').format(ql.type)
			]),
			E('div', { 'class': 'alert-message blocky-query-log-tmpfs-note' }, [
				E('strong', {}, [ _('tmpfs / RAM note:') ]),
				' ',
				_('Default path /tmp/blocky-logs lives in tmpfs on most routers. Logs are lost on reboot and compete with RAM for space. Use a short retention period or disable query logging on memory-constrained devices.')
			]),
			truncatedBanner,
			E('div', { 'class': 'blocky-query-log-toolbar' }, [
				filterDomain, ' ',
				filterClient, ' ',
				filterResponse, ' ',
				E('button', {
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						pageState.page = 0;
						renderTable();
					})
				}, [ _('Filter') ]),
				' ',
				E('button', {
					'class': 'cbi-button',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						return loadCsvLogs();
					})
				}, [ _('Reload') ]),
				' ',
				E('label', { 'class': 'blocky-query-log-autorefresh' }, [
					autoRefresh, ' ', _('Auto-refresh (30s)')
				]),
				E('span', { 'class': 'blocky-query-log-quick-filters' }, [
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-neutral',
						'click': ui.createHandlerFn(null, function(ev) {
							ev.preventDefault();
							applyQuickFilter('BLOCKED');
						})
					}, [ _('Blocked') ]),
					' ',
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-neutral',
						'click': ui.createHandlerFn(null, function(ev) {
							ev.preventDefault();
							applyQuickFilter('CACHED');
						})
					}, [ _('Cached') ]),
					' ',
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-neutral',
						'click': ui.createHandlerFn(null, function(ev) {
							ev.preventDefault();
							applyQuickFilter('');
						})
					}, [ _('All') ])
				]),
				E('span', { 'class': 'blocky-query-log-copy-actions' }, [
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-neutral',
						'click': ui.createHandlerFn(null, function(ev) {
							ev.preventDefault();
							return copyPlainText(
								bp.formatQueryLogRowsText(visibleRows()),
								_('Visible page copied to clipboard.'),
								_('Copy failed.')
							);
						})
					}, [ _('Copy page') ]),
					' ',
					E('button', {
						'type': 'button',
						'class': 'cbi-button cbi-button-neutral',
						'click': ui.createHandlerFn(null, function(ev) {
							ev.preventDefault();
							var rows = filteredRows();
							var truncated = rows.length > QUERY_LOG_COPY_MAX_ROWS;

							if (truncated)
								rows = rows.slice(0, QUERY_LOG_COPY_MAX_ROWS);

							return copyPlainText(
								bp.formatQueryLogRowsText(rows),
								truncated
									? _('Copied first %d filtered rows.').format(QUERY_LOG_COPY_MAX_ROWS)
									: _('Filtered rows copied to clipboard.'),
								_('Copy failed.')
							);
						})
					}, [ _('Copy filtered') ])
				])
			]),
			tableHost,
			E('div', { 'class': 'blocky-query-log-pagination' }, [
				E('button', {
					'class': 'cbi-button',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						if (pageState.page > 0) {
							pageState.page--;
							renderTable();
						}
					})
				}, [ _('Previous') ]),
				' ',
				pageInfoHost,
				' ',
				E('button', {
					'class': 'cbi-button',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						var maxPage = Math.max(0, Math.ceil(filteredRows().length / pageState.pageSize) - 1);

						if (pageState.page < maxPage) {
							pageState.page++;
							renderTable();
						}
					})
				}, [ _('Next') ])
			]),
			sourceHost
		]),
		destroy: stopAutoRefresh
	};
}

function renderServiceLogPanel(pageStatus) {
	var logHost = E('textarea', {
		'class': 'blocky-debug-log',
		'readonly': 'readonly',
		'rows': 16,
		'placeholder': _('Loading service logs…')
	});
	var limitSelect = E('select', { 'class': 'cbi-input-select blocky-debug-limit' }, [
		E('option', { 'value': '100' }, [ '100' ]),
		E('option', { 'value': '200', 'selected': '' }, [ '200' ]),
		E('option', { 'value': '500' }, [ '500' ]),
		E('option', { 'value': '1000' }, [ '1000' ])
	]);
	var truncatedNote = E('p', {
		'class': 'blocky-note-soft blocky-debug-truncated',
		'style': 'display:none'
	}, [ _('Output truncated to the most recent 200 KiB.') ]);

	function logLimit() {
		var n = parseInt(limitSelect.value, 10);
		return (n > 0 && n <= 2000) ? n : 200;
	}

	function refreshLogs() {
		logHost.value = _('Loading logs…');
		truncatedNote.style.display = 'none';

		return callBlockyGetLogs(logLimit(), 204800).then(function(res) {
			if (!res || !res.ok) {
				logHost.value = (res && (res.message || res.error)) || _('Could not load logs.');
				return;
			}
			logHost.value = res.output || _('No matching log entries (try: logread -e blocky).');
			truncatedNote.style.display = res.truncated ? '' : 'none';
		}).catch(function(err) {
			logHost.value = _('Could not load logs: %s').format(err.message || err);
		});
	}

	return {
		title: _('Service log'),
		onShow: function() {
			if (!logHost.value || logHost.value === _('Loading logs…'))
				refreshLogs();
		},
		content: E('div', { 'class': 'blocky-service-logs-panel' }, [
			E('p', { 'class': 'cbi-section-descr' }, [
				_('Service syslog lines tagged blocky (procd, list downloads, startup). Set log level under Configuration → Logging.')
			]),
			E('div', { 'class': 'blocky-debug-toolbar' }, [
				E('label', { 'class': 'blocky-debug-limit-label' }, [ _('Lines') + ' ' ]),
				limitSelect,
				' ',
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-action',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						return refreshLogs();
					})
				}, [ _('Refresh') ]),
				' ',
				E('button', {
					'type': 'button',
					'class': 'cbi-button cbi-button-neutral',
					'click': ui.createHandlerFn(null, function(ev) {
						ev.preventDefault();
						return copyPlainText(
							logHost.value,
							_('Log copied to clipboard.'),
							_('Copy failed — select the text area and copy manually.')
						);
					})
				}, [ _('Copy to clipboard') ])
			]),
			truncatedNote,
			logHost
		])
	};
}

function renderLogsTab(config, pageStatus) {
	var queryPanel = renderQueryLogPanel(config);
	var servicePanel = renderServiceLogPanel(pageStatus);

	return E('div', { 'class': 'cbi-section blocky-logs-section' }, [
		E('h3', {}, [ _('Logs') ]),
		renderLogsSubTabs([ queryPanel, servicePanel ], 0)
	]);
}

return {
	renderQueryLogsTab: renderLogsTab,
	renderLogsTab: renderLogsTab
};
