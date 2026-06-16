# SSD1306 OLED on OpenWrt / ImmortalWrt — Research Report

*Saved for internal planning. Last updated: 2026-05-14.*

## Summary

Small **SSD1306** I2C OLED panels can be supported on OpenWrt/ImmortalWrt (including **Orange Pi CM5 Base**), but **[Dev4Embedded/ssd1306](https://github.com/Dev4Embedded/ssd1306) is not the best default choice**. Prefer **mainline kernel drivers** or community packages such as **[luci-app-oled](https://github.com/NateLol/luci-app-oled)**, or extend the existing **`luci-app-peripherals`** stack on the CM5 image.

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
- Depends on **`kmod-i2c-*`** (I2C core + bus driver)
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

### 3. Extend luci-app-peripherals (CM5-specific UX)

The CM5 image already ships **`luci-app-peripherals`** (**System → Peripherals**) with **`luci.peripherals`** rpcd backend (fan, IR, diagnostics — see `immortal_opi_cm5/docs/FEATURES_AND_DEBUG.md`).

A natural integration path:

- Add an **OLED** section: UCI, **`rpcd`** methods, init/procd script
- Reuse or fork **luci-app-oled** daemon logic (I2C userspace) rather than Dev4Embedded
- Keeps hardware controls in one LuCI menu

### 4. Python stacks (experimental / heavier)

Examples: [dbian/pi3b_screen](https://github.com/dbian/pi3b_screen), `luma.oled`, [karabek/OrangePi-OLED](https://github.com/karabek/OrangePi-OLED).

Flexible but **heavier** on OpenWrt (Python 3 + dependencies, procd glue). Reasonable for bring-up; weaker for a default router firmware profile.

---

## Orange Pi CM5 Base — hardware / DTS context

From **`immortal_opi_cm5`** device trees:

- **`i2c0`**, **`i2c1`**, **`i2c2`** are enabled in the CM5 DTS
- **`i2c1`** already hosts an **RTC at `0x51`** — a typical SSD1306 at **`0x3c`** can share the same bus if the carrier breaks out SDA/SCL to that controller

Confirm wiring against the **CM5 Base carrier schematic** (which header pins map to which I2C instance).

---

## Requirements (any approach)

| Layer | Requirement |
|--------|-------------|
| **Hardware** | SSD1306 module on **3.3 V I2C** (common address **`0x3c`** or **`0x3d`**) |
| **Kernel** | `kmod-i2c-core`, Rockchip I2C (`CONFIG_I2C_RK3X` — present on CM5 config) |
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
| **Extend luci-app-peripherals** | Yes | Medium–high | Good (fits existing tree) | **Best UX fit** |
| **Python OLED tools** | Optional | Low (hack) / high (product) | Fair | OK |

---

## Recommended next steps

1. **Do not** adopt Dev4Embedded as the default unless a **`/dev/ssd1306` char device** is an explicit goal.
2. **Short path:** Vendor **luci-app-oled** into `openwrt-packages` or `immortalwrt`; configure **`/etc/config/oled`** for CM5 (I2C bus, `br-lan`, 128×32/64); add **`kmod-i2c-*`** and the app to **`DEVICE_PACKAGES`** if it should ship in the image.
3. **Long-term:** Add an **SSD1306 DT node** on the wired I2C bus, enable **mainline `ssd130x`**, then use fbcon or a small daemon; optionally expose settings in **Peripherals**.
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

- `immortal_opi_cm5/docs/FEATURES_AND_DEBUG.md` — **luci-app-peripherals**, fan, IR, CM5 packages
- `openwrt-packages/docs/reticulum-nomadnet-openwrt-research.md` — separate mesh networking research
