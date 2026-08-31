package metrics

import (
	"fmt"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/proto"
)

func demoPayload(scope proto.Scope, demoAlarms bool) (string, error) {
	switch scope {
	case proto.ScopeSystem:
		return `{"hostname":"Router","time":"--","cpu":"0","cpu_temp":"--","ram_used":"--","ram_pct":0,"uptime_short":"--","load_short":"--"}`, nil
	case proto.ScopeNetwork:
		return `{"wan_ip":"--","wan_dev":"--","rx_rate":"0B/s","tx_rate":"0B/s","ping_ms":-1,"ping_ok":false,"eth0_role":"WAN","eth0_up":false,"eth0_speed":"--","eth1_role":"LAN1","eth1_up":false,"eth1_speed":"--","eth2_role":"LAN2","eth2_up":false,"eth2_speed":"--","link_ok":false}`, nil
	case proto.ScopeClients:
		return `{"wifi_24":"0","wifi_5":"0","lan_clients":"0","clients_total":"0 clients","dhcp_leases":"0","dhcp_summary":"no leases","dhcp_pool":150,"dhcp_pct":0}`, nil
	case proto.ScopeStorage:
		return `{"root_usage":"--","root_pct":0,"root_dev":"--","data_kind":"none","data_usage":"--","data_pct":0,"overlay_dev":"--","swap_usage":"off","swap_pct":0}`, nil
	case proto.ScopeWiFi:
		return `{"wifi_ssid":"--","wifi_enc":"--","wifi_ap_state":"down","wifi_qr":""}`, nil
	case proto.ScopeSecurity:
		return `{"firewall_state":"unknown","blocked_24h":"--","vpn_tunnels":"--","blocky_blocked":0,"banip_blocked":0}`, nil
	case proto.ScopeAlarms:
		if demoAlarms {
			return `{"alarms":[{"text":"demo alarm","level":"info"}]}`, nil
		}
		return `{"alarms":[]}`, nil
	default:
		return "", fmt.Errorf("scope unavailable")
	}
}

func (p *Provider) Build(scope proto.Scope) (string, error) {
	if p == nil {
		return demoPayload(scope, false)
	}
	if p.DemoMode {
		return demoPayload(scope, true)
	}
	switch scope {
	case proto.ScopeSystem:
		return marshalJSON(p.collectSystem())
	case proto.ScopeNetwork:
		return marshalJSON(p.collectNetwork())
	case proto.ScopeClients:
		return marshalJSON(p.collectClients())
	case proto.ScopeStorage:
		return marshalJSON(p.collectStorage())
	case proto.ScopeWiFi:
		return marshalJSON(p.collectWiFi())
	case proto.ScopeSecurity:
		return marshalJSON(p.collectSecurity())
	case proto.ScopeAlarms:
		return `{"alarms":[]}`, nil
	default:
		return "", fmt.Errorf("scope unavailable")
	}
}
