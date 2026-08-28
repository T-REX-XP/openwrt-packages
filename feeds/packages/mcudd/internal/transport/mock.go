package transport

import "io"

// LineTransport reads/writes newline-delimited protocol lines.
type LineTransport interface {
	WriteLine(line string) error
	ReadByte() (byte, error)
	Close() error
}

type Buffer struct {
	RX []byte
	TX []string
}

func (b *Buffer) WriteLine(line string) error {
	b.TX = append(b.TX, line)
	return nil
}

func (b *Buffer) ReadByte() (byte, error) {
	if len(b.RX) == 0 {
		return 0, io.EOF
	}
	ch := b.RX[0]
	b.RX = b.RX[1:]
	return ch, nil
}

func (b *Buffer) Close() error { return nil }

func (b *Buffer) PushLine(line string) {
	b.RX = append(b.RX, []byte(line)...)
	b.RX = append(b.RX, '\n')
}

func (b *Buffer) LastTX() string {
	if len(b.TX) == 0 {
		return ""
	}
	return b.TX[len(b.TX)-1]
}
