---
name: luci-bootstrap-theming
description: >-
  Theme and lay out LuCI apps in openwrt-packages using luci-theme-bootstrap
  CSS variables. Use when editing *-theme.css, LuCI JS dashboards, responsive
  layouts, dark/light mode, or chart colors in feeds/luci/luci-app-*/.
---

# LuCI Bootstrap theming (openwrt-packages)

Each LuCI app ships its own `*-theme.css`. There is **no shared theme library**.

## Required theme support

1. **Light** — default Bootstrap variables
2. **Dark** — `:root[data-darkmode="true"]` and `:root[data-darkmode="1"]`
3. **System** — `@media (prefers-color-scheme: dark)` when dark mode is not forced off

## CSS variable usage

Use Bootstrap tokens for surfaces and text:

```css
background: var(--background-color-medium);
color: var(--text-color-highest);
border-color: var(--border-color-medium);
```

App-specific accents go on a scoped root (e.g. `.luci-app-blocky`):

```css
.luci-app-blocky {
  --blocky-accent-queries: #2196f3;
  --blocky-chart-total: var(--blocky-accent-queries);
}
```

Override fill opacities in dark mode on the same scoped root.

## LuCI JS patterns

- Wrap the view in a scoped class: `E('div', { 'class': 'luci-app-blocky' }, [...])`
- Inject stylesheet: `blockyInjectStyles()` → `L.resource('blocky-theme.css')`
- **Charts:** use CSS tone classes (`blocky-bar-seg--total`, `blocky-vbar--blocked`) not inline `background:#hex`
- **SVG paths:** read colors via `getComputedStyle` + CSS vars; re-apply on `data-darkmode` change
- **Legends:** `blocky-legend-dot blocky-legend-dot--{tone}` classes

## Responsive layout

Use CSS grid/flex with breakpoints; prevent overflow:

```css
.blocky-dash-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  min-width: 0;
}
@media (max-width: 768px) {
  .blocky-dash-grid { grid-template-columns: 1fr; }
}
```

Typical breakpoints: **1200px**, **768px**, **520px**.

## After UI changes

1. Bump **`PKG_RELEASE`** in the LuCI app Makefile
2. Run `node --check` on modified JS files
3. Verify light, dark, and narrow viewport in LuCI

## Reference implementation

- `feeds/luci/luci-app-blocky/htdocs/luci-static/resources/blocky-theme.css`
- `feeds/luci/luci-app-blocky/htdocs/luci-static/resources/blocky-common.js`
