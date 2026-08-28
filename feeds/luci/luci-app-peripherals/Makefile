# SPDX-License-Identifier: Apache-2.0
#
# LuCI + rpcd/ucode backend for IR remote, PWM fan, and peripheral diagnostics.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Peripherals (IR, fan, diagnostics)
# luci-base pulls rpcd-mod-ucode, ucode-mod-fs, ...
# CM5 onboard IR uses PWM capture; ir-keytable (v4l-utils) is optional for external GPIO IR only.
# MCU display configuration is in luci-app-mcu-display; this app exposes read-only I2C diagnostics when present.
LUCI_DEPENDS:=+luci-base +i2c-tools +kmod-ir-gpio-cir +kmod-hwmon-pwmfan
LUCI_PKGARCH:=all
PKG_VERSION:=2026.04.26
PKG_RELEASE:=24

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Immortal OPI CM5 overlay

define Package/luci-app-peripherals/conffiles
/etc/config/luci_peripherals
endef

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
