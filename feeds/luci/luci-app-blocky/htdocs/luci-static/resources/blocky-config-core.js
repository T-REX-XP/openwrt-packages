'use strict';

'require blocky-parse-core as bp';

function safeString(value) {
	return bp.safeString(value);
}

function extractYamlSection(yaml, sectionName) {
	var lines = safeString(yaml).split('\n');
	var out = [];
	var inSection = false;
	var re = new RegExp('^' + sectionName + ':\\s*$');

	lines.forEach(function(line) {
		if (re.test(line)) {
			inSection = true;
			out.push(line);
			return;
		}

		if (!inSection)
			return;

		if (/^[a-zA-Z0-9_]+:\s*$/.test(line) && !re.test(line))
			return;

		if (/^[^#\s]/.test(line) && !re.test(line))
			return;

		out.push(line);
	});

	return out.length ? out.join('\n') : '';
}

function parseYamlScalar(sectionYaml, key, fallback) {
	var m = safeString(sectionYaml).match(new RegExp('(?:^|\\n)\\s+' + key + ':\\s*(.+)$', 'm'));

	if (!m)
		return fallback;

	return m[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, '');
}

function parseYamlBool(sectionYaml, key, fallback) {
	var value = parseYamlScalar(sectionYaml, key, null);

	if (value === null)
		return fallback;

	value = value.toLowerCase();

	return value === 'true' || value === '1' || value === 'yes';
}

function parseYamlListItems(sectionYaml) {
	var items = [];

	safeString(sectionYaml).split('\n').forEach(function(line) {
		var m = line.match(/^\s+-\s+(.+)$/);

		if (!m)
			return;

		items.push(m[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, ''));
	});

	return items;
}

function parseUpstreamGroupResolvers(sectionYaml) {
	var groups = parseUpstreamGroups(sectionYaml);
	return groups.default || [];
}

function parseUpstreamGroups(sectionYaml) {
	var groups = {};
	var currentGroup = null;
	var inGroups = false;
	var baseIndent = -1;

	safeString(sectionYaml).split('\n').forEach(function(line) {
		if (/^\s+groups:\s*$/.test(line)) {
			inGroups = true;
			currentGroup = null;
			var m = line.match(/^(\s*)/);
			baseIndent = m ? m[1].length : 2;
			return;
		}

		if (!inGroups)
			return;

		var lead = line.match(/^(\s*)/);
		if (lead && lead[1].length <= baseIndent && line.trim() !== '')
			return;

		var groupMatch = line.match(/^\s+([A-Za-z0-9_*[\].-]+):\s*$/);
		if (groupMatch) {
			currentGroup = groupMatch[1];
			groups[currentGroup] = groups[currentGroup] || [];
			return;
		}

		var itemMatch = line.match(/^\s+-\s+(.+)$/);
		if (itemMatch && currentGroup) {
			groups[currentGroup].push(itemMatch[1].replace(/#.*$/, '').trim().replace(/^['"]|['"]$/g, ''));
		}
	});

	if (!groups.default)
		groups.default = [];

	return groups;
}

function upstreamGroupsFromFields(fields) {
	var groups = fields.upstreamGroups;
	var name;
	var out = {};

	if (groups && typeof groups === 'object') {
		Object.keys(groups).forEach(function(key) {
			name = safeString(key).trim();
			if (!name)
				return;

			out[name] = (groups[key] || []).map(function(item) {
				return safeString(item).trim();
			}).filter(Boolean);
		});

		if (Object.keys(out).length)
			return out;
	}

	out.default = safeString(fields.upstreamResolvers).split(/\n/).map(function(s) {
		return s.trim();
	}).filter(Boolean);

	return out;
}

function buildUpstreamGroupsYaml(groups) {
	var lines = [ '  groups:' ];
	var names = Object.keys(groups).sort(function(a, b) {
		if (a === 'default')
			return -1;
		if (b === 'default')
			return 1;
		return a.localeCompare(b);
	});

	if (!names.length)
		names = [ 'default' ];

	names.forEach(function(name) {
		var list = yamlListLines(groups[name] || [], '      ');

		lines.push('    ' + name + ':');
		if (list)
			lines.push(list);
	});

	return lines.join('\n');
}

function parseBlockySettings(yaml) {
	var upstreams = extractYamlSection(yaml, 'upstreams');
	var bootstrap = extractYamlSection(yaml, 'bootstrapDns');
	var blocking = extractYamlSection(yaml, 'blocking');
	var caching = extractYamlSection(yaml, 'caching');
	var hostsFile = extractYamlSection(yaml, 'hostsFile');
	var logSec = extractYamlSection(yaml, 'log');
	var queryLog = extractYamlSection(yaml, 'queryLog');
	var ports = extractYamlSection(yaml, 'ports');
	var rebinding = extractYamlSection(yaml, 'rebindingProtection');
	var prometheus = extractYamlSection(yaml, 'prometheus');
	var statistics = extractYamlSection(yaml, 'statistics');
	var dnsEp = bp.parseBlockyPortLine(yaml, 'dns', 5353);
	var httpEp = bp.parseBlockyPortLine(yaml, 'http', 4000);
	var bootstrapItems = parseYamlListItems(bootstrap);
	var bootstrapResolvers = [];
	var initMatch = upstreams.match(/init:\s*\n\s+strategy:\s*(\S+)/);
	var refreshMatch = blocking.match(/refreshPeriod:\s*(\S+)/);
	var downloadTimeoutMatch = blocking.match(/downloads:[\s\S]*?\n\s+timeout:\s*(\S+)/);
	var downloadAttemptsMatch = blocking.match(/downloads:[\s\S]*?\n\s+attempts:\s*(\S+)/);
	var loadingStrategyMatch = blocking.match(/loading:[\s\S]*?\n\s+strategy:\s*(\S+)/);
	var cachePathMatch = blocking.match(/cachePath:\s*(\S+)/);
	var writeTimeoutMatch = blocking.match(/writeTimeout:\s*(\S+)/);
	var readTimeoutMatch = blocking.match(/readTimeout:\s*(\S+)/);
	var cooldownMatch = blocking.match(/cooldown:\s*(\S+)/);
	var concurrencyMatch = blocking.match(/concurrency:\s*(\S+)/);

	bootstrapItems.forEach(function(item) {
		if (/^resolvFile:/i.test(item))
			return;

		bootstrapResolvers.push(item);
	});

	return {
		upstreamGroups: parseUpstreamGroups(upstreams),
		upstreamResolvers: parseUpstreamGroupResolvers(upstreams),
		upstreamInitStrategy: initMatch ? initMatch[1].replace(/['"]/g, '') : 'fast',
		upstreamTimeout: parseYamlScalar(upstreams, 'timeout', '5s'),
		bootstrapResolvers: bootstrapResolvers,
		bootstrapUseWan: bootstrapItems.some(function(item) {
			return /^resolvFile:/i.test(item);
		}),
		listRefreshPeriod: refreshMatch ? refreshMatch[1].replace(/['"]/g, '') : '4h',
		loadingStrategy: loadingStrategyMatch ? loadingStrategyMatch[1].replace(/['"]/g, '') : 'fast',
		listCachePath: cachePathMatch ? cachePathMatch[1].replace(/['"]/g, '') : '/var/lib/blocky/lists',
		listDownloadTimeout: downloadTimeoutMatch ? downloadTimeoutMatch[1].replace(/['"]/g, '') : '60s',
		listWriteTimeout: writeTimeoutMatch ? writeTimeoutMatch[1].replace(/['"]/g, '') : '60s',
		listReadTimeout: readTimeoutMatch ? readTimeoutMatch[1].replace(/['"]/g, '') : '60s',
		listDownloadAttempts: downloadAttemptsMatch ? downloadAttemptsMatch[1].replace(/['"]/g, '') : '5',
		listCooldown: cooldownMatch ? cooldownMatch[1].replace(/['"]/g, '') : '10s',
		listConcurrency: concurrencyMatch ? concurrencyMatch[1].replace(/['"]/g, '') : '4',
		cachingMinTime: parseYamlScalar(caching, 'minTime', '5m'),
		cachingMaxTime: parseYamlScalar(caching, 'maxTime', '30m'),
		cachingPrefetch: parseYamlBool(caching, 'prefetching', false),
		hostsSources: parseYamlListItems(hostsFile),
		logLevel: parseYamlScalar(logSec, 'level', 'warn'),
		logPrivacy: parseYamlBool(logSec, 'privacy', false),
		queryLogType: parseYamlScalar(queryLog, 'type', 'csv'),
		queryLogTarget: parseYamlScalar(queryLog, 'target', '/tmp/blocky-logs'),
		queryLogRetention: parseYamlScalar(queryLog, 'logRetentionDays', '7'),
		queryLogFlush: parseYamlScalar(queryLog, 'flushInterval', '30s'),
		portDns: dnsEp.host + ':' + String(dnsEp.port),
		portHttp: httpEp.host + ':' + String(httpEp.port),
		rebindingEnable: parseYamlBool(rebinding, 'enable', true),
		prometheusEnable: parseYamlBool(prometheus, 'enable', true),
		prometheusPath: parseYamlScalar(prometheus, 'path', '/metrics'),
		statisticsEnable: parseYamlBool(statistics, 'enable', true),
		blockingSection: blocking
	};
}

function yamlQuote(value) {
	var v = safeString(value).trim();

	if (!v)
		return '""';

	if (/[:#{}[\],&*?|>!%@`"]|\s/.test(v))
		return '"' + v.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

	return v;
}

function yamlListLines(items, indent) {
	var prefix = indent || '      ';

	return items.filter(function(item) {
		return safeString(item).trim();
	}).map(function(item) {
		return prefix + '- ' + yamlQuote(item.trim());
	}).join('\n');
}

function buildBlockySettingsYaml(fields, currentYaml) {
	var blocking = fields.blockingSection || extractYamlSection(currentYaml, 'blocking');
	var upstreamGroups = upstreamGroupsFromFields(fields);
	var bootstrapResolvers = fields.bootstrapResolvers.split(/\n/).map(function(s) {
		return s.trim();
	}).filter(Boolean);
	var hostsSources = fields.hostsSources.split(/\n/).map(function(s) {
		return s.trim();
	}).filter(Boolean);
	var bootstrapLines = bootstrapResolvers.slice();

	if (fields.bootstrapUseWan)
		bootstrapLines.push('resolvFile: /tmp/resolv.conf.auto');

	if (!blocking.trim())
		blocking = extractYamlSection(currentYaml, 'blocking');

	return [
		'upstreams:',
		'  init:',
		'    strategy: ' + yamlQuote(fields.upstreamInitStrategy || 'fast'),
		'  timeout: ' + yamlQuote(fields.upstreamTimeout || '5s'),
		buildUpstreamGroupsYaml(upstreamGroups),
		'',
		'bootstrapDns:',
		bootstrapLines.length ? yamlListLines(bootstrapLines, '  ') : '  - tcp+udp:1.1.1.1',
		'',
		blocking.trim(),
		'',
		'caching:',
		'  minTime: ' + yamlQuote(fields.cachingMinTime || '5m'),
		'  maxTime: ' + yamlQuote(fields.cachingMaxTime || '30m'),
		'  prefetching: ' + (fields.cachingPrefetch ? 'true' : 'false'),
		'',
		'hostsFile:',
		'  sources:',
		hostsSources.length ? yamlListLines(hostsSources, '    ') : '    - /etc/hosts',
		'',
		'log:',
		'  level: ' + yamlQuote(fields.logLevel || 'warn'),
		'  privacy: ' + (fields.logPrivacy ? 'true' : 'false'),
		'',
		'queryLog:',
		'  type: ' + yamlQuote(fields.queryLogType || 'csv'),
		'  target: ' + yamlQuote(fields.queryLogTarget || '/tmp/blocky-logs'),
		'  logRetentionDays: ' + yamlQuote(fields.queryLogRetention || '7'),
		'  flushInterval: ' + yamlQuote(fields.queryLogFlush || '30s'),
		'',
		'ports:',
		'  dns: ' + yamlQuote(fields.portDns || '127.0.0.1:5353'),
		'  http: ' + yamlQuote(fields.portHttp || '127.0.0.1:4000'),
		'',
		'rebindingProtection:',
		'  enable: ' + (fields.rebindingEnable ? 'true' : 'false'),
		'',
		'prometheus:',
		'  enable: ' + (fields.prometheusEnable ? 'true' : 'false'),
		'  path: ' + yamlQuote(fields.prometheusPath || '/metrics'),
		'',
		'statistics:',
		'  enable: ' + (fields.statisticsEnable ? 'true' : 'false'),
		''
	].join('\n');
}

function patchBlockingLoadingSection(blockingYaml, fields) {
	var lines = safeString(blockingYaml).split('\n');
	var out = [];
	var inLoading = false;
	var inDownloads = false;
	var replaced = {};

	function patchLine(line, key, indent, value, flag) {
		if (replaced[flag])
			return null;

		if (!new RegExp('^' + indent + key + ':').test(line))
			return null;

		replaced[flag] = true;
		return indent + key + ': ' + yamlQuote(value);
	}

	lines.forEach(function(line) {
		if (/^\s+loading:\s*$/.test(line)) {
			inLoading = true;
			inDownloads = false;
			out.push(line);
			return;
		}

		if (inLoading && /^\s+downloads:\s*$/.test(line)) {
			inDownloads = true;
			out.push(line);
			return;
		}

		if (inLoading && !inDownloads) {
			var loadingStrategy = patchLine(line, 'strategy', '    ', fields.loadingStrategy || 'fast', 'loadingStrategy');
			if (loadingStrategy) {
				out.push(loadingStrategy);
				return;
			}

			var loadingConcurrency = patchLine(line, 'concurrency', '    ', fields.listConcurrency || '4', 'concurrency');
			if (loadingConcurrency) {
				out.push(loadingConcurrency);
				return;
			}
		}

		if (inLoading) {
			var refresh = patchLine(line, 'refreshPeriod', '    ', fields.listRefreshPeriod || '4h', 'refreshPeriod');
			if (refresh) {
				out.push(refresh);
				return;
			}
		}

		if (inDownloads) {
			if (/^\s{6}concurrency:/.test(line))
				return;

			var patched = patchLine(line, 'cachePath', '      ', fields.listCachePath || '/var/lib/blocky/lists', 'cachePath') ||
				patchLine(line, 'timeout', '      ', fields.listDownloadTimeout || '60s', 'timeout') ||
				patchLine(line, 'writeTimeout', '      ', fields.listWriteTimeout || '60s', 'writeTimeout') ||
				patchLine(line, 'readTimeout', '      ', fields.listReadTimeout || '60s', 'readTimeout') ||
				patchLine(line, 'attempts', '      ', fields.listDownloadAttempts || '5', 'attempts') ||
				patchLine(line, 'cooldown', '      ', fields.listCooldown || '10s', 'cooldown');

			if (patched) {
				out.push(patched);
				return;
			}
		}

		if (/^\s{2}[A-Za-z0-9_]+:/.test(line) && !/^\s+loading:/.test(line)) {
			inLoading = false;
			inDownloads = false;
		}

		out.push(line);
	});

	if (!replaced.concurrency) {
		var insertAt = -1;
		var i;

		for (i = 0; i < out.length; i++) {
			if (/^\s+refreshPeriod:/.test(out[i])) {
				insertAt = i + 1;
				break;
			}
		}

		if (insertAt < 0) {
			for (i = 0; i < out.length; i++) {
				if (/^\s+loading:\s*$/.test(out[i])) {
					insertAt = i + 1;
					break;
				}
			}
		}

		if (insertAt >= 0)
			out.splice(insertAt, 0, '    concurrency: ' + yamlQuote(fields.listConcurrency || '4'));
	}

	return out.join('\n');
}

return {
	extractYamlSection: extractYamlSection,
	parseYamlScalar: parseYamlScalar,
	parseYamlBool: parseYamlBool,
	parseYamlListItems: parseYamlListItems,
	parseUpstreamGroupResolvers: parseUpstreamGroupResolvers,
	parseUpstreamGroups: parseUpstreamGroups,
	upstreamGroupsFromFields: upstreamGroupsFromFields,
	buildUpstreamGroupsYaml: buildUpstreamGroupsYaml,
	parseBlockySettings: parseBlockySettings,
	yamlQuote: yamlQuote,
	yamlListLines: yamlListLines,
	buildBlockySettingsYaml: buildBlockySettingsYaml,
	patchBlockingLoadingSection: patchBlockingLoadingSection
};
