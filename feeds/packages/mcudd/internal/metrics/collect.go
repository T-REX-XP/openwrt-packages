package metrics

import (
	"encoding/json"
	"fmt"
	"path"
	"strconv"
	"strings"
)

func marshalJSON(v any) (string, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func trimNL(s string) string {
	return strings.TrimSpace(s)
}

func dash(s string) string {
	s = trimNL(s)
	if s == "" {
		return "--"
	}
	return s
}

func clampPct(v uint) uint {
	if v > 100 {
		return 100
	}
	return v
}

func formatBytes(n uint64) string {
	switch {
	case n >= 1024*1024*1024:
		return fmt.Sprintf("%.1fG", float64(n)/(1024*1024*1024))
	case n >= 1024*1024:
		return fmt.Sprintf("%.1fM", float64(n)/(1024*1024))
	case n >= 1024:
		return fmt.Sprintf("%.1fK", float64(n)/1024)
	default:
		return fmt.Sprintf("%dB", n)
	}
}

func formatRate(n uint64) string {
	return formatBytes(n) + "/s"
}

func formatUptime(sec uint64) string {
	d := sec / 86400
	h := (sec % 86400) / 3600
	m := (sec % 3600) / 60
	switch {
	case d > 0:
		return fmt.Sprintf("%dd %dh", d, h)
	case h > 0:
		return fmt.Sprintf("%dh %dm", h, m)
	case m > 0:
		return fmt.Sprintf("%dm", m)
	default:
		return fmt.Sprintf("%ds", sec)
	}
}

func formatSpeed(mbps int) string {
	if mbps <= 0 {
		return "--"
	}
	if mbps >= 1000 {
		if mbps%1000 == 0 {
			return fmt.Sprintf("%dG", mbps/1000)
		}
		return fmt.Sprintf("%.1fG", float64(mbps)/1000)
	}
	return fmt.Sprintf("%dM", mbps)
}

func uciOption(body, key string) string {
	needle := "option " + key
	for _, line := range strings.Split(body, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, needle) {
			continue
		}
		rest := strings.TrimSpace(line[len(needle):])
		rest = strings.Trim(rest, `'"`)
		return rest
	}
	return ""
}

func countNonEmptyLines(body string) int {
	n := 0
	for _, line := range strings.Split(body, "\n") {
		if strings.TrimSpace(line) != "" {
			n++
		}
	}
	return n
}

type systemMetrics struct {
	Hostname    string `json:"hostname"`
	Time        string `json:"time"`
	CPU         string `json:"cpu"`
	CPUTemp     string `json:"cpu_temp"`
	RamUsed     string `json:"ram_used"`
	RamPct      uint   `json:"ram_pct"`
	UptimeShort string `json:"uptime_short"`
	LoadShort   string `json:"load_short"`
}

func (p *Provider) collectSystem() systemMetrics {
	m := systemMetrics{
		Hostname:    p.hostname(),
		Time:        p.now().Format("15:04"),
		CPU:         "0",
		CPUTemp:     "--",
		RamUsed:     "--",
		UptimeShort: "--",
		LoadShort:   "--",
	}
	m.CPU = p.cpuPct()
	if t := p.cpuTemp(); t != "" {
		m.CPUTemp = t
	}
	used, pct := p.mem()
	if used != "" {
		m.RamUsed = used
		m.RamPct = pct
	}
	if u := p.uptime(); u != "" {
		m.UptimeShort = u
	}
	if l := p.load(); l != "" {
		m.LoadShort = l
	}
	return m
}

