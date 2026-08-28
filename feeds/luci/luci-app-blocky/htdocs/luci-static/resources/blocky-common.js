'use strict';
'require view';
'require blocky-base as Blocky';
'require blocky-tab-blocklists as tabBlocklists';
'require blocky-tab-stats as tabStats';
'require blocky-tab-dashboard as tabDashboard';
'require blocky-tab-config as tabConfig';
'require blocky-tab-controls as tabControls';
'require blocky-tab-query as tabQuery';
'require blocky-tab-logs as tabLogs';
'require baseclass';

var BlockyTabs = {
	blocklists: tabBlocklists,
	stats: tabStats,
	dashboard: tabDashboard,
	config: tabConfig,
	controls: tabControls,
	query: tabQuery,
	logs: tabLogs
};

var loadBlockyPageData = Blocky.loadBlockyPageData,
	resolveDefaultTabFromHash = Blocky.resolveDefaultTabFromHash,
	renderBlockyVersionBadge = Blocky.renderBlockyVersionBadge,
	resolveBlockyVersion = Blocky.resolveBlockyVersion,
	parseBlockyVersionFromMetrics = Blocky.parseBlockyVersionFromMetrics,
	blockyCliStdout = Blocky.blockyCliStdout,
	execResultStdout = Blocky.execResultStdout,
	unwrapFetchText = Blocky.unwrapFetchText,
	EMPTY_BLOCKLIST_CATALOG = Blocky.EMPTY_BLOCKLIST_CATALOG,
	notify = Blocky.notify,
	renderTabs = Blocky.renderTabs,
	BLOCKY_TAB_HASH_KEYS = Blocky.BLOCKY_TAB_HASH_KEYS;

function createBlockyView(options) {
	options = options || {};
	var defaultTab = resolveDefaultTabFromHash(options.defaultTab || 0);
	var statsPollRegistered = false;

	return view.extend({
		load: loadBlockyPageData,

		render: function(data) {
			var self = this;
			var service = data[0];
			var status = data[1];
			var config = data[2];
			var metrics = data[3];
			var dnsFwd = data[4];
			var statsResult = data[5];
			var uciAccess = data[7] || { user: '', password: '', localOnly: true };
			var catalogData = data[8] || EMPTY_BLOCKLIST_CATALOG;
			var dnsFwdRaw = blockyCliStdout(execResultStdout(dnsFwd, '0\n'));
			var metricsPayload = unwrapFetchText(metrics);
			var dashboardHost = E('div', { 'class': 'blocky-dashboard' });
			var statisticsHost = E('div', {});
			var blocklistsHost = E('div', {});
			var configHost = E('div', {});
			var controlsHost = E('div', {});
			var logsHost = E('div', {});
			var versionText = parseBlockyVersionFromMetrics(metricsPayload);

			function refreshPage() {
				return self.load().then(function(fresh) {
					var mounted = BlockyTabs.dashboard.mountDashboardContent(dashboardHost, fresh, refreshPage);
					BlockyTabs.dashboard.attachDashboardHostState(dashboardHost, mounted.service, mounted.status, refreshPage);
					statisticsHost.replaceChildren(BlockyTabs.stats.renderStatisticsTab(fresh, refreshPage));
					blocklistsHost.replaceChildren(BlockyTabs.blocklists.renderBlocklistsTab(
						fresh[5],
						refreshPage,
						fresh[8],
						unwrapFetchText(fresh[3])
					));
					configHost.replaceChildren(BlockyTabs.config.renderBlockySettingsPage(
						fresh[2],
						blockyCliStdout(execResultStdout(fresh[4], '0\n')),
						fresh[7] || { user: '', password: '', localOnly: true },
						refreshPage
					));
					controlsHost.replaceChildren(
						BlockyTabs.controls.renderBlockingControls(fresh[1], refreshPage),
						BlockyTabs.controls.renderOperations(fresh[0], refreshPage),
						BlockyTabs.controls.renderServiceControls(fresh[0], refreshPage)
					);
					logsHost.replaceChildren(BlockyTabs.logs.renderQueryLogsTab(fresh[2]));
				}).catch(function(err) {
					notify(err.message || String(err), 'danger');
				});
			}

			var mounted = BlockyTabs.dashboard.mountDashboardContent(dashboardHost, data, refreshPage);
			BlockyTabs.dashboard.attachDashboardHostState(dashboardHost, mounted.service, mounted.status, refreshPage);
			statisticsHost.appendChild(BlockyTabs.stats.renderStatisticsTab(data, refreshPage));
			blocklistsHost.appendChild(BlockyTabs.blocklists.renderBlocklistsTab(statsResult, refreshPage, catalogData, metricsPayload));
			configHost.appendChild(BlockyTabs.config.renderBlockySettingsPage(config, dnsFwdRaw, uciAccess, refreshPage));
			logsHost.appendChild(BlockyTabs.logs.renderQueryLogsTab(config));

			controlsHost.appendChild(BlockyTabs.controls.renderBlockingControls(status, refreshPage));
			controlsHost.appendChild(BlockyTabs.controls.renderOperations(service, refreshPage));
			controlsHost.appendChild(BlockyTabs.controls.renderServiceControls(service, refreshPage));

			if (!statsPollRegistered) {
				statsPollRegistered = true;
				BlockyTabs.dashboard.registerStatsPoll(dashboardHost, refreshPage);
			}

			if (!versionText) {
				resolveBlockyVersion(metricsPayload).then(function(version) {
					var badge = document.querySelector('.luci-app-blocky .blocky-version-badge');

					if (version && badge)
						badge.textContent = _('Blocky %s').format(version);
				});
			}

			return E('div', { 'class': 'luci-app-blocky' }, [
				BlockyTabs.dashboard.BlockyTabs.dashboard.blockyInjectStyles(),
				E('div', { 'class': 'blocky-page-head' }, [
					E('h2', {}, [ _('Blocky DNS') ]),
					renderBlockyVersionBadge(versionText)
				]),
				E('p', { 'class': 'cbi-section-descr' }, [
					_('Dashboard for Blocky on your router — live statistics, blocking controls, DNS integration, and query logs.')
				]),
				renderTabs([
					{
						title: _('Dashboard'),
						nodes: [ dashboardHost ]
					},
					{
						title: _('Statistics'),
						nodes: [ statisticsHost ]
					},
					{
						title: _('Block lists'),
						nodes: [ blocklistsHost ]
					},
					{
						title: _('Configuration'),
						nodes: [ configHost ]
					},
					{
						title: _('Controls'),
						nodes: [ controlsHost ]
					},
					{
						title: _('DNS Query'),
						nodes: [ BlockyTabs.query.renderQuery() ]
					},
					{
						title: _('Logs'),
						nodes: [ logsHost ]
					}
				], defaultTab)
			]);
		},

		handleSaveApply: null,
		handleSave: null,
		handleReset: null
	});
}

return baseclass.extend({
	createBlockyView: createBlockyView
});

