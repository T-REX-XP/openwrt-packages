'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callGetConfig = rpc.declare({
	object: 'luci.oled',
	method: 'getConfig',
	expect: { '': {} }
});

var callSetConfig = rpc.declare({
	object: 'luci.oled',
	method: 'setConfig',
	params: [ 'config', 'restart' ],
	expect: { '': {} }
});

var callGetStatus = rpc.declare({
	object: 'luci.oled',
	method: 'getStatus',
	expect: { '': {} }
});

var callDetectI2c = rpc.declare({
	object: 'luci.oled',
	method: 'detectI2c',
	params: [ 'bus' ],
	expect: { '': {} }
});

var callReleaseRst = rpc.declare({
	object: 'luci.oled',
	method: 'releaseRst',
	expect: { '': {} }
});

var callServiceControl = rpc.declare({
	object: 'luci.oled',
	method: 'serviceControl',
	params: [ 'action' ],
	expect: { '': {} }
});

var callGetLogs = rpc.declare({
	object: 'luci.oled',
	method: 'getLogs',
	params: [ 'limit' ],
	expect: { '': {} }
});

var callGetPagePreview = rpc.declare({
	object: 'luci.oled',
	method: 'getPagePreview',
	expect: { '': {} }
});

var callPageControl = rpc.declare({
	object: 'luci.oled',
	method: 'pageControl',
	params: [ 'action', 'page_id' ],
	expect: { '': {} }
});

var isReadonlyView = !L.hasViewPermission() || null;

var PREVIEW_SCALE = 3;

var FORM_DEFAULTS = {
	enable: '1',
	path: '/dev/i2c-7',
	rotate: '0',
	menu_mode: '1',
	menu_timeout: '5',
	menu_idle_dim: '0',
	menu_wifi: '1',
	menu_interactive: '0',
	menu_nav_button: 'BTN_2',
	menu_select_button: 'wps',
	menu_alerts: '1',
	autoswitch: '0',
	from: '0',
	to: '1440',
	date: '0',
	lanip: '0',
	ipifname: 'br-lan',
	cputemp: '0',
	cpufreq: '0',
	netspeed: '0',
	netsource: 'br-lan',
	time: '60',
	scroll: '0',
	text: 'CM5'
};

function rpcData(data, fallback) {
	if (Array.isArray(data)) {
		if (data.length > 1 && data[0] === 0 && data[1] != null)
			return data[1];
		if (data.length && data[0] != null && typeof data[0] === 'object')
			return data[0];
		return fallback || {};
	}
	if (data && data.result != null)
		return rpcData(data.result, fallback);
	return data || fallback || {};
}

function oledInjectStyles() {
	return E('link', {
		'rel': 'stylesheet',
		'type': 'text/css',
		'href': L.resource('oled-theme.css')
	});
}

function cbiSection(title, descrNodes, bodyNodes, extraClass) {
	var parts = [];
	if (title)
		parts.push(E('h3', {}, [ title ]));
	if (descrNodes && descrNodes.length)
		parts.push(E('p', { 'class': 'cbi-section-descr' }, descrNodes));
	for (var i = 0; i < (bodyNodes || []).length; i++)
		parts.push(bodyNodes[i]);
	var cls = 'cbi-section';
	if (extraClass)
		cls += ' ' + extraClass;
	return E('div', { 'class': cls }, parts);
}

function fieldRow(title, field, descr) {
	var fieldWrap = [ field ];
	if (descr)
		fieldWrap.push(E('div', { 'class': 'cbi-value-description' }, [ descr ]));
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, [ title ]),
		E('div', { 'class': 'cbi-value-field' }, fieldWrap)
	]);
}

function timeSelect(id, selected) {
	var opts = [];
	for (var h = 0; h < 24; h++) {
		for (var m = 0; m < 60; m += 30) {
			var mins = String(h * 60 + m);
			var label = ('0' + h).slice(-2) + ':' + ('0' + m).slice(-2);
			opts.push(E('option', {
				'value': mins,
				'selected': mins === String(selected) ? 'selected' : null
			}, [ label ]));
		}
	}
	opts.push(E('option', {
		'value': '1440',
		'selected': String(selected) === '1440' ? 'selected' : null
	}, [ '24:00' ]));
	return E('select', { 'id': id, 'disabled': isReadonlyView }, opts);
}

function flagInput(id, label, checked) {
	return E('label', { 'class': 'oled-flag' }, [
		E('input', {
			'type': 'checkbox',
			'id': id,
			'checked': checked ? 'checked' : null,
			'disabled': isReadonlyView
		}),
		' ',
		label
	]);
}

