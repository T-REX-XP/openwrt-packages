package rdcp

import "testing"

func TestBuildFrames(t *testing.T) {
	if _, err := BuildCmdScreen(""); err == nil {
		t.Fatal("empty screen")
	}
	s, err := BuildCmdScreen("router_system")
	if err != nil || s == "" {
		t.Fatal(s, err)
	}
	s, err = BuildCmdScreenDir("router_system", "right")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = BuildCmdNav("bad"); err == nil {
		t.Fatal("nav")
	}
	if _, err = BuildPushBoot("", "x", 0); err == nil {
		t.Fatal("boot stage")
	}
	if _, err = BuildReqVersion(0); err == nil {
		t.Fatal("version id zero")
	}
	if _, err = BuildReqVersion(1); err != nil {
		t.Fatal(err)
	}
	if _, err = BuildCmdEcho(""); err == nil {
		t.Fatal("echo")
	}
	echo, _ := BuildCmdEcho(`say "hi"`)
	if echo == "" {
		t.Fatal("echo build")
	}
	if rdcp := BuildPushHello(); rdcp == "" {
		t.Fatal("hello")
	}
	out, err := FormatResponse(Message{Type: MsgReq, ReqID: 3}, `{"ok":true}`)
	if err != nil || out == "" {
		t.Fatal(out, err)
	}
	if _, err = FormatResponse(Message{Type: MsgReq, ReqID: 1}, ``); err == nil {
		t.Fatal("empty payload")
	}
	if _, err = FormatResponse(Message{Type: MsgReq, ReqID: 0}, `{"a":1}`); err != nil {
		t.Fatal(err)
	}
}

func TestScopeEmptyName(t *testing.T) {
	if ScopeName(ScopeNone) != "" {
		t.Fatal()
	}
}

func TestBuildMore(t *testing.T) {
	if _, err := BuildPushConfig(0, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildReqPing(1); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildReqPing(0); err == nil {
		t.Fatal("ping id")
	}
	if _, err := BuildCmdNav("next"); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildCmdNav("prev"); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildPushBoot("boot", "OK", 150); err != nil {
		t.Fatal(err)
	}
	if _, err := BuildCmdScreenDir("router_system", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := FormatResponse(Message{Type: MsgReq, ReqID: 1}, `notjson`); err == nil {
		t.Fatal("bad payload shape")
	}
}
