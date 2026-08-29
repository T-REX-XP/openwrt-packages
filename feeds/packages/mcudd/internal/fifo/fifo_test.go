package fifo

import "testing"

func TestParse(t *testing.T) {
	cases := []struct {
		in   string
		kind Kind
		ok   bool
	}{
		{"next", KindNext, true},
		{"prev", KindPrev, true},
		{"boot", KindBoot, true},
		{"ready", KindReady, true},
		{"version", KindVersion, true},
		{"ping", KindPing, true},
		{"net", KindRefresh, true},
		{"refresh", KindRefresh, true},
		{"screen router_wifi", KindScreen, true},
		{"echo hi", KindEcho, true},
		{"screen bad", KindUnknown, false},
		{"echo ", KindUnknown, false},
		{"", KindUnknown, false},
		{"noop", KindUnknown, false},
	}
	for _, tc := range cases {
		cmd, ok := Parse(tc.in)
		if ok != tc.ok || (ok && cmd.Kind != tc.kind) {
			t.Fatalf("%q => %+v %v want ok=%v kind=%v", tc.in, cmd, ok, tc.ok, tc.kind)
		}
	}
}
