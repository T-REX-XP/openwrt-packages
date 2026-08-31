package engine

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/fifo"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/proto"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/state"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/version"
)

type memLog struct{ lines []string }

func (l *memLog) Infof(f string, a ...any)  { l.lines = append(l.lines, sprintf(f, a...)) }
func (l *memLog) Warnf(f string, a ...any)  { l.lines = append(l.lines, sprintf(f, a...)) }
func (l *memLog) Debugf(f string, a ...any) { l.lines = append(l.lines, sprintf(f, a...)) }

func sprintf(f string, a ...any) string {
	return strings.TrimSpace(strings.ReplaceAll(
		// cheap; tests only check substrings
		func() string {
			if len(a) == 0 {
				return f
			}
			return f + ":" + strings.Join(stringify(a), ",")
		}(), "%s", "x"))
}

func stringify(a []any) []string {
	out := make([]string, len(a))
	for i, v := range a {
		out[i] = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(
			strings.ReplaceAll("%v", "%v", ""), "", ""), "", ""))
		_ = v
		out[i] = "x"
	}
	return out
}

type fixedClock struct{ t time.Time }

func (f *fixedClock) Now() time.Time { return f.t }

type failTP struct {
	err error
	n   int
}

func (f *failTP) WriteLine(string) error {
	f.n++
	return f.err
}
func (f *failTP) ReadByte() (byte, error) { return 0, io.EOF }
func (f *failTP) Close() error            { return nil }

type stubMetrics struct {
	payload string
	err     error
}

func (s stubMetrics) Build(proto.Scope) (string, error) { return s.payload, s.err }

