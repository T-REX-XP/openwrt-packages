# Waveshare 1.3" OLED HAT → Orange Pi CM5 Base — Wiring Report

*Last updated: 2026-06-24.*

Hardware guide for connecting a **[Waveshare 1.3" OLED HAT](https://www.waveshare.com/1.3inch-oled-hat.htm)** to the **Orange Pi CM5 Base** 12-pin FPC expansion port using dupont wires or a 0.5 mm FPC breakout (not by stacking the HAT on a Raspberry Pi).

**Related docs:**

- [SSD1306 OLED on OpenWrt / ImmortalWrt — Research Report](ssd1306-oled-openwrt-research.md) — software stack, kernel options, `luci-app-oled` vs mainline DRM
- [`feeds/luci/luci-app-oled`](../feeds/luci/luci-app-oled/) — CM5 status daemon (userspace I2C)
- [`feeds/luci/luci-app-peripherals`](../feeds/luci/luci-app-peripherals/) — **System → Peripherals → OLED display** tab

**Official manuals:**

- [Orange Pi CM5 Base user manual v1.3 (PDF)](https://orangepi.net/wp-content/uploads/2025/01/OrangePi_CM5_Base_RK3588S_user-manual_v1.3.pdf)
- [Waveshare 1.3" OLED HAT user manual (PDF)](https://files.waveshare.com/upload/4/46/1.3inch_OLED_HAT_User_Manual_EN.pdf)
- [Waveshare 1.3" OLED HAT wiki](https://www.waveshare.net/wiki/1.3inch_OLED_HAT)

---

## Summary

| Topic | Recommendation |
|-------|----------------|
| **Interface** | **I2C** (re-solder HAT jumpers from factory SPI to I2C mode) |
| **CM5 connector** | 12-pin **0.5 mm** FPC expansion port (not a MIPI CSI camera port) |
| **I2C on FPC** | Pads **10/11** = GPIO4_B3/B2 = **`i2c7m3_xfer`** (SDA/SCL) |
| **Power** | **3.3 V only** from FPC pad **2** — never 5 V |
| **Minimum wires** | 4: 3V3, GND, SDA, SCL |
| **Recommended wires** | 5: add **RST** (FPC pad 9 → HAT pin 22) |
| **Firmware gap** | ImmortalWrt CM5 DT patch **`998-*-fpc-i2c7`** enables **`i2c7`** + `i2c7m3_xfer` on the FPC; onboard RTC remains on **`i2c1`** @ `0x51` |
| **Software** | Set UCI **`chip`** to **`sh1106_128x64`** for the Waveshare HAT (`luci-app-oled` also supports SSD1306 128×32/64) |

Wiring alone does not light the display — enable **`i2c7`** in firmware, set the correct **`path`**, and **`chip`** for SH1106. See [Firmware and software requirements](#firmware-and-software-requirements).

---

## 1. CM5 Base 12-pin FPC expansion port

The CM5 Base has **four separate MIPI CSI camera FPCs** plus one **12-pin, 0.5 mm pitch FPC** for general expansion. Per the [CM5 Base manual](https://orangepi.net/wp-content/uploads/2025/01/OrangePi_CM5_Base_RK3588S_user-manual_v1.3.pdf):

- **12-pin FPC**, 0.5 mm pitch
- **3.3 V** output (up to ~500 mA)
- Multiplexable: UART, PWM, I2C, SPI, CAN, GPIO

The silkscreen under the connector labels **GPIO1** (right columns) and **GPIO4** (left columns). `B0`–`B5` denote **bank B, bit N** on that GPIO controller (Rockchip naming: `GPIO4_B2` = `gpio4`, line `RK_PB2`).

### Pin map (pads 1–12)

Connector numbering: **pin 1 = bottom-right** (at the `1` mark on the board), **pin 12 = top-left** (at the `12` mark). On a typical green FPC-12P 0.5 mm breakout, odd pads sit on one row and even pads on the other.

| FPC pad | CM5 signal (silkscreen) | RK3588 pad | Notes |
|--------:|-------------------------|------------|-------|
| **1** | *(no test pad)* | — | Likely NC / mechanical; not labeled on silkscreen |
| **2** | **3V3** | — | 3.3 V power |
| **3** | **GND** | — | Ground |
| **4** | **B1** | GPIO1_B1 | General GPIO / SPI0_MISO_m2 |
| **5** | **B0** | GPIO1_B0 | General GPIO / SPI2_CS1_m2 |
| **6** | **B3** | GPIO1_B3 | General GPIO / SPI0_CLK_m2 |
| **7** | **B2** | GPIO1_B2 | General GPIO / SPI0_MOSI_m2 |
| **8** | **B5** | GPIO4_B5 | General GPIO / SPI3_MISO_m1 |
| **9** | **B4** | GPIO4_B4 | General GPIO — good candidate for **RST** |
| **10** | **B3** | GPIO4_B3 | **I2C7 SDA** (`i2c7m3_xfer`) |
| **11** | **B2** | GPIO4_B2 | **I2C7 SCL** (`i2c7m3_xfer`) |
| **12** | *(no test pad)* | — | Likely NC / mechanical |

> **Device-tree note:** The ImmortalWrt CM5 image enables **`i2c1`** with `i2c1m2_xfer` on **GPIO0_D4/D5** for the **onboard RTC** (HYM8563 @ `0x51`). That bus is **not** routed to this FPC. The FPC’s natural I2C pair is **`i2c7` mux m3** on **GPIO4_B2/B3** (pads 11/10), which is **not enabled** in the current CM5 device tree.

---

## 2. Waveshare 1.3" OLED HAT

| Item | Value |
|------|-------|
| Controller | **SH1106** (not SSD1306) |
| Resolution | **128×64** |
| Supply | **3.3 V only** |
| Factory mode | **4-wire SPI** (all jumpers at `0`) |
| I2C address | **0x3C** (with DC tied GND in I2C mode) |

The HAT exposes a standard **40-pin Raspberry Pi header**. For CM5 wiring, use the **female header on the HAT** with individual dupont leads — do not plug the HAT onto a Pi or CM5.

### HAT jumper settings — switch to I2C mode

Re-solder the six pads on the back of the HAT per the [Waveshare manual](https://files.waveshare.com/upload/4/46/1.3inch_OLED_HAT_User_Manual_EN.pdf):

| Jumper | I2C target | Factory SPI (`0`) |
|--------|------------|-------------------|
| **BS0** | `0` (GND) | `0` ✓ |
| **BS1** | `1` (3.3 V) | `0` — **move to `1`** |
| **CS** | `1` (GND) | `0` — **move to `1`** |
| **DC** | `1` (GND) | `0` — **move to `1`** |
| **CLK** | `1` → routes to **SCL** | `0` — **move to `1`** |
| **DIN** | `1` → routes to **SDA** | `0` — **move to `1`** |

**I2C mode summary:** `BS0=0`, `BS1=1`, and move **CS, DC, CLK, DIN** from `0` to `1`.

Waveshare documents I2C mode as **BS1/BS0 = 1/0** in their hardware table (equivalent to BS0=0, BS1=1 on the solder pads).

---

## 3. Recommended interface: I2C

**Use I2C**, not SPI:

- [`luci-app-oled`](../feeds/luci/luci-app-oled/) talks **I2C userspace** via `/usr/bin/oled`
- CM5 first-boot defaults set `path='/dev/i2c-1'` in `/etc/config/oled` — that bus hosts the **onboard RTC**, not the FPC
- FPC pads **10/11** map cleanly to **`i2c7m3`** (GPIO4_B3/B2)

After enabling `i2c7` in firmware, run `i2cdetect` to find the correct `/dev/i2c-N` and update UCI.

---

## 4. Wire-by-wire table (I2C)

Physical pin numbers below are **standard Raspberry Pi 40-pin header numbering** on the Waveshare HAT.

| FPC breakout pad | CM5 signal | → | Waveshare HAT physical pin | HAT function |
|------------------|------------|---|---------------------------|--------------|
| **2** | 3V3 | → | **1** | 3.3 V |
| **3** | GND | → | **6** | GND |
| **10** | GPIO4_B3 (I2C SDA) | → | **3** | SDA |
| **11** | GPIO4_B2 (I2C SCL) | → | **5** | SCL |
| **9** *(recommended)* | GPIO4_B4 | → | **22** | RST |

**Minimum 4 wires:** 3V3, GND, SDA, SCL.

**5 wires (recommended):** add RST from pad **9** to HAT pin **22**.

Do **not** connect HAT pins **2** or **4** (5 V).

### ASCII wiring diagram

```text
Orange Pi CM5 Base                    Waveshare 1.3" OLED HAT
12-pin FPC breakout (0.5 mm)          40-pin header (use dupont wires)

  Pad  2  3V3  ──────────────────────►  Pin  1   3.3 V
  Pad  3  GND  ──────────────────────►  Pin  6   GND
  Pad 10  SDA  (GPIO4_B3 / i2c7)  ────►  Pin  3   SDA
  Pad 11  SCL  (GPIO4_B2 / i2c7)  ────►  Pin  5   SCL
  Pad  9  RST  (GPIO4_B4)         ────►  Pin 22   RST   [optional, recommended]

  Pin 1 on FPC cable ──► align to "1" mark on CM5 connector (bottom-right)
```

### Mermaid connection diagram

```mermaid
flowchart LR
  subgraph CM5["CM5 Base FPC"]
    P2["Pad 2 — 3V3"]
    P3["Pad 3 — GND"]
    P10["Pad 10 — SDA\nGPIO4_B3"]
    P11["Pad 11 — SCL\nGPIO4_B2"]
    P9["Pad 9 — RST\nGPIO4_B4"]
  end

  subgraph HAT["Waveshare 1.3\" OLED HAT"]
    H1["Pin 1 — 3.3 V"]
    H6["Pin 6 — GND"]
    H3["Pin 3 — SDA"]
    H5["Pin 5 — SCL"]
    H22["Pin 22 — RST"]
  end

  P2 --> H1
  P3 --> H6
  P10 --> H3
  P11 --> H5
  P9 -.-> H22
```

---

## 5. Alternative: 4-wire SPI (not recommended)

The HAT ships in **4-wire SPI** mode (`BS0=0`, `BS1=0`). SPI needs **SCLK, MOSI, CS, DC, RST**. The FPC exposes only a **subset** of SPI0_m2 pins; there is **no dedicated CS** line for `spi0_m2` on the FPC.

| FPC pad | CM5 signal | SPI0_m2 role | → HAT pin | HAT signal |
|---------|------------|--------------|-----------|------------|
| 2 | 3V3 | — | 1 | 3.3 V |
| 3 | GND | — | 6 | GND |
| 6 | GPIO1_B3 | SCLK | 23 | SCLK |
| 7 | GPIO1_B2 | MOSI | 19 | MOSI |
| 8 | GPIO4_B5 | *(GPIO CS)* | 24 | CE0 |
| 9 | GPIO4_B4 | *(GPIO DC)* | 18 | GPIO24 / DC |
| 5 or 4 | GPIO1_B0/B1 | *(GPIO RST)* | 22 | RST |

### SPI software changes required

- Enable **SPI controller** + pinmux in device tree (`spi0` m2 + GPIO CS/DC/RST)
- `luci-app-oled` is **I2C-only** — would need a different stack (Waveshare examples, mainline DRM `ssd130x`, or a custom daemon)
- Controller is still **SH1106 128×64**, not SSD1306 128×32

**Verdict:** SPI is possible with creative GPIO wiring but a poor fit for the current CM5 ImmortalWrt stack. Prefer I2C.

---

## 6. Warnings

| Topic | Guidance |
|-------|----------|
| **Voltage** | **3.3 V only.** Never use 5 V (HAT pins 2/4) on the CM5 FPC. |
| **FPC pitch** | CM5 socket is **0.5 mm**. Use a **0.5 mm** cable/breakout. A 1.0 mm breakout will not fit. |
| **Pin 1 orientation** | Align cable **pin 1** to the **`1`** mark on the CM5 connector (bottom-right). A reversed cable swaps power and data. |
| **Current** | FPC 3.3 V is rated ~500 mA; OLED draw is small (~tens of mA). |
| **I2C pull-ups** | HAT typically includes pull-ups; usually fine. If the bus is unstable, verify with `i2cdetect` or a scope. |
| **Controller chip** | HAT is **SH1106 128×64** — UCI must use `chip='sh1106_128x64'`, not `ssd1306_*`. |
| **Unused HAT pins** | Joystick and buttons on the HAT are not wired in this harness; ignore unless you add more GPIO lines from the FPC. |

---

## 7. Firmware and software requirements

Wiring is necessary but not sufficient. See [ssd1306-oled-openwrt-research.md](ssd1306-oled-openwrt-research.md) for the full software comparison.

| Issue | Detail |
|-------|--------|
| **Wrong I2C controller** | Image enables **`i2c1`** (RTC on GPIO0). FPC needs **`i2c7`** with `pinctrl-0 = <&i2c7m3_xfer>` in CM5 device tree |
| **Wrong `/dev/i2c-N`** | With `i2c7` enabled, the FPC bus is usually **`/dev/i2c-3`** (after `i2c0`, `i2c2`, `i2c1`); confirm with `i2cdetect` and set `oled.@oled[0].path` to the bus showing **`0x3c`** |
| **SH1106 vs SSD1306** | HAT is **SH1106 128×64**; set UCI `chip='sh1106_128x64'` (`luci-app-oled` r7+). Wrong chip → blank or garbled output |
| **No bus conflict** | Onboard RTC stays on `i2c1` @ `0x51`; OLED on separate `i2c7` @ `0x3c` |

---

## 8. Verification on router

Run after wiring **and** enabling `i2c7` in device tree.

### 1) Confirm I2C device nodes

```sh
ls -l /dev/i2c-*
```

### 2) Scan all buses (find which number is `i2c7`)

```sh
for b in /dev/i2c-*; do
  n=${b#/dev/i2c-}
  echo "=== i2cdetect -y $n ==="
  i2cdetect -y "$n"
done
```

**Expected after enabling `i2c7`:** `0x3c` on the FPC bus.

**On current image without DT change:** `i2c-1` shows `0x51` (RTC) only; an OLED on the FPC will **not** appear.

### 3) Kernel / mux check

```sh
dmesg | grep -iE 'i2c|ssd1306|oled|sh1106'
```

### 4) Configure and start OLED daemon

```sh
uci set oled.@oled[0].chip='sh1106_128x64'
uci set oled.@oled[0].path='/dev/i2c-N'    # replace N with bus where 3c appears
uci set oled.@oled[0].enable='1'
uci commit oled
/etc/init.d/oled restart
pgrep -af oled
```

### 5) LuCI

- **System → Peripherals → OLED display** — bus scan, UCI toggles, service control
- **Services → OLED** — full screensaver options (when `showmenu=1`)

---

## 9. Checklist

1. Use **0.5 mm** FPC cable; align **pin 1** to the CM5 `1` mark
2. Re-solder HAT jumpers to **I2C mode** (`BS0=0`, `BS1=1`, CS/DC/CLK/DIN → `1`)
3. Wire **4–5 lines**: 3V3, GND, SDA (pad 10), SCL (pad 11), optional RST (pad 9 → HAT pin 22)
4. **Enable `i2c7` + `i2c7m3_xfer`** in CM5 device tree (firmware change in `immortalwrt`)
5. Point UCI `path` at the correct `/dev/i2c-N`
6. Set UCI **`chip`** to **`sh1106_128x64`** (CM5 first-boot default when OLED is detected on FPC I2C)

---

## 10. Debugging

Work bottom-up: **hardware → I2C scan → UCI → daemon → LuCI**.

### Sanity script (SSH)

```sh
echo "=== buses ===" && ls /dev/i2c-* 2>/dev/null
echo "=== scan ===" && for b in /dev/i2c-*; do n=${b#/dev/i2c-}; echo "--- $b"; i2cdetect -y "$n"; done
echo "=== dmesg i2c7 ===" && dmesg | grep -i i2c7
echo "=== uci ===" && uci show oled 2>/dev/null
echo "=== daemon ===" && pgrep -af oled || echo "oled not running"
```

**Healthy pattern:** `i2c7` in dmesg; **`0x3c`** on one bus (not the RTC bus with `0x51`); UCI `chip='sh1106_128x64'` and matching `path`; `oled` in `pgrep`.

### Quick decision tree

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No `0x3c` on any bus | Wiring, I2C jumpers, or image without patch `998` | §1–2; flash firmware with `i2c7` enabled |
| Only `0x51` on `i2c-1` | Normal RTC; OLED bus missing or unwired | Enable DT `i2c7`; check FPC pads 10/11 |
| `0x3c` present, UCI `path` wrong | Pointing at RTC bus | `uci set oled.@oled[0].path='/dev/i2c-N'` (bus with `3c`) |
| Blank / garbled display | Wrong `chip` | `uci set oled.@oled[0].chip='sh1106_128x64'` |
| `enable='0'` | OLED unplugged at first boot | `uci set oled.@oled[0].enable='1'`; restart daemon |

### Manual daemon test

```sh
/etc/init.d/oled stop
/usr/bin/oled --needInit --i2cDevPath=/dev/i2c-N --chip=sh1106_128x64 --ipIfName=br-lan
```

Replace `N` with the bus where `i2cdetect` shows `3c`. Re-enable with `/etc/init.d/oled start` when done.

---

## References

- [ssd1306-oled-openwrt-research.md](ssd1306-oled-openwrt-research.md) — OpenWrt/ImmortalWrt OLED software research
- [`feeds/luci/luci-app-oled`](../feeds/luci/luci-app-oled/) — vendored LuCI + `/usr/bin/oled` daemon
- [Orange Pi CM5 Base manual v1.3 (PDF)](https://orangepi.net/wp-content/uploads/2025/01/OrangePi_CM5_Base_RK3588S_user-manual_v1.3.pdf)
- [Waveshare 1.3" OLED HAT manual (PDF)](https://files.waveshare.com/upload/4/46/1.3inch_OLED_HAT_User_Manual_EN.pdf)
- ImmortalWrt CM5 DTS: `i2c1` + RTC @ `0x51` in `994-03`; FPC I2C = `i2c7m3` on GPIO4_B2/B3 enabled in `998-*-fpc-i2c7` patch