func (p *Provider) cpuPct() string {
	body := string(p.readFile("/proc/stat"))
	if body == "" {
		return "0"
	}
	line := body
	if i := strings.IndexByte(body, '\n'); i >= 0 {
		line = body[:i]
	}
	fs := strings.Fields(line)
	if len(fs) < 5 || fs[0] != "cpu" {
		return "0"
	}
	var vals []uint64
	for _, f := range fs[1:] {
		v, err := strconv.ParseUint(f, 10, 64)
		if err != nil {
			return "0"
		}
		vals = append(vals, v)
	}
	var total uint64
	for _, v := range vals {
		total += v
	}
	idle := vals[3]
	if len(vals) > 4 {
		idle += vals[4]
	}
	if !p.prevCPUOK || total <= p.prevCPUTotal {
		p.prevCPUIdle = idle
		p.prevCPUTotal = total
		p.prevCPUOK = true
		return "0"
	}
	dTotal := total - p.prevCPUTotal
	dIdle := idle - p.prevCPUIdle
	p.prevCPUIdle = idle
	p.prevCPUTotal = total
	busy := 100 - (100 * dIdle / dTotal)
	if busy > 100 {
		busy = 100
	}
	return strconv.FormatUint(busy, 10)
}

func (p *Provider) cpuTemp() string {
	raw := trimNL(string(p.readFile("/sys/class/thermal/thermal_zone0/temp")))
	if raw == "" {
		return ""
	}
	milli, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return ""
	}
	return fmt.Sprintf("%dC", milli/1000)
}

func (p *Provider) mem() (string, uint) {
	body := string(p.readFile("/proc/meminfo"))
	if body == "" {
		return "", 0
	}
	var total, avail uint64
	for _, line := range strings.Split(body, "\n") {
		fs := strings.Fields(line)
		if len(fs) < 2 {
			continue
		}
		v, err := strconv.ParseUint(fs[1], 10, 64)
		if err != nil {
			continue
		}
		v *= 1024
		switch fs[0] {
		case "MemTotal:":
			total = v
		case "MemAvailable:":
			avail = v
		}
	}
	if total == 0 {
		return "", 0
	}
	if avail > total {
		avail = total
	}
	used := total - avail
	pct := clampPct(uint((used * 100) / total))
	return formatBytes(used), pct
}

func (p *Provider) uptime() string {
	fs := strings.Fields(string(p.readFile("/proc/uptime")))
	if len(fs) == 0 {
		return ""
	}
	sec, err := strconv.ParseFloat(fs[0], 64)
	if err != nil || sec < 0 {
		return ""
	}
	return formatUptime(uint64(sec))
}

func (p *Provider) load() string {
	fs := strings.Fields(string(p.readFile("/proc/loadavg")))
	if len(fs) == 0 {
		return ""
	}
	return fs[0]
}

type networkMetrics struct {
	WANIP     string `json:"wan_ip"`
	WANDev    string `json:"wan_dev"`
	RxRate    string `json:"rx_rate"`
	TxRate    string `json:"tx_rate"`
	PingMS    int    `json:"ping_ms"`
	PingOK    bool   `json:"ping_ok"`
	Eth0Role  string `json:"eth0_role"`
	Eth0Up    bool   `json:"eth0_up"`
	Eth0Speed string `json:"eth0_speed"`
	Eth1Role  string `json:"eth1_role"`
	Eth1Up    bool   `json:"eth1_up"`
	Eth1Speed string `json:"eth1_speed"`
	Eth2Role  string `json:"eth2_role"`
	Eth2Up    bool   `json:"eth2_up"`
	Eth2Speed string `json:"eth2_speed"`
	LinkOK    bool   `json:"link_ok"`
}

func (p *Provider) collectNetwork() networkMetrics {
	m := networkMetrics{
		WANIP:     "--",
		WANDev:    "--",
		RxRate:    "0B/s",
		TxRate:    "0B/s",
		PingMS:    -1,
		Eth0Role:  "WAN",
		Eth0Speed: "--",
		Eth1Role:  "LAN1",
		Eth1Speed: "--",
		Eth2Role:  "LAN2",
		Eth2Speed: "--",
	}
	dev, ip, up := p.wanStatus()
	if ip != "" {
		m.WANIP = ip
	}
	if dev != "" {
		m.WANDev = dev
	}
	m.PingOK = up && ip != "" && ip != "--"
	m.LinkOK = m.PingOK
	rx, tx := p.netRates(dash(dev))
	m.RxRate = rx
	m.TxRate = tx
	m.Eth0Up, m.Eth0Speed = p.ethLink("eth0")
	m.Eth1Up, m.Eth1Speed = p.ethLink("eth1")
	m.Eth2Up, m.Eth2Speed = p.ethLink("eth2")
	return m
}

