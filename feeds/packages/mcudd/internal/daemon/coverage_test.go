package daemon

import (
	"errors"
	"testing"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/rdcp"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

type failWriter struct{ transport.Buffer }

func (f *failWriter) WriteLine(string) error { return errors.New("tx fail") }

type seqFailWriter struct {
	transport.Buffer
	failAfter int
	n         int
}

func (s *seqFailWriter) WriteLine(line string) error {
	s.n++
	if s.n > s.failAfter {
		return errors.New("tx fail")
	}
	return s.Buffer.WriteLine(line)
}

type failMetrics struct{}

func (failMetrics) Build(rdcp.Scope) (string, error) { return "", errors.New("fail") }

func TestStartupWriteFail(t *testing.T) {
	e := New(config.Default(), &failWriter{})
	if err := e.Startup(); err == nil {
		t.Fatal("expected startup fail")
	}
}

func TestStartupPartialAndLeaveBootWarn(t *testing.T) {
	e, _ := newTestEngine(t)
	e.Transport = &seqFailWriter{failAfter: 1}
	if err := e.Startup(); err == nil {
		t.Fatal("config push should fail startup")
	}
	e2, _ := newTestEngine(t)
	e2.Transport = &failWriter{}
	e2.Nav.ActiveScreen = pages.BootScreen
	_ = e2.LeaveBoot()
}

func TestSendScreenWriteFail(t *testing.T) {
	e, _ := newTestEngine(t)
	e.Transport = &failWriter{}
	if err := e.SendScreen("router_system", "left"); err == nil {
		t.Fatal("expected tx fail")
	}
}

func TestPollOnceCRLF(t *testing.T) {
	e, tp := newTestEngine(t)
	tp.RX = []byte("\r\n")
	for len(tp.RX) > 0 {
		_, _ = tp.ReadByte()
	}
	tp.PushLine("x")
	if err := e.PollOnce(); err != nil {
		t.Fatal(err)
	}
}

func TestMetricsBuildFail(t *testing.T) {
	e, tp := newTestEngine(t)
	e.Metrics = failMetrics{}
	_ = e.HandleRXLine(`{"v":1,"t":"req","id":1,"op":"metrics","scope":"system"}`)
	if len(tp.TX) != 1 {
		t.Fatal(tp.TX)
	}
}

func TestNilLoggerPaths(t *testing.T) {
	e, _ := newTestEngine(t)
	e.Log = nil
	e.Cfg.DebugSerial = true
	_ = e.HandleRXLine("bad")
	_ = e.HandleFIFO("noop")
	e.Nav.ActiveScreen = pages.BootScreen
	e.Transport = &failWriter{}
	_ = e.LeaveBoot()
}
