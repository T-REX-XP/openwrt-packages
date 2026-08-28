package metrics

import (
	"fmt"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/rdcp"
)

// Provider returns JSON object payloads for RDCP metric scopes (POC: minimal stubs).
type Provider struct {
	DemoMode bool
}

func (p Provider) Build(scope rdcp.Scope) (string, error) {
	switch scope {
	case rdcp.ScopeSystem:
		return `{"hostname":"Router","cpu":"0","ram_pct":0,"uptime_short":"--"}`, nil
	case rdcp.ScopeNetwork:
		return `{"wan_ip":"--","wan_dev":"--","rx_rate":"0B/s","tx_rate":"0B/s","ping_ms":-1,"ping_ok":false,"eth0_role":"WAN","eth0_up":false,"eth0_speed":"--","eth1_role":"LAN1","eth1_up":false,"eth1_speed":"--","eth2_role":"LAN2","eth2_up":false,"eth2_speed":"--","link_ok":false}`, nil
	case rdcp.ScopeClients:
		return `{"wifi_24":"0","wifi_5":"0","lan_clients":"0","clients_total":"0 clients","dhcp_leases":"0","dhcp_pool":150,"dhcp_pct":0}`, nil
	case rdcp.ScopeStorage:
		return `{"root_usage":"--","root_pct":0,"root_dev":"--","data_kind":"none","data_usage":"--","data_pct":0,"swap_usage":"off","swap_pct":0}`, nil
	case rdcp.ScopeWiFi:
		return `{"wifi_ssid":"--","wifi_enc":"--","wifi_ap_state":"down","wifi_qr":""}`, nil
	case rdcp.ScopeSecurity:
		return `{"firewall_state":"unknown","blocked_24h":"--","vpn_state":"--"}`, nil
	case rdcp.ScopeAlarms:
		if p.DemoMode {
			return `[{"text":"demo alarm","level":"info"}]`, nil
		}
		return `[]`, nil
	default:
		return "", fmt.Errorf("scope unavailable")
	}
}
