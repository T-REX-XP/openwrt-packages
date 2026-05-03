'use strict';
'require view';

var SECTIONS = [
	{
		title: _('IP and DNS Leak Tests'),
		description: _('Use these pages after enabling VPN, WireGuard, AmneziaWG, Tailscale, Cloudflared, or custom DNS forwarding. The expected result is that public IP and DNS resolvers match the path you intended.'),
		links: [
			{
				title: _('Cloudflare 1.1.1.1 Help'),
				url: 'https://one.one.one.one/help/',
				description: _('Checks whether the current client is using Cloudflare DNS, DoH, DoT, and WARP-related connectivity.')
			},
			{
				title: _('DNSLeakTest'),
				url: 'https://www.dnsleaktest.com/',
				description: _('Classic standard and extended DNS leak tests.')
			},
			{
				title: _('BrowserLeaks DNS'),
				url: 'https://browserleaks.com/dns',
				description: _('Browser-oriented DNS leak inspection, useful for checking resolver visibility from the browser.')
			},
			{
				title: _('Control D DNS Leak Test'),
				url: 'https://controld.com/tools/dns-leak-test',
				description: _('Shows detected DNS resolvers and provider information.')
			},
			{
				title: _('Surfshark DNS Leak Test'),
				url: 'https://surfshark.com/dns-leak-test',
				description: _('Simple resolver visibility test from a VPN provider.')
			},
			{
				title: _('IPLeak'),
				url: 'https://ipleak.net/',
				description: _('Checks public IP, DNS, WebRTC exposure, geolocation hints, request headers, and torrent IP exposure.')
			}
		]
	},
	{
		title: _('What Is My IP'),
		description: _('Use more than one service when validating routing. CDN, VPN, proxy, and IPv6 paths can differ.'),
		links: [
			{
				title: _('Cloudflare Trace'),
				url: 'https://www.cloudflare.com/cdn-cgi/trace',
				description: _('Plain text view of the IP and Cloudflare edge metadata seen from the client.')
			},
			{
				title: _('ifconfig.co'),
				url: 'https://ifconfig.co/',
				description: _('Simple public IP, user agent, and request information.')
			},
			{
				title: _('ipinfo.io'),
				url: 'https://ipinfo.io/',
				description: _('Public IP, ASN, and geolocation summary.')
			},
			{
				title: _('WhatIsMyIPAddress'),
				url: 'https://whatismyipaddress.com/',
				description: _('Public IP and geolocation information with extra explanation pages.')
			}
		]
	},
	{
		title: _('Ad Blocking Tests'),
		description: _('Run these from a LAN client that should use Blocky or Adblock. Disable browser extensions first if you need to test router-side filtering only.'),
		links: [
			{
				title: _('D3ward Ad Block Test'),
				url: 'https://d3ward.github.io/toolz/adblock.html',
				description: _('Broad list of ad, analytics, social, and tracker domains.')
			},
			{
				title: _('AdBlock Tester'),
				url: 'https://adblock-tester.com/',
				description: _('Scores ad and tracker blocking behavior.')
			},
			{
				title: _('Can You Block It'),
				url: 'https://canyoublockit.com/',
				description: _('Checks common ad formats and anti-adblock behavior.')
			},
			{
				title: _('Cover Your Tracks'),
				url: 'https://coveryourtracks.eff.org/',
				description: _('EFF privacy test for tracking protection and fingerprinting resistance.')
			}
		]
	},
	{
		title: _('Browser and WebRTC Leaks'),
		description: _('These tests are client-side. Router DNS and VPN policy can be correct while the browser still leaks via WebRTC, IPv6, or fingerprinting.'),
		links: [
			{
				title: _('BrowserLeaks WebRTC'),
				url: 'https://browserleaks.com/webrtc',
				description: _('Checks public and local IP disclosure through WebRTC/STUN.')
			},
			{
				title: _('BrowserLeaks IP'),
				url: 'https://browserleaks.com/ip',
				description: _('Detailed IP, headers, proxy, and browser network visibility.')
			},
			{
				title: _('BrowserLeaks Canvas'),
				url: 'https://browserleaks.com/canvas',
				description: _('Checks canvas fingerprinting signals.')
			},
			{
				title: _('Am I Unique'),
				url: 'https://amiunique.org/',
				description: _('Browser fingerprint uniqueness check.')
			}
		]
	},
	{
		title: _('IPv6 and TLS Checks'),
		description: _('Useful when a VPN or DNS policy handles IPv4 correctly but leaves IPv6 or TLS trust problems behind.'),
		links: [
			{
				title: _('Test IPv6'),
				url: 'https://test-ipv6.com/',
				description: _('Checks IPv6 connectivity and whether IPv6 routing differs from IPv4 expectations.')
			},
			{
				title: _('BadSSL'),
				url: 'https://badssl.com/',
				description: _('TLS certificate and browser trust behavior test cases.')
			},
			{
				title: _('SSL Labs Client Test'),
				url: 'https://clienttest.ssllabs.com:8443/ssltest/viewMyClient.html',
				description: _('Shows TLS protocol and cipher support for the current browser/client.')
			}
		]
	},
	{
		title: _('Firewall and Exposure Checks'),
		description: _('Run external exposure checks only from a network you own and understand. Results depend on NAT, ISP filtering, and whether the test can reach your WAN address.'),
		links: [
			{
				title: _('ShieldsUP'),
				url: 'https://www.grc.com/shieldsup',
				description: _('Classic external port visibility and firewall exposure test.')
			},
			{
				title: _('Censys Search'),
				url: 'https://search.censys.io/',
				description: _('Search public internet scan data for exposed services on known public IPs.')
			},
			{
				title: _('Shodan'),
				url: 'https://www.shodan.io/',
				description: _('Search public service exposure indexed by Shodan.')
			}
		]
	}
];

