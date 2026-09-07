//go:build linux

package fifo

import (
	"os"
	"path/filepath"
	"testing"
)

func TestOpenCommandReaderExported(t *testing.T) {
	path, f, err := OpenCommandReader()
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(path)
	defer f.Close()
	if path != Path && path != FallbackPath {
		t.Fatalf("unexpected fifo path %s", path)
	}
}

func TestOpenCommandReaderPrimary(t *testing.T) {
	dir := t.TempDir()
	primary := filepath.Join(dir, "mcudd.fifo")
	fallback := filepath.Join(dir, "fallback.fifo")
	path, f, err := openCommandReader(primary, fallback)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if path != primary {
		t.Fatalf("path %s want %s", path, primary)
	}
	path2, f2, err := openCommandReader(primary, fallback)
	if err != nil {
		t.Fatal("reopen existing fifo:", err)
	}
	defer f2.Close()
	if path2 != primary {
		t.Fatalf("reopen path %s want %s", path2, primary)
	}
}

func TestOpenCommandReaderFallback(t *testing.T) {
	dir := t.TempDir()
	primary := filepath.Join(dir, "missing", "mcudd.fifo")
	fallback := filepath.Join(dir, "fallback.fifo")
	path, f, err := openCommandReader(primary, fallback)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if path != fallback {
		t.Fatalf("path %s want %s", path, fallback)
	}
}

func TestOpenCommandReaderMkfifoFail(t *testing.T) {
	dir := t.TempDir()
	primary := filepath.Join(dir, "nope", "a.fifo")
	fallback := filepath.Join(dir, "nope", "b.fifo")
	if _, _, err := openCommandReader(primary, fallback); err == nil {
		t.Fatal("expected mkfifo error")
	}
}

func TestOpenCommandReaderOpenFail(t *testing.T) {
	dir := t.TempDir()
	primary := filepath.Join(dir, "isdir")
	if err := os.Mkdir(primary, 0o700); err != nil {
		t.Fatal(err)
	}
	fallback := filepath.Join(dir, "unused.fifo")
	if _, _, err := openCommandReader(primary, fallback); err == nil {
		t.Fatal("expected open error on directory")
	}
}
