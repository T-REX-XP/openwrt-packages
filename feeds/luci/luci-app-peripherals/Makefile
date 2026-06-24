# SPDX-License-Identifier: Apache-2.0
#
# LuCI + rpcd/ucode backend for IR remote, PWM fan, and peripheral diagnostics.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Peripherals (IR, fan, OLED, diagnostics)
# luci-base pulls rpcd-mod-ucode, ucode-mod-fs, ...; v4l-utils provides ir-keytable for IR Apply.
# OLED daemon comes from luci-app-oled (optional); this app manages UCI and service when present.
LUCI_DEPENDS:=+luci-base +v4l-utils +kmod-ir-gpio-cir +kmod-hwmon-pwmfan
LUCI_PKGARCH:=all
PKG_VERSION:=2026.04.26
PKG_RELEASE:=13

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=Immortal OPI CM5 overlay

define Package/luci-app-peripherals/conffiles
/etc/config/luci_peripherals
endef

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
