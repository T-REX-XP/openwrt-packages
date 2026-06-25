# SPDX-License-Identifier: GPL-3.0-or-later
#
# Vendored from https://github.com/NateLol/luci-app-oled (master, 20230823).

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI support for SH1106 128×64 OLED display
LUCI_DEPENDS:=+luci-base +libconfig +libubus +libubox +libblobmsg-json +i2c-tools +coreutils-nohup
LUCI_PKGARCH:=$(if $(realpath src/Makefile),$(ARCH_PACKAGES),all)

PKG_NAME:=luci-app-oled
PKG_VERSION:=20230823
PKG_RELEASE:=42

PKG_LICENSE:=GPL-3.0-or-later
PKG_LICENSE_FILES:=LICENSE src/LICENSE
PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)-$(PKG_VERSION)

define Package/luci-app-oled/conffiles
/etc/config/oled
endef

define Build/Prepare
	$(INSTALL_DIR) $(PKG_BUILD_DIR)
	$(CP) ./src $(PKG_BUILD_DIR)/
endef

define Build/Compile
	$(MAKE) -C $(PKG_BUILD_DIR)/src \
		CC="$(TARGET_CC)" \
		CFLAGS="$(TARGET_CFLAGS) -Wall" \
		LDFLAGS="$(TARGET_LDFLAGS) -lpthread -lconfig" \
		OLEDD_LDFLAGS="$(TARGET_LDFLAGS) -lpthread -lubus -lubox -lblobmsg_json"
endef

define Package/luci-app-oled/install
	$(call Package/luci/install/template,$(1))
	$(INSTALL_DIR) $(1)/usr/bin $(1)/usr/sbin $(1)/etc/init.d $(1)/usr/lib/oled
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/src/oled $(1)/usr/bin/oled
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/src/oledd-bin $(1)/usr/sbin/oledd
	$(INSTALL_BIN) ./root/etc/init.d/oledd $(1)/etc/init.d/oledd
	$(INSTALL_BIN) ./root/etc/init.d/oled $(1)/etc/init.d/oled
	$(INSTALL_BIN) ./root/usr/lib/oled/cm5-apply-config.sh $(1)/usr/lib/oled/cm5-apply-config.sh
endef

# include/scan.mk only indexes dirs whose Makefile matches "call BuildPackage"; the real call is in luci.mk.
# call BuildPackage

include $(TOPDIR)/feeds/luci/luci.mk
