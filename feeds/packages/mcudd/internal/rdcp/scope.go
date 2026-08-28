package rdcp

import "github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"

func ScopeName(s Scope) string {
	switch s {
	case ScopeSystem:
		return "system"
	case ScopeNetwork:
		return "network"
	case ScopeStorage:
		return "storage"
	case ScopeAlarms:
		return "alarms"
	case ScopeClients:
		return "clients"
	case ScopeWiFi:
		return "wifi"
	case ScopeSecurity:
		return "security"
	default:
		return ""
	}
}

func ScopeFromName(name string) Scope {
	switch name {
	case "cpu", "system":
		return ScopeSystem
	case "network":
		return ScopeNetwork
	case "storage":
		return ScopeStorage
	case "alarms":
		return ScopeAlarms
	case "clients":
		return ScopeClients
	case "wifi":
		return ScopeWiFi
	case "security":
		return ScopeSecurity
	default:
		return ScopeNone
	}
}

func ScopeFromScreen(screenID string) Scope {
	switch screenID {
	case "router_network":
		return ScopeNetwork
	case "router_clients":
		return ScopeClients
	case "router_storage":
		return ScopeStorage
	case "router_wifi":
		return ScopeWiFi
	case "router_security":
		return ScopeSecurity
	case pages.BootScreen, "router_system":
		return ScopeSystem
	default:
		return ScopeSystem
	}
}
