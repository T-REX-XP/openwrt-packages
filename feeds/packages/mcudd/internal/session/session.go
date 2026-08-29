package session

// Session tracks outstanding link-test requests so unmatched frames cannot
// flip ping_ok / echo_ok.
type Session struct {
	OutstandingPingID uint
	LastEchoSent      string
	PingOK            bool
	EchoOK            bool
}

func (s *Session) NotePingSent(id uint) {
	s.OutstandingPingID = id
}

func (s *Session) AcceptPong(id uint) bool {
	if s.OutstandingPingID == 0 || id != s.OutstandingPingID {
		return false
	}
	s.PingOK = true
	s.OutstandingPingID = 0
	return true
}

func (s *Session) NoteEchoSent(text string) {
	s.LastEchoSent = text
}

func (s *Session) AcceptEcho(text string) bool {
	if s.LastEchoSent == "" || text != s.LastEchoSent {
		return false
	}
	s.EchoOK = true
	return true
}
