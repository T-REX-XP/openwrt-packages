//go:build linux

package transport

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestBaudFlag(t *testing.T) {
	cases := []struct {
		baud int
		ok   bool
	}{
		{9600, true},
		{19200, true},
		{38400, true},
		{57600, true},
		{115200, true},
		{230400, true},
		{460800, true},
		{921600, true},
		{1, false},
		{0, false},
	}
	for _, tc := range cases {
		_, ok := baudFlag(tc.baud)
		if ok != tc.ok {
			t.Fatalf("baud %d ok=%v want %v", tc.baud, ok, tc.ok)
		}
	}
}

func TestOpenSerialErrors(t *testing.T) {
	if _, err := OpenSerial("/no/such/ttyS2-mcudd-test", 115200); err == nil {
		t.Fatal("expected open error")
	}
	f, err := os.CreateTemp(t.TempDir(), "notty")
	if err != nil {
		t.Fatal(err)
	}
	name := f.Name()
	f.Close()
	if _, err := OpenSerial(name, 115200); err == nil {
		t.Fatal("expected tcgets error on regular file")
	}

	master, slavePath, err := openPtyPair()
	if err != nil {
		t.Skip(err)
	}
	defer unix.Close(master)
	if _, err := OpenSerial(slavePath, 1234); err == nil {
		t.Fatal("expected unsupported baud")
	}
}

func TestSerialPtyRoundTrip(t *testing.T) {
	master, slavePath, err := openPtyPair()
	if err != nil {
		t.Skip(err)
	}
	defer unix.Close(master)

	s, err := OpenSerial(slavePath, 115200)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.Fd() < 0 {
		t.Fatal("fd")
	}
	if err := s.WriteLine("hello"); err != nil {
		t.Fatal(err)
	}
	var got []byte
	for len(got) < 6 {
		var b [1]byte
		n, rerr := unix.Read(master, b[:])
		if n == 1 {
			got = append(got, b[0])
			continue
		}
		if rerr != nil && rerr != unix.EINTR {
			t.Fatal(rerr)
		}
	}
	if string(got) != "hello\n" {
		t.Fatalf("got %q", got)
	}
	if _, err := unix.Write(master, []byte{'Z'}); err != nil && !errors.Is(err, unix.EINTR) {
		t.Fatal(err)
	}
	ch, err := s.ReadByte()
	if err != nil || ch != 'Z' {
		t.Fatalf("read %q %v", ch, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestSerialWriteAllAndReadErrors(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	defer w.Close()

	ws := &Serial{fd: int(w.Fd())}
	if err := ws.WriteLine("ab"); err != nil {
		t.Fatal(err)
	}
	buf := make([]byte, 3)
	n, err := r.Read(buf)
	if err != nil || n != 3 || string(buf) != "ab\n" {
		t.Fatalf("pipe read %q n=%d err=%v", buf[:n], n, err)
	}

	if err := unix.SetNonblock(int(w.Fd()), true); err != nil {
		t.Fatal(err)
	}
	big := make([]byte, 1<<20)
	for i := range big {
		big[i] = 'x'
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		time.Sleep(50 * time.Millisecond)
		_, _ = io.Copy(io.Discard, r)
	}()
	if err := ws.writeAll(big); err != nil {
		t.Fatal(err)
	}
	w.Close()
	<-done

	rs := &Serial{fd: int(r.Fd())}
	if err := unix.SetNonblock(int(r.Fd()), true); err != nil {
		t.Fatal(err)
	}
	// Drain leftover pipe data so the next ReadByte hits EAGAIN.
	drain := make([]byte, 4096)
	for {
		n, err := unix.Read(int(r.Fd()), drain)
		if n <= 0 || errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EWOULDBLOCK) {
			break
		}
	}
	if _, err := rs.ReadByte(); !errors.Is(err, os.ErrDeadlineExceeded) {
		t.Fatalf("want deadline, got %v", err)
	}

	dead := &Serial{fd: -1}
	if err := dead.Close(); err != nil {
		t.Fatal(err)
	}

	closed, err := unix.Open(filepath.Join(t.TempDir(), "closed"), unix.O_RDWR|unix.O_CREAT, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	cs := &Serial{fd: closed}
	_ = unix.Close(closed)
	if _, err := cs.ReadByte(); err == nil {
		t.Fatal("expected read on closed fd to fail")
	}
	_ = cs.Close()
}

func openPtyPair() (master int, slavePath string, err error) {
	master, err = unix.Open("/dev/ptmx", unix.O_RDWR|unix.O_NOCTTY|unix.O_CLOEXEC, 0)
	if err != nil {
		return -1, "", err
	}
	if err := unix.IoctlSetPointerInt(master, unix.TIOCSPTLCK, 0); err != nil {
		_ = unix.Close(master)
		return -1, "", err
	}
	n, err := unix.IoctlGetInt(master, unix.TIOCGPTN)
	if err != nil {
		_ = unix.Close(master)
		return -1, "", err
	}
	return master, fmt.Sprintf("/dev/pts/%d", n), nil
}
