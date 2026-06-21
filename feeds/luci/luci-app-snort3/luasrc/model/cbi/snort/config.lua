-- /usr/lib/lua/luci/model/cbi/snort/config.lua
local sys = require "luci.sys"
local util = require "luci.util"

m = Map("snort", translate("Snort IDS/IPS"), 
 translate("Snort is an open source intrusion detection and prevention system."))

s = m:section(TypedSection, "snort", translate("Service Status"))
s.anonymous = true
s.addremove = false
st = s:option(DummyValue, "_status", translate("State"))
st.template = "snort/status"
btn = s:option(Button, "_control")
btn.template = "snort/control"
alerts = s:option(DummyValue, "_alerts", translate("Recent Alerts"))
alerts.template = "snort/recent_alerts"

s = m:section(TypedSection, "snort", translate("Configuration"))
s.anonymous = true
s.addremove = false

theme_css = s:option(DummyValue, "_theme_css", " ")
theme_css.rawhtml = true
function theme_css.cfgvalue()
	return '<link rel="stylesheet" type="text/css" href="/luci-static/resources/snort-theme.css" />'
end

o = s:option(Flag, "enabled", translate("Enable Snort"),
 translate("Enable or disable Snort service"))
o.default = "0"
o.rmempty = false

o = s:option(Flag, "manual", translate("Manual mode"),
 translate("Use manual configuration (snort.lua)"))
o.default = "1"
o.rmempty = false

o = s:option(Value, "interface", translate("Network interface"),
 translate("Network interface to monitor (e.g. br-lan, eth0)"))
o.placeholder = "br-lan"
o.datatype = "string"

o = s:option(Value, "home_net", translate("Local network"),
 translate("IP address range to protect"))
o.placeholder = "192.168.1.0/24"
o.default = "192.168.1.0/24"
o.datatype = "string"

o = s:option(Value, "external_net", translate("External network"),
 translate("External IP address range"))
o.placeholder = "any"
o.default = "any"
o.datatype = "string"

o = s:option(ListValue, "mode", translate("Operating mode"),
 translate("IDS = Detection only, IPS = Active prevention"))
o:value("ids", "IDS (Detection)")
o:value("ips", "IPS (Prevention)")
o.default = "ids"

o = s:option(ListValue, "method", translate("DAQ method"),
 translate("Packet acquisition method"))
o:value("pcap", "PCAP (Recommended)")
o:value("afpacket", "AF_PACKET")
o:value("nfq", "NFQ (for IPS)")
o.default = "pcap"

o = s:option(Value, "snaplen", translate("Capture Length"),
 translate("Maximum packet capture size"))
o.placeholder = "1518"
o.default = "1518"
o.datatype = "range(1518,65535)"

s = m:section(TypedSection, "snort", translate("Logging configuration"))
s.anonymous = true
s.addremove = false

o = s:option(Flag, "logging", translate("Enable logging"),
 translate("Enable event logging"))
o.default = "1"
o.rmempty = false

o = s:option(Value, "log_dir", translate("Log directory"),
 translate("Path where logs will be stored"))
o.placeholder = "/var/log"
o.default = "/var/log"
o.datatype = "directory"

o = s:option(Value, "config_dir", translate("Configuration directory"),
 translate("Snort configuration directory path"))
o.placeholder = "/etc/snort"
o.default = "/etc/snort"
o.datatype = "directory"

o = s:option(Value, "temp_dir", translate("Temporary directory"),
 translate("Directory for temporary files and downloaded rules"))
o.placeholder = "/var/snort.d"
o.default = "/var/snort.d"
o.datatype = "directory"

s = m:section(TypedSection, "snort", translate("Rules management"))
s.anonymous = true
s.addremove = false

update_status = s:option(DummyValue, "_update_status", translate("Update status"))
update_status.rawhtml = true
function update_status.cfgvalue(self, section)
 return [[
 
]] .. translate("Click on \"Update\" to start the rules update") .. [[ 
 
 
 // Vérifier automatiquement si une mise à jour est en cours
 function checkUpdateStatus() {
 XHR.get(']] .. luci.dispatcher.build_url("admin/services/snort/check_update_status") .. [[', null,
 function(x, status) {
 var statusDiv = document.getElementById('update_status');
 if (status.running) {
 statusDiv.innerHTML = ' ⚠ ]] .. translate("Update in progress...") .. [[ ';
 setTimeout(checkUpdateStatus, 3000);
 } else if (status.finished) {
 statusDiv.innerHTML = ' ✓ ]] .. translate("Update completed!") .. [[ ';
 // Nettoyage automatique après réussite
 XHR.get(']] .. luci.dispatcher.build_url("admin/services/snort/cleanup_temp") .. [[', null, function() {});
 }
 }
 );
 }
 
 // Vérifier au chargement de la page si une mise à jour est en cours
 window.onload = function() {
 XHR.get(']] .. luci.dispatcher.build_url("admin/services/snort/check_update_status") .. [[', null,
 function(x, status) {
 if (status.running) {
 checkUpdateStatus();
 }
 }
 );
 };
 
 ]]