function val(id, fallback) {
	var el = document.getElementById(id);
	return el ? String(el.value || '') : String(fallback || '');
}

function flag(id) {
	var el = document.getElementById(id);
	return el && el.checked ? '1' : '0';
}

function i2cBusNumber(path) {
	var m = String(path || '').match(/^\/dev\/i2c-([0-9]+)$/);
	return m ? m[1] : '0';
}

function optionSelected(value, current) {
	return String(value) === String(current) ? 'selected' : null;
}

/* LuCI E() skips attrs only when null; disabled:false still disables the widget. */
function disableIf(cond) {
	return cond ? true : null;
}

function buildI2cPathList(cfg) {
	cfg = cfg || {};
	var i2cList = (cfg.i2c_devices || []).slice();
	var configuredPath = cfg.path || FORM_DEFAULTS.path || '/dev/i2c-7';
	if (configuredPath && i2cList.indexOf(configuredPath) < 0)
		i2cList.unshift(configuredPath);
	if (!i2cList.length)
		i2cList.push(configuredPath || '/dev/i2c-7');
	return {
		list: i2cList,
		selected: configuredPath
	};
}

function readFormConfig() {
	return {
		enable: flag('oled-enable'),
		path: val('oled-path', FORM_DEFAULTS.path),
		rotate: flag('oled-rotate'),
		menu_mode: flag('oled-menu-mode'),
		menu_timeout: val('oled-menu-timeout', FORM_DEFAULTS.menu_timeout),
		menu_idle_dim: val('oled-menu-idle-dim', FORM_DEFAULTS.menu_idle_dim),
		menu_wifi: flag('oled-menu-wifi'),
		menu_interactive: flag('oled-menu-interactive'),
		menu_nav_button: val('oled-nav-button', FORM_DEFAULTS.menu_nav_button),
		menu_select_button: val('oled-select-button', FORM_DEFAULTS.menu_select_button),
		menu_alerts: flag('oled-menu-alerts'),
		autoswitch: flag('oled-autoswitch'),
		from: val('oled-from', FORM_DEFAULTS.from),
		to: val('oled-to', FORM_DEFAULTS.to),
		date: flag('oled-date'),
		lanip: flag('oled-lanip'),
		ipifname: val('oled-ipifname', FORM_DEFAULTS.ipifname),
		cputemp: flag('oled-cputemp'),
		cpufreq: flag('oled-cpufreq'),
		netspeed: flag('oled-netspeed'),
		netsource: val('oled-netsource', FORM_DEFAULTS.netsource),
		time: val('oled-time', FORM_DEFAULTS.time),
		scroll: flag('oled-scroll'),
		text: val('oled-text', FORM_DEFAULTS.text),
		drawline: flag('oled-drawline'),
		drawrect: flag('oled-drawrect'),
		fillrect: flag('oled-fillrect'),
		drawcircle: flag('oled-drawcircle'),
		drawroundrect: flag('oled-drawroundrect'),
		fillroundrect: flag('oled-fillroundrect'),
		drawtriangle: flag('oled-drawtriangle'),
		filltriangle: flag('oled-filltriangle'),
		displaybitmap: flag('oled-displaybitmap'),
		displayinvertnormal: flag('oled-displayinvertnormal'),
		drawbitmapeg: flag('oled-drawbitmapeg')
	};
}

function statusPill(running, label) {
	return E('span', {
		'class': 'oled-pill ' + (running ? 'oled-pill--ok' : 'oled-pill--err')
	}, [ label || (running ? _('Running') : _('Stopped')) ]);
}

function statusCard(label, value) {
	return E('div', { 'class': 'oled-status-card' }, [
		E('div', { 'class': 'oled-status-label' }, [ label ]),
		E('div', { 'class': 'oled-status-value' }, [ value ])
	]);
}

function renderStatusBlock(st) {
	st = st || {};
	var daemonLabel = st.daemon === 'oledd' ? _('oledd (menu)') : _('oled (legacy)');
	var pageLabel = st.page_title ?
		(st.page_title + (st.page_id ? ' (' + st.page_id + ')' : '')) :
		(st.view || '—');
	return E('div', { 'class': 'oled-status-panel', 'id': 'oled-status-panel' }, [
		E('div', { 'class': 'oled-status-grid' }, [
			statusCard(_('Daemon'), E('span', {}, [ daemonLabel, ' ', statusPill(st.running) ])),
			statusCard(_('Current view'), pageLabel),
			statusCard(_('Page'), st.page_count && st.page_idx != null ?
				String((st.page_idx + 1) + ' / ' + st.page_count) :
				(st.view === 'boot' ? _('boot') : (st.view || '—'))),
			statusCard(_('Display'), st.dimmed ? _('Dimmed') : _('Active')),
			statusCard(_('I2C bus'), st.path || '—'),
			statusCard(_('Boot stage'), st.boot_stage || _('unknown')),
			statusCard(_('Boot message'), st.boot_message || '—'),
			statusCard(_('ubus'), st.ubus_available ? _('available') : _('unavailable')),
			statusCard(_('Interactive'), st.menu_interactive ? _('yes') : _('no')),
			statusCard(_('Preinit hook'), st.preinit_hook || _('not installed'))
		])
	]);
}

