'use strict';
'require view';
'require ui';
'require blocky-base as Blocky';
'require blocky-tab-blocklists as tabBlocklists';
'require blocky-tab-stats as tabStats';
'require blocky-tab-dashboard as tabDashboard';
'require blocky-tab-config as tabConfig';
'require blocky-tab-query as tabQuery';
'require blocky-tab-logs as tabLogs';
'require baseclass';

var BlockyTabs = {
	blocklists: tabBlocklists,
	stats: tabStats,
	dashboard: tabDashboard,
	config: tabConfig,
	query: tabQuery,
	logs: tabLogs
};

var loadBlockyPageData = Blocky.loadBlockyPageData,
	resolveDefaultTabFromHash = Blocky.resolveDefaultTabFromHash,
	parseBlockyVersionFromMetrics = Blocky.parseBlockyVersionFromMetrics,
	blockyCliStdout = Blocky.blockyCliStdout,
	execResultStdout = Blocky.execResultStdout,
	unwrapFetchText = Blocky.unwrapFetchText,
	EMPTY_BLOCKLIST_CATALOG = Blocky.EMPTY_BLOCKLIST_CATALOG,
	notify = Blocky.notify,
	mountInnerTabs = Blocky.mountInnerTabs,
	canonicalTabHash = Blocky.canonicalTabHash,
	BLOCKY_TAB_HASH = Blocky.BLOCKY_TAB_HASH;

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
			var statsResult = data[5];
			var uciAccess = data[7] || { user: '', password: '', localOnly: true };
			var catalogData = data[8] || EMPTY_BLOCKLIST_CATALOG;
			var pageStatus = data[9] || {};
			var dnsFwdRaw = blockyCliStdout(execResultStdout(data[4], '0\n'));
			var metricsPayload = unwrapFetchText(metrics);
			var overviewHost = E('div', { 'class': 'blocky-dashboard' });
			var logsHost = E('div', {});
			var queryPanel = BlockyTabs.query.createQueryPanel();
			var root;
			var tabHost;
			var statusBox;
			var listsBox;
			var settingsBox;
			var queryBox;
			var logsBox;
			var hero;

			function jumpTab(hash) {
				var idx = BLOCKY_TAB_HASH[hash];
				var buttons;
				var canonical = canonicalTabHash(hash);

				if (idx == null)
					return;

				window.location.hash = canonical;

				buttons = tabHost ? tabHost.querySelectorAll(':scope > .cbi-tabmenu li') : [];
				if (!buttons.length && tabHost)
					buttons = tabHost.querySelectorAll('.cbi-tabmenu li');
				if (buttons[idx])
					buttons[idx].click();
			}

			function openDnsQuery(domain, recordType) {
				jumpTab('query');
				return queryPanel.prefillAndRun(domain, recordType);
			}

			function paintHero(freshStatus) {
				var running = !!(freshStatus && freshStatus.service_running);
				var blocking = !!(freshStatus && freshStatus.blocking && freshStatus.blocking.enabled &&
					!(freshStatus.blocking.autoEnableInSec > 0));
				var note;

				hero.innerHTML = '';
				if (!running)
					note = _('Filtering is off. Enable Blocky on the Settings tab, then Save & Apply.');
				else if (!blocking)
					note = _('The service is up, but blocking is off or paused. Use Enable blocking on Status.');
				else
					note = _('Filtering LAN DNS through dnsmasq. Edit lists on Block lists; change resolvers on Settings.');
				hero.appendChild(E('div', { 'class': 'blocky-hero-copy' }, [
					E('strong', {}, running ? _('Running') : _('Not running')),
					E('span', { 'class': 'blocky-hero-note' }, note)
				]));
			}

			function refreshPage() {
				return self.load().then(function(fresh) {
					pageStatus = fresh[9] || {};
					service = fresh[0];
					status = fresh[1];
					statsResult = fresh[5];
					paintHero(pageStatus);
					var mounted = BlockyTabs.dashboard.mountDashboardContent(overviewHost, fresh, refreshPage);
					BlockyTabs.dashboard.attachDashboardHostState(overviewHost, mounted.service, mounted.status, refreshPage);
					listsBox.replaceChildren(BlockyTabs.blocklists.renderBlocklistsTab(
						fresh[5],
						refreshPage,
						fresh[8],
						unwrapFetchText(fresh[3]),
						fresh[2]
					));
					settingsBox.replaceChildren(BlockyTabs.config.renderBlockySettingsPage(
						fresh[2],
						blockyCliStdout(execResultStdout(fresh[4], '0\n')),
						fresh[7] || { user: '', password: '', localOnly: true },
						refreshPage,
						pageStatus
					));
					logsHost.replaceChildren(BlockyTabs.logs.renderLogsTab(fresh[2], fresh[9], {
						onQueryDomain: openDnsQuery
					}));
				}).catch(function(err) {
					notify(err.message || String(err), 'danger');
				});
			}

			hero = E('div', { 'class': 'blocky-hero', 'id': 'blocky-hero' });
			paintHero(pageStatus);

			var mounted = BlockyTabs.dashboard.mountDashboardContent(overviewHost, data, refreshPage);
			BlockyTabs.dashboard.attachDashboardHostState(overviewHost, mounted.service, mounted.status, refreshPage);

			statusBox = E('div', { 'data-tab': 'status', 'data-tab-title': _('Status') });
			statusBox.appendChild(overviewHost);

			listsBox = E('div', { 'data-tab': 'blocklists', 'data-tab-title': _('Block lists') });
			listsBox.appendChild(BlockyTabs.blocklists.renderBlocklistsTab(statsResult, refreshPage, catalogData, metricsPayload, config));

			settingsBox = E('div', { 'data-tab': 'settings', 'data-tab-title': _('Settings') });
			settingsBox.appendChild(BlockyTabs.config.renderBlockySettingsPage(config, dnsFwdRaw, uciAccess, refreshPage, pageStatus));

			queryBox = E('div', { 'data-tab': 'query', 'data-tab-title': _('Query') });
			queryBox.appendChild(queryPanel.node);

			logsBox = E('div', { 'data-tab': 'logs', 'data-tab-title': _('Logs') });
			logsHost.appendChild(BlockyTabs.logs.renderLogsTab(config, pageStatus, {
				onQueryDomain: openDnsQuery
			}));
			logsBox.appendChild(logsHost);

			if (!statsPollRegistered) {
				statsPollRegistered = true;
				BlockyTabs.dashboard.registerStatsPoll(overviewHost, refreshPage);
			}

			tabHost = E('div', { 'class': 'blocky-tab-host' }, [
				statusBox, listsBox, settingsBox, queryBox, logsBox
			]);

			root = E('div', { 'class': 'luci-app-blocky' }, [
				BlockyTabs.dashboard.blockyInjectStyles(),
				E('h2', {}, [ _('Blocky') ]),
				hero,
				tabHost
			]);

			ui.tabs.initTabGroup(tabHost.childNodes);

			statusBox.addEventListener('cbi-tab-active', function() {
				window.location.hash = 'status';
			});
			listsBox.addEventListener('cbi-tab-active', function() {
				window.location.hash = 'blocklists';
			});
			settingsBox.addEventListener('cbi-tab-active', function() {
				window.location.hash = 'settings';
			});
			queryBox.addEventListener('cbi-tab-active', function() {
				window.location.hash = 'query';
			});
			logsBox.addEventListener('cbi-tab-active', function() {
				window.location.hash = 'logs';
			});

			if (defaultTab > 0) {
				var buttons = tabHost.querySelectorAll(':scope > .cbi-tabmenu li');
				if (!buttons.length)
					buttons = tabHost.querySelectorAll('.cbi-tabmenu li');
				if (buttons[defaultTab])
					buttons[defaultTab].click();
			}

			return root;
		},

		handleSave: function() {
			return Blocky.runSettingsApply(false).then(function() {
				ui.addNotification(null, E('p', {}, _('Settings saved.')), 4000);
			});
		},

		handleSaveApply: function() {
			return Blocky.runSettingsApply(true).then(function() {
				ui.addNotification(null, E('p', {}, _('Settings saved and Blocky restarted.')), 4000);
			});
		},

		handleReset: null
	});
}

return baseclass.extend({
	createBlockyView: createBlockyView
});
