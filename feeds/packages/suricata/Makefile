#
# Suricata 8 IDS for ImmortalWrt (in CM5 image; IDS off by default).
# Compile in macOS Docker builder (build_immortalwrt); skip GitHub SDK CI.
# See docs/suricata-openwrt-plan.md
#

include $(TOPDIR)/rules.mk

PKG_NAME:=suricata
PKG_VERSION:=8.0.6
PKG_RELEASE:=7

PKG_SOURCE:=suricata-$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://www.openinfosecfoundation.org/download
PKG_HASH:=b264584edda4a3b2b462050099c7c54f4f35ac0c7164e41084be9b216c090f8c

PKG_MAINTAINER:=T-Rex XP <t-rex-xp@users.noreply.github.com>
PKG_LICENSE:=GPL-2.0-only
PKG_LICENSE_FILES:=COPYING LICENSE

PKG_FIXUP:=autoreconf
PKG_INSTALL:=1
PKG_BUILD_PARALLEL:=1
PKG_BUILD_DEPENDS:=rust/host

include $(INCLUDE_DIR)/package.mk
-include $(TOPDIR)/feeds/packages/lang/rust/rust-values.mk

define Package/suricata
  SECTION:=net
  CATEGORY:=Network
  SUBMENU:=Routing and Redirection
  TITLE:=Suricata IDS (AF_PACKET)
  URL:=https://suricata.io/
  DEPENDS:=$(RUST_ARCH_DEPENDS) +libpcap +libpcre2 +libyaml +jansson \
	+libmagic +zlib +libcap-ng +libnet-1.2.x +liblz4 +libatomic +libelf
endef

define Package/suricata/description
  Suricata 8 IDS for ImmortalWrt. Default is passive AF_PACKET on br-lan
  with EVE JSON under /var/log/suricata. Not inline IPS. Shipped in the
  Orange Pi CM5 image (disabled until enabled in LuCI).
endef

define Package/suricata/conffiles
/etc/config/suricata
/etc/suricata/suricata.yaml
endef

CONFIGURE_ARGS += \
	--prefix=/usr \
	--sysconfdir=/etc \
	--localstatedir=/var \
	--enable-af-packet \
	--disable-gccmarch-native \
	--disable-python \
	--disable-suricata-update \
	--disable-gccprotect

ifneq ($(CARGO_PKG_CONFIG_VARS),)
CONFIGURE_VARS += $(CARGO_PKG_CONFIG_VARS)
MAKE_VARS += $(CARGO_PKG_CONFIG_VARS)
endif

# rust/Makefile.am uses --target $(host_triplet); src/Makefile looks for
# ../rust/target/$(host_alias)/release/libsuricata_rust.a. OpenWrt rustc
# only knows aarch64-unknown-linux-musl (CARGO_BUILD_TARGET in rust-values.mk).
ifneq ($(RUSTC_TARGET_ARCH),)
CONFIGURE_VARS += CARGO_BUILD_TARGET="$(RUSTC_TARGET_ARCH)"
MAKE_VARS += CARGO_BUILD_TARGET="$(RUSTC_TARGET_ARCH)"
MAKE_FLAGS += \
	CARGO_BUILD_TARGET="$(RUSTC_TARGET_ARCH)" \
	RUST_TARGET="--target $(RUSTC_TARGET_ARCH)" \
	RUST_SURICATA_LIBDIR="../rust/target/$(RUSTC_TARGET_ARCH)/release" \
	RUST_SURICATA_LIB="../rust/target/$(RUSTC_TARGET_ARCH)/release/libsuricata_rust.a"
endif

# Upstream `make install` skips yaml; configs live under /etc/suricata.
define Build/Install
	$(call Build/Install/Default)
	$(MAKE) -C $(PKG_BUILD_DIR) $(MAKE_INSTALL_FLAGS) DESTDIR="$(PKG_INSTALL_DIR)" install-conf
endef

define Package/suricata/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_INSTALL_DIR)/usr/bin/suricata $(1)/usr/bin/
	$(INSTALL_DIR) $(1)/etc/suricata $(1)/etc/suricata/rules
	$(INSTALL_DATA) $(PKG_INSTALL_DIR)/etc/suricata/suricata.yaml $(1)/etc/suricata/suricata.yaml
	$(INSTALL_DATA) $(PKG_INSTALL_DIR)/etc/suricata/classification.config $(1)/etc/suricata/classification.config
	$(INSTALL_DATA) $(PKG_INSTALL_DIR)/etc/suricata/reference.config $(1)/etc/suricata/reference.config
	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./files/suricata.config $(1)/etc/config/suricata
	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/suricata.init $(1)/etc/init.d/suricata
	$(INSTALL_DIR) $(1)/usr/sbin
	$(INSTALL_BIN) ./files/usr/sbin/suricata-config-apply $(1)/usr/sbin/suricata-config-apply
	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./files/suricata.defaults $(1)/etc/uci-defaults/90-suricata-ids
endef

$(eval $(call BuildPackage,suricata))
