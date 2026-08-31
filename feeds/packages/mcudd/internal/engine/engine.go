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

const MaxLeaveBootAttempts = 3

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

	BootStatePath     string
	VersionReqID      uint
	PingReqID         uint
	Link              state.LinkTest
	LeaveBootAttempts int
	leaveBootGaveUp   bool

	lineBuf []byte
}

func New(cfg config.Config, tp transport.LineTransport) *Engine {
	return &Engine{
		Cfg:           cfg,
		Transport:     tp,
		Nav:           nav.New(),
		Metrics:       metrics.Provider{DemoMode: cfg.DemoMode},
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
	e.VersionReqID++
	out, _ = proto.BuildReqVersion(e.VersionReqID)
	if err := e.send(out); err != nil {
		return err
	}
	return e.LeaveBoot()
}

func (e *Engine) LeaveBoot() error {
	bs := state.ReadBootState(e.BootStatePath)
	if !bs.Ready() || e.Nav.ActiveScreen != pages.BootScreen {
		return nil
	}
	if e.LeaveBootAttempts >= MaxLeaveBootAttempts {
		if e.Log != nil && !e.leaveBootGaveUp {
			e.Log.Warnf("leave-boot capped after %d attempts", MaxLeaveBootAttempts)
			e.leaveBootGaveUp = true
		}
		return nil
	}
	if err := e.pushBoot(); err != nil && e.Log != nil {
		e.Log.Warnf("leave boot push failed: %v", err)
	}
	e.LeaveBootAttempts++
	return e.SendScreen(pages.Ring[0], "left")
}

func (e *Engine) pushBoot() error {
	bs := state.ReadBootState(e.BootStatePath)
	out, err := proto.BuildPushBoot(bs.Stage, bs.Message, uint(bs.Pct))
	if err != nil {
		return err
	}
	return e.send(out)
}

func (e *Engine) logRateLimit(screenID string, now time.Time) {
	if e.Log == nil {
		return
	}
	reason := "interval"
	if e.Nav.Pending {
		age := now.Sub(e.Nav.LastTX)
		reason = fmt.Sprintf("pending=%s age=%dms", e.Nav.PendingScreen, age.Milliseconds())
	}
	e.Log.Infof("rate-limit cmd screen %s (%s)", screenID, reason)
}

func (e *Engine) txScreen(screenID, dir string, now time.Time) error {
	out, err := proto.BuildCmdScreenDir(screenID, dir)
	if err != nil {
		return err
	}
	if err := e.send(out); err != nil {
		return err
	}
	e.Nav.MarkSent(screenID, now)
	if e.Log != nil {
		e.Log.Infof("cmd screen %s (await screen evt)", screenID)
	}
	return nil
}

func (e *Engine) SendScreen(screenID, dir string) error {
	now := e.now()
	if !e.Nav.Allow(now) {
		e.logRateLimit(screenID, now)
		return nil
	}
	return e.txScreen(screenID, dir, now)
}

// sendUserScreen is LuCI/FIFO next/prev/goto: walk the ring without waiting
// for evt screen, and update the sidecar so the UI matches the command.
func (e *Engine) sendUserScreen(screenID, dir string) error {
	now := e.now()
	if !e.Nav.AllowUserNav(now) {
		e.logRateLimit(screenID, now)
		return nil
	}
	if err := e.txScreen(screenID, dir, now); err != nil {
		return err
	}
	e.Nav.MarkCommanded(screenID)
	_ = e.State.WriteActiveScreen(screenID)
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
		return e.navCommand("prev", "right")
	case fifo.KindNext:
		return e.navCommand("next", "left")
	case fifo.KindBoot:
		return e.pushBoot()
	case fifo.KindReady:
		return e.LeaveBoot()
	case fifo.KindScreen:
		return e.sendUserScreen(cmd.Screen, "left")
	case fifo.KindRefresh:
		if e.Nav.Cursor() == pages.BootScreen {
			return e.LeaveBoot()
		}
		return e.sendUserScreen(e.Nav.Cursor(), "left")
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

func (e *Engine) navCommand(cmd, animDir string) error {
	target := pages.Neighbor(e.Nav.Cursor(), animDir)
	if e.Log != nil {
		e.Log.Infof("nav %s -> %s", cmd, target)
	}
	return e.sendUserScreen(target, animDir)
}

func (e *Engine) HandleRXLine(line string) error {
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
		return e.State.WriteFirmwareVersion(msg)
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
	case proto.MsgEvtInput:
		from := e.Nav.Cursor()
		target := pages.Neighbor(from, msg.GestureDir)
		if e.Log != nil {
			e.Log.Infof("gesture %s: %s -> %s", msg.GestureDir, from, target)
		}
		// Firmware already applied the page locally and will emit evt screen.
		// Do not echo cmd screen — a stale host cursor yanks the panel.
		if pages.Known(target) {
			e.Nav.MarkCommanded(target)
			e.Nav.ClearPending()
			_ = e.State.WriteActiveScreen(target)
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