func readyBoot(t *testing.T) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "mcud_state")
	if err := os.WriteFile(p, []byte("stage=ready\nmessage=System ready\npct=100\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func newTestEngine(t *testing.T) (*Engine, *transport.Buffer, *memLog) {
	t.Helper()
	buf := &transport.Buffer{}
	cfg := config.Default()
	cfg.DebugSerial = true
	e := New(cfg, buf)
	e.BootStatePath = readyBoot(t)
	e.State = state.Writer{Dir: t.TempDir()}
	log := &memLog{}
	e.Log = log
	clk := &fixedClock{t: time.Unix(1000, 0)}
	e.Nav.Clock = clk
	return e, buf, log
}

func TestStartupNoScreenCmd(t *testing.T) {
	e, buf, _ := newTestEngine(t)
	if err := e.Startup(); err != nil {
		t.Fatal(err)
	}
	if len(buf.TX) != 4 {
		t.Fatalf("tx=%v", buf.TX)
	}
	joined := strings.Join(buf.TX, "\n")
	if !strings.Contains(joined, `"op":"boot"`) || !strings.Contains(joined, `"op":"hello"`) {
		t.Fatal(joined)
	}
	if strings.Contains(joined, `"op":"screen"`) {
		t.Fatal("host must not send cmd screen")
	}
}

func TestHandleFIFO(t *testing.T) {
	e, buf, _ := newTestEngine(t)
	e.Nav.AckScreen("router_system")
	cmds := []string{"prev", "next", "boot", "ready", "screen router_wifi", "refresh", "version", "ping", "echo hi", "noop", ""}
	for _, c := range cmds {
		e.Nav.ClearPending()
		e.Nav.LastTX = time.Time{}
		if err := e.HandleFIFO(c); err != nil {
			t.Fatalf("%s: %v", c, err)
		}
	}
	e.Nav.AckScreen(pages.BootScreen)
	e.Nav.ClearPending()
	e.Nav.LastTX = time.Time{}
	if err := e.HandleFIFO("refresh"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleFIFO("net"); err != nil {
		t.Fatal(err)
	}
	if len(buf.TX) == 0 {
		t.Fatal("expected tx")
	}
	_ = fifo.KindUnknown
}

func TestHandleRXLineUSBSniffComment(t *testing.T) {
	e, buf, _ := newTestEngine(t)
	echo := `#rx {"v":1,"t":"evt","op":"version","data":{"stack":"1.0.0","release":47,"component":"esp32-router","rdcp":1}}`
	if err := e.HandleRXLine(echo); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleRXLine(""); err != nil {
		t.Fatal(err)
	}
	if len(buf.TX) != 0 {
		t.Fatalf("USB sniff echo must not be parsed as RDCP: %v", buf.TX)
	}
}

func TestHandleRXLine(t *testing.T) {
	e, buf, _ := newTestEngine(t)
	e.Nav.AckScreen("router_system")
	if err := e.HandleRXLine("not-json"); err != nil {
		t.Fatal(err)
	}
	ver := `{"v":1,"t":"evt","op":"version","data":{"stack":"` + version.Stack + `","release":` +
		strings.TrimPrefix(version.String(), "1.0.0+") + `,"component":"esp32-router","rdcp":1}}`
	// build version line properly
	ver = `{"v":1,"t":"evt","op":"version","data":{"stack":"1.0.0","release":47,"component":"esp32-router","rdcp":1}}`
	if err := e.HandleRXLine(ver); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleFIFO("ping"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleRXLine(`{"v":1,"t":"res","id":99,"data":{"pong":1,"uptime_ms":1}}`); err != nil {
		t.Fatal(err)
	}
	if e.Link.PingOK {
		t.Fatal("unmatched pong")
	}
	if err := e.HandleRXLine(`{"v":1,"t":"res","id":1,"data":{"pong":1,"uptime_ms":9}}`); err != nil {
		t.Fatal(err)
	}
	if !e.Link.PingOK {
		t.Fatal("matched pong")
	}
	if err := e.HandleFIFO("echo hi"); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"echo","data":{"text":"nope"}}`); err != nil {
		t.Fatal(err)
	}
	if e.Link.EchoOK {
		t.Fatal("unmatched echo")
	}
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"echo","data":{"text":"hi"}}`); err != nil {
		t.Fatal(err)
	}
	if !e.Link.EchoOK {
		t.Fatal("matched echo")
	}
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"nope"}}`); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_network"}}`); err != nil {
		t.Fatal(err)
	}
	if e.Nav.ActiveScreen != "router_network" {
		t.Fatal(e.Nav.ActiveScreen)
	}
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_boot"}}`); err != nil {
		t.Fatal(err)
	}
	e.Nav.ClearPending()
	e.Nav.LastTX = time.Time{}
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_system","action":"loaded"}}`); err != nil {
		t.Fatal(err)
	}
	if e.Nav.Cursor() != "router_system" {
		t.Fatal(e.Nav.Cursor())
	}
	if err := e.HandleRXLine(`{"v":1,"t":"req","id":3,"op":"metrics","scope":"system"}`); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleRXLine(`{"request":"cpu"}`); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleRXLine(`{"v":1,"t":"push","op":"hello"}`); err != nil {
		t.Fatal(err)
	}
	if err := e.HandleRXLine(`{"v":1,"t":"req","op":"poweroff"}`); err == nil {
		t.Fatal("poweroff")
	}
	e.Metrics = stubMetrics{err: errors.New("no")}
	if err := e.HandleRXLine(`{"v":1,"t":"req","id":4,"op":"metrics","scope":"system"}`); err != nil {
		t.Fatal(err)
	}
	e.Metrics = stubMetrics{payload: "[]"}
	if err := e.HandleRXLine(`{"v":1,"t":"req","id":5,"op":"metrics","scope":"system"}`); err == nil {
		t.Fatal("bad payload")
	}
	_ = buf
}

