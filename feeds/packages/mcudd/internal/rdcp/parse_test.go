package rdcp

import "testing"

func TestParseRDCP(t *testing.T) {
	line := `{"v":1,"t":"req","id":7,"op":"metrics","scope":"network"}`
	msg, err := Parse(line)
	if err != nil || msg.Type != MsgReq || msg.Scope != ScopeNetwork || msg.ReqID != 7 {
		t.Fatalf("%+v %v", msg, err)
	}
	legacy, err := Parse(`{"request":"cpu"}`)
	if err != nil || legacy.Type != MsgLegacyRequest || legacy.Scope != ScopeSystem {
		t.Fatal(legacy, err)
	}
	pong, err := Parse(`{"v":1,"t":"res","id":2,"data":{"pong":true,"uptime_ms":1234}}`)
	if err != nil || pong.Type != MsgResPing || pong.UptimeMS != 1234 {
		t.Fatal(pong, err)
	}
	screen, err := Parse(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_wifi"}}`)
	if err != nil || screen.Screen != "router_wifi" {
		t.Fatal(screen, err)
	}
	ver, err := Parse(`{"v":1,"t":"evt","op":"version","data":{"stack":"1.0.0","release":44,"component":"esp32-router","rdcp":1}}`)
	if err != nil || ver.Type != MsgEvtVersion {
		t.Fatal(ver, err)
	}
	echo, err := Parse(`{"v":1,"t":"evt","op":"echo","data":{"text":"mcud-link-test"}}`)
	if err != nil || echo.EchoText != "mcud-link-test" {
		t.Fatal(echo, err)
	}
	in, err := Parse(`{"v":1,"t":"evt","op":"input","data":{"type":"gesture","dir":"left"}}`)
	if err != nil || in.GestureDir != "left" {
		t.Fatal(in, err)
	}
	pw, err := Parse(`{"v":1,"t":"req","op":"poweroff"}`)
	if err != nil || pw.Type != MsgReqPoweroff {
		t.Fatal(pw, err)
	}
}

func TestParseErrors(t *testing.T) {
	bad := []string{
		"",
		"{not json",
		`{"request":"nope"}`,
		`{"v":2,"t":"req"}`,
		`{"v":1,"t":"req","op":"metrics","scope":"bad"}`,
		`{"v":1,"t":"req","op":"nope"}`,
		`{"v":1,"t":"res","data":{}}`,
		`{"v":1,"t":"evt","op":"nope"}`,
		`{"v":1,"t":"evt","op":"version","data":{}}`,
		`{"v":1,"t":"evt","op":"input","data":{"type":"tap"}}`,
		`{"v":1,"t":"nope"}`,
	}
	for _, line := range bad {
		if _, err := Parse(line); err == nil {
			t.Fatalf("expected error: %s", line)
		}
	}
}

func TestParsePingVersionReq(t *testing.T) {
	v, err := Parse(`{"v":1,"t":"req","id":3,"op":"version"}`)
	if err != nil || v.Type != MsgReq {
		t.Fatal(v, err)
	}
	p, err := Parse(`{"v":1,"t":"req","id":4,"op":"ping"}`)
	if err != nil || p.Type != MsgReq {
		t.Fatal(p, err)
	}
}

func TestParseMetricsInData(t *testing.T) {
	msg, err := Parse(`{"v":1,"t":"req","id":2,"op":"metrics","data":{"scope":"wifi"}}`)
	if err != nil || msg.Scope != ScopeWiFi {
		t.Fatal(msg, err)
	}
}

func TestParseStringHelpers(t *testing.T) {
	if parseStringField(`{"screen":"top"}`, "screen") != "top" {
		t.Fatal("top level")
	}
	if parseStringField(`{"data":{"text":"x"}}`, "text") != "x" {
		t.Fatal("data level")
	}
	if parseUintField(`{"data":{"release":"31"}}`, "release") != 31 {
		t.Fatal("uint quoted")
	}
	if parseUintField(`{"data":{"uptime_ms":99}}`, "uptime_ms") != 99 {
		t.Fatal("uint bare")
	}
	if parseStringField("{bad", "x") != "" {
		t.Fatal()
	}
}

func TestParseFallbackFields(t *testing.T) {
	in, err := Parse(`{"v":1,"t":"evt","op":"input","data":{"type":"gesture","dir":"right"}}`)
	if err != nil || in.GestureDir != "right" {
		t.Fatal(in, err)
	}
	in2, err := Parse(`{"v":1,"t":"evt","op":"input","data":{"type":"gesture"}}`)
	if err != nil || in2.GestureDir != "left" {
		t.Fatal(in2, err)
	}
}
