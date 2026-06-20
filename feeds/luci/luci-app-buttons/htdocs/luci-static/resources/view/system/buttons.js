'use strict';
'require view';
'require rpc';
'require ui';
'require poll';

var callList = rpc.declare({
	object: 'luci.buttons',
	method: 'list',
	expect: { names: [] }
});

var callGet = rpc.declare({
	object: 'luci.buttons',
	method: 'get',
	params: [ 'name' ]
});

var callSet = rpc.declare({
	object: 'luci.buttons',
	method: 'set',
	params: [ 'name', 'content', 'preset' ]
});

var callDelete = rpc.declare({
	object: 'luci.buttons',
	method: 'delete',
	params: [ 'name' ]
});

var callStatus = rpc.declare({
	object: 'luci.buttons',
	method: 'status',
	expect: { buttons: [], events: [] }
});

var isReadonlyView = !L.hasViewPermission() || null;

function buttonNameValid(name) {
	return /^[A-Za-z0-9._-]{1,64}$/.test(name || '') && name !== '.' && name !== '..';
}

function section(title, descr, body) {
	var nodes = [];
	if (title)
		nodes.push(E('h3', {}, [ title ]));
	if (descr)
		nodes.push(E('p', { 'class': 'cbi-section-descr' }, [ descr ]));
	return E('div', { 'class': 'cbi-section' }, nodes.concat(body || []));
}

function table(headers, rows) {
	return E('table', { 'class': 'table' }, [
		E('tr', { 'class': 'tr table-titles' }, headers.map(function(h) {
			return E('th', { 'class': 'th' }, [ h ]);
		})),
		E('tbody', {}, rows)
	]);
}

function statePill(state) {
	var cls = 'label';
	if (state === 'pressed')
		cls += ' success';
	else if (state === 'released')
		cls += '';
	else
		cls += ' warning';
	return E('span', { 'class': cls }, [ state || _('unknown') ]);
}

function renderLiveStatus(statusHost, eventsHost, data) {
	var buttons = (data && data.buttons) || [];
	var events = (data && data.events) || [];

	replaceContent(statusHost, E('div', { 'class': 'table' }, buttons.length ? buttons.map(function(btn) {
		return E('div', { 'class': 'tr' }, [
			E('div', { 'class': 'td', 'style': 'width:28%' }, [ btn.label || btn.id ]),
			E('div', { 'class': 'td', 'style': 'width:22%' }, [ statePill(btn.state) ]),
			E('div', { 'class': 'td' }, [
				btn.detected ? _('input detected') : _('no input device'),
				btn.script ? '' : (' — ' + _('no script'))
			])
		]);
	}) : [ E('em', {}, [ _('No CM5 button definitions.') ]) ]));

	if (!events.length) {
		replaceContent(eventsHost, E('em', {}, [ _('No button events logged yet. Press USERKEY or MaskROM.') ]));
		return;
	}

	replaceContent(eventsHost, E('div', { 'class': 'cbi-section', 'style': 'font-family:monospace;font-size:.92em' },
		events.slice().reverse().map(function(line) {
			return E('div', { 'style': 'padding:.2em 0;border-bottom:1px solid rgba(128,128,128,.2)' }, [ line ]);
		})
	));
}

function replaceContent(node, content) {
	while (node.firstChild)
		node.removeChild(node.firstChild);
	if (content == null || content === false)
		return;
	if (Array.isArray(content)) {
		for (var i = 0; i < content.length; i++)
			if (content[i] != null)
				node.appendChild(content[i]);
		return;
	}
	node.appendChild(content);
}

