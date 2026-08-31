package proto

import (
	"bufio"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestParseEmptyAndInvalid(t *testing.T) {
	if _, err := Parse("\x00\x00"); err == nil {
		t.Fatal("nuls")
	}
	msg, err := Parse("\x00{\"v\":1,\"t\":\"req\",\"id\":1,\"op\":\"ping\"}")
	if err != nil || msg.Op != "ping" {
		t.Fatalf("leading nul: %+v %v", msg, err)
	}
	if _, err := Parse(""); err == nil {
		t.Fatal("empty")
	}
	if _, err := Parse("not-json"); err == nil {
		t.Fatal("invalid json")
	}
	if _, err := Parse(`{"v":2,"t":"req"}`); err == nil {
		t.Fatal("not v1")
	}
	if _, err := Parse(`{"v":1}`); err == nil {
		t.Fatal("no t")
	}
	if _, err := Parse(`{"v":1,"t":"zzz"}`); err == nil {
		t.Fatal("unknown type")
	}
}

func TestParseLegacy(t *testing.T) {
	msg, err := Parse(`{"request":"cpu"}`)
	if err != nil || msg.Type != MsgLegacyRequest || msg.Scope != ScopeSystem {
		t.Fatalf("%+v %v", msg, err)
	}
	if _, err := Parse(`{"request":"nope"}`); err == nil {
		t.Fatal("unknown legacy")
	}
}

func TestParseReq(t *testing.T) {
	msg, err := Parse(`{"v":1,"t":"req","id":3,"op":"metrics","scope":"system"}`)
	if err != nil || msg.Type != MsgReq || msg.Scope != ScopeSystem || msg.ReqID != 3 {
		t.Fatalf("%+v %v", msg, err)
	}
	msg, err = Parse(`{"v":1,"t":"req","id":1,"op":"metrics","data":{"scope":"wifi"}}`)
	if err != nil || msg.Scope != ScopeWiFi {
		t.Fatalf("%+v %v", msg, err)
	}
	if _, err := Parse(`{"v":1,"t":"req","id":1,"op":"metrics"}`); err == nil {
		t.Fatal("unknown scope")
	}
	msg, err = Parse(`{"v":1,"t":"req","op":"poweroff"}`)
	if err != nil || msg.Type != MsgReqPoweroff {
		t.Fatalf("%+v %v", msg, err)
	}
	msg, err = Parse(`{"v":1,"t":"req","id":9,"op":"ping"}`)
	if err != nil || msg.Type != MsgReq || msg.Op != "ping" {
		t.Fatalf("%+v %v", msg, err)
	}
	msg, err = Parse(`{"v":1,"t":"req","id":1,"op":"version"}`)
	if err != nil || msg.Op != "version" {
		t.Fatalf("%+v %v", msg, err)
	}
	if _, err := Parse(`{"v":1,"t":"req","op":"nope"}`); err == nil {
		t.Fatal("unknown req")
	}
}

func TestParseResPingByDataField(t *testing.T) {
	msg, err := Parse(`{"v":1,"t":"res","id":7,"data":{"pong":1,"uptime_ms":1234}}`)
	if err != nil || msg.Type != MsgResPing || msg.ReqID != 7 || msg.UptimeMS != 1234 {
		t.Fatalf("%+v %v", msg, err)
	}
	// substring "pong" in an unrelated field must not count
	msg, err = Parse(`{"v":1,"t":"res","id":1,"data":{"note":"no pong key"}}`)
	if err != nil || msg.Type != MsgIgnored {
		t.Fatalf("false pong: %+v %v", msg, err)
	}
	msg, err = Parse(`{"v":1,"t":"res","id":1}`)
	if err != nil || msg.Type != MsgIgnored {
		t.Fatalf("empty res: %+v %v", msg, err)
	}
	msg, err = Parse(`{"v":1,"t":"res","id":1,"data":"x"}`)
	if err != nil || msg.Type != MsgIgnored {
		t.Fatalf("non-object data: %+v %v", msg, err)
	}
}

func TestParseEvt(t *testing.T) {
	msg, err := Parse(`{"v":1,"t":"evt","op":"screen","data":{"screen":"router_system","action":"loaded"}}`)
	if err != nil || msg.Type != MsgEvtScreen || msg.Screen != "router_system" {
		t.Fatalf("%+v %v", msg, err)
	}
	msg, err = Parse(`{"v":1,"t":"evt","op":"version","data":{"stack":"1.0.0","release":47,"component":"esp32-router","rdcp":1}}`)
	if err != nil || msg.Type != MsgEvtVersion || msg.VersionRelease != 47 {
		t.Fatalf("%+v %v", msg, err)
	}
	msg, err = Parse(`{"v":1,"t":"evt","op":"version","data":{"stack":"1.0.0","release":1}}`)
	if err != nil || msg.VersionComponent != "esp32-router" {
		t.Fatalf("default component: %+v %v", msg, err)
	}
	if _, err := Parse(`{"v":1,"t":"evt","op":"version","data":{"stack":"","release":0}}`); err == nil {
		t.Fatal("incomplete version")
	}
	msg, err = Parse(`{"v":1,"t":"evt","op":"echo","data":{"text":"hi"}}`)
	if err != nil || msg.EchoText != "hi" {
		t.Fatalf("%+v %v", msg, err)
	}
	if _, err := Parse(`{"v":1,"t":"evt","op":"input","data":{"type":"gesture","dir":"right"}}`); err == nil {
		t.Fatal("v1 has no gesture evt")
	}
	if _, err := Parse(`{"v":1,"t":"evt","op":"nope"}`); err == nil {
		t.Fatal("unknown evt")
	}
}

func TestParseIgnoredHostFrames(t *testing.T) {
	for _, line := range []string{
		`{"v":1,"t":"cmd","op":"screen","data":{"screen":"router_system"}}`,
		`{"v":1,"t":"push","op":"hello"}`,
	} {
		msg, err := Parse(line)
		if err != nil || msg.Type != MsgIgnored {
			t.Fatalf("%s => %+v %v", line, msg, err)
		}
	}
}

func TestGoldenInboundParse(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(file), "..", "..", "testdata", "rdcp")
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		f, err := os.Open(filepath.Join(root, e.Name()))
		if err != nil {
			t.Fatal(err)
		}
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			if !strings.HasPrefix(line, "< ") {
				continue
			}
			raw := strings.TrimPrefix(line, "< ")
			if _, err := Parse(raw); err != nil {
				t.Fatalf("%s inbound %q: %v", e.Name(), raw, err)
			}
		}
		_ = f.Close()
		if err := sc.Err(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestScopeHelpers(t *testing.T) {
	if ScopeName(ScopeNone) != "" || ScopeName(ScopeSystem) != "system" {
		t.Fatal("name")
	}
	if ScopeName(ScopeNetwork) != "network" || ScopeName(ScopeStorage) != "storage" {
		t.Fatal("name2")
	}
	if ScopeName(ScopeAlarms) != "alarms" || ScopeName(ScopeClients) != "clients" {
		t.Fatal("name3")
	}
	if ScopeName(ScopeWiFi) != "wifi" || ScopeName(ScopeSecurity) != "security" {
		t.Fatal("name4")
	}
	if ScopeFromName("cpu") != ScopeSystem || ScopeFromName("nope") != ScopeNone {
		t.Fatal("from name")
	}
	for _, pair := range []struct {
		name string
		s    Scope
	}{
		{"system", ScopeSystem}, {"network", ScopeNetwork}, {"storage", ScopeStorage},
		{"alarms", ScopeAlarms}, {"clients", ScopeClients}, {"wifi", ScopeWiFi},
		{"security", ScopeSecurity},
	} {
		if ScopeFromName(pair.name) != pair.s {
			t.Fatal(pair.name)
		}
	}
	if ScopeFromScreen("router_network") != ScopeNetwork {
		t.Fatal("screen net")
	}
	if ScopeFromScreen("router_clients") != ScopeClients {
		t.Fatal("clients")
	}
	if ScopeFromScreen("router_storage") != ScopeStorage {
		t.Fatal("storage")
	}
	if ScopeFromScreen("router_wifi") != ScopeWiFi {
		t.Fatal("wifi")
	}
	if ScopeFromScreen("router_security") != ScopeSecurity {
		t.Fatal("sec")
	}
	if ScopeFromScreen("router_boot") != ScopeSystem {
		t.Fatal("boot")
	}
}
