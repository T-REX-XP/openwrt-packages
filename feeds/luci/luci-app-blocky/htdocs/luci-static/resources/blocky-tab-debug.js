'use strict';
'require ui';
'require blocky-base as Blocky';

var notify = Blocky.notify,
	callBlockyGetLogs = Blocky.callBlockyGetLogs,
	blockyPill = Blocky.blockyPill,
	replaceContent = Blocky.replaceContent,
	formatDuration = Blocky.formatDuration,
	shapeBlockyStatusBar = Blocky.shapeBlockyStatusBar;

function copyTextareaValue(ta, okMessage, failMessage) {
	if (!ta || !ta.value)
		return Promise.resolve();

	var text = ta.value;
	var done = function(ok) {
		notify(ok ? okMessage : failMessage, ok ? 'info' : 'warning');
	};

	if (navigator.clipboard && navigator.clipboard.writeText) {
		return navigator.clipboard.writeText(text).then(function() {
			done(true);
		}).catch(function() {
			ta.focus();
			ta.select();
			try {
				done(document.execCommand('copy'));
			}
			catch (err) {
				done(false);
			}
		});
	}

	ta.focus();
	ta.select();
	try {
		done(document.execCommand('copy'));
	}
	catch (err) {
		done(false);
	}
	return Promise.resolve();
}

function renderDebugTab(pageStatus) {
	var bar = shapeBlockyStatusBar(pageStatus || {});
	var logHost = E('textarea', {
		'class': 'blocky-debug-log',
		'readonly': 'readonly',
		'rows': 18,
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

	setTimeout(refreshLogs, 50);

	return E('div', { 'class': 'cbi-section blocky-debug-section' }, [
		E('h3', {}, [ _('Debug') ]),
		E('p', { 'class': 'cbi-section-descr' }, [
			_('Service syslog lines tagged blocky (procd, list downloads, startup). Set log level under Configuration → Logging.')
		]),
		E('div', { 'class': 'blocky-debug-meta' }, [
			E('div', { 'class': 'blocky-debug-meta-row' }, [
				E('span', { 'class': 'blocky-debug-meta-label' }, [ _('Log level (config.yml)') ]),
				E('code', {}, [ bar.logLevel || 'warn' ])
			]),
			E('div', { 'class': 'blocky-debug-meta-row' }, [
				E('span', { 'class': 'blocky-debug-meta-label' }, [ _('HTTP API') ]),
				blockyPill(bar.apiOk ? 'yes' : 'no', bar.apiOk ? _('Reachable') : _('Unreachable'))
			]),
			E('div', { 'class': 'blocky-debug-meta-row' }, [
				E('span', { 'class': 'blocky-debug-meta-label' }, [ _('Statistics API') ]),
				blockyPill(bar.statsOk ? 'yes' : (bar.statsDisabled ? 'warn' : 'no'),
					bar.statsOk ? _('OK') : (bar.statsDisabled ? _('Disabled') : _('Unavailable')))
			])
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
					return copyTextareaValue(
						logHost,
						_('Log copied to clipboard.'),
						_('Copy failed — select the text area and copy manually.')
					);
				})
			}, [ _('Copy to clipboard') ])
		]),
		truncatedNote,
		logHost
	]);
}

return {
	renderDebugTab: renderDebugTab
};