function previewFontClass(font) {
	switch (font) {
	case 'sm':
	case 'md':
		return 'oled-preview-font-sm';
	case 'lg':
	case 'xl':
	case 'huge':
		return 'oled-preview-font-lg';
	default:
		return 'oled-preview-font-xs';
	}
}

function previewPosStyle(el, scale) {
	var s = scale || PREVIEW_SCALE;
	var style = 'left:' + (el.x * s) + 'px;top:' + (el.y * s) + 'px;';
	if (el.w != null)
		style += 'width:' + (el.w * s) + 'px;';
	if (el.h != null)
		style += 'height:' + (el.h * s) + 'px;';
	return style;
}

function renderPreviewElement(el, scale) {
	var s = scale || PREVIEW_SCALE;
	var cls = 'oled-preview-el';

	switch (el.type) {
	case 'rect':
		return E('div', {
			'class': cls + ' oled-preview-rect' + (el.fill ? ' oled-preview-rect--fill' : ''),
			'style': previewPosStyle(el, s)
		});
	case 'line':
		return E('div', {
			'class': cls + ' oled-preview-line',
			'style': 'left:' + (el.x1 * s) + 'px;top:' + (el.y1 * s) +
				'px;width:' + (Math.max(1, (el.x2 - el.x1) * s)) + 'px;'
		});
	case 'text':
		return E('div', {
			'class': cls + ' oled-preview-text ' + previewFontClass(el.font) +
				(el.invert ? ' oled-preview-text--invert' : '') +
				(el.align === 'right' ? ' oled-preview-text--right' : ''),
			'style': previewPosStyle(el, s)
		}, [ el.text || '' ]);
	case 'bar':
		var pct = Math.max(0, Math.min(1, el.value_num || 0));
		return E('div', {
			'class': cls + ' oled-preview-bar',
			'style': previewPosStyle(el, s)
		}, [
			E('div', {
				'class': 'oled-preview-bar-fill',
				'style': 'width:' + Math.round(pct * 100) + '%;'
			})
		]);
	case 'icon':
		return E('div', {
			'class': cls + ' oled-preview-icon',
			'style': previewPosStyle({ x: el.x, y: el.y, w: el.size || 8, h: el.size || 8 }, s),
			'title': el.name || ''
		}, [ el.name ? el.name.substr(0, 3).toUpperCase() : '?' ]);
	case 'sparkline':
		return E('div', {
			'class': cls + ' oled-preview-spark',
			'style': previewPosStyle(el, s),
			'title': _('Ping sparkline')
		}, [ '~~~' ]);
	case 'qrcode':
		return E('div', {
			'class': cls + ' oled-preview-qr',
			'style': previewPosStyle(el, s),
			'title': el.source || 'qr'
		}, [ 'QR' ]);
	default:
		return null;
	}
}

function renderPreviewCanvas(preview) {
	preview = preview || {};
	var scale = PREVIEW_SCALE;
	var w = preview.width || 128;
	var h = preview.height || 64;
	var elements = preview.elements || [];
	var nodes = [];

	for (var i = 0; i < elements.length; i++) {
		var node = renderPreviewElement(elements[i], scale);
		if (node)
			nodes.push(node);
	}

	var cls = 'oled-preview-screen';
	if (preview.dimmed)
		cls += ' oled-preview-screen--dimmed';
	if (!preview.running)
		cls += ' oled-preview-screen--offline';

	return E('div', { 'class': 'oled-preview-wrap' }, [
		E('div', {
			'class': cls,
			'id': 'oled-preview-screen',
			'style': 'width:' + (w * scale) + 'px;height:' + (h * scale) + 'px;'
		}, nodes),
		E('div', { 'class': 'oled-preview-meta', 'id': 'oled-preview-meta' }, [
			E('span', { 'class': 'oled-preview-page-title' }, [
				preview.page_title || preview.page_id || preview.view || _('No page')
			]),
			preview.page_count && preview.page_idx != null ?
				E('span', { 'class': 'oled-preview-page-idx' }, [
					' ',
					_('Page %d of %d').format((preview.page_idx || 0) + 1, preview.page_count)
				]) : ''
		])
	]);
}

