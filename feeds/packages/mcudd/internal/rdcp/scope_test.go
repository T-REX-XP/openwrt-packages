package rdcp

import "testing"

func TestScopeHelpersFull(t *testing.T) {
	names := map[Scope]string{
		ScopeSystem: "system", ScopeNetwork: "network", ScopeStorage: "storage",
		ScopeAlarms: "alarms", ScopeClients: "clients", ScopeWiFi: "wifi", ScopeSecurity: "security",
	}
	for s, want := range names {
		if ScopeName(s) != want {
			t.Fatalf("%v", s)
		}
	}
	inputs := map[string]Scope{
		"cpu": ScopeSystem, "system": ScopeSystem, "network": ScopeNetwork,
		"storage": ScopeStorage, "alarms": ScopeAlarms, "clients": ScopeClients,
		"wifi": ScopeWiFi, "security": ScopeSecurity,
	}
	for in, want := range inputs {
		if ScopeFromName(in) != want {
			t.Fatalf("%s", in)
		}
	}
	screens := map[string]Scope{
		"router_network": ScopeNetwork, "router_clients": ScopeClients,
		"router_storage": ScopeStorage, "router_wifi": ScopeWiFi,
		"router_security": ScopeSecurity, "router_boot": ScopeSystem,
		"router_system": ScopeSystem, "other": ScopeSystem,
	}
	for id, want := range screens {
		if ScopeFromScreen(id) != want {
			t.Fatalf("%s", id)
		}
	}
}
