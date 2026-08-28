package daemon

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/nav"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/state"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

type testClock struct{ t time.Time }

func (c testClock) Now() time.Time { return c.t }

func newTestEngine(t *testing.T) (*Engine, *transport.Buffer) {
	t.Helper()
	dir := t.TempDir()
	tp := &transport.Buffer{}
	start := time.Unix(100, 0)
	e := New(config.Default(), tp)
	e.State = state.Writer{Dir: dir}
	e.Nav.Clock = testClock{t: start}
	e.BootStatePath = filepath.Join(dir, "boot")
	if err := os.WriteFile(e.BootStatePath, []byte("stage=ready\nmessage=OK\npct=100\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return e, tp
}

func TestEngineStartupAndNav(t *testing.T) {
	e, tp := newTestEngine(t)
	if err := e.Startup(); err != nil {
		t.Fatal(err)
	}
	if len(tp.TX) < 4 {
		t.Fatalf("startup tx: %d", len(tp.TX))
	}
	if e.Nav.ActiveScreen != pages.BootScreen {
		t.Fatal("still boot until ack")
	}
	_ = e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_system"}}`)
	if e.Nav.ActiveScreen != "router_system" {
		t.Fatal("acked system")
	}
	if err := e.HandleFIFO("next"); err != nil {
		t.Fatal(err)
	}
	if len(tp.TX) == 0 {
		t.Fatal("expected screen cmd")
	}
	_ = e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_network"}}`)
	if err := e.HandleFIFO("screen router_wifi"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleFIFO("prev"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleFIFO("boot"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleFIFO("ready"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleFIFO("refresh"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleFIFO("version"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleFIFO("ping"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleFIFO("echo test"); err != nil {
		t.Fatal(err)
	}
	_ = e.HandleFIFO("ignored")
}

func TestEngineRXPaths(t *testing.T) {
	e, tp := newTestEngine(t)
	e.Startup()
	tp.RX = nil
	tp.TX = nil
	metricsLine := `{"v":1,"t":"req","id":9,"op":"metrics","scope":"system"}`
	if err := e.HandleRXLine(metricsLine); err != nil {
		t.Fatal(err)
	}
	if len(tp.TX) != 1 {
		t.Fatal("metrics res")
	}
	ver := `{"v":1,"t":"evt","op":"version","data":{"stack":"1.0.0","release":44,"component":"esp32-router","rdcp":1}}`
	if err := e.HandleRXLine(ver); err != nil {
		t.Fatal(err)
	}
	pong := `{"v":1,"t":"res","id":1,"data":{"pong":true,"uptime_ms":50}}`
	if err := e.HandleRXLine(pong); err != nil {
		t.Fatal(err)
	}
	echo := `{"v":1,"t":"evt","op":"echo","data":{"text":"test"}}`
	if err := e.HandleRXLine(echo); err != nil {
		t.Fatal(err)
	}
	swipe := `{"v":1,"t":"evt","op":"input","data":{"type":"gesture","dir":"left"}}`
	if err := e.HandleRXLine(swipe); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleRXLine(`{"request":"cpu"}`); err != nil {
		t.Fatal(err)
	}
	_ = e.HandleRXLine("not json")
	_ = e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"bad"}}`)
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_boot"}}`); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleRXLine(`{"v":1,"t":"req","op":"poweroff"}`); err == nil {
		t.Fatal("poweroff")
	}
}

func TestPollOnce(t *testing.T) {
	e, tp := newTestEngine(t)
	tp.PushLine(`{"v":1,"t":"req","id":1,"op":"metrics","scope":"wifi"}`)
	if err := e.PollOnce(); err != nil {
		t.Fatal(err)
	}
	e.Cfg.MaxLine = 4
	tp.PushLine("123456789")
	_ = e.PollOnce()
}

func TestRateLimit(t *testing.T) {
	e, _ := newTestEngine(t)
	start := time.Unix(200, 0)
	e.Nav.Clock = testClock{t: start}
	e.Nav.ActiveScreen = "router_system"
	e.Nav.MarkSent("router_network", start)
	if err := e.HandleFIFO("next"); err != nil {
		t.Fatal(err)
	}
}

func TestLeaveBootNotReady(t *testing.T) {
	e, _ := newTestEngine(t)
	e.BootStatePath = filepath.Join(t.TempDir(), "missing")
	if err := e.LeaveBoot(); err != nil {
		t.Fatal(err)
	}
}

func TestEngineDebugAndErrors(t *testing.T) {
	e, tp := newTestEngine(t)
	e.Cfg.DebugSerial = true
	e.Log = testLogger{}
	if err := e.SendScreen("", "left"); err == nil {
		t.Fatal("empty screen")
	}
	if err := e.HandleFIFO("screen bad"); err != nil {
		t.Fatal(err)
	}
	e.Nav.AckScreen("router_system")
	e.Nav.LastTX = time.Time{}
	e.Nav.Pending = false
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"input","data":{"type":"gesture","dir":"right"}}`); err != nil {
		t.Fatal(err)
	}
	if len(tp.TX) == 0 {
		t.Fatal("expected tx")
	}
}

type testLogger struct{}

func (testLogger) Infof(string, ...any)  {}
func (testLogger) Warnf(string, ...any)  {}
func (testLogger) Debugf(string, ...any) {}

func TestEngineLeaveBootActive(t *testing.T) {
	e, _ := newTestEngine(t)
	e.Nav.AckScreen("router_system")
	if err := e.LeaveBoot(); err != nil {
		t.Fatal(err)
	}
}

func TestEngineRefreshBoot(t *testing.T) {
	e, tp := newTestEngine(t)
	e.Nav.ActiveScreen = pages.BootScreen
	if err := e.HandleFIFO("refresh"); err != nil {
		t.Fatal(err)
	}
	if len(tp.TX) == 0 {
		t.Fatal("leave boot refresh")
	}
}

func TestEngineMetricsUnavailable(t *testing.T) {
	e, tp := newTestEngine(t)
	_ = e.HandleRXLine(`{"v":1,"t":"req","id":1,"op":"metrics","scope":"system"}`)
	if len(tp.TX) != 1 {
		t.Fatal(tp.TX)
	}
}

func TestNavNilClock(t *testing.T) {
	e, _ := newTestEngine(t)
	e.Nav = nav.New()
	e.Nav.Clock = nil
	_ = e.now()
}
