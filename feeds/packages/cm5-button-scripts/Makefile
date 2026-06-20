# SPDX-License-Identifier: GPL-2.0-only
#
# CM5 Base button hotplug scripts. Installed after wifi-scripts so /etc/rc.button/wps
# is not overwritten by the generic WPS handler.

include $(TOPDIR)/rules.mk

PKG_NAME:=cm5-button-scripts
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=Immortal OPI CM5 overlay
PKG_LICENSE:=GPL-2.0-only

include $(INCLUDE_DIR)/package.mk

define Package/cm5-button-scripts
  SECTION:=utils
  CATEGORY:=Base system
  TITLE:=Orange Pi CM5 Base button hotplug scripts
  DEPENDS:=@TARGET_rockchip_armv8 +kmod-gpio-button-hotplug +kmod-button-hotplug +kmod-input-adc-keys
  PKGARCH:=all
endef

define Package/cm5-button-scripts/description
  Default /etc/rc.button/wps and /etc/rc.button/BTN_2 handlers for the
  Orange Pi CM5 Base USERKEY and MaskROM buttons (live state + logging).
endef

define Package/cm5-button-scripts/install
	$(INSTALL_DIR) $(1)/etc/rc.button
	$(INSTALL_BIN) ./files/wps $(1)/etc/rc.button/wps
	$(INSTALL_BIN) ./files/BTN_2 $(1)/etc/rc.button/BTN_2
endef

$(eval $(call BuildPackage,cm5-button-scripts))