function previewDaemonRunning(preview, st) {
	if (preview && preview.running != null)
		return !!preview.running;
	if (st && st.running != null)
		return !!st.running;
	return false;
}

function renderPreviewControls(preview, st) {
	preview = preview || {};
	st = st || {};
	var pages = preview.pages || [];
	var running = previewDaemonRunning(preview, st);
	var blocked = isReadonlyView || !running;
	var opts = [];

	for (var i = 0; i < pages.length; i++) {
		opts.push(E('option', {
			'value': pages[i].id,
			'selected': optionSelected(pages[i].id, preview.page_id)
		}, [ pages[i].title || pages[i].id ]));
	}

	return E('div', { 'class': 'oled-preview-controls' }, [
		E('button', {
			'class': 'btn cbi-button-action',
			'id': 'oled-page-prev',
			'click': ui.createHandlerFn(this, 'handlePageControl', 'prev'),
			'disabled': disableIf(blocked)
		}, [ _('Previous page') ]),
		' ',
		E('button', {
			'class': 'btn cbi-button-action',
			'id': 'oled-page-next',
			'click': ui.createHandlerFn(this, 'handlePageControl', 'next'),
			'disabled': disableIf(blocked)
		}, [ _('Next page') ]),
		' ',
		E('select', {
			'id': 'oled-page-jump',
			'disabled': disableIf(blocked || !pages.length)
		}, opts.length ? opts : [
			E('option', { 'value': '' }, [ _('No pages') ])
		]),
		' ',
		E('button', {
			'class': 'btn cbi-button-action',
			'id': 'oled-page-goto',
			'click': ui.createHandlerFn(this, 'handlePageGoto'),
			'disabled': disableIf(blocked || !pages.length)
		}, [ _('Jump to page') ])
	]);
}

function renderPreviewPanel(preview, st) {
	return E('div', { 'class': 'oled-preview-panel', 'id': 'oled-preview-panel' }, [
		renderPreviewCanvas(preview),
		renderPreviewControls.call(this, preview, st)
	]);
}

function renderLegacyFields(pick) {
	return [
		fieldRow(_('Time window'), flagInput('oled-autoswitch', _('Limit to hours'), pick('autoswitch') === '1')),
		fieldRow(_('Active hours'), E('div', { 'class': 'oled-time-range' }, [
			E('label', {}, [ _('From'), ' ', timeSelect('oled-from', pick('from')) ]),
			E('label', {}, [ _('To'), ' ', timeSelect('oled-to', pick('to')) ])
		])),
		fieldRow(_('Status fields'), E('div', { 'class': 'oled-flag-grid' }, [
			flagInput('oled-date', _('Date/time'), pick('date') === '1'),
			flagInput('oled-lanip', _('LAN IP'), pick('lanip') === '1'),
			flagInput('oled-cputemp', _('CPU temperature'), pick('cputemp') === '1'),
			flagInput('oled-cpufreq', _('CPU frequency'), pick('cpufreq') === '1'),
			flagInput('oled-netspeed', _('Network speed'), pick('netspeed') === '1')
		])),
		fieldRow(_('IP interface'), E('input', {
			'type': 'text', 'id': 'oled-ipifname', 'class': 'cbi-input-text',
			'value': pick('ipifname'), 'disabled': isReadonlyView
		})),
		fieldRow(_('Speed interface'), E('input', {
			'type': 'text', 'id': 'oled-netsource', 'class': 'cbi-input-text',
			'value': pick('netsource'), 'disabled': isReadonlyView
		})),
		fieldRow(_('Refresh interval'), E('input', {
			'type': 'number', 'id': 'oled-time', 'class': 'cbi-input-text',
			'min': 5, 'max': 600, 'value': pick('time'), 'disabled': isReadonlyView
		}), _('Seconds between screen updates.')),
		fieldRow(_('Scroll text'), flagInput('oled-scroll', _('Enable scroll'), pick('scroll') === '1')),
		fieldRow(_('Message'), E('input', {
			'type': 'text', 'id': 'oled-text', 'class': 'cbi-input-text',
			'value': pick('text'), 'disabled': isReadonlyView
		})),
		fieldRow(_('Demo animations'), E('div', { 'class': 'oled-flag-grid' }, [
			flagInput('oled-drawline', _('Lines'), pick('drawline') === '1'),
			flagInput('oled-drawrect', _('Rectangles'), pick('drawrect') === '1'),
			flagInput('oled-fillrect', _('Filled rects'), pick('fillrect') === '1'),
			flagInput('oled-drawcircle', _('Circles'), pick('drawcircle') === '1'),
			flagInput('oled-drawroundrect', _('Round rects'), pick('drawroundrect') === '1'),
			flagInput('oled-fillroundrect', _('Filled round rects'), pick('fillroundrect') === '1'),
			flagInput('oled-drawtriangle', _('Triangles'), pick('drawtriangle') === '1'),
			flagInput('oled-filltriangle', _('Filled triangles'), pick('filltriangle') === '1'),
			flagInput('oled-displaybitmap', _('Bitmap'), pick('displaybitmap') === '1'),
			flagInput('oled-displayinvertnormal', _('Invert'), pick('displayinvertnormal') === '1'),
			flagInput('oled-drawbitmapeg', _('Animated bitmap'), pick('drawbitmapeg') === '1')
		]))
	];
}

