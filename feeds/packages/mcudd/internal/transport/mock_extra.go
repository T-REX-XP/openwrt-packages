package transport

func (b *Buffer) HasRX() bool {
	return len(b.RX) > 0
}
