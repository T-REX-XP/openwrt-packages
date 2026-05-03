'use strict';
'require view';
'require ui';
'require rpc';

var callStatus = rpc.declare({
	object: 'luci.speedtest',
	method: 'status',
	expect: { '': {} }
});

var callRun = rpc.declare({
	object: 'luci.speedtest',
	method: 'run',
	expect: { '': {} }
});

function setOutput(node, text) {
	node.textContent = text || _('No output returned.');
}

return view.extend({
	load: function() {
		return callStatus();
	},

	render: function(status) {
		var output = E('pre', {
			'class': 'cbi-section',
			'style': 'white-space: pre-wrap; word-break: break-word; min-height: 12em;'
		}, [ status.available ? _('Ready. Click "Run speed test" to measure the current WAN connection.') : _('speedtest-go is not installed.') ]);

		var button = E('button', {
			'class': 'btn cbi-button cbi-button-apply',
			'click': ui.createHandlerFn(this, function() {
				button.disabled = true;
				button.classList.add('spinning');
				setOutput(output, _('Running speed test. This can take up to a minute...'));

				return callRun().then(function(res) {
					var header = res.ok ? _('Speed test completed.') : _('Speed test failed.');
					setOutput(output, '%s\n\n%s'.format(header, res.output || _('No output returned.')));
				}).catch(function(err) {
					setOutput(output, _('RPC call failed: %s').format(err));
				}).finally(function() {
					button.disabled = false;
					button.classList.remove('spinning');
				});
			})
		}, [ _('Run speed test') ]);

		button.disabled = !status.available;

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, [ _('Speed Test') ]),
			E('div', { 'class': 'cbi-map-descr' }, [
				_('Runs the speedtest-go client on the router and shows the raw result. The measurement uses public Speedtest.net servers and depends on current WAN load.')
			]),
			E('div', { 'class': 'cbi-section' }, [
				E('p', {}, [
					E('strong', {}, [ _('Binary') ]),
					': ',
					status.binary || '/usr/bin/speedtest-go'
				]),
				E('p', {}, [ button ]),
				output
			])
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
