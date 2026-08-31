package metrics

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/config"
	"github.com/t-rex-xp/openwrt-packages/mcudd/internal/proto"
)

type fakeEnt string

func (f fakeEnt) Name() string               { return string(f) }
func (f fakeEnt) IsDir() bool                { return false }
func (f fakeEnt) Type() os.FileMode          { return 0 }
func (f fakeEnt) Info() (os.FileInfo, error) { return nil, errors.New("no") }

func filesSys(files map[string]string) Sys {
	now := time.Unix(1_700_000_000, 0)
	return Sys{
		ReadFile: func(path string) ([]byte, error) {
			if v, ok := files[path]; ok {
				return []byte(v), nil
			}
			return nil, errors.New("missing")
		},
		ReadDir: func(path string) ([]os.DirEntry, error) {
			if path != "/sys/class/net" {
				return nil, errors.New("missing")
			}
			return []os.DirEntry{fakeEnt("eth0"), fakeEnt("wg0"), fakeEnt("tun0"), fakeEnt("awg0"), fakeEnt("amn0"), fakeEnt("tap0"), fakeEnt("br-lan")}, nil
		},
		Statfs: func(path string) (Disk, error) {
			switch path {
			case "/":
				return Disk{Blocks: 1000, Bavail: 400, Bsize: 1024}, nil
			case "/overlay":
				return Disk{Blocks: 2000, Bavail: 500, Bsize: 1024}, nil
			default:
				return Disk{}, errors.New("missing")
			}
		},
		Run: func(name string, args ...string) ([]byte, error) {
			joined := name + " " + strings.Join(args, " ")
			switch {
			case strings.Contains(joined, "ubus"):
				return []byte(`{"up":true,"device":"eth0","ipv4-address":[{"address":"203.0.113.8"}]}`), nil
			case strings.Contains(joined, "station dump") && strings.Contains(joined, "wlan0"):
				return []byte("Station aa:bb:cc:dd:ee:ff (on wlan0)\n"), nil
			case strings.Contains(joined, "station dump") && strings.Contains(joined, "wlan1"):
				return []byte("Station 11:22:33:44:55:66 (on wlan1)\n"), nil
			case strings.Contains(joined, "iwinfo") && strings.Contains(joined, "wlan1"):
				return []byte("wlan1 ESSID: test\nChannel: 36 (5.180 GHz)\n"), nil
			case strings.Contains(joined, "iwinfo"):
				return []byte("wlan0 ESSID: test\nChannel: 6 (2.437 GHz)\n"), nil
			default:
				return nil, errors.New("no")
			}
		},
		HTTPGet: func(url string) ([]byte, error) {
			return []byte("# HELP\nblocky_query_total{response=\"BLOCKED\"} 7\nblocky_query_total{response=\"NOERROR\"} 9\n"), nil
		},
		Now:      func() time.Time { return now },
		Hostname: func() (string, error) { return "cm5", nil },
	}
}

func TestStubAllScopes(t *testing.T) {
	p := &Provider{DemoMode: true}
	scopes := []proto.Scope{
		proto.ScopeSystem, proto.ScopeNetwork, proto.ScopeClients, proto.ScopeStorage,
		proto.ScopeWiFi, proto.ScopeSecurity, proto.ScopeAlarms,
	}
	for _, s := range scopes {
		out, err := p.Build(s)
		if err != nil || out == "" || out[0] != '{' {
			t.Fatalf("scope %v: %v %q", s, err, out)
		}
	}
	p.DemoMode = false
	p.Sys = filesSys(nil)
	out, err := p.Build(proto.ScopeAlarms)
	if err != nil || out != `{"alarms":[]}` {
		t.Fatalf("alarms off: %q %v", out, err)
	}
	if _, err := p.Build(proto.ScopeNone); err == nil {
		t.Fatal("expected error")
	}
	var n *Provider
	out, err = n.Build(proto.ScopeSystem)
	if err != nil || !strings.Contains(out, `"hostname"`) {
		t.Fatalf("nil provider: %q %v", out, err)
	}
	if _, err := n.Build(proto.ScopeNone); err == nil {
		t.Fatal("nil none")
	}
}