func (p *Provider) wanStatus() (dev, ip string, up bool) {
	body := p.run("ubus", "call", "network.interface."+p.WanIf, "status")
	if len(body) > 0 {
		var st struct {
			Up      bool   `json:"up"`
			Device  string `json:"device"`
			IPv4    []struct {
				Address string `json:"address"`
			} `json:"ipv4-address"`
		}
		if json.Unmarshal(body, &st) == nil {
			up = st.Up
			dev = st.Device
			if len(st.IPv4) > 0 {
				ip = st.IPv4[0].Address
			}
			if dev != "" || ip != "" {
				return dash(dev), dash(ip), up
			}
		}
	}
	fallback := "eth0"
	if p.WanIf != "" && p.WanIf != "wan" {
		fallback = p.WanIf
	}
	dev = fallback
	if trimNL(string(p.readFile("/sys/class/net/"+dev+"/operstate"))) == "up" {
		up = true
	}
	return dev, "--", up
}

func (p *Provider) netRates(dev string) (string, string) {
	if dev == "" || dev == "--" {
		return "0B/s", "0B/s"
	}
	rx := parseU64(trimNL(string(p.readFile("/sys/class/net/" + dev + "/statistics/rx_bytes"))))
	tx := parseU64(trimNL(string(p.readFile("/sys/class/net/" + dev + "/statistics/tx_bytes"))))
	now := p.now()
	rxOut, txOut := "0B/s", "0B/s"
	if p.prevNetDev == dev && !p.prevNetAt.IsZero() {
		dt := now.Sub(p.prevNetAt).Seconds()
		if dt > 0 && rx >= p.prevNetRX && tx >= p.prevNetTX {
			rxOut = formatRate(uint64(float64(rx-p.prevNetRX) / dt))
			txOut = formatRate(uint64(float64(tx-p.prevNetTX) / dt))
		}
	}
	p.prevNetRX, p.prevNetTX, p.prevNetDev, p.prevNetAt = rx, tx, dev, now
	return rxOut, txOut
}

func parseU64(s string) uint64 {
	v, _ := strconv.ParseUint(s, 10, 64)
	return v
}

func (p *Provider) ethLink(iface string) (bool, string) {
	up := trimNL(string(p.readFile("/sys/class/net/"+iface+"/operstate"))) == "up"
	sp := trimNL(string(p.readFile("/sys/class/net/" + iface + "/speed")))
	mbps, err := strconv.Atoi(sp)
	if err != nil {
		if up {
			return true, "--"
		}
		return false, "--"
	}
	return up, formatSpeed(mbps)
}

type clientsMetrics struct {
	Wifi24       string `json:"wifi_24"`
	Wifi5        string `json:"wifi_5"`
	LanClients   string `json:"lan_clients"`
	ClientsTotal string `json:"clients_total"`
	DHCPLeases   string `json:"dhcp_leases"`
	DHCPSummary  string `json:"dhcp_summary"`
	DHCPPool     uint   `json:"dhcp_pool"`
	DHCPPct      uint   `json:"dhcp_pct"`
}

