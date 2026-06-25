# Orange Pi CM5 Base — fan and IR hardware validation

Cross-check of **OPI_CM5_BASE_V1_2_SCH** (rev V1.2, Jan 2025) and **OPi CM5 core board interface PIN definition_V1.1** against ImmortalWrt DTS (`994-*`, `995-*`) and `luci-app-peripherals`.

## Summary table

| Feature | Schematic / pin mux | Current DTS (ImmortalWrt) | Status |
|--------|---------------------|-----------------------------|--------|
| Case fan PWM | **PWM13_M1** → **GPIO4_B6** (`gpio4`, `RK_PB6`); net to **FAN1** 2-pin 1.25 mm (5 V, 2-wire) | `case_fan` `pwm-fan` on **`&pwm13`**, `pwm13m1_pins`, 20 ms period (`995-*-openwrt-fan.patch`) | **OK** (after pwm13 fix; was **MISMATCH** on pwm7) |
| Fan tach / RPM | Not wired — FAN1 is 2-pin only (no tach to SoC) | No `fan-supply` / no tach GPIO; `fan1_input` may be absent | **OK** (RPM n/a is expected) |
| Onboard IR receiver | **IRM-3638** demodulator OUT → **PWM7_IR_M0** → **GPIO0_D0** (`gpio0`, `RK_PD0`, 1.8 V domain on JP3) | No `gpio-ir-receiver` / no `rockchip-pwm-capture` node in `994-02` / `994-03` | **OK** (deferred — see below) |
| IR userspace | PWM input capture, not GPIO bit-bang | `luci-app-peripherals`: diagnostics + optional `kmod-ir-gpio-cir` for **external** receivers; comment-only `rc_maps.cfg` default | **OK** (matches hardware class) |
| J4 FPC (12-pin) | Expansion: **GPIO1_B0–B5**, CAN on **GPIO4_B2/B3** — not fan/IR | Used for HAT GPIO/UART/CAN (OLED on separate **I2C7** FPC) | **OK** (orthogonal) |

## Fan (sheet `03. KEY/ Debug/LED/FAN`)

From **OPI_CM5_BASE_V1_2_SCH**:

- Connector **FAN1**: 2-pin `A1251WF-2P-125`, pin 1 = fan +, pin 2 = fan − (5 V switched).
- SoC side: **`PWM13_M1`** → **`GPIO4_B6`** (series 10 kΩ to base of switching transistor).
- No tachometer net to the RK3588.

Rockchip mux (RK3588S pinctrl): `pwm13m1_pins` = `<4 RK_PB6 …>` = **GPIO4_B6**.

Recommended DTS pattern (what `995-*` should contain):

```dts
case_fan: pwm-fan {
	compatible = "pwm-fan";
	#cooling-cells = <2>;
	cooling-levels = <0 50 100 150 200 255>;
	pwms = <&pwm13 0 20000000 0>;
};

&pwm13 {
	pinctrl-0 = <&pwm13m1_pins>;
	pinctrl-names = "default";
	status = "okay";
};
```

**Common mistake:** `&pwm7` + `pwm7m0_pins` drives **GPIO0_D0** (**PWM7_IR_M0**), which is the **infrared** front-end on sheet `02.RTC/IR/5V/3V3`, not the fan header.

Kernel / packages: `kmod-hwmon-pwmfan` → hwmon name `pwmfan`. LuCI: **System → Peripherals → Cooling fan**.

## Infrared (sheet `02.RTC/IR/5V/3V3`)

From **OPI_CM5_BASE_V1_2_SCH**:

- **IR1**: `IRM-3638` (3-pin IR module).
- Demodulated output: **`PWM7_IR_M0`** → **`GPIO0_D0`** (JP3, 1.8 V GPIO bank).

This is **PWM input capture** (IR demodulated waveform), not a GPIO-level `gpio-ir-receiver`.

Upstream Orange Pi CM5 Base Linux DTS (Laurent Pinchart, 2025) intentionally **does not** enable onboard IR: the PWM IR binding and capture driver were incomplete at submission time. ImmortalWrt carries experimental `rockchip-mfpwm` / `rockchip-pwm-capture` patches (`124-01` … `124-03`) but **no CM5 Base DTS node** wires IR yet.

Userspace today:

- **Onboard IR:** Peripherals diagnostics (`PWM/counter capture`, kernel log); no `/sys/class/rc/rc*` expected.
- **External TSOP-style module on GPIO:** `kmod-ir-gpio-cir` + `gpio-ir-receiver` in DT + `ir-keytable` / `rc_maps.cfg` (see `92-luci-peripherals-ir-defaults`).

## Connectors (quick map)

| Connector | Schematic ref | Role |
|-----------|---------------|------|
| **FAN1** | Sheet 03 | 5 V 2-wire PWM fan (**PWM13_M1** / GPIO4_B6) |
| **IR1** | Sheet 02 | Onboard IR (**PWM7_IR_M0** / GPIO0_D0) |
| **J4** | Sheet 01 | 12-pin 2.54 mm header — GPIO1_Bx, CAN (GPIO4_B2/B3) |
| **JP1 / JP2 / JP3** | Sheets 01, 10 | 3×100-pin CM5 module ↔ base (all SoC balls) |
| Camera / VI FPCs | Sheets 11–12 | MIPI CSI (not fan/IR) |

## Validation on a running router

```sh
# Fan
for d in /sys/class/hwmon/hwmon*; do
	[ "$(cat "$d/name" 2>/dev/null)" = pwmfan ] && ls -l "$d"/pwm*
done
grep -a pwm-fan /proc/device-tree/*/compatible 2>/dev/null || \
	tr '\0' ' ' </proc/device-tree/case_fan/compatible 2>/dev/null

# IR (onboard: counter may appear when DT + driver land; rc* only for GPIO IR)
ls /sys/bus/counter/devices/ 2>/dev/null
ls /sys/class/rc/ 2>/dev/null
dmesg | grep -Ei 'pwm|capture|ir|rc-core' | tail -20
```

See also: [cm5-waveshare-oled-hat-wiring.md](cm5-waveshare-oled-hat-wiring.md) (J4 / FPC GPIO naming), and `build_immortalwrt/docs/FAN_BUTTON_DIAGNOSTICS.md` (fan/button/IR SSH checklist).

## References

- `Downloads/OPI_CM5_BASE_V1_2_SCH (1).pdf` — Xunlong, V1.2
- `Downloads/OPi CM5 core board interface PIN definition_V1.1 (1).pdf`
- `immortalwrt/target/linux/rockchip/patches-6.18/995-arm64-dts-rockchip-orangepi-cm5-base-openwrt-fan.patch`
- Linux kernel mailing list: Orange Pi CM5 Base DTS v2 (IR deferred pending PWM capture binding)