func TestNewDefaultsAndLiveSystem(t *testing.T) {
	cfg := config.Default()
	cfg.WanIf, cfg.LanIf, cfg.WifiIf = "", "", ""
	p := New(cfg)
	if p.WanIf != "wan" || p.LanIf != "br-lan" || p.WifiIf != "wlan0" {
		t.Fatalf("defaults %+v", p)
	}
	p.Sys = filesSys(map[string]string{
		"/proc/stat":     "cpu  10 0 10 80 10 0 0 0\n",
		"/proc/meminfo":  "MemTotal: 1024 kB\nMemAvailable: 256 kB\n",
		"/proc/uptime":   "90000.0 1.0\n",
		"/proc/loadavg":  "0.12 0.10 0.09 1/100 1\n",
		"/sys/class/thermal/thermal_zone0/temp": "45123\n",
	})
	out, err := p.Build(proto.ScopeSystem)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `"hostname":"cm5"`) || !strings.Contains(out, `"cpu":"0"`) {
		t.Fatal(out)
	}
	p.Sys.ReadFile = func(path string) ([]byte, error) {
		if path == "/proc/stat" {
			return []byte("cpu  20 0 20 90 10 0 0 0\n"), nil
		}
		return filesSys(map[string]string{
			"/proc/meminfo": "MemTotal: 2048 kB\nMemAvailable: 3000 kB\n",
			"/proc/uptime":  "70.0 1\n",
			"/proc/loadavg": "1.00\n",
			"/sys/class/thermal/thermal_zone0/temp": "bogus",
		}).ReadFile(path)
	}
	out, err = p.Build(proto.ScopeSystem)
	if err != nil || !strings.Contains(out, `"cpu":`) {
		t.Fatalf("%q %v", out, err)
	}
}

func TestLiveNetworkClientsStorageWifiSecurity(t *testing.T) {
	p := New(config.Default())
	files := map[string]string{
		"/tmp/dhcp.leases": "1 aa:bb:cc:dd:ee:ff 192.168.8.10 phone *\n2 11:22:33:44:55:66 192.168.8.11 pad *\n",
		"/etc/config/dhcp": "config dhcp 'lan'\n\toption start '100'\n\toption limit '50'\n",
		"/etc/config/wireless": "config wifi-iface\n\toption ssid 'Cafe;Net'\n\toption encryption 'psk2'\n\toption key 'secret:1'\n\toption disabled '0'\n",
		"/etc/config/firewall": "config defaults\n",
		"/sys/class/net/eth0/operstate": "up\n",
		"/sys/class/net/eth0/speed":     "2500\n",
		"/sys/class/net/eth1/operstate": "up\n",
		"/sys/class/net/eth1/speed":     "1000\n",
		"/sys/class/net/eth2/operstate": "down\n",
		"/sys/class/net/eth2/speed":     "-1\n",
		"/sys/class/net/wlan0/operstate": "up\n",
		"/sys/class/net/eth0/statistics/rx_bytes": "1000\n",
		"/sys/class/net/eth0/statistics/tx_bytes": "2000\n",
		"/proc/mounts": "/dev/mmcblk0p2 / overlay rw\noverlayfs:/overlay /overlay overlay rw\n",
		"/proc/swaps":  "Filename\tType\tSize\tUsed\tPriority\n/dev/zram0 partition 65536 1024 -2\n",
		"/var/run/banip/banip.list": "1.2.3.4\n5.6.7.8\n",
	}
	sys := filesSys(files)
	t0 := time.Unix(1000, 0)
	sys.Now = func() time.Time { return t0 }
	p.Sys = sys

	net1, err := p.Build(proto.ScopeNetwork)
	if err != nil || !strings.Contains(net1, `"wan_ip":"203.0.113.8"`) {
		t.Fatalf("net1 %q %v", net1, err)
	}
	t0 = t0.Add(time.Second)
	p.Sys.Now = func() time.Time { return t0 }
	p.Sys.ReadFile = func(path string) ([]byte, error) {
		if path == "/sys/class/net/eth0/statistics/rx_bytes" {
			return []byte("3000\n"), nil
		}
		if path == "/sys/class/net/eth0/statistics/tx_bytes" {
			return []byte("4000\n"), nil
		}
		return filesSys(files).ReadFile(path)
	}
	net2, err := p.Build(proto.ScopeNetwork)
	if err != nil || !strings.Contains(net2, `/s"`) {
		t.Fatalf("net2 %q %v", net2, err)
	}

	cli, err := p.Build(proto.ScopeClients)
	if err != nil || !strings.Contains(cli, `"dhcp_pool":50`) || !strings.Contains(cli, `"wifi_24":"1"`) {
		t.Fatalf("cli %q %v", cli, err)
	}
	sto, err := p.Build(proto.ScopeStorage)
	if err != nil || !strings.Contains(sto, `"data_kind":"overlay"`) {
		t.Fatalf("sto %q %v", sto, err)
	}
	wifi, err := p.Build(proto.ScopeWiFi)
	if err != nil || !strings.Contains(wifi, `"wifi_ap_state":"up"`) || !strings.Contains(wifi, `WIFI:S:`) {
		t.Fatalf("wifi %q %v", wifi, err)
	}
	sec, err := p.Build(proto.ScopeSecurity)
	if err != nil || !strings.Contains(sec, `"blocky_blocked":7`) || !strings.Contains(sec, `"vpn_tunnels":"5"`) {
		t.Fatalf("sec %q %v", sec, err)
	}
}