func (p *Provider) collectClients() clientsMetrics {
	leases := countNonEmptyLines(string(p.readFile("/tmp/dhcp.leases")))
	pool := uint(150)
	if lim := uciOption(string(p.readFile("/etc/config/dhcp")), "limit"); lim != "" {
		if v, err := strconv.ParseUint(lim, 10, 32); err == nil && v > 0 {
			pool = uint(v)
		}
	}
	pct := uint(0)
	if pool > 0 {
		pct = clampPct(uint(leases) * 100 / pool)
	}
	n24, n5 := p.wifiStations()
	lan := leases
	if lan < n24+n5 {
		lan = n24 + n5
	}
	total := n24 + n5
	if leases > total {
		total = leases
	}
	summary := "no leases"
	if leases > 0 {
		summary = fmt.Sprintf("%d of %d leases", leases, pool)
	}
	return clientsMetrics{
		Wifi24:       strconv.Itoa(n24),
		Wifi5:        strconv.Itoa(n5),
		LanClients:   strconv.Itoa(lan),
		ClientsTotal: fmt.Sprintf("%d clients", total),
		DHCPLeases:   strconv.Itoa(leases),
		DHCPSummary:  summary,
		DHCPPool:     pool,
		DHCPPct:      pct,
	}
}

func (p *Provider) wifiStations() (n24, n5 int) {
	ifaces := []string{p.WifiIf, "wlan0", "wlan1", "phy0-ap0", "phy1-ap0"}
	seen := map[string]bool{}
	for _, iface := range ifaces {
		if iface == "" || seen[iface] {
			continue
		}
		seen[iface] = true
		dump := string(p.run("iw", "dev", iface, "station", "dump"))
		n := strings.Count(dump, "Station ")
		if n == 0 {
			continue
		}
		info := string(p.run("iwinfo", iface, "info"))
		if strings.Contains(info, "5.") || strings.Contains(info, "6.") {
			n5 += n
			continue
		}
		n24 += n
	}
	return n24, n5
}

type storageMetrics struct {
	RootUsage  string `json:"root_usage"`
	RootPct    uint   `json:"root_pct"`
	RootDev    string `json:"root_dev"`
	DataKind   string `json:"data_kind"`
	DataUsage  string `json:"data_usage"`
	DataPct    uint   `json:"data_pct"`
	OverlayDev string `json:"overlay_dev"`
	SwapUsage  string `json:"swap_usage"`
	SwapPct    uint   `json:"swap_pct"`
}

func (p *Provider) collectStorage() storageMetrics {
	m := storageMetrics{
		RootUsage:  "--",
		RootDev:    "--",
		DataKind:   "none",
		DataUsage:  "--",
		OverlayDev: "--",
		SwapUsage:  "off",
	}
	if used, pct, ok := p.diskUsage("/"); ok {
		m.RootUsage = used
		m.RootPct = pct
	}
	m.RootDev = mountSrc(string(p.readFile("/proc/mounts")), "/")
	if used, pct, ok := p.diskUsage("/overlay"); ok {
		m.DataKind = "overlay"
		m.DataUsage = used
		m.DataPct = pct
		m.OverlayDev = mountSrc(string(p.readFile("/proc/mounts")), "/overlay")
	}
	m.SwapUsage, m.SwapPct = p.swapUsage()
	return m
}

func (p *Provider) diskUsage(mount string) (string, uint, bool) {
	d, ok := p.statfs(mount)
	if !ok {
		return "", 0, false
	}
	total := d.Blocks * d.Bsize
	free := d.Bavail * d.Bsize
	if free > total {
		free = total
	}
	used := total - free
	pct := clampPct(uint((used * 100) / total))
	return formatBytes(used) + "/" + formatBytes(total), pct, true
}

func mountSrc(mounts, target string) string {
	src := "--"
	for _, line := range strings.Split(mounts, "\n") {
		fs := strings.Fields(line)
		if len(fs) < 2 {
			continue
		}
		if fs[1] == target {
			src = path.Base(fs[0])
		}
	}
	return src
}

func (p *Provider) swapUsage() (string, uint) {
	body := string(p.readFile("/proc/swaps"))
	lines := strings.Split(body, "\n")
	if len(lines) < 2 {
		return "off", 0
	}
	var size, used uint64
	for _, line := range lines[1:] {
		fs := strings.Fields(line)
		if len(fs) < 4 {
			continue
		}
		s, _ := strconv.ParseUint(fs[2], 10, 64)
		u, _ := strconv.ParseUint(fs[3], 10, 64)
		size += s * 1024
		used += u * 1024
	}
	if size == 0 {
		return "off", 0
	}
	pct := clampPct(uint((used * 100) / size))
	return formatBytes(used) + "/" + formatBytes(size), pct
}

