package transport

import (
	"io"
	"testing"
)

func TestBuffer(t *testing.T) {
	var b Buffer
	if b.LastTX() != "" {
		t.Fatal("empty last tx")
	}
	if b.HasRX() {
		t.Fatal("empty")
	}
	b.PushLine(`{"v":1}`)
	if !b.HasRX() {
		t.Fatal("has rx")
	}
	if err := b.WriteLine("tx1"); err != nil {
		t.Fatal(err)
	}
	if b.LastTX() != "tx1" {
		t.Fatal(b.LastTX())
	}
	ch, err := b.ReadByte()
	if err != nil || ch != '{' {
		t.Fatal(ch, err)
	}
	if err := b.Close(); err != nil {
		t.Fatal(err)
	}
	for {
		_, err := b.ReadByte()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
}