end

local function check_and_fix_rules_symlink()
 local config_dir = "/etc/snort"
 local temp_dir = "/var/snort.d"
 local config_rules = config_dir .. "/rules"
 local temp_rules = temp_dir .. "/rules"
 if sys.call("[ -d " .. temp_rules .. " ]") == 0 then
 if sys.call("[ -d " .. config_rules .. " ] && [ ! -L " .. config_rules .. " ]") == 0 then
 sys.call("mv " .. config_rules .. " " .. config_rules .. ".backup 2>/dev/null")
 elseif sys.call("[ -L " .. config_rules .. " ]") == 0 then
 sys.call("rm " .. config_rules)
 end
 sys.call("ln -sf " .. temp_rules .. " " .. config_rules)
 return true
 end
 return false
end

rules_info = s:option(DummyValue, "_rules_info", translate("Rules location"))
rules_info.rawhtml = true
function rules_info.cfgvalue(self, section)
	local config_rules = "/etc/snort/rules"
	local temp_rules = "/var/snort.d/rules"
	local status = ""

	if sys.call("[ -L " .. config_rules .. " ]") == 0 then
		local target = util.trim(sys.exec("readlink " .. config_rules))
		status = '<span class="snort-rules-ok">&#10003; ' .. translate("Active symbolic link") .. ': ' .. config_rules .. ' &#8594; ' .. target .. '</span>'
	elseif sys.call("[ -d " .. temp_rules .. " ]") == 0 then
		status = '<span class="snort-rules-warn">&#9888; ' .. translate("Rules are in") .. ' ' .. temp_rules .. '<br>' ..
			'<a href="javascript:fixRulesSymlink()" class="cbi-button cbi-button-apply">' .. translate("Create symbolic link") .. '</a></span>'
	else
		status = '<span class="snort-rules-err">' .. translate("No rules directory found") .. '</span>'
	end

	local rule_count = util.trim(sys.exec("find /etc/snort/rules -name '*.rules' 2>/dev/null | wc -l"))
	if tonumber(rule_count) and tonumber(rule_count) > 0 then
		status = status .. '<br><span class="snort-rules-meta">' .. translate("Rule files:") .. ' ' .. rule_count .. '</span>'
	end

	return status
end

rules_script = s:option(DummyValue, "_rules_script")
rules_script.rawhtml = true
function rules_script.cfgvalue()
	return [[<script type="text/javascript">
	function fixRulesSymlink() {
		if (confirm(']] .. translate("Create a symbolic link from /var/snort.d/rules to /etc/snort/rules?") .. [[')) {
			XHR.get(']] .. luci.dispatcher.build_url("admin/services/snort/fix_rules") .. [[', null,
				function(x, result) {
					if (result && result.success) {
						alert(']] .. translate("Symbolic link created successfully!") .. [[');
						location.reload();
					} else {
						alert(']] .. translate("Error creating symbolic link") .. [[');
					}
				}
			);
		}
	}
	</script>]]
end

o = s:option(Value, "oinkcode", translate("Oinkcode"),
	translate("Access code to download official Snort rules (optional)"))
o.password = true
o.placeholder = translate("Enter your Oinkcode if you have one")

o = s:option(ListValue, "action", translate("Rule action"),
	translate("Default action for rules"))
o:value("default", translate("Default"))
o:value("alert", translate("Alert"))
o:value("block", translate("Block"))
o:value("drop", translate("Drop"))
o:value("reject", translate("Reject"))
o.default = "default"

btn = s:option(Button, "_update_rules", translate("Update rules"))
btn.inputtitle = translate("Update")
btn.inputstyle = "apply"
function btn.write(self, section)
    -- Lancer la mise à jour en arrière-plan
    luci.sys.call("(/usr/bin/snort-rules > /tmp/snort_rules_update.log 2>&1; " ..
                  "rm -f /var/snort.d/*.tar.gz /tmp/snort*.tar.gz 2>/dev/null; " ..
                  "rm -f /var/snort.d/rules/*.tar.gz 2>/dev/null; " ..
                  "echo 'FINISHED' >> /tmp/snort_rules_update.log) &")
    
    -- Créer le fichier lock
    luci.sys.call("touch /tmp/snort_rules_update.lock")
    
    -- Réparer le lien symbolique si nécessaire
    check_and_fix_rules_symlink()
    
    -- Message de confirmation
    luci.http.redirect(luci.dispatcher.build_url("admin/services/snort"))
end

return m