type wifiMetrics struct {
	SSID    string `json:"wifi_ssid"`
	Enc     string `json:"wifi_enc"`
	APState string `json:"wifi_ap_state"`
	QR      string `json:"wifi_qr"`
}

func (p *Provider) collectWiFi() wifiMetrics {
	m := wifiMetrics{SSID: "--", Enc: "--", APState: "down"}
	cfg := string(p.readFile("/etc/config/wireless"))
	if ssid := uciOption(cfg, "ssid"); ssid != "" {
		m.SSID = ssid
	}
	if enc := uciOption(cfg, "encryption"); enc != "" {
		m.Enc = enc
	}
	disabled := uciOption(cfg, "disabled")
	iface := p.WifiIf
	if iface == "" {
		iface = "wlan0"
	}
	up := trimNL(string(p.readFile("/sys/class/net/"+iface+"/operstate"))) == "up"
	if disabled == "1" {
		m.APState = "disabled"
	} else if up {
		m.APState = "up"
	}
	key := uciOption(cfg, "key")
	if m.SSID != "--" && key != "" && m.Enc != "none" && m.Enc != "--" {
		m.QR = fmt.Sprintf("WIFI:S:%s;T:WPA;P:%s;;", escapeQR(m.SSID), escapeQR(key))
		if len(m.QR) > 159 {
			m.QR = m.QR[:159]
		}
	}
	return m
}

func escapeQR(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `;`, `\;`)
	s = strings.ReplaceAll(s, `,`, `\,`)
	s = strings.ReplaceAll(s, `:`, `\:`)
	return s
}

type securityMetrics struct {
	Firewall     string `json:"firewall_state"`
	Blocked24h   string `json:"blocked_24h"`
	VPNTunnels   string `json:"vpn_tunnels"`
	BlockyBlocked uint  `json:"blocky_blocked"`
	BanIPBlocked  uint  `json:"banip_blocked"`
}

func (p *Provider) collectSecurity() securityMetrics {
	m := securityMetrics{
		Firewall:   "unknown",
		Blocked24h: "--",
		VPNTunnels: "0",
	}
	if len(p.readFile("/etc/config/firewall")) > 0 {
		m.Firewall = "active"
	}
	blocked := p.blockyBlocked()
	m.BlockyBlocked = blocked
	if blocked > 0 {
		m.Blocked24h = strconv.FormatUint(uint64(blocked), 10)
	}
	m.BanIPBlocked = uint(countNonEmptyLines(string(p.readFile("/var/run/banip/banip.list"))))
	m.VPNTunnels = strconv.Itoa(p.vpnCount())
	return m
}

func (p *Provider) blockyBlocked() uint {
	body := string(p.httpGet("http://127.0.0.1:4000/metrics"))
	if body == "" {
		return 0
	}
	var total uint
	for _, line := range strings.Split(body, "\n") {
		if strings.HasPrefix(line, "#") || !strings.Contains(line, "blocky_query_total") {
			continue
		}
		if !strings.Contains(line, "BLOCKED") && !strings.Contains(line, "blocked") {
			continue
		}
		fs := strings.Fields(line)
		if len(fs) < 2 {
			continue
		}
		v, err := strconv.ParseUint(fs[len(fs)-1], 10, 32)
		if err == nil {
			total += uint(v)
		}
	}
	return total
}

func (p *Provider) vpnCount() int {
	n := 0
	for _, ent := range p.readDir("/sys/class/net") {
		name := ent.Name()
		switch {
		case strings.HasPrefix(name, "wg"),
			strings.HasPrefix(name, "awg"),
			strings.HasPrefix(name, "amn"),
			strings.HasPrefix(name, "tun"),
			strings.HasPrefix(name, "tap"):
			n++
		}
	}
	return n
}
