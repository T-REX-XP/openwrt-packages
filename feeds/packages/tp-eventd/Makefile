#
# Tail Suricata EVE JSON into a SQLite ring for LuCI.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=tp-eventd
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>
PKG_LICENSE:=Apache-2.0

include $(INCLUDE_DIR)/package.mk

define Package/tp-eventd
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Routing and Redirection
  TITLE:=Threat Prevention EVE → SQLite ring
  DEPENDS:=+sqlite3-cli +jsonfilter
  PKGARCH:=all
endef

define Package/tp-eventd/description
  Reads Suricata eve.json alert lines into
  /var/lib/threat-prevention/events.sqlite (capped ring) and
  /tmp/tp_status.json for rpcd.
endef

define Build/Prepare
endef

define Build/Configure
endef

define Build/Compile
endef

define Package/tp-eventd/install
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/tp-eve-ingest $(1)/usr/sbin/tp-eve-ingest
	$(INSTALL_BIN) ./files/usr/sbin/tp-eventd $(1)/usr/sbin/tp-eventd
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/tp-eventd.init $(1)/etc/init.d/tp-eventd
endef

$(eval $(call BuildPackage,tp-eventd))
