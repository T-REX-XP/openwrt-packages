package proto

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/version"
)

func BuildCmdScreenDir(screenID, dir string) (string, error) {
	if screenID == "" {
		return "", fmt.Errorf("empty screen")
	}
	if dir == "" {
		dir = "left"
	}
	return fmt.Sprintf(`{"v":1,"t":"cmd","op":"screen","data":{"screen":"%s","dir":"%s"}}`, screenID, dir), nil
}

func BuildCmdScreen(screenID string) (string, error) {
	return BuildCmdScreenDir(screenID, "left")
}

func BuildCmdNav(dir string) (string, error) {
	if dir != "prev" && dir != "next" {
		return "", fmt.Errorf("invalid nav dir")
	}
	return fmt.Sprintf(`{"v":1,"t":"cmd","op":"nav","data":{"dir":"%s"}}`, dir), nil
}

func BuildPushBoot(stage, text string, pct uint) (string, error) {
	if stage == "" || text == "" {
		return "", fmt.Errorf("empty boot fields")
	}
	if pct > 100 {
		pct = 100
	}
	return fmt.Sprintf(`{"v":1,"t":"push","op":"boot","data":{"stage":"%s","text":"%s","pct":%d}}`, stage, text, pct), nil
}

func BuildPushConfig(timeoutSec uint, mode string) (string, error) {
	if mode == "" {
		mode = "off"
	}
	return fmt.Sprintf(`{"v":1,"t":"push","op":"config","data":{"screen_timeout":%d,"screen_timeout_mode":"%s"}}`, timeoutSec, mode), nil
}

func BuildPushHello() string {
	return fmt.Sprintf(`{"v":1,"t":"push","op":"hello","data":{"stack":"%s","release":%d,"component":"%s","rdcp":%d}}`,
		version.Stack, version.Release, version.ComponentHost, version.RDCP)
}

func BuildReqVersion(id uint) (string, error) {
	if id == 0 {
		return "", fmt.Errorf("invalid id")
	}
	return fmt.Sprintf(`{"v":1,"t":"req","id":%d,"op":"version"}`, id), nil
}

func BuildReqPing(id uint) (string, error) {
	if id == 0 {
		return "", fmt.Errorf("invalid id")
	}
	return fmt.Sprintf(`{"v":1,"t":"req","id":%d,"op":"ping"}`, id), nil
}

func BuildCmdEcho(text string) (string, error) {
	if text == "" {
		return "", fmt.Errorf("empty echo")
	}
	b, _ := json.Marshal(text)
	return fmt.Sprintf(`{"v":1,"t":"cmd","op":"echo","data":{"text":%s}}`, string(b)), nil
}

func FormatResponse(msg Message, payload string) (string, error) {
	payload = strings.TrimSpace(payload)
	if msg.Type == MsgReq && msg.ReqID > 0 {
		if payload == "" || payload[0] != '{' {
			return "", fmt.Errorf("payload must be json object")
		}
		return fmt.Sprintf(`{"v":1,"t":"res","id":%d,"data":%s}`, msg.ReqID, payload), nil
	}
	if payload == "" {
		return "", fmt.Errorf("empty payload")
	}
	return payload, nil
}
