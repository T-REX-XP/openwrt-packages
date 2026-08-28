package rdcp

import (
	"encoding/json"
	"fmt"
	"strconv"
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
	Type      string `json:"type"`
}

type legacyRequest struct {
	Request string `json:"request"`
}

// Parse decodes one newline-stripped RDCP or legacy JSON line.
func Parse(line string) (Message, error) {
	line = strings.TrimSpace(line)
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
	if msg.Op == "" {
		msg.Op = frame.Op
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
			// scope none
		default:
			return Message{}, fmt.Errorf("unknown req op")
		}
	case "res":
		if strings.Contains(line, `"pong"`) {
			msg.Type = MsgResPing
			if data.UptimeMS == 0 {
				msg.UptimeMS = parseUintField(line, "uptime_ms")
			} else {
				msg.UptimeMS = data.UptimeMS
			}
		} else {
			return Message{}, fmt.Errorf("unknown res")
		}
	case "evt":
		switch frame.Op {
		case "screen":
			msg.Type = MsgEvt
			msg.Screen = data.Screen
			if msg.Screen == "" {
				msg.Screen = parseStringField(line, "screen")
			}
		case "version":
			msg.Type = MsgEvtVersion
			msg.VersionStack = data.Stack
			msg.VersionComponent = data.Component
			msg.VersionRelease = data.Release
			msg.VersionRDCP = data.RDCP
			if msg.VersionStack == "" {
				msg.VersionStack = parseStringField(line, "stack")
			}
			if msg.VersionComponent == "" {
				msg.VersionComponent = "esp32-router"
			}
			if msg.VersionRelease == 0 {
				msg.VersionRelease = parseUintField(line, "release")
			}
			if msg.VersionRDCP == 0 {
				msg.VersionRDCP = parseUintField(line, "rdcp")
			}
			if msg.VersionStack == "" || msg.VersionRelease == 0 {
				return Message{}, fmt.Errorf("incomplete version evt")
			}
		case "echo":
			msg.Type = MsgEvtEcho
			msg.EchoText = data.Text
			if msg.EchoText == "" {
				msg.EchoText = parseStringField(line, "text")
			}
		case "input":
			if !strings.Contains(line, "gesture") {
				return Message{}, fmt.Errorf("input without gesture")
			}
			msg.Type = MsgEvtInput
			msg.GestureDir = data.Dir
			if msg.GestureDir == "" {
				if strings.Contains(line, `"dir":"right"`) {
					msg.GestureDir = "right"
				} else {
					msg.GestureDir = "left"
				}
			}
		default:
			return Message{}, fmt.Errorf("unknown evt op")
		}
	default:
		return Message{}, fmt.Errorf("unknown frame type")
	}

	return msg, nil
}

func parseStringField(line, key string) string {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal([]byte(line), &obj); err != nil {
		return ""
	}
	if raw, ok := obj["data"]; ok {
		var data map[string]string
		if json.Unmarshal(raw, &data) == nil {
			if v, ok := data[key]; ok {
				return v
			}
		}
	}
	if raw, ok := obj[key]; ok {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
	}
	return ""
}

func parseUintField(line, key string) uint {
	s := parseStringField(line, key)
	if s == "" {
		// bare number in data
		var obj map[string]json.RawMessage
		if json.Unmarshal([]byte(line), &obj) == nil {
			if raw, ok := obj["data"]; ok {
				var data map[string]json.Number
				if json.Unmarshal(raw, &data) == nil {
					if n, ok := data[key]; ok {
						v, _ := n.Int64()
						return uint(v)
					}
				}
			}
		}
		return 0
	}
	v, _ := strconv.ParseUint(s, 10, 32)
	return uint(v)
}