func TestFallbacksAndHelpers(t *testing.T) {
	p := &Provider{WanIf: "eth0", WifiIf: ""}
	p.Sys = Sys{
		ReadFile: func(string) ([]byte, error) { return nil, errors.New("x") },
		ReadDir:  func(string) ([]os.DirEntry, error) { return nil, errors.New("x") },
		Statfs:   func(string) (Disk, error) { return Disk{}, errors.New("x") },
		Run:      func(string, ...string) ([]byte, error) { return []byte("not-json"), errors.New("x") },
		HTTPGet:  func(string) ([]byte, error) { return nil, errors.New("x") },
		Hostname: func() (string, error) { return "", errors.New("x") },
	}
	if _, err := p.Build(proto.ScopeSystem); err != nil {
		t.Fatal(err)
	}
	net, err := p.Build(proto.ScopeNetwork)
	if err != nil || !strings.Contains(net, `"wan_dev":"eth0"`) {
		t.Fatalf("%q %v", net, err)
	}
	if _, err := p.Build(proto.ScopeClients); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Build(proto.ScopeStorage); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Build(proto.ScopeWiFi); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Build(proto.ScopeSecurity); err != nil {
		t.Fatal(err)
	}

	empty := &Provider{}
	if got := empty.hostname(); got != "Router" {
		t.Fatal(got)
	}
	_ = empty.readFile("/x")
	_ = empty.readDir("/x")
	_, _ = empty.statfs("/")
	_ = empty.run("true")
	_ = empty.httpGet("http://127.0.0.1/")
	_ = empty.now()

	if formatBytes(0) != "0B" || formatBytes(2048) != "2.0K" || formatBytes(2*1024*1024) != "2.0M" || formatBytes(2*1024*1024*1024) != "2.0G" {
		t.Fatal("bytes")
	}
	if formatUptime(10) != "10s" || formatUptime(120) != "2m" || formatUptime(3700) != "1h 1m" || formatUptime(90000) != "1d 1h" {
		t.Fatal("uptime")
	}
	if formatSpeed(0) != "--" || formatSpeed(100) != "100M" || formatSpeed(1000) != "1G" || formatSpeed(2500) != "2.5G" {
		t.Fatal("speed")
	}
	if clampPct(150) != 100 || dash("") != "--" || uciOption("foo", "ssid") != "" {
		t.Fatal("helpers")
	}
	if _, err := marshalJSON(make(chan int)); err == nil {
		t.Fatal("marshal")
	}
	if escapeQR(`a;b,c:d\e`) == `a;b,c:d\e` {
		t.Fatal("escape")
	}

	p2 := &Provider{Sys: Sys{
		ReadFile: func(path string) ([]byte, error) {
			switch path {
			case "/proc/stat":
				return []byte("intr 1\n"), nil
			case "/proc/meminfo":
				return []byte("Foo: 1\n"), nil
			case "/proc/uptime":
				return []byte("nope\n"), nil
			case "/proc/loadavg":
				return []byte("\n"), nil
			case "/sys/class/net/eth0/operstate":
				return []byte("up\n"), nil
			case "/sys/class/net/eth0/speed":
				return []byte("x\n"), nil
			case "/proc/swaps":
				return []byte("Filename\n"), nil
			case "/etc/config/wireless":
				return []byte("option ssid 'x'\noption encryption 'none'\noption disabled '1'\noption key 'k'\n"), nil
			case "/sys/class/net/wlan0/operstate":
				return []byte("down\n"), nil
			default:
				return nil, errors.New("x")
			}
		},
		Statfs: func(string) (Disk, error) { return Disk{Blocks: 10, Bavail: 20, Bsize: 1024}, nil },
		Now:    time.Now,
	}}
	_ = p2.cpuPct()
	_, _ = p2.mem()
	_ = p2.uptime()
	_ = p2.load()
	_, _ = p2.ethLink("eth0")
	_, _, _ = p2.diskUsage("/")
	_, _ = p2.swapUsage()
	wifi, _ := marshalJSON(p2.collectWiFi())
	if !strings.Contains(wifi, `"wifi_ap_state":"disabled"`) {
		t.Fatal(wifi)
	}

	p3 := &Provider{Sys: Sys{
		ReadFile: func(path string) ([]byte, error) {
			if strings.Contains(path, "rx_bytes") || strings.Contains(path, "tx_bytes") {
				return []byte("10\n"), nil
			}
			return nil, errors.New("x")
		},
		Now: func() time.Time { return time.Unix(5, 0) },
	}}
	p3.prevNetDev, p3.prevNetAt = "eth0", time.Unix(5, 0)
	rx, tx := p3.netRates("eth0")
	if rx != "0B/s" || tx != "0B/s" {
		t.Fatalf("zero dt %s %s", rx, tx)
	}
	p3.prevNetRX, p3.prevNetTX = 50, 50
	p3.Sys.Now = func() time.Time { return time.Unix(6, 0) }
	rx, tx = p3.netRates("eth0")
	if rx != "0B/s" {
		t.Fatalf("reset %s %s", rx, tx)
	}
	_, _ = p3.netRates("--")

	p4 := &Provider{WifiIf: "wlan0", Sys: Sys{
		Run: func(name string, args ...string) ([]byte, error) {
			if strings.Contains(strings.Join(args, " "), "station") {
				return []byte("Station a\n"), nil
			}
			return []byte("Channel: 6 (2.4 GHz)\n"), nil
		},
	}}
	n24, n5 := p4.wifiStations()
	if n24 == 0 && n5 == 0 {
		t.Fatal("stations")
	}

	longSSID := strings.Repeat("s", 80)
	p5 := &Provider{WifiIf: "wlan0", Sys: Sys{
		ReadFile: func(path string) ([]byte, error) {
			if path == "/etc/config/wireless" {
				return []byte("option ssid '" + longSSID + "'\noption encryption 'psk2'\noption key '" + strings.Repeat("k", 80) + "'\n"), nil
			}
			if strings.Contains(path, "operstate") {
				return []byte("up\n"), nil
			}
			return nil, errors.New("x")
		},
	}}
	w := p5.collectWiFi()
	if len(w.QR) > 159 {
		t.Fatal(len(w.QR))
	}

	p6 := &Provider{Sys: Sys{
		HTTPGet: func(string) ([]byte, error) {
			return []byte("# x\nblocky_query_total{response=\"BLOCKED\"}\nblocky_query_total{response=\"blocked\"} zz\n"), nil
		},
	}}
	if p6.blockyBlocked() != 0 {
		t.Fatal("blocky parse")
	}

	sys := defaultSys()
	_, _ = sys.ReadFile("/no/such/mcudd-test")
	_, _ = sys.ReadDir("/no/such/mcudd-test")
	_, _ = sys.Statfs("/")
	_, _ = sys.Run("false")
	_, _ = sys.HTTPGet("http://127.0.0.1:1/")
	_ = sys.Now()
	_, _ = sys.Hostname()
	if _, err := marshalJSON(map[string]int{"a": 1}); err != nil {
		t.Fatal(err)
	}
	var js map[string]any
	_ = json.Unmarshal([]byte(`{"a":1}`), &js)
}