return view.extend({
	load: function() {
		return Promise.all([
			callGetConfig(),
			callGetStatus(),
			callGetPagePreview()
		]).then(function(parts) {
			return {
				config: rpcData(parts[0], {}).config || {},
				status: rpcData(parts[1], {}),
				preview: rpcData(parts[2], {})
			};
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, [
				_('Failed to load OLED settings: %s').format(e)
			]), 'error');
			throw e;
		});
	},

	handleOledSave: function(restart) {
		if (isReadonlyView)
			return Promise.resolve();
		return callSetConfig(readFormConfig(), !!restart).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error) {
				ui.addNotification(null, E('p', {}, [ r.message || r.error ]), 'error');
				return;
			}
			ui.addNotification(null, E('p', {}, [
				restart ? _('Settings saved and service restarted.') : _('Settings saved.')
			]), 'info');
			return this.refreshStatus();
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, [
				_('Could not save settings: %s').format(e)
			]), 'error');
		});
	},

	handleService: function(action) {
		return callServiceControl(action).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false)
				ui.addNotification(null, E('p', {}, [
					r.message || r.error || r.output || _('Service action failed.')
				]), 'error');
			else
				ui.addNotification(null, E('p', {}, [
					_('Service %s: %s').format(action, r.running ? _('running') : _('stopped'))
				]), 'info');
			return this.refreshStatus();
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Service control failed: %s').format(e) ]), 'error');
		});
	},

	handleDetect: function() {
		var bus = i2cBusNumber(val('oled-path'));
		var out = document.getElementById('oled-detect-out');
		if (out)
			out.textContent = _('Scanning bus %s…').format(bus);
		return callDetectI2c(bus).then(function(r) {
			r = rpcData(r, {});
			if (!out)
				return;
			out.textContent = r.error ? (r.message || r.error) : (r.output || _('No output'));
		}).catch(function(e) {
			if (out)
				out.textContent = String(e);
			ui.addNotification(null, E('p', {}, [ _('I2C scan failed: %s').format(e) ]), 'error');
		});
	},

	handleRst: function() {
		return callReleaseRst().then(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false)
				ui.addNotification(null, E('p', {}, [
					r.message || r.error || r.output || _('Display reset failed.')
				]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('Display reset signal sent.') ]), 'info');
		}).catch(function(e) {
			ui.addNotification(null, E('p', {}, [ _('Reset failed: %s').format(e) ]), 'error');
		});
	},

	refreshStatus: function(notify) {
		return callGetStatus().then(L.bind(function(st) {
			st = rpcData(st, {});
			var panel = document.getElementById('oled-status-panel');
			if (panel && panel.parentNode) {
				var next = renderStatusBlock(st);
				panel.parentNode.replaceChild(next, panel);
			}
		}, this)).catch(function(e) {
			if (notify)
				ui.addNotification(null, E('p', {}, [
					_('Could not refresh status: %s').format(e)
				]), 'error');
		});
	},

	refreshPreview: function(notify) {
		return callGetPagePreview().then(L.bind(function(preview) {
			preview = rpcData(preview, {});
			var panel = document.getElementById('oled-preview-panel');
			if (panel && panel.parentNode) {
				var next = renderPreviewPanel.call(this, preview);
				panel.parentNode.replaceChild(next, panel);
			}
			var jump = document.getElementById('oled-page-jump');
			if (jump && preview.page_id)
				jump.value = preview.page_id;
		}, this)).catch(function(e) {
			if (notify)
				ui.addNotification(null, E('p', {}, [
					_('Could not refresh preview: %s').format(e)
				]), 'error');
		});
	},

	handlePageControl: function(action) {
		if (isReadonlyView)
			return Promise.resolve();
		return callPageControl(action, '').then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false) {
				ui.addNotification(null, E('p', {}, [
					r.message || r.error || _('Page control failed.')
				]), 'error');
				return;
			}
			return Promise.all([
				this.refreshPreview(false),
				this.refreshStatus(false)
			]);
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, [
				_('Page control failed: %s').format(e)
			]), 'error');
		});
	},

	handlePageGoto: function() {
		if (isReadonlyView)
			return Promise.resolve();
		var sel = document.getElementById('oled-page-jump');
		var pageId = sel ? String(sel.value || '') : '';
		if (!pageId)
			return Promise.resolve();
		return callPageControl('goto', pageId).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (r.error || r.ok === false) {
				ui.addNotification(null, E('p', {}, [
					r.message || r.error || _('Could not jump to page.')
				]), 'error');
				return;
			}
			return Promise.all([
				this.refreshPreview(false),
				this.refreshStatus(false)
			]);
		}, this)).catch(function(e) {
			ui.addNotification(null, E('p', {}, [
				_('Could not jump to page: %s').format(e)
			]), 'error');
		});
	},

	buildServiceButtons: function() {
		return E('div', { 'class': 'cbi-page-actions oled-inline-actions' }, [
			E('button', {
				'class': 'btn cbi-button-action',
				'click': ui.createHandlerFn(this, 'handleService', 'restart'),
				'disabled': isReadonlyView
			}, [ _('Restart') ]),
			' ',
			E('button', {
				'class': 'btn cbi-button-action',
				'click': ui.createHandlerFn(this, 'handleService', 'start'),
				'disabled': isReadonlyView
			}, [ _('Start') ]),
			' ',
			E('button', {
				'class': 'btn cbi-button-reset',
				'click': ui.createHandlerFn(this, 'handleService', 'stop'),
				'disabled': isReadonlyView
			}, [ _('Stop') ]),
			' ',
			E('button', {
				'class': 'btn cbi-button-action',
				'click': ui.createHandlerFn(this, 'refreshStatus', true)
			}, [ _('Refresh status') ])
		]);
	},

	buildDashboardTab: function(st, preview) {
		st = st || {};
		preview = preview || {};
		return E('div', { 'data-tab': 'dashboard', 'data-tab-title': _('Dashboard') }, [
			cbiSection(_('Live preview'), [
				_('Mirrors the physical 128×64 OLED page using the same pages.json layout and live metrics. Refreshes every few seconds.')
			], [
				renderPreviewPanel.call(this, preview, st)
			], 'oled-section-preview'),
			cbiSection(_('Status'), [
				_('Live daemon and boot state. Refreshes automatically every few seconds.')
			], [
				renderStatusBlock(st)
			], 'oled-section-status'),
			cbiSection(_('Service control'), [
				_('Start, stop, or restart the display daemon without saving other settings.')
			], [ this.buildServiceButtons() ])
		]);
	},

	buildDisplayTab: function(pick, pathOptions, st, periphLink) {
		st = st || {};
		return E('div', { 'data-tab': 'display', 'data-tab-title': _('Display') }, [
			cbiSection(_('Display & I2C'), [
				_('Enable the display, select the I2C adapter, and adjust hardware options.'),
				' ', periphLink
			], [
				fieldRow(_('Enable'), flagInput('oled-enable', _('Run on boot'), pick('enable') === '1')),
				fieldRow(_('I2C bus'), E('div', {}, [
					E('select', { 'id': 'oled-path', 'disabled': isReadonlyView || null }, pathOptions.length ? pathOptions : [
						E('option', { 'value': FORM_DEFAULTS.path }, [ FORM_DEFAULTS.path ])
					]),
					' ',
					E('button', {
						'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, 'handleDetect')
					}, [ _('Scan bus') ]),
					E('pre', { 'id': 'oled-detect-out', 'class': 'oled-detect-pre' }, [ _('Scan output appears here.') ])
				]), _('Quick scan of the selected bus. For full diagnostics use Peripherals.')),
				fieldRow(_('Rotation'), flagInput('oled-rotate', _('180° rotation'), pick('rotate') === '1')),
				fieldRow(_('Reset display'), E('div', {}, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, 'handleRst'),
						'disabled': isReadonlyView || !st.rst_led
					}, [ _('Send RST pulse') ]),
					E('p', { 'class': 'cbi-value-description' }, [
						_('Release the display reset GPIO when available on this board. Use after wiring changes or if the display stays blank.')
					])
				]))
			])
		]);
	},

	buildMenuTab: function(pick) {
		return E('div', { 'data-tab': 'menu', 'data-tab-title': _('Menu') }, [
			cbiSection(_('Menu behavior'), [
				_('Menu mode uses oledd for boot splash, rotating views, and button navigation.')
			], [
				fieldRow(_('Menu mode'), flagInput('oled-menu-mode', _('Use oledd menu daemon'), pick('menu_mode') === '1')),
				fieldRow(_('View timeout'), E('input', {
					'type': 'number',
					'id': 'oled-menu-timeout',
					'class': 'cbi-input-text',
					'min': 0,
					'max': 120,
					'value': pick('menu_timeout'),
					'disabled': isReadonlyView
				}), _('Seconds per view when auto-rotating (0 = stay on current view).')),
				fieldRow(_('WiFi view'), flagInput('oled-menu-wifi', _('Show WiFi status'), pick('menu_wifi') === '1')),
				fieldRow(_('Status alerts'), flagInput('oled-menu-alerts', _('WAN-down and load banners'), pick('menu_alerts') === '1'))
			])
		]);
	},

	buildButtonsTab: function(pick) {
		return E('div', { 'data-tab': 'buttons', 'data-tab-title': _('Buttons') }, [
			cbiSection(_('Button mapping'), [
				_('On Orange Pi CM5 Base use the onboard USERKEY (WPS) and MaskROM buttons — not the Waveshare HAT KEY/joystick (those GPIOs are not wired on the 5-line FPC harness). Handlers live in %s (cm5-button-scripts).').format('/etc/rc.button/')
			], [
				fieldRow(_('Interactive menu'), flagInput('oled-menu-interactive', _('Button-driven menu'), pick('menu_interactive') === '1')),
				fieldRow(_('Idle blank'), E('input', {
					'type': 'number',
					'id': 'oled-menu-idle-dim',
					'class': 'cbi-input-text',
					'min': 0,
					'max': 3600,
					'value': pick('menu_idle_dim'),
					'disabled': isReadonlyView
				}), _('Blank the display after this many idle seconds in interactive menu mode (0 = off). Auto-rotate mode never blanks.')),
				E('fieldset', { 'class': 'oled-fieldset' }, [
					E('legend', {}, [ _('Physical buttons') ]),
					fieldRow(_('Navigate screens'), E('select', { 'id': 'oled-nav-button', 'disabled': isReadonlyView || null }, [
						E('option', { 'value': 'BTN_2', 'selected': optionSelected('BTN_2', pick('menu_nav_button')) }, [ _('GPIO button 2 (BTN_2)') ]),
						E('option', { 'value': 'wps', 'selected': optionSelected('wps', pick('menu_nav_button')) }, [ _('WPS key') ])
					])),
					fieldRow(_('Select / OK'), E('select', { 'id': 'oled-select-button', 'disabled': isReadonlyView || null }, [
						E('option', { 'value': 'wps', 'selected': optionSelected('wps', pick('menu_select_button')) }, [ _('WPS key') ]),
						E('option', { 'value': 'BTN_2', 'selected': optionSelected('BTN_2', pick('menu_select_button')) }, [ _('GPIO button 2 (BTN_2)') ]),
						E('option', { 'value': 'none', 'selected': optionSelected('none', pick('menu_select_button')) }, [ _('None') ])
					]))
				])
			])
		]);
	},

	buildScreensaverTab: function(pick) {
		return E('div', { 'data-tab': 'screensaver', 'data-tab-title': _('Screensaver') }, [
			cbiSection(_('Legacy screensaver'), [
				_('These options apply only when menu mode is disabled. Most installations use menu mode (oledd) and can ignore this section.')
			], renderLegacyFields(pick), 'oled-section-legacy')
		]);
	},

	buildDebugTab: function() {
		return E('div', { 'data-tab': 'debug', 'data-tab-title': _('Debug') }, [
			cbiSection(_('Debug logs'), [
				_('Recent syslog lines tagged oledd, oled-cm5, oledd-boot, or cm5-oled.')
			], [
				fieldRow(_('Line limit'), E('select', { 'id': 'oled-log-limit' }, [
					E('option', { 'value': '50' }, [ '50' ]),
					E('option', { 'value': '100' }, [ '100' ]),
					E('option', { 'value': '200', 'selected': 'selected' }, [ '200' ]),
					E('option', { 'value': '500' }, [ '500' ])
				])),
				E('div', { 'class': 'oled-log-toolbar' }, [
					E('button', {
						'class': 'btn cbi-button-action',
						'click': ui.createHandlerFn(this, 'refreshLogs')
					}, [ _('Refresh') ]),
					' ',
					E('button', {
						'class': 'btn cbi-button-neutral',
						'click': ui.createHandlerFn(this, 'copyLogs')
					}, [ _('Copy to clipboard') ])
				]),
				E('textarea', {
					'id': 'oled-debug-log',
					'class': 'oled-log-pre',
					'readonly': 'readonly',
					'rows': 16,
					'placeholder': _('Click Refresh to load log lines.')
				}, [])
			])
		]);
	},

	logLimit: function() {
		var el = document.getElementById('oled-log-limit');
		var n = el ? parseInt(el.value, 10) : 200;
		return (n > 0 && n <= 2000) ? n : 200;
	},

	refreshLogs: function() {
		var ta = document.getElementById('oled-debug-log');
		if (ta)
			ta.value = _('Loading logs…');
		return callGetLogs(this.logLimit()).then(L.bind(function(r) {
			r = rpcData(r, {});
			if (!ta)
				return;
			if (r.error) {
				ta.value = r.message || r.error;
				ui.addNotification(null, E('p', {}, [ r.message || r.error ]), 'error');
				return;
			}
			var text = r.output || '';
			ta.value = text.length ? text : _('No matching log entries.');
		}, this)).catch(function(e) {
			if (ta)
				ta.value = _('Could not load logs: %s').format(e);
			ui.addNotification(null, E('p', {}, [ _('Could not load logs: %s').format(e) ]), 'error');
		});
	},

	copyLogs: function() {
		var ta = document.getElementById('oled-debug-log');
		if (!ta || !ta.value)
			return Promise.resolve();
		var text = ta.value;
		var notify = function(ok) {
			ui.addNotification(null, E('p', {}, [
				ok ? _('Log copied to clipboard.') : _('Copy failed — select the text area and copy manually.')
			]), ok ? 'info' : 'warning');
		};
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text).then(function() {
				notify(true);
			}).catch(function() {
				ta.focus();
				ta.select();
				try {
					notify(document.execCommand('copy'));
				} catch (err) {
					notify(false);
				}
			});
		}
		ta.focus();
		ta.select();
		try {
			notify(document.execCommand('copy'));
		} catch (err) {
			notify(false);
		}
		return Promise.resolve();
	},

	render: function(data) {
		var cfg = data.config || {};
		var st = data.status || {};
		var preview = data.preview || {};
		var i2cPaths = buildI2cPathList(cfg);

		function pick(key) {
			return cfg[key] != null ? cfg[key] : FORM_DEFAULTS[key];
		}

		var pathOptions = i2cPaths.list.map(function(dev) {
			return E('option', {
				'value': dev,
				'selected': optionSelected(dev, pick('path') || i2cPaths.selected)
			}, [ dev ]);
		});

		var periphLink = E('a', {
			'href': L.url('admin/system/peripherals'),
			'class': 'oled-crosslink'
		}, [ _('I2C diagnostics → Peripherals') ]);

		var tabHost = E('div', { 'class': 'oled-tab-host' }, [
			this.buildDashboardTab(st, preview),
			this.buildDisplayTab(pick, pathOptions, st, periphLink),
			this.buildMenuTab(pick),
			this.buildButtonsTab(pick),
			this.buildScreensaverTab(pick),
			this.buildDebugTab()
		]);

		var root = E('div', { 'class': 'luci-app-oled' }, [
			oledInjectStyles(),
			E('h2', {}, [ _('OLED display') ]),
			E('p', { 'class': 'cbi-map-descr' }, [
				_('SH1106 128×64 I2C display — menu, boot splash, and button navigation.')
			]),
			tabHost,
			E('div', { 'class': 'cbi-page-actions oled-form-actions' }, [
				E('button', {
					'class': 'btn cbi-button-save',
					'click': ui.createHandlerFn(this, 'handleOledSave', false),
					'disabled': isReadonlyView
				}, [ _('Save') ]),
				' ',
				E('button', {
					'class': 'btn cbi-button-apply',
					'click': ui.createHandlerFn(this, 'handleOledSave', true),
					'disabled': isReadonlyView
				}, [ _('Save & restart') ])
			])
		]);

		ui.tabs.initTabGroup(tabHost.childNodes);
		poll.add(L.bind(function() {
			return Promise.all([
				this.refreshStatus(false),
				this.refreshPreview(false)
			]);
		}, this), 4);
		setTimeout(L.bind(this.refreshLogs, this), 0);

		return root;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
