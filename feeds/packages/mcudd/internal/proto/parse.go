package proto

import (
	"encoding/json"
	"fmt"
	"strings"
)

type wireFrame struct {
	V     int             `json:"v"`
	T     string          `json:"t"`
	ID    uint            `json:"id"`
	Op    string          `json:"op"`
	Scope string          `json:"scope"`
	Data  json.RawMessage `json:"data"`
}

type wireData struct {
	Scope     string `json:"scope"`
	Screen    string `json:"screen"`
	Dir       string `json:"dir"`
	Text      string `json:"text"`
	Stack     string `json:"stack"`
	Component string `json:"component"`
	Release   uint   `json:"release"`
	RDCP      uint   `json:"rdcp"`
	UptimeMS  uint   `json:"uptime_ms"`
}

type legacyRequest struct {
	Request string `json:"request"`
}

// Parse decodes one newline-stripped RDCP or legacy JSON line.
func Parse(line string) (Message, error) {
	line = strings.TrimSpace(strings.Trim(line, "\x00"))
	if line == "" {
		return Message{}, fmt.Errorf("empty line")
	}

	var legacy legacyRequest
	if err := json.Unmarshal([]byte(line), &legacy); err == nil && legacy.Request != "" {
		scope := ScopeFromName(legacy.Request)
		if scope == ScopeNone {
			return Message{}, fmt.Errorf("unknown legacy request")
		}
		return Message{Type: MsgLegacyRequest, Scope: scope}, nil
	}

	var frame wireFrame
	if err := json.Unmarshal([]byte(line), &frame); err != nil {
		return Message{}, fmt.Errorf("invalid json: %w", err)
	}
	if frame.V != 1 || frame.T == "" {
		return Message{}, fmt.Errorf("not rdcp v1")
	}

	msg := Message{Op: frame.Op, ReqID: frame.ID}
	var data wireData
	if len(frame.Data) > 0 {
		_ = json.Unmarshal(frame.Data, &data)
	}

	switch frame.T {
	case "req":
		msg.Type = MsgReq
		switch msg.Op {
		case "metrics":
			scopeName := data.Scope
			if scopeName == "" {
				scopeName = frame.Scope
			}
			msg.Scope = ScopeFromName(scopeName)
			if msg.Scope == ScopeNone {
				return Message{}, fmt.Errorf("unknown scope")
			}
		case "poweroff":
			msg.Type = MsgReqPoweroff
		case "version", "ping":
		default:
			return Message{}, fmt.Errorf("unknown req op")
		}
	case "res":
		if hasPong(frame.Data) {
			msg.Type = MsgResPing
			msg.UptimeMS = data.UptimeMS
		} else {
			msg.Type = MsgIgnored
		}
	case "evt":
		switch frame.Op {
		case "screen":
			msg.Type = MsgEvtScreen
			msg.Screen = data.Screen
		case "version":
			msg.Type = MsgEvtVersion
			msg.VersionStack = data.Stack
			msg.VersionComponent = data.Component
			msg.VersionRelease = data.Release
			msg.VersionRDCP = data.RDCP
			if msg.VersionComponent == "" {
				msg.VersionComponent = "esp32-router"
			}
			if msg.VersionStack == "" || msg.VersionRelease == 0 {
				return Message{}, fmt.Errorf("incomplete version evt")
			}
		case "echo":
			msg.Type = MsgEvtEcho
			msg.EchoText = data.Text
		default:
			return Message{}, fmt.Errorf("unknown evt op")
		}
	case "cmd", "push":
		msg.Type = MsgIgnored
	default:
		return Message{}, fmt.Errorf("unknown frame type")
	}

	return msg, nil
}

func hasPong(data json.RawMessage) bool {
	if len(data) == 0 {
		return false
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(data, &obj) != nil {
		return false
	}
	_, ok := obj["pong"]
	return ok
}
