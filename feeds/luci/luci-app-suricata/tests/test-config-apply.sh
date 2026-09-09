#!/bin/sh
# Host test: suricata-config-apply writes mpm/spm/bypass from UCI.
set -eu
APP=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
APPLY="$APP/../../packages/suricata/files/usr/sbin/suricata-config-apply"

sh -n "$APPLY"
sh -n "$APP/../../packages/suricata/files/suricata.init"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
YAML_IN="$WORKDIR/in.yaml"
YAML_OUT="$WORKDIR/out.yaml"
mkdir -p "$WORKDIR/rules" "$WORKDIR/run"

cat > "$YAML_IN" <<'EOF'
%YAML 1.1
---
vars:
  address-groups:
    HOME_NET: "[192.168.1.0/24]"
default-rule-path: /etc/suricata/rules
#mpm-algo: auto
#spm-algo: auto
af-packet:
  - interface: eth0
    cluster-id: 99
    #bypass: yes
stream:
  memcap: 64mb
  bypass: no
outputs:
  - eve-log:
      enabled: yes
      filename: eve.json
rule-files:
  - local.rules
#threshold-file: /etc/suricata/threshold.config
EOF

cat > "$WORKDIR/uci" <<EOF
#!/bin/sh
case "\$*" in
"-q get suricata.main.yaml") echo "$YAML_IN" ;;
"-q get suricata.main.run_yaml") echo "$YAML_OUT" ;;
"-q get suricata.main.interface") echo br-lan ;;
"-q get suricata.main.home_net") echo '[192.168.8.0/24]' ;;
"-q get suricata.main.rule_dir") echo "$WORKDIR/rules" ;;
"-q get suricata.main.rule_profile") echo small ;;
"-q get suricata.main.eve_path") echo "$WORKDIR/eve.json" ;;
"-q get suricata.main.threshold_file") echo "$WORKDIR/threshold.config" ;;
"-q get suricata.main.pattern_algo") echo ac ;;
"-q get suricata.main.flow_bypass") echo 1 ;;
*) exit 1 ;;
esac
exit 0
EOF
chmod +x "$WORKDIR/uci"

PATH="$WORKDIR:/usr/bin:/bin" sh "$APPLY"

grep -q 'mpm-algo: ac' "$YAML_OUT" || { echo "missing mpm-algo ac"; cat "$YAML_OUT"; exit 1; }
grep -q 'spm-algo: bm' "$YAML_OUT" || { echo "missing spm-algo bm"; cat "$YAML_OUT"; exit 1; }
grep -q '  bypass: yes' "$YAML_OUT" || { echo "missing stream bypass"; cat "$YAML_OUT"; exit 1; }
grep -q '    bypass: yes' "$YAML_OUT" || { echo "missing af-packet bypass"; cat "$YAML_OUT"; exit 1; }
grep -q 'interface: br-lan' "$YAML_OUT" || { echo "interface not rewritten"; cat "$YAML_OUT"; exit 1; }

echo "suricata-config-apply accel tests ok"