func TestCpuBadFieldsAndMem(t *testing.T) {
	p := &Provider{Sys: Sys{ReadFile: func(path string) ([]byte, error) {
		if path == "/proc/stat" {
			return []byte("cpu  1 x 1 1\n"), nil
		}
		if path == "/proc/meminfo" {
			return []byte("MemTotal: nope kB\nMemAvailable: 1 kB\n"), nil
		}
		return nil, errors.New("x")
	}}}
	if p.cpuPct() != "0" {
		t.Fatal("bad cpu")
	}
	if s, _ := p.mem(); s != "" {
		t.Fatal(s)
	}
	p.prevCPUOK = true
	p.prevCPUIdle = 80
	p.prevCPUTotal = 110
	p.Sys.ReadFile = func(string) ([]byte, error) { return []byte("cpu  100 0 100 0 0\n"), nil }
	_ = p.cpuPct()
}

func TestCoverageHoles(t *testing.T) {
	var n *Provider
	out, err := n.Build(proto.ScopeAlarms)
	if err != nil || out != `{"alarms":[]}` {
		t.Fatalf("nil alarms %q %v", out, err)
	}

	p := &Provider{
		WanIf: "eth0",
		Sys: Sys{
			ReadFile: func(path string) ([]byte, error) {
				switch path {
				case "/sys/class/net/eth0/operstate":
					return []byte("up\n"), nil
				case "/proc/sys/kernel/hostname":
					return []byte("fromproc\n"), nil
				case "/tmp/dhcp.leases":
					return []byte(""), nil
				default:
					return nil, errors.New("x")
				}
			},
			Run: func(string, ...string) ([]byte, error) {
				return []byte(`{"up":true}`), nil
			},
			Hostname: func() (string, error) { return "", errors.New("x") },
		},
	}
	dev, ip, up := p.wanStatus()
	if dev != "eth0" || ip != "--" || !up {
		t.Fatalf("wan fallback %s %s %v", dev, ip, up)
	}
	if p.hostname() != "fromproc" {
		t.Fatal(p.hostname())
	}

	p.WifiIf = "wlan0"
	p.Sys.Run = func(name string, args ...string) ([]byte, error) {
		joined := strings.Join(args, " ")
		if strings.Contains(joined, "station dump") && strings.Contains(joined, "wlan0") {
			return []byte("Station a\nStation b\nStation c\n"), nil
		}
		if strings.Contains(joined, "station") {
			return nil, errors.New("x")
		}
		return []byte("Channel: 6 (2.4 GHz)\n"), nil
	}
	cli := p.collectClients()
	if cli.LanClients != "3" {
		t.Fatalf("lan from wifi %s", cli.LanClients)
	}

	p.Sys.ReadFile = func(path string) ([]byte, error) {
		if path == "/tmp/dhcp.leases" {
			return []byte("1 a\n2 b\n3 c\n4 d\n5 e\n"), nil
		}
		return nil, errors.New("x")
	}
	p.Sys.Run = func(string, ...string) ([]byte, error) { return nil, errors.New("x") }
	cli = p.collectClients()
	if cli.ClientsTotal != "5 clients" {
		t.Fatalf("leases dominate %s", cli.ClientsTotal)
	}

	_, err = defaultStatfs("/no/such/mcudd-statfs")
	if err == nil {
		t.Fatal("statfs")
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))
	defer srv.Close()
	b, err := defaultHTTPGet(srv.URL)
	if err != nil || string(b) != "ok" {
		t.Fatalf("http %q %v", b, err)
	}
}