func TestHelloOnVersionEvt(t *testing.T) {
	e, buf, _ := newTestEngine(t)
	clk := e.Nav.Clock.(*fixedClock)
	ver := `{"v":1,"t":"evt","op":"version","data":{"stack":"1.0.0","release":47,"component":"esp32-router","rdcp":1}}`
	if err := e.HandleRXLine(ver); err != nil {
		t.Fatal(err)
	}
	n := len(buf.TX)
	if n == 0 || !strings.Contains(buf.TX[n-1], `"op":"hello"`) {
		t.Fatalf("expected hello, tx=%v", buf.TX)
	}
	if err := e.HandleRXLine(ver); err != nil {
		t.Fatal(err)
	}
	if len(buf.TX) != n {
		t.Fatal("hello must rate-limit")
	}
	clk.t = clk.t.Add(helloRepeat)
	if err := e.HandleRXLine(ver); err != nil {
		t.Fatal(err)
	}
	if len(buf.TX) != n+1 {
		t.Fatalf("expected retry hello, tx=%v", buf.TX)
	}
}

func TestPollOnce(t *testing.T) {
	e, buf, _ := newTestEngine(t)
	if err := e.PollOnce(); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
	buf.RX = []byte("\n\r")
	if err := e.PollOnce(); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
	buf.PushLine(`{"v":1,"t":"push","op":"hello"}`)
	if err := e.PollOnce(); err != nil {
		t.Fatal(err)
	}
	e.Cfg.MaxLine = 4
	buf.RX = []byte("12345\n")
	if err := e.PollOnce(); !errors.Is(err, io.EOF) {
		t.Fatal(err)
	}
}

type nthFail struct {
	failAt int
	n      int
}

func (f *nthFail) WriteLine(string) error {
	f.n++
	if f.n >= f.failAt {
		return errors.New("tx")
	}
	return nil
}
func (f *nthFail) ReadByte() (byte, error) { return 0, io.EOF }
func (f *nthFail) Close() error            { return nil }

func TestStartupSendFailures(t *testing.T) {
	cfg := config.Default()
	for i := 1; i <= 4; i++ {
		e := New(cfg, &nthFail{failAt: i})
		e.BootStatePath = readyBoot(t)
		e.Log = &memLog{}
		if err := e.Startup(); err == nil {
			t.Fatalf("expected fail at write %d", i)
		}
	}
	e := New(cfg, &failTP{err: errors.New("tx")})
	e.BootStatePath = readyBoot(t)
	_ = e.now()
	e2 := New(cfg, &failTP{err: errors.New("tx")})
	e2.BootStatePath = readyBoot(t)
	e2.Log = nil
	if err := e2.HandleFIFO("next"); err != nil {
		t.Fatal(err)
	}
}

