# SSD1306 OLED on OpenWrt / ImmortalWrt — Research Report

*Last updated: 2026-06-25.*

## CM5 Base + Waveshare 1.3" OLED HAT (hardware)

For **wire-by-wire** connection of a [Waveshare 1.3" OLED HAT](https://www.waveshare.com/1.3inch-oled-hat.htm) to the **Orange Pi CM5 Base** 12-pin FPC expansion port, see **[cm5-waveshare-oled-hat-wiring.md](cm5-waveshare-oled-hat-wiring.md)**.

Key points that affect software choices below:

| Topic | Detail |
|-------|--------|
| **FPC I2C** | Pads **11/12** = GPIO4_B2/B3 = **`i2c7m3`** — requires enabling **`i2c7`** in CM5 device tree (stock image only enables **`i2c1`** for onboard RTC @ `0x51`) |
| **UCI path** | CM5 images default **`/dev/i2c-7`** when FPC `i2c7` is enabled; confirm with **`i2cget -y 7 0x3c 0x00 b`** |
| **Controller** | Waveshare HAT uses **SH1106 128×64** — set `oled.@oled[0].chip='sh1106_128x64'` in UCI (CM5 uci-defaults when `0x3c` is found on FPC I2C) |

---

## Summary

Small **SSD1306** I2C OLED panels can be supported on OpenWrt/ImmortalWrt (including **Orange Pi CM5 Base**), but **[Dev4Embedded/ssd1306](https://github.com/Dev4Embedded/ssd1306) is not the best default choice**. Prefer **mainline kernel drivers** or community packages such as **[luci-app-oled](https://github.com/NateLol/luci-app-oled)**, or extend the existing **`luci-app-peripherals`** stack on the CM5 image.

## Verified packages (ImmortalWrt 25.12 / CM5)

Cross-checked against **ImmortalWrt `config-6.12`**, **OpenWrt `packages` feed**, and **[NateLol/luci-app-oled](https://github.com/NateLol/luci-app-oled)** (`master`).

### CM5 kernel (built-in — not separate kmods)

| Kconfig | Status | Effect |
|---------|--------|--------|
| `CONFIG_I2C=y` | **y** | I2C core in kernel image |
| `CONFIG_I2C_CHARDEV=y` | **y** | `/dev/i2c-*` char devices |
| `CONFIG_I2C_RK3X=y` | **y** | Rockchip I2C (i2c0/1/2 in CM5 DTS) |
| `CONFIG_DRM*` / SSD130x | **absent** | No mainline OLED framebuffer yet |

On a stock CM5 image you usually **do not** need `kmod-i2c-core` — bus driver and `i2c-dev` are already in the kernel. **luci-app-oled** still mentions `kmod-i2c-*` for routers where I2C is modular or disabled ([issue #10](https://github.com/NateLol/luci-app-oled/issues/10)).

### Packages by approach

| Approach | Install on router | Feed / source | In `openwrt-packages`? |
|----------|-------------------|---------------|-------------------------|
| **luci-app-oled** | `luci-app-oled` | [feeds/luci/luci-app-oled](../feeds/luci/luci-app-oled/) | **Yes** |
| | `i2c-tools` | [packages/utils/i2c-tools](https://github.com/openwrt/packages/tree/master/utils/i2c-tools) | No (standard feed) |
| | `coreutils-nohup` | [packages/utils/coreutils](https://github.com/openwrt/packages/tree/master/utils/coreutils) | No |
| | `libuci` | base | — |
| **Bring-up** | `i2c-tools` | packages feed | No |
| **Mainline DRM** | *(none today)* | `CONFIG_DRM_SSD130X` + DT in `config-6.12` | No kmod until `=m` |
| **Dev4Embedded** | custom `kmod-ssd1306` | Out-of-tree | **Avoid** |
| **Peripherals UX** | `luci-app-peripherals` | [feeds/luci/luci-app-peripherals](../feeds/luci/luci-app-peripherals/) | **Yes** (I2C tab + rpcd; OLED config in luci-app-oled) |

**luci-app-oled `LUCI_DEPENDS`:** `+i2c-tools +coreutils-nohup +libuci` — userspace I2C daemon, not a kernel module.

### CM5 bring-up install (short path)

```sh
apk add i2c-tools coreutils-nohup   # if not on image
apk add luci-app-oled               # after vendoring into feed
i2cdetect -y 7                      # expect 0x3c on i2c7 (CM5 FPC)
# Configure /etc/config/oled: chip sh1106_128x64, path /dev/i2c-7, menu_mode 1
/etc/init.d/oledd enable && /etc/init.d/oledd start
```

---

## Dev4Embedded/ssd1306

**Repository:** [Dev4Embedded/ssd1306](https://github.com/Dev4Embedded/ssd1306)

This project is an **out-of-tree Linux kernel module**, not a LuCI app or userspace tool.

| Aspect | Detail |
|--------|--------|
| Resolution | **128×32** hard-coded |
| Interface | **`/dev/ssd1306`** char device — `echo "Hello World!" > /dev/ssd1306` |
| I2C setup | Manual: `echo ssd1306 0x3C > /sys/class/i2c-adapter/i2c-<N>/new_device` then `insmod ssd1306.ko` |
| Maturity | Early / small project; ioctl command path not fully implemented per upstream README |
| OpenWrt | **No packaged feed**; would require custom **`kmod-ssd1306`** built against the image kernel (e.g. 6.12) |

**Verdict:** Usable only if you explicitly want a minimal char-device experiment. Higher maintenance and less capability than mainline Linux or existing OpenWrt-oriented OLED daemons.

---

## Better approaches (ranked)

### 1. luci-app-oled (LuCI + status daemon)

**Repository:** [NateLol/luci-app-oled](https://github.com/NateLol/luci-app-oled)

Best match for **“OpenWrt web UI + small OLED status display”**:

- LuCI under **Services → OLED**
- Shows time, LAN IP, CPU temp/freq, link speed, screensavers, optional night auto-off
- Includes a **C userspace daemon** (`src/`) that talks **I2C directly** (not the Dev4Embedded kernel module)
- Depends on **`i2c-tools`**, **`coreutils-nohup`**, **`libuci`** (see Makefile); **not** a kernel module
- Kernel must expose **`/dev/i2c-N`** (`CONFIG_I2C` + `CONFIG_I2C_CHARDEV` + bus driver — **already on CM5**)
- On modular-I2C targets, also install **`kmod-i2c-core`** (and platform bus kmod if applicable)
- Tested on NanoPi R2S, Hinlink H69K, Raspberry Pi CM4 (CM4 may need DT/bus tweaks — [issue #10](https://github.com/NateLol/luci-app-oled/issues/10))

Example daemon config keys (from upstream `linux/ssd1306.cfg`): `i2cDevPath`, rotation, display toggles, interface names (`eth0` vs `br-lan`).

**CM5 Base:** Feasible if the panel is wired to an enabled I2C bus and config matches hardware (bus number, resolution 128×32 vs 128×64, LAN interface name).

### 2. Mainline kernel driver (recommended long-term)

Linux **6.12** (ImmortalWrt CM5 kernel) includes Solomon SSD1306 support via the **DRM `ssd130x` driver** (Linux 5.18+). Older **`ssd1307fb`** fbdev driver exists but is **deprecated** per [kernel DT bindings](https://www.kernel.org/doc/Documentation/devicetree/bindings/display/solomon%2Cssd1307fb.yaml).

Example device-tree node on the I2C bus:

```dts
ssd1306: oled@3c {
    compatible = "solomon,ssd1306";
    reg = <0x3c>;
    solomon,width = <128>;
    solomon,height = <64>;   /* use 32 for common 0.91" modules */
};
```

Enable matching **`CONFIG_DRM_*` / SSD130x** options in `target/linux/rockchip/armv8/config-6.12`. The driver exposes **framebuffer (`/dev/fb*`)** — usable for fbcon, simple drawing, or a small status daemon without a third-party kernel module.

**Current CM5 kernel config:** I2C is enabled (`CONFIG_I2C`, `CONFIG_I2C_RK3X`, `CONFIG_I2C_CHARDEV`); **SSD1306/DRM OLED options are not enabled yet**.

References: [Using SSD1306 on Fedora (ssd130x DRM)](https://blog.dowhile0.org/2022/08/18/using-an-i2c-ssd1306-oled-on-fedora-with-a-raspberry-pi/), [Raspberry Pi kernel discussion on ssd1306 drivers](https://github.com/raspberrypi/linux/issues/7012).

### 3. luci-app-peripherals (CM5) — **implemented**

The CM5 image ships **`luci-app-peripherals`** (**System → Peripherals**) with **`luci.peripherals`** rpcd backend (fan, IR, I2C scan, module diagnostics).

**Split with luci-app-oled (2026-06):**

- **I2C tab** — read-only bus scan (`scanI2c` RPC, `i2c-tools`); cross-link to **Services → OLED**
- **luci-app-oled** — all OLED UCI, `oledd` service, RST pulse, button mapping, boot splash
- Reuses **oledd** / legacy **oled** daemons from **luci-app-oled** — no Dev4Embedded kernel module

**Long-term:** mainline **DRM `ssd130x`** + device-tree node (see §2 below).

### 4. Python stacks (experimental / heavier)

Examples: [dbian/pi3b_screen](https://github.com/dbian/pi3b_screen), `luma.oled`, [karabek/OrangePi-OLED](https://github.com/karabek/OrangePi-OLED).

Flexible but **heavier** on OpenWrt (Python 3 + dependencies, procd glue). Reasonable for bring-up; weaker for a default router firmware profile.

---

## Orange Pi CM5 Base — hardware / DTS context

From **`immortal_opi_cm5`** device trees:

- **`i2c0`**, **`i2c1`**, **`i2c2`** are enabled in the CM5 DTS
- **`i2c1`** already hosts an **RTC at `0x51`** — a typical SSD1306 at **`0x3c`** can share the same bus if the carrier breaks out SDA/SCL to that controller

**Waveshare 1.3" OLED HAT on the 12-pin FPC:** the natural I2C pair is **`i2c7m3`** on GPIO4_B2/B3 (FPC pads **11/12**), enabled in CM5 ImmortalWrt patch **998**. See **[cm5-waveshare-oled-hat-wiring.md](cm5-waveshare-oled-hat-wiring.md)** for the full pin map, jumper settings, and verification steps.

Confirm other wiring against the **CM5 Base carrier schematic** (which header pins map to which I2C instance).

---

## Requirements (any approach)

| Layer | Requirement |
|--------|-------------|
| **Hardware** | SSD1306 module on **3.3 V I2C** (common address **`0x3c`** or **`0x3d`**) |
| **Kernel** | Built-in on CM5: `CONFIG_I2C`, `CONFIG_I2C_CHARDEV`, `CONFIG_I2C_RK3X`. Else: **`kmod-i2c-core`** (+ platform bus kmod if modular) |
| **Device tree / config** | OLED DT node **or** userspace config with correct **`/dev/i2c-N`** |
| **Bring-up** | `i2c-tools` → `i2cdetect -y N` should show **`3c`** (or your address) |
| **LuCI (optional)** | **luci-app-oled** or **Peripherals** extension |

**Common failures** on Orange Pi + OpenWrt ([Stack Overflow example](https://stackoverflow.com/questions/75368467/i2c-oled-ssd1306-on-orange-pi-r1-plus-lts-with-openwrt)):

- No **`/dev/i2c-*`** → I2C bus not enabled in DT or wrong bus index
- **`Resource busy`** / probe errors → wrong I2C address, conflicting driver, or panel needs reset GPIO in DT

---

## Option comparison

| Option | LuCI | Effort | Maintainability | CM5 fit |
|--------|------|--------|-------------------|---------|
| **Dev4Embedded/ssd1306** | No | High (custom kmod) | Low | Poor |
| **luci-app-oled** | Yes | Medium (port config/DT) | Good | Good |
| **Mainline DT + fb/daemon** | Via custom LuCI | Medium | **Best** | Good |
| **Extend luci-app-peripherals** | Yes | Medium | Good (fits existing tree) | **Best UX fit** |
| **Python OLED tools** | Optional | Low (hack) / high (product) | Fair | OK |

---

## Recommended next steps

1. **Do not** adopt Dev4Embedded as the default unless a **`/dev/ssd1306` char device** is an explicit goal.
2. **Short path:** **`luci-app-oled`** is vendored in [`feeds/luci/luci-app-oled`](../feeds/luci/luci-app-oled/). CM5 image ships **`luci-app-oled`** via **`DEVICE_PACKAGES`**; first boot sets **`/dev/i2c-7`**, **`menu_mode=1`**, and **`oledd`**. **Services → OLED** owns configuration; **System → Peripherals → I2C** provides read-only bus scan.
3. **Long-term:** Add an **SSD1306 DT node** on the wired I2C bus, enable **mainline `ssd130x`**, then use fbcon or a small daemon.
4. **Bring-up checklist:** Install **`i2c-tools`**, run **`i2cdetect`**, verify **`dmesg`** after adding DT or starting the OLED daemon.

---

## References (external)

- [Dev4Embedded/ssd1306](https://github.com/Dev4Embedded/ssd1306)
- [NateLol/luci-app-oled](https://github.com/NateLol/luci-app-oled)
- [Kernel DT bindings — solomon,ssd1307fb.yaml](https://www.kernel.org/doc/Documentation/devicetree/bindings/display/solomon%2Cssd1307fb.yaml)
- [SSD1306 on Fedora with ssd130x DRM (blog)](https://blog.dowhile0.org/2022/08/18/using-an-i2c-ssd1306-oled-on-fedora-with-a-raspberry-pi/)
- [Orange Pi R1 Plus LTS + OpenWrt SSD1306 (Stack Overflow)](https://stackoverflow.com/questions/75368467/i2c-oled-ssd1306-on-orange-pi-r1-plus-lts-with-openwrt)
- [dbian/pi3b_screen — OpenWrt OLED example (Python)](https://github.com/dbian/pi3b_screen)

## Related internal docs

- [cm5-waveshare-oled-hat-wiring.md](cm5-waveshare-oled-hat-wiring.md) — CM5 Base FPC → Waveshare 1.3" OLED HAT wire harness
- `immortal_opi_cm5/docs/FEATURES_AND_DEBUG.md` — **luci-app-peripherals**, fan, IR, CM5 packages
- `openwrt-packages/docs/reticulum-nomadnet-openwrt-research.md` — separate mesh networking research
