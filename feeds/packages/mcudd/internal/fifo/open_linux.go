//go:build linux

package fifo

import (
	"fmt"
	"os"
	"syscall"
)

const (
	Path         = "/var/run/mcudd.fifo"
	FallbackPath = "/tmp/mcudd.fifo"
)

// OpenCommandReader creates/opens the mcudd command FIFO for non-blocking reads.
func OpenCommandReader() (path string, f *os.File, err error) {
	path = Path
	if err := syscall.Mkfifo(path, 0o600); err != nil && !os.IsExist(err) {
		path = FallbackPath
		_ = os.Remove(FallbackPath)
		if err2 := syscall.Mkfifo(path, 0o600); err2 != nil && !os.IsExist(err2) {
			return "", nil, fmt.Errorf("mkfifo: %w", err2)
		}
	}
	f, err = os.OpenFile(path, os.O_RDONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return "", nil, err
	}
	return path, f, nil
}
