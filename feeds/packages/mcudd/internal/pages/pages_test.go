package pages

import "testing"

func TestKnownAndNeighbor(t *testing.T) {
	if !Known(BootScreen) || !Known("router_wifi") {
		t.Fatal("expected known screens")
	}
	if Known("nope") {
		t.Fatal("unknown screen")
	}
	if got := Neighbor(BootScreen, "left"); got != Ring[0] {
		t.Fatalf("boot neighbor: %s", got)
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
