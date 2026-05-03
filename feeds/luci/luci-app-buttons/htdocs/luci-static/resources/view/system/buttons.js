'use strict';
'require view';
'require rpc';
'require ui';

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

return view.extend({
	load: function() {
		return callList().then(function(list) {
			var names = list.names || [];
			var current = names.indexOf('wps') > -1 ? 'wps' : (names[0] || 'wps');

			return callGet(current).catch(function() {
				return { name: current, content: '', missing: true };
			}).then(function(script) {
				return {
					list: list,
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

		return callGet(name).then(function(res) {
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
				ui.addNotification(null, E('p', {}, [ _('Saved %s. Press the physical button and watch logread to test it.').format('/etc/rc.button/' + name) ]), 'info');
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
		var list = data.list || {};
		var names = list.names || [];
		var common = list.common || [];
		var current = data.current || 'wps';
		var script = data.script || {};

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
			E('option', { value: 'wps' }, [ _('Trigger Wi-Fi WPS') ]),
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
				_('Manage OpenWrt GPIO button hotplug scripts. The scripts live in %s and are called with ACTION, BUTTON and SEEN environment variables when gpio-button-hotplug receives a supported key event.').format('/etc/rc.button/')
			]),
			list.missing ? E('p', { 'class': 'alert-message warning' }, [
				_('%s is missing. Saving a script will create it.').format('/etc/rc.button/')
			]) : '',
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
								_('Use the hotplug button name, for example %s or %s.').format('wps', 'reset')
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
			section(_('Known Button Names'), _('These are common OpenWrt hotplug names. The CM5 Base USERKEY is mapped to wps in this image.'), [
				table([ _('Name'), _('Status') ], rows)
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
