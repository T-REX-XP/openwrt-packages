'use strict';
'require view';

/*
 * Legacy Status menu entry removed — redirect bookmarks to Services → Blocky.
 */
return view.extend({
	render: function() {
		window.location.replace(L.url('admin/services/blocky') + '#statistics');
		return E('p', { 'class': 'cbi-section-descr' }, [ _('Redirecting to Blocky…') ]);
	}
});
