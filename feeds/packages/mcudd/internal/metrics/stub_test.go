package metrics

import (
	"testing"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/rdcp"
)

func TestStubAllScopes(t *testing.T) {
	p := Provider{DemoMode: true}
	scopes := []rdcp.Scope{
		rdcp.ScopeSystem, rdcp.ScopeNetwork, rdcp.ScopeClients, rdcp.ScopeStorage,
		rdcp.ScopeWiFi, rdcp.ScopeSecurity, rdcp.ScopeAlarms,
	}
	for _, s := range scopes {
		out, err := p.Build(s)
		if err != nil || out == "" {
			t.Fatalf("scope %v: %v %q", s, err, out)
		}
	}
	p.DemoMode = false
	out, err := p.Build(rdcp.ScopeAlarms)
	if err != nil || out != "[]" {
		t.Fatalf("alarms off: %q %v", out, err)
	}
	if _, err := p.Build(rdcp.ScopeNone); err == nil {
		t.Fatal("expected error")
	}
}
