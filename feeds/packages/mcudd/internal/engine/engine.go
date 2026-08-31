package engine

import (
	"fmt"
	"strings"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/fifo"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/metrics"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/nav"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/proto"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/session"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/state"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

const helloRepeat = 2 * time.Second

type Logger interface {
	Infof(string, ...any)
	Warnf(string, ...any)
	Debugf(string, ...any)
}

type metricsProvider interface {
	Build(scope proto.Scope) (string, error)
}

// Engine orchestrates RDCP over a line transport.
type Engine struct {
	Cfg       config.Config
	Transport transport.LineTransport
	Nav       *nav.Controller
	Metrics   metricsProvider
	State     state.Writer
	Log       Logger
	Session   session.Session

	BootStatePath string
	VersionReqID  uint
	PingReqID     uint
	Link          state.LinkTest
	lastHello     time.Time

	lineBuf []byte
}

func New(cfg config.Config, tp transport.LineTransport) *Engine {
	return &Engine{
		Cfg:           cfg,
		Transport:     tp,
		Nav:           nav.New(),
		Metrics:       metrics.New(cfg),
		BootStatePath: "/tmp/mcud_state",
	}
}

func (e *Engine) now() time.Time {
	if e.Nav != nil && e.Nav.Clock != nil {
		return e.Nav.Clock.Now()
	}
	return time.Now()
}

func (e *Engine) send(line string) error {
	if e.Cfg.DebugSerial && e.Log != nil {
		e.Log.Debugf("uart tx: %s", line)
	}
	return e.Transport.WriteLine(line)
}

// helloOnVersion re-sends push hello while the panel is still announcing
// evt version (unlinked). Startup hello is easy to miss; without a retry
// the MCU never marks linked and never leaves the boot splash.
func (e *Engine) helloOnVersion() error {
	now := e.now()
	if !e.lastHello.IsZero() && now.Sub(e.lastHello) < helloRepeat {
		return nil
	}
	e.lastHello = now
	if e.Log != nil {
		e.Log.Infof("hello on version evt")
	}
	return e.send(proto.BuildPushHello())
}

func (e *Engine) Startup() error {
	bs := state.ReadBootState(e.BootStatePath)
	out, err := proto.BuildPushBoot(bs.Stage, bs.Message, uint(bs.Pct))
	if err != nil {
		return err
	}
	if err := e.send(out); err != nil {
		return err
	}
	out, _ = proto.BuildPushConfig(e.Cfg.ScreenTimeoutSec, e.Cfg.ScreenTimeoutMode)
	if err := e.send(out); err != nil {
		return err
	}
	if err := e.send(proto.BuildPushHello()); err != nil {
		return err
	}
	e.lastHello = e.now()
	e.VersionReqID++
	out, _ = proto.BuildReqVersion(e.VersionReqID)
	return e.send(out)
}

func (e *Engine) pushBoot() error {
	bs := state.ReadBootState(e.BootStatePath)
	out, err := proto.BuildPushBoot(bs.Stage, bs.Message, uint(bs.Pct))
	if err != nil {
		return err
	}
	return e.send(out)
}

func (e *Engine) ignorePageFIFO(kind string) error {
	if e.Log != nil {
		e.Log.Infof("ignored fifo page cmd %s (mcu owns pages)", kind)
	}
	return nil
}

func (e *Engine) HandleFIFO(line string) error {
	if e.Log != nil {
		e.Log.Infof("fifo: %s", line)
	}
	cmd, ok := fifo.Parse(line)
	if !ok {
		if e.Log != nil {
			e.Log.Infof("ignored fifo: %s", line)
		}
		return nil
	}
	return e.handleCommand(cmd)
}

func (e *Engine) handleCommand(cmd fifo.Command) error {
	switch cmd.Kind {
	case fifo.KindPrev:
		return e.ignorePageFIFO("prev")
	case fifo.KindNext:
		return e.ignorePageFIFO("next")
	case fifo.KindScreen:
		return e.ignorePageFIFO("screen")
	case fifo.KindRefresh:
		return e.ignorePageFIFO("refresh")
	case fifo.KindReady:
		return e.ignorePageFIFO("ready")
	case fifo.KindBoot:
		return e.pushBoot()
	case fifo.KindVersion:
		e.VersionReqID++
		out, _ := proto.BuildReqVersion(e.VersionReqID)
		return e.send(out)
	case fifo.KindPing:
		e.PingReqID++
		e.Session.NotePingSent(e.PingReqID)
		if e.Log != nil {
			e.Log.Infof("req ping id=%d", e.PingReqID)
		}
		out, _ := proto.BuildReqPing(e.PingReqID)
		return e.send(out)
	case fifo.KindEcho:
		e.Session.NoteEchoSent(cmd.Echo)
		if e.Log != nil {
			e.Log.Infof("cmd echo (await echo evt): %s", cmd.Echo)
		}
		out, _ := proto.BuildCmdEcho(cmd.Echo)
		return e.send(out)
	default:
		return nil
	}
}

func (e *Engine) HandleRXLine(line string) error {
	line = strings.TrimSpace(line)
	/* Firmware USB sniff copies host→MCU frames onto GPIO1 as `#rx …`
	 * so a Mac CH340 monitor can see mcudd payloads. Skip those echoes. */
	if line == "" || strings.HasPrefix(line, "#") {
		return nil
	}
	if e.Cfg.DebugSerial && e.Log != nil {
		e.Log.Debugf("uart rx: %s", line)
	}
	msg, err := proto.Parse(line)
	if err != nil {
		if e.Log != nil {
			e.Log.Debugf("ignored line: %v", err)
		}
		return nil
	}
	switch msg.Type {
	case proto.MsgEvtVersion:
		_ = e.State.WriteFirmwareVersion(msg)
		return e.helloOnVersion()
	case proto.MsgResPing:
		if !e.Session.AcceptPong(msg.ReqID) {
			if e.Log != nil {
				e.Log.Debugf("ignored unmatched pong id=%d", msg.ReqID)
			}
			return nil
		}
		e.Link.PingOK = true
		e.Link.PingID = msg.ReqID
		e.Link.UptimeMS = msg.UptimeMS
		return e.State.WriteLinkTest(e.Link)
	case proto.MsgEvtEcho:
		if !e.Session.AcceptEcho(msg.EchoText) {
			if e.Log != nil {
				e.Log.Debugf("ignored unmatched echo")
			}
			return nil
		}
		e.Link.EchoOK = true
		e.Link.EchoText = msg.EchoText
		return e.State.WriteLinkTest(e.Link)
	case proto.MsgEvtScreen:
		if !pages.Known(msg.Screen) {
			if e.Log != nil {
				e.Log.Warnf("unknown screen evt: %s", msg.Screen)
			}
			return nil
		}
		e.Nav.AckScreen(msg.Screen)
		_ = e.State.WriteActiveScreen(msg.Screen)
		if e.Log != nil {
			e.Log.Infof("screen evt ack: %s", msg.Screen)
		}
		if msg.Screen == pages.BootScreen {
			return e.pushBoot()
		}
		return nil
	case proto.MsgReqPoweroff:
		return fmt.Errorf("poweroff requested")
	case proto.MsgLegacyRequest, proto.MsgReq:
		payload, err := e.Metrics.Build(msg.Scope)
		if err != nil {
			payload = `{"error":"scope_unavailable"}`
		}
		out, err := proto.FormatResponse(msg, payload)
		if err != nil {
			return err
		}
		return e.send(out)
	default:
		return nil
	}
}

func (e *Engine) PollOnce() error {
	for {
		b, err := e.Transport.ReadByte()
		if err != nil {
			return err
		}
		if b == '\n' || b == '\r' {
			if len(e.lineBuf) == 0 {
				continue
			}
			line := string(e.lineBuf)
			e.lineBuf = e.lineBuf[:0]
			return e.HandleRXLine(strings.TrimSpace(line))
		}
		if uint(len(e.lineBuf)) >= e.Cfg.MaxLine {
			e.lineBuf = e.lineBuf[:0]
			if e.Log != nil {
				e.Log.Warnf("line exceeded max_line=%d", e.Cfg.MaxLine)
			}
			continue
		}
		e.lineBuf = append(e.lineBuf, b)
	}
}
