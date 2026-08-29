package session

import "testing"

func TestPingMatch(t *testing.T) {
	var s Session
	if s.AcceptPong(1) {
		t.Fatal("no outstanding")
	}
	s.NotePingSent(7)
	if s.AcceptPong(8) {
		t.Fatal("wrong id")
	}
	if s.PingOK || s.OutstandingPingID != 7 {
		t.Fatal("must keep outstanding")
	}
	if !s.AcceptPong(7) || !s.PingOK || s.OutstandingPingID != 0 {
		t.Fatal("match")
	}
}

func TestEchoMatch(t *testing.T) {
	var s Session
	if s.AcceptEcho("x") {
		t.Fatal("empty sent")
	}
	s.NoteEchoSent("mcud-link-test")
	if s.AcceptEcho("other") {
		t.Fatal("mismatch")
	}
	if s.EchoOK {
		t.Fatal("must stay false")
	}
	if !s.AcceptEcho("mcud-link-test") || !s.EchoOK {
		t.Fatal("match")
	}
}
