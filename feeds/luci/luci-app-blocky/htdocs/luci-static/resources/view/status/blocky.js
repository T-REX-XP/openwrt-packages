'use strict';
'require view';

return view.extend({
	load: function() {
		window.location.replace(L.url('admin/services/blocky'));
		return Promise.resolve([]);
	},

	render: function() {
		return E('p', { 'class': 'spinning' }, [ _('Loading…') ]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
