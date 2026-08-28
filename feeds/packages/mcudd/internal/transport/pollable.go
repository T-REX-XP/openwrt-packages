package transport

// PollableLineTransport is a UART that exposes a poll(2) fd.
type PollableLineTransport interface {
	LineTransport
	Fd() int
}