return view.extend({
	load: function() {
		return Promise.all([
			callList(),
			callStatus()
		]).then(function(res) {
			var list = res[0];
			var status = res[1];
			var names = list.names || [];
			var current = names.indexOf('wps') > -1 ? 'wps' : (names.indexOf('BTN_2') > -1 ? 'BTN_2' : (names[0] || 'wps'));

			return callGet(current).catch(function() {
				return { name: current, content: '', missing: true };
			}).then(function(script) {
				return {
					list: list,
					status: status,
					current: current,
					script: script
				};
			});
		});
	},

	handleSelect: function(ev) {
		var name = ev.target.value;
		if (!buttonNameValid(name))
			return;

		return callGet(name).then(function(res) {
			var editor = document.getElementById('button-script-editor');
			var nameInput = document.getElementById('button-name');
			var del = document.getElementById('button-delete');

			if (editor)
				editor.value = res.content || '';
			if (nameInput)
				nameInput.value = name;
			if (del)
				del.disabled = isReadonlyView || !!res.protected || !!res.missing;
		});
	},

	handleTemplate: function(ev) {
		var preset = ev.target.value;
		var name = document.getElementById('button-name').value || 'custom';
		if (!preset)
			return;

		return callGet(name).then(function() {
			return callSet(name, '', preset).then(function() {
				return callGet(name);
			});
		}).then(function(res) {
			var editor = document.getElementById('button-script-editor');
			if (editor)
				editor.value = res.content || '';
			ui.addNotification(null, E('p', {}, [ _('Template written. Review and save if you make more changes.') ]), 'info');
		});
	},

	handleScriptSave: function() {
		var name = (document.getElementById('button-name').value || '').trim();
		var content = document.getElementById('button-script-editor').value || '';

		if (!buttonNameValid(name)) {
			ui.addNotification(null, E('p', {}, [ _('Use only letters, numbers, dot, underscore and dash in the button script name.') ]), 'error');
			return;
		}

		return callSet(name, content, '').then(function(res) {
			if (res.error)
				ui.addNotification(null, E('p', {}, [ res.error ]), 'error');
			else
				ui.addNotification(null, E('p', {}, [ _('Saved %s. Press the physical button and watch the live status below.').format('/etc/rc.button/' + name) ]), 'info');
		});
	},

	handleDelete: function() {
		var name = (document.getElementById('button-name').value || '').trim();
		if (!buttonNameValid(name))
			return;

		if (!confirm(_('Delete %s?').format('/etc/rc.button/' + name)))
			return;

		return callDelete(name).then(function(res) {
			if (res.error)
				ui.addNotification(null, E('p', {}, [ res.error ]), 'error');
			else
				window.location.reload();
		});
	},

	render: function(data) {
		var self = this;
		var list = data.list || {};
		var names = list.names || [];
		var common = list.common || [];
		var current = data.current || 'wps';
		var script = data.script || {};
		var statusHost = E('div', { id: 'button-live-status' });
		var eventsHost = E('div', { id: 'button-live-events' });
		var pollRegistered = false;

		renderLiveStatus(statusHost, eventsHost, data.status || {});

		if (!pollRegistered) {
			pollRegistered = true;
			poll.add(function() {
				return callStatus().then(function(st) {
					renderLiveStatus(statusHost, eventsHost, st);
				});
			}, 1);
		}

		var selector = E('select', {
			'class': 'cbi-input-select',
			'change': ui.createHandlerFn(this, 'handleSelect')
		}, names.map(function(name) {
			return E('option', { value: name, selected: name === current }, [ name ]);
		}));

		var nameInput = E('input', {
			id: 'button-name',
			'class': 'cbi-input-text',
			value: current,
			placeholder: 'wps',
			disabled: isReadonlyView
		});

		var preset = E('select', {
			'class': 'cbi-input-select',
			'change': ui.createHandlerFn(this, 'handleTemplate'),
			disabled: isReadonlyView
		}, [
			E('option', { value: '' }, [ _('Choose template...') ]),
			E('option', { value: 'logger' }, [ _('Log press/release') ]),
			E('option', { value: 'wps' }, [ _('CM5 USERKEY → Wi-Fi WPS') ]),
			E('option', { value: 'maskrom' }, [ _('CM5 MaskROM → log only') ]),
			E('option', { value: 'reboot' }, [ _('Reboot on release') ])
		]);

		var editor = E('textarea', {
			id: 'button-script-editor',
			'class': 'cbi-input-textarea',
			'style': 'width:100%;min-height:22em;font-family:monospace',
			disabled: isReadonlyView
		}, [ script.content || '' ]);

		var rows = common.map(function(name) {
			return E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td' }, [ name ]),
				E('td', { 'class': 'td' }, [
					names.indexOf(name) > -1 ? _('configured') : _('not configured')
				])
			]);
		});

		return E([], [
			E('h2', {}, [ _('Buttons') ]),
			E('p', { 'class': 'cbi-map-descr' }, [
				_('Manage OpenWrt GPIO/ADC button hotplug scripts. Scripts live in %s and receive ACTION, BUTTON and SEEN when a mapped key event arrives.').format('/etc/rc.button/')
			]),
			list.missing ? E('p', { 'class': 'alert-message warning' }, [
				_('%s is missing. Saving a script will create it.').format('/etc/rc.button/')
			]) : '',
			section(_('Live button status'), _('Press or release USERKEY (wps) or MaskROM (BTN_2). Updates every second.'), [
				statusHost,
				E('h4', { 'style': 'margin:1em 0 .35em' }, [ _('Recent events') ]),
				eventsHost
			]),
			section(_('Button Scripts'), _('Select an existing script, or type a new button event name and save it.'), [
				E('div', { 'class': 'cbi-section-node' }, [
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Existing script') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							names.length ? selector : E('em', {}, [ _('No scripts yet') ])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Script name') ]),
						E('div', { 'class': 'cbi-value-field' }, [
							nameInput,
							E('div', { 'class': 'cbi-value-description' }, [
								_('CM5 USERKEY → %s, MaskROM → %s.').format('wps', 'BTN_2')
							])
						])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Template') ]),
						E('div', { 'class': 'cbi-value-field' }, [ preset ])
					]),
					E('div', { 'class': 'cbi-value' }, [
						E('label', { 'class': 'cbi-value-title' }, [ _('Script') ]),
						E('div', { 'class': 'cbi-value-field' }, [ editor ])
					])
				]),
				E('div', { 'class': 'cbi-page-actions' }, [
					E('button', {
						'class': 'btn cbi-button-save',
						'click': ui.createHandlerFn(this, 'handleScriptSave'),
						disabled: isReadonlyView
					}, [ _('Save') ]),
					' ',
					E('button', {
						id: 'button-delete',
						'class': 'btn cbi-button-negative',
						'click': ui.createHandlerFn(this, 'handleDelete'),
						disabled: isReadonlyView || !!script.protected || !!script.missing
					}, [ _('Delete') ])
				])
			]),
			section(_('Known Button Names'), _('Common OpenWrt hotplug names on CM5 Base.'), [
				table([ _('Name'), _('Status') ], rows)
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
