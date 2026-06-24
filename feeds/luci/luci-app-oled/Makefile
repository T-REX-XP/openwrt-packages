# SPDX-License-Identifier: GPL-3.0-or-later
#
# Vendored from https://github.com/NateLol/luci-app-oled (master, 20230823).

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for SSD1306 OLED display
LUCI_DEPENDS:=+libconfig +i2c-tools +coreutils-nohup
LUCI_PKGARCH:=$(if $(realpath src/Makefile),,all)

PKG_VERSION:=20230823
PKG_RELEASE:=6

PKG_LICENSE:=GPL-3.0-or-later
PKG_LICENSE_FILES:=LICENSE src/LICENSE
PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>

define Package/luci-app-oled/conffiles
/etc/config/oled
endef

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
