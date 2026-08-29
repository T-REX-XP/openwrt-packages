package proto

import (
	"strings"
	"testing"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/version"
)

func TestBuilders(t *testing.T) {
	if _, err := BuildCmdScreenDir("", "left"); err == nil {
		t.Fatal("empty screen")
	}
	out, err := BuildCmdScreenDir("router_system", "")
	if err != nil || !strings.Contains(out, `"dir":"left"`) {
		t.Fatal(out, err)
	}
	out, err = BuildCmdScreen("router_wifi")
	if err != nil || !strings.Contains(out, "router_wifi") {
		t.Fatal(out, err)
	}
	if _, err := BuildCmdNav("up"); err == nil {
		t.Fatal("bad nav")
	}
	out, err = BuildCmdNav("next")
	if err != nil || !strings.Contains(out, "next") {
		t.Fatal(out, err)
	}
	out, err = BuildCmdNav("prev")
	if err != nil || !strings.Contains(out, "prev") {
		t.Fatal(out, err)
	}
	if _, err := BuildPushBoot("", "x", 0); err == nil {
		t.Fatal("empty boot")
	}
	out, err = BuildPushBoot("ready", "System ready", 200)
	if err != nil || !strings.Contains(out, `"pct":100`) {
		t.Fatal(out, err)
	}
	out, err = BuildPushConfig(60, "")
	if err != nil || !strings.Contains(out, `"screen_timeout_mode":"off"`) {
		t.Fatal(out, err)
	}
	hello := BuildPushHello()
	if !strings.Contains(hello, version.ComponentHost) || !strings.Contains(hello, `"rdcp":1`) {
		t.Fatal(hello)
	}
	if _, err := BuildReqVersion(0); err == nil {
		t.Fatal("id 0")
	}
	if _, err := BuildReqPing(0); err == nil {
		t.Fatal("ping id 0")
	}
	out, err = BuildReqVersion(1)
	if err != nil || !strings.Contains(out, `"id":1`) {
		t.Fatal(out, err)
	}
	out, err = BuildReqPing(7)
	if err != nil || !strings.Contains(out, `"op":"ping"`) {
		t.Fatal(out, err)
	}
	if _, err := BuildCmdEcho(""); err == nil {
		t.Fatal("empty echo")
	}
	out, err = BuildCmdEcho(`a"b`)
	if err != nil || !strings.Contains(out, `\u0022`) && !strings.Contains(out, `\"`) {
		t.Fatal(out, err)
	}
}

func TestFormatResponse(t *testing.T) {
	msg := Message{Type: MsgReq, ReqID: 3}
	out, err := FormatResponse(msg, `{"hostname":"Router"}`)
	if err != nil || !strings.Contains(out, `"id":3`) {
		t.Fatal(out, err)
	}
	if _, err := FormatResponse(msg, "not-obj"); err == nil {
		t.Fatal("must be object")
	}
	if _, err := FormatResponse(msg, ""); err == nil {
		t.Fatal("empty object")
	}
	if _, err := FormatResponse(Message{}, ""); err == nil {
		t.Fatal("empty payload")
	}
	out, err = FormatResponse(Message{Type: MsgLegacyRequest}, `{"ok":1}`)
	if err != nil || out != `{"ok":1}` {
		t.Fatal(out, err)
	}
}