var CHECKLIST = [
	_('Confirm the client received the router as DNS server, or the intended custom DNS server.'),
	_('Run at least two DNS leak tests; resolvers should match the expected provider or tunnel exit.'),
	_('Check IPv6 separately. Disable or route IPv6 if it bypasses the intended path.'),
	_('Use a private/incognito window or disable browser extensions when testing router-side ad blocking.'),
	_('Re-test after changing VPN, WireGuard, AmneziaWG, Tailscale, DNS, DHCP, or ad-block configuration.'),
	_('Remember that external test sites receive your public IP, request headers, and browser metadata.')
];

var TABS = [
	{
		title: _('Overview'),
		sections: []
	},
	{
		title: _('DNS and IP'),
		sections: [ 0, 1 ]
	},
	{
		title: _('Browser'),
		sections: [ 3 ]
	},
	{
		title: _('Ad Blocking'),
		sections: [ 2 ]
	},
	{
		title: _('IPv6 and TLS'),
		sections: [ 4 ]
	},
	{
		title: _('Firewall'),
		sections: [ 5 ]
	}
];

function externalLink(url, title) {
	return E('a', {
		'href': url,
		'target': '_blank',
		'rel': 'noopener noreferrer'
	}, [ title ]);
}

function renderLink(link) {
	return E('div', { 'class': 'tr' }, [
		E('div', { 'class': 'td left', 'style': 'width:25%' }, [
			externalLink(link.url, link.title)
		]),
		E('div', { 'class': 'td left' }, [
			E('div', {}, [ link.description ]),
			E('small', {}, [ link.url ])
		])
	]);
}

function renderSection(section) {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ section.title ]),
		E('p', { 'class': 'cbi-section-descr' }, [ section.description ]),
		E('div', { 'class': 'table' }, [
			E('div', { 'class': 'tr table-titles' }, [
				E('div', { 'class': 'th left' }, [ _('Tool') ]),
				E('div', { 'class': 'th left' }, [ _('Purpose') ])
			])
		].concat(section.links.map(renderLink)))
	]);
}

function renderChecklist() {
	return E('div', { 'class': 'cbi-section' }, [
		E('h3', {}, [ _('Validation Checklist') ]),
		E('ul', {}, CHECKLIST.map(function(item) {
			return E('li', {}, [ item ]);
		}))
	]);
}

function renderTabs() {
	var tabButtons = [];
	var tabPanels = [];
	var activeIndex = 0;

	function activate(index) {
		tabButtons.forEach(function(button, pos) {
			button.className = pos === index ? 'cbi-tab' : 'cbi-tab-disabled';
		});

		tabPanels.forEach(function(panel, pos) {
			panel.style.display = pos === index ? '' : 'none';
		});
	}

	TABS.forEach(function(tab, index) {
		var nodes = tab.sections.length
			? tab.sections.map(function(sectionIndex) {
				return renderSection(SECTIONS[sectionIndex]);
			})
			: [
				renderChecklist(),
				E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, [ _('How to use this guide') ]),
					E('p', {}, [
						_('Open these checks from a LAN client whose routing, DNS, VPN, or ad-blocking behavior you want to validate. Results describe the client browser and network path, not only the router.')
					]),
					E('p', {}, [
						_('Use the tabs to focus on one validation area at a time after changing DNS, DHCP, VPN, WireGuard, AmneziaWG, Tailscale, Blocky, Adblock, or firewall settings.')
					])
				])
			];

		var button = E('li', {
			'class': index === activeIndex ? 'cbi-tab' : 'cbi-tab-disabled',
			'role': 'tab',
			'click': function(ev) {
				ev.preventDefault();
				activate(index);
			}
		}, [
			E('a', { 'href': '#' }, [ tab.title ])
		]);

		var panel = E('div', {
			'role': 'tabpanel',
			'style': index === activeIndex ? '' : 'display:none'
		}, nodes);

		tabButtons.push(button);
		tabPanels.push(panel);
	});

	return E('div', {}, [
		E('ul', { 'class': 'cbi-tabmenu', 'role': 'tablist' }, tabButtons)
	].concat(tabPanels));
}

return view.extend({
	render: function() {
		return E('div', {}, [
			E('h2', {}, [ _('Security Guide') ]),
			E('p', { 'class': 'cbi-section-descr' }, [
				_('Quick links for validating DNS leaks, public IP, browser leaks, ad blocking, IPv6, TLS, and firewall exposure from LAN clients. This page is static and does not send router data anywhere.')
			]),
			renderTabs()
		]);
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
