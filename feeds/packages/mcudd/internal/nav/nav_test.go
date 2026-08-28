package nav

import (
	"testing"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
)

type fixedClock struct{ t time.Time }

func (f fixedClock) Now() time.Time { return f.t }

func TestNavController(t *testing.T) {
	start := time.Unix(0, 0)
	c := New()
	c.Clock = fixedClock{t: start}
	if c.ActiveScreen != pages.BootScreen {
		t.Fatal("boot default")
	}
	if !c.Allow(start) {
		t.Fatal("should allow initially")
	}
	c.MarkSent("router_system", start)
	if c.Allow(start) {
		t.Fatal("pending blocks")
	}
	c.AckScreen("router_system")
	if c.ActiveScreen != "router_system" || c.Pending {
		t.Fatal("ack")
	}
	c.MarkSent("router_network", start)
	c.ClearPending()
	if c.Pending {
		t.Fatal("cleared")
	}
	c.MarkSent("router_wifi", start)
	if !c.Pending {
		t.Fatal("pending")
	}
	late := start.Add(AckTimeout + time.Millisecond)
	if c.Busy(late) {
		t.Fatal("timeout should clear pending")
	}
	if c.Pending {
		t.Fatal("cleared after timeout")
	}
	c.LastTX = start
	if !c.Busy(start.Add(MinInterval / 2)) {
		t.Fatal("interval block")
	}
	if !c.Allow(start.Add(MinInterval + time.Millisecond)) {
		t.Fatal("interval elapsed")
	}
	c.MarkSent("unknown", start)
	if c.Pending {
		t.Fatal("unknown screen should not pending")
	}
}

func TestRealClock(t *testing.T) {
	c := New()
	_ = c.Clock.Now()
}
