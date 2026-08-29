package pages

import (
	"os"
	"path/filepath"
	"testing"
)

func TestKnownAndNeighbor(t *testing.T) {
	ResetDefault()
	if !Known(BootScreen) || !Known("router_wifi") {
		t.Fatal("expected known screens")
	}
	if Known("nope") {
		t.Fatal("unknown screen")
	}
	if got := Neighbor(BootScreen, "left"); got != Ring[0] {
		t.Fatalf("boot neighbor: %s", got)
	}
	if got := Neighbor("", "left"); got != Ring[0] {
		t.Fatalf("empty neighbor: %s", got)
	}
	if got := Neighbor("router_system", "left"); got != "router_network" {
		t.Fatalf("left: %s", got)
	}
	if got := Neighbor("router_system", "right"); got != "router_security" {
		t.Fatalf("right: %s", got)
	}
	if got := Neighbor("bad", "left"); got != "router_network" {
		t.Fatalf("bad idx: %s", got)
	}
	if Index("router_clients") != 2 {
		t.Fatal("index")
	}
	if Index("") >= 0 {
		t.Fatal("empty index")
	}
}

func TestLoadFile(t *testing.T) {
	ResetDefault()
	if err := LoadFile(""); err != nil {
		t.Fatal(err)
	}
	if err := LoadFile(filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("missing")
	}
	bad := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(bad, []byte(`{`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := LoadFile(bad); err == nil {
		t.Fatal("invalid json")
	}
	empty := filepath.Join(t.TempDir(), "empty.json")
	if err := os.WriteFile(empty, []byte(`{"screens":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := LoadFile(empty); err == nil {
		t.Fatal("empty screens")
	}
	off := false
	body := `{
	  "screens": [
	    {"id":"router_boot"},
	    {"id":""},
	    {"id":"router_wifi","enabled":true},
	    {"id":"router_system","enabled":false}
	  ]
	}`
	_ = off
	good := filepath.Join(t.TempDir(), "pages.json")
	if err := os.WriteFile(good, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := LoadFile(good); err != nil {
		t.Fatal(err)
	}
	if len(Ring) != 1 || Ring[0] != "router_wifi" {
		t.Fatalf("ring=%v", Ring)
	}
	ResetDefault()
}
