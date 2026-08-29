package daemon

import (
	"fmt"
	"strings"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/fifo"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/metrics"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/nav"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/pages"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/rdcp"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/state"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/transport"
)

type Logger interface {
	Infof(string, ...any)
	Warnf(string, ...any)
	Debugf(string, ...any)
}

// Engine orchestrates RDCP over a line transport.
type Engine struct {
	Cfg      config.Config
	Transport transport.LineTransport
	Nav      *nav.Controller
	Metrics  metricsProvider
	State    state.Writer
	Log      Logger

	BootStatePath string
	VersionReqID  uint
	PingReqID     uint
	LastEchoSent  string
	Link          state.LinkTest

	lineBuf []byte
}

type metricsProvider interface {
	Build(scope rdcp.Scope) (string, error)
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
	out, err := rdcp.BuildPushBoot(bs.Stage, bs.Message, uint(bs.Pct))
	if err != nil {
		return err
	}
	if err := e.send(out); err != nil {
		return err
	}
	out, err = rdcp.BuildPushConfig(e.Cfg.ScreenTimeoutSec, e.Cfg.ScreenTimeoutMode)
	if err != nil {
		return err
	}
	if err := e.send(out); err != nil {
		return err
	}
	if err := e.send(rdcp.BuildPushHello()); err != nil {
		return err
	}
	e.VersionReqID++
	if out, err = rdcp.BuildReqVersion(e.VersionReqID); err != nil {
		return err
	}
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
	if err := e.pushBoot(); err != nil {
		if e.Log != nil {
			e.Log.Warnf("leave boot push failed: %v", err)
		}
	}
	return e.SendScreen(pages.Ring[0], "left")
}

func (e *Engine) pushBoot() error {
	bs := state.ReadBootState(e.BootStatePath)
	out, err := rdcp.BuildPushBoot(bs.Stage, bs.Message, uint(bs.Pct))
	if err != nil {
		return err
	}
	return e.send(out)
}

func (e *Engine) SendScreen(screenID, dir string) error {
	now := e.now()
	if !e.Nav.Allow(now) {
		if e.Log != nil {
			reason := "interval"
			if e.Nav.Pending {
				age := now.Sub(e.Nav.LastTX)
				reason = fmt.Sprintf("pending=%s age=%dms", e.Nav.PendingScreen, age.Milliseconds())
			}
			e.Log.Infof("rate-limit cmd screen %s (%s)", screenID, reason)
		}
		return nil
	}
	out, err := rdcp.BuildCmdScreenDir(screenID, dir)
	if err != nil {
		return err
	}
	if err := e.send(out); err != nil {
		return err
	}
	e.Nav.MarkSent(screenID, now)
	// LuCI polls /tmp/mcud_active_screen; write on TX so the live page
	// follows FIFO/nav immediately. evt screen still acks Nav.
	_ = e.State.WriteActiveScreen(screenID)
	if e.Log != nil {
		e.Log.Infof("cmd screen %s (await screen evt)", screenID)
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
		return e.SendScreen(cmd.Screen, "left")
	case fifo.KindRefresh:
		if e.Nav.ActiveScreen == pages.BootScreen {
			return e.LeaveBoot()
		}
		return e.SendScreen(e.Nav.ActiveScreen, "left")
	case fifo.KindVersion:
		e.VersionReqID++
		out, err := rdcp.BuildReqVersion(e.VersionReqID)
		if err != nil {
			return err
		}
		return e.send(out)
	case fifo.KindPing:
		e.PingReqID++
		if e.Log != nil {
			e.Log.Infof("req ping id=%d", e.PingReqID)
		}
		out, err := rdcp.BuildReqPing(e.PingReqID)
		if err != nil {
			return err
		}
		return e.send(out)
	case fifo.KindEcho:
		e.LastEchoSent = cmd.Echo
		if e.Log != nil {
			e.Log.Infof("cmd echo (await echo evt): %s", cmd.Echo)
		}
		out, err := rdcp.BuildCmdEcho(cmd.Echo)
		if err != nil {
			return err
		}
		return e.send(out)
	default:
		return nil
	}
}

func (e *Engine) navCommand(cmd, animDir string) error {
	target := pages.Neighbor(e.Nav.ActiveScreen, animDir)
	if e.Log != nil {
		e.Log.Infof("nav %s -> %s", cmd, target)
	}
	return e.SendScreen(target, animDir)
}

func (e *Engine) HandleRXLine(line string) error {
	if e.Cfg.DebugSerial && e.Log != nil {
		e.Log.Debugf("uart rx: %s", line)
	}
	msg, err := rdcp.Parse(line)
	if err != nil {
		if e.Log != nil {
			e.Log.Debugf("ignored line: %v", err)
		}
		return nil
	}
	switch msg.Type {
	case rdcp.MsgEvtVersion:
		return e.State.WriteFirmwareVersion(msg)
	case rdcp.MsgResPing:
		e.Link.PingOK = true
		e.Link.PingID = msg.ReqID
		e.Link.UptimeMS = msg.UptimeMS
		return e.State.WriteLinkTest(e.Link)
	case rdcp.MsgEvtEcho:
		e.Link.EchoOK = true
		e.Link.EchoText = msg.EchoText
		return e.State.WriteLinkTest(e.Link)
	case rdcp.MsgEvt:
		if !pages.Known(msg.Screen) {
			if e.Log != nil {
				e.Log.Warnf("unknown screen evt: %s", msg.Screen)
			}
			return nil
		}
		e.Nav.AckScreen(msg.Screen)
		_ = e.State.WriteActiveScreen(msg.Screen)
		if msg.Screen == pages.BootScreen {
			return e.pushBoot()
		}
		return nil
	case rdcp.MsgEvtInput:
		return e.SendScreen(pages.Neighbor(e.Nav.ActiveScreen, msg.GestureDir), msg.GestureDir)
	case rdcp.MsgReqPoweroff:
		return fmt.Errorf("poweroff requested")
	case rdcp.MsgLegacyRequest, rdcp.MsgReq:
		payload, err := e.Metrics.Build(msg.Scope)
		if err != nil {
			payload = `{"error":"scope_unavailable"}`
		}
		out, err := rdcp.FormatResponse(msg, payload)
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
