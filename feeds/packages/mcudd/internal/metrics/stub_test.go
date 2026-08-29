package metrics

import (
	"testing"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/proto"
)

func TestStubAllScopes(t *testing.T) {
	p := Provider{DemoMode: true}
	scopes := []proto.Scope{
		proto.ScopeSystem, proto.ScopeNetwork, proto.ScopeClients, proto.ScopeStorage,
		proto.ScopeWiFi, proto.ScopeSecurity, proto.ScopeAlarms,
	}
	for _, s := range scopes {
		out, err := p.Build(s)
		if err != nil || out == "" || out[0] != '{' {
			t.Fatalf("scope %v: %v %q", s, err, out)
		}
	}
	p.DemoMode = false
	out, err := p.Build(proto.ScopeAlarms)
	if err != nil || out != `{"alarms":[]}` {
		t.Fatalf("alarms off: %q %v", out, err)
	}
	if _, err := p.Build(proto.ScopeNone); err == nil {
		t.Fatal("expected error")
	}
}
