# SPDX-License-Identifier: GPL-3.0-or-later

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for ESP32 MCU smart display (UART)
LUCI_DEPENDS:=+luci-base +libubus +libubox +libblobmsg-json
LUCI_PKGARCH:=$(if $(realpath src/Makefile),$(ARCH_PACKAGES),all)

PKG_NAME:=luci-app-mcu-display
PKG_VERSION:=2026.07.06
PKG_RELEASE:=24

PKG_LICENSE:=GPL-3.0-or-later
PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

define Package/luci-app-mcu-display/conffiles
/etc/config/mcud
/etc/mcud/pages.json
endef

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./src $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(MAKE) -C $(PKG_BUILD_DIR)/src \
		CC="$(TARGET_CC)" \
		CFLAGS="$(TARGET_CFLAGS) -Wall" \
		LDFLAGS="$(TARGET_LDFLAGS)"
endef

define Package/luci-app-mcu-display/install
	$(call Package/luci/install/template,$(1))
	$(INSTALL_DIR) $(1)/usr/sbin $(1)/etc/init.d $(1)/usr/lib/mcud
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/src/mcudd-bin $(1)/usr/sbin/mcudd
	$(INSTALL_BIN) ./root/etc/init.d/mcudd $(1)/etc/init.d/mcudd
	$(INSTALL_BIN) ./root/usr/lib/mcud/mcud-event.sh $(1)/usr/lib/mcud/mcud-event.sh
	$(INSTALL_BIN) ./root/usr/lib/mcud/mcud-boot-state.sh $(1)/usr/lib/mcud/mcud-boot-state.sh
	$(INSTALL_DIR) $(1)/etc/hotplug.d/button $(1)/etc/hotplug.d/net
	$(INSTALL_BIN) ./root/etc/hotplug.d/button/99-mcud $(1)/etc/hotplug.d/button/99-mcud
	$(INSTALL_BIN) ./root/usr/lib/mcud/mcud-autodiscover.sh $(1)/usr/lib/mcud/mcud-autodiscover.sh
	$(INSTALL_DIR) $(1)/etc/hotplug.d/usb
	$(INSTALL_BIN) ./root/etc/hotplug.d/usb/99-mcud $(1)/etc/hotplug.d/usb/99-mcud
	$(INSTALL_DIR) $(1)/etc/mcud
	$(INSTALL_DATA) ./root/etc/mcud/pages.json $(1)/etc/mcud/pages.json
endef

# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
