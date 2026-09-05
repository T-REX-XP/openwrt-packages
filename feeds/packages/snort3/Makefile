#
# snort3 — vendored from openwrt/packages net/snort3 (3.12.2.0).
# In the CM5 image (IDS off by default). Built and published by GitHub SDK CI
# (libdaq3 + luajit come from ImmortalWrt packages).
# https://github.com/openwrt/packages/tree/master/net/snort3
#
# This is free software, licensed under the GNU General Public License v2.
# See /LICENSE for more information.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=snort3
PKG_VERSION:=3.12.2.0
PKG_RELEASE:=5

PKG_SOURCE:=$(PKG_NAME)-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://codeload.github.com/snort3/snort3/tar.gz/$(PKG_VERSION)?
PKG_HASH:=43000d6b0e0307bc1a735874d00deb61e8b6a96d074f8cc9b2fe2cde0058720b

PKG_MAINTAINER:=W. Michael Petullo <mike@flyn.org>, John Audia <therealgraysky@proton.me>
PKG_LICENSE:=GPL-2.0-only
PKG_LICENSE_FILES:=COPYING
PKG_CPE_ID:=cpe:/a:snort:snort

include $(INCLUDE_DIR)/package.mk
include $(INCLUDE_DIR)/cmake.mk

define Package/snort3
  SUBMENU:=Firewall
  SECTION:=net
  CATEGORY:=Network
  DEPENDS:=+libstdcpp +libdaq3 +libdnet +libopenssl +libpcap +libpcre2 \
    +libpthread +libuuid +zlib +libhwloc +USE_MUSL:libtirpc @HAS_LUAJIT_ARCH +luajit +libatomic \
    +kmod-nft-queue +liblzma +ucode +ucode-mod-fs +ucode-mod-uci \
    +PACKAGE_gperftools:gperftools \
    +PACKAGE_vectorscan:vectorscan
  USERID:=snort=975:snort=975
  TITLE:=Lightweight Network Intrusion Detection System
  URL:=https://snort.org/
  MENU:=1
endef

define Package/snort3/description
  Snort 3 IDS/IPS for ImmortalWrt. Default UCI is IDS off, AF_PACKET on
  br-lan, HOME_NET 192.168.8.0/24 (Orange Pi CM5 LAN). Shipped in the CM5
  image (disabled until enabled in LuCI). Pair with luci-app-snort3.

  Optional menuconfig: gperftools, vectorscan (not enabled by default).
endef

CMAKE_OPTIONS += \
	-DUSE_TIRPC=$(if $(CONFIG_USE_MUSL),ON,OFF) \
	-DENABLE_STATIC_DAQ:BOOL=NO \
	-DDAQ_INCLUDE_DIR=$(STAGING_DIR)/usr/include/daq3 \
	-DDAQ_LIBRARIES_DIR_HINT:PATH=$(STAGING_DIR)/usr/lib/daq3 \
	-DFLEX_INCLUDES:PATH=$(STAGING_DIR_HOST)/include \
	-DENABLE_COREFILES:BOOL=NO \
	-DENABLE_GDB:BOOL=NO \
	-DMAKE_DOC:BOOL=NO \
	-DMAKE_HTML_DOC:BOOL=NO \
	-DMAKE_PDF_DOC:BOOL=NO \
	-DMAKE_TEXT_DOC:BOOL=NO \
	-DHAVE_LIBUNWIND=OFF \
	-DHAVE_LZMA=ON \
	-DENABLE_TCMALLOC=$(if $(CONFIG_PACKAGE_gperftools),ON,OFF) \
	-DENABLE_HYPERSCAN=$(if $(CONFIG_PACKAGE_vectorscan),ON,OFF) \
	$(if $(CONFIG_PACKAGE_vectorscan),-DHS_INCLUDE_DIRS=$(STAGING_DIR)/usr/include/hs)

TARGET_CFLAGS += -I$(STAGING_DIR)/usr/include/daq3

define Package/snort3/conffiles
/etc/config/snort
/etc/snort/
endef

define Package/snort3/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/bin/snort $(1)/usr/bin/
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/bin/snort2lua $(1)/usr/bin/
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/bin/u2{boat,spewfoo} $(1)/usr/bin/
	$(INSTALL_BIN) ./files/snort-{mgr,rules} $(1)/usr/bin/

	$(INSTALL_DIR) $(1)/usr/lib/snort
	$(CP) $(PKG_INSTALL_DIR)/usr/lib/snort/daq/daq_{hext,file}.so $(1)/usr/lib/snort/

	$(INSTALL_DIR) $(1)/usr/share/lua
	$(CP) $(PKG_INSTALL_DIR)/usr/include/snort/lua/snort_plugin.lua $(1)/usr/share/lua/

	$(INSTALL_DIR) $(1)/usr/share/snort
	$(INSTALL_CONF) ./files/main.uc $(1)/usr/share/snort/

	$(INSTALL_DIR) $(1)/usr/share/snort/templates
	$(INSTALL_CONF) ./files/{nftables,snort}.uc $(1)/usr/share/snort/templates/

	$(INSTALL_DIR) $(1)/etc/snort/{rules,lists,builtin_rules,so_rules}

	$(INSTALL_CONF) $(PKG_INSTALL_DIR)/usr/etc/snort/*.lua $(1)/etc/snort
	$(INSTALL_CONF) $(PKG_INSTALL_DIR)/usr/etc/snort/file_magic.rules $(1)/etc/snort

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/snort.init $(1)/etc/init.d/snort

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/snort.config $(1)/etc/config/snort

	$(INSTALL_DIR) $(1)/etc/capabilities
	$(INSTALL_CONF) ./files/snort.json $(1)/etc/capabilities/snort.json
endef

$(eval $(call BuildPackage,snort3))