func TestStartupEmptyBootFields(t *testing.T) {
	e, _, _ := newTestEngine(t)
	p := filepath.Join(t.TempDir(), "st")
	if err := os.WriteFile(p, []byte("stage=\nmessage=\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	e.BootStatePath = p
	if err := e.Startup(); err == nil {
		t.Fatal("expected empty boot")
	}
}

func TestDispatchUnknownFIFO(t *testing.T) {
	e, _, _ := newTestEngine(t)
	if err := e.handleCommand(fifo.Command{Kind: fifo.KindUnknown}); err != nil {
		t.Fatal(err)
	}
	if err := e.handleCommand(fifo.Command{Kind: 99}); err != nil {
		t.Fatal(err)
	}
}

func TestPushBootEmptyStage(t *testing.T) {
	e, _, _ := newTestEngine(t)
	p := filepath.Join(t.TempDir(), "st")
	if err := os.WriteFile(p, []byte("stage=\nmessage=\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	e.BootStatePath = p
	if err := e.pushBoot(); err == nil {
		t.Fatal("expected empty boot fields")
	}
}

func TestFIFOPageCmdsIgnored(t *testing.T) {
	e, buf, log := newTestEngine(t)
	n := len(buf.TX)
	for _, c := range []string{"next", "prev", "screen router_wifi", "refresh", "ready"} {
		if err := e.HandleFIFO(c); err != nil {
			t.Fatal(err)
		}
	}
	if len(buf.TX) != n {
		t.Fatalf("page fifo must not TX: %v", buf.TX[n:])
	}
	if e.Nav.Cursor() != pages.BootScreen {
		t.Fatal(e.Nav.Cursor())
	}
	joined := strings.Join(log.lines, "\n")
	if !strings.Contains(joined, "mcu owns pages") {
		t.Fatal(joined)
	}
}

func TestEvtScreenWritesSidecar(t *testing.T) {
	e, _, _ := newTestEngine(t)
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_clients","action":"loaded"}}`); err != nil {
		t.Fatal(err)
	}
	if e.Nav.ActiveScreen != "router_clients" {
		t.Fatal(e.Nav.ActiveScreen)
	}
	data, err := os.ReadFile(filepath.Join(e.State.Dir, "mcud_active_screen"))
	if err != nil || strings.TrimSpace(string(data)) != "router_clients" {
		t.Fatalf("sidecar=%q err=%v", data, err)
	}
}

func TestEvtScreenAdoptsWhilePending(t *testing.T) {
	e, buf, _ := newTestEngine(t)
	e.Nav.AckScreen("router_wifi")
	e.Nav.MarkSent("router_system", e.now())
	nTX := len(buf.TX)
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_clients","action":"loaded"}}`); err != nil {
		t.Fatal(err)
	}
	if e.Nav.ActiveScreen != "router_clients" {
		t.Fatal(e.Nav.ActiveScreen)
	}
	data, err := os.ReadFile(filepath.Join(e.State.Dir, "mcud_active_screen"))
	if err != nil || strings.TrimSpace(string(data)) != "router_clients" {
		t.Fatalf("sidecar=%q err=%v", data, err)
	}
	if e.Nav.Pending {
		t.Fatal("pending must clear on any known evt screen")
	}
	if len(buf.TX) != nTX {
		t.Fatalf("swipe evt screen must not TX cmd: %v", buf.TX[nTX:])
	}
}

func TestEvtInputIgnored(t *testing.T) {
	e, buf, _ := newTestEngine(t)
	e.Nav.AckScreen("router_wifi")
	nTX := len(buf.TX)
	if err := e.HandleRXLine(`{"v":1,"t":"evt","op":"input","data":{"type":"gesture","dir":"left"}}`); err != nil {
		t.Fatal(err)
	}
	if e.Nav.ActiveScreen != "router_wifi" {
		t.Fatal("gesture evt must not move sidecar")
	}
	if len(buf.TX) != nTX {
		t.Fatalf("ignored input must not TX: %v", buf.TX[nTX:])
	}
}

func TestSendUserScreenErrorsAndRefresh(t *testing.T) {
	e := New(config.Default(), &failTP{err: errors.New("tx")})
	e.Log = &memLog{}
	if err := e.HandleFIFO("next"); err != nil {
		t.Fatal(err)
	}
	e2, _, _ := newTestEngine(t)
	e2.Log = nil
	e2.Nav.AckScreen("router_wifi")
	if err := e2.HandleFIFO("refresh"); err != nil {
		t.Fatal(err)
	}
	if e2.Nav.Cursor() != "router_wifi" {
		t.Fatal(e2.Nav.Cursor())
	}
}

func TestHandleFIFOSendErrors(t *testing.T) {
	e := New(config.Default(), &failTP{err: errors.New("tx")})
	e.Log = &memLog{}
	e.BootStatePath = readyBoot(t)
	if err := e.HandleFIFO("version"); err == nil {
		t.Fatal("version")
	}
	if err := e.HandleFIFO("ping"); err == nil {
		t.Fatal("ping")
	}
	if err := e.HandleFIFO("echo hi"); err == nil {
		t.Fatal("echo")
	}
	if err := e.HandleFIFO("boot"); err == nil {
		t.Fatal("boot")
	}
}

func TestNewDefaults(t *testing.T) {
	e := New(config.Default(), &transport.Buffer{})
	if e.Nav == nil || e.BootStatePath != "/tmp/mcud_state" {
		t.Fatal("defaults")
	}
	e.Nav.Clock = nil
	if e.now().IsZero() {
		t.Fatal("real clock")
	}
}
