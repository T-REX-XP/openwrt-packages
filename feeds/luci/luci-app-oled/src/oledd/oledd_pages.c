/*
 * oledd_pages — JSON page config loader and renderer (router OLED spec).
 */

#include "oledd_pages.h"

#include "oledd_data.h"
#include "oledd_fonts.h"
#include "oledd_icons.h"

#include "SSD1306_OLED.h"

#include <libubox/blobmsg.h>
#include <libubox/blobmsg_json.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>

#define OLEDD_MAX_PAGES 8
#define OLEDD_MAX_ELEMENTS 24
#define OLEDD_MAX_SPARK 24

typedef enum {
	EL_TEXT,
	EL_RECT,
	EL_LINE,
	EL_BAR,
	EL_ICON,
	EL_SPARKLINE,
} el_type_t;

typedef struct {
	el_type_t type;
	int x, y, w, h;
	int x1, y1, x2, y2;
	int fill;
	int invert;
	char text[64];
	char font[8];
	char align[8];
	char icon_name[16];
	int icon_size;
	double value;
	char value_token[32];
	char data_source[16];
	int spark_values[OLEDD_MAX_SPARK];
	int spark_count;
} oledd_element_t;

typedef struct {
	char id[24];
	char title[32];
	char tab_icon[16];
	int enabled;
	oledd_element_t elements[OLEDD_MAX_ELEMENTS];
	int element_count;
} oledd_page_t;

static oledd_page_t g_pages[OLEDD_MAX_PAGES];
static int g_page_count;

static oledd_font_t parse_font(const char *name)
{
	if (!name || !name[0])
		return OLEDD_FONT_XS;
	if (!strcmp(name, "sm") || !strcmp(name, "md"))
		return OLEDD_FONT_SM;
	if (!strcmp(name, "lg") || !strcmp(name, "xl") || !strcmp(name, "huge"))
		return OLEDD_FONT_LG;
	return OLEDD_FONT_XS;
}

static void subst_tokens(char *dst, size_t len, const char *src,
			 struct oledd_data_ctx *ctx)
{
	const char *p, *start;
	size_t out = 0;

	if (!dst || !len)
		return;
	dst[0] = '\0';
	if (!src)
		return;

	for (p = src; *p && out + 1 < len; p++) {
		if (*p != '{') {
			dst[out++] = *p;
			continue;
		}
		start = ++p;
		while (*p && *p != '}')
			p++;
		if (*p == '}') {
			char tok[32];
			size_t tl = (size_t)(p - start);

			if (tl >= sizeof(tok))
				tl = sizeof(tok) - 1;
			memcpy(tok, start, tl);
			tok[tl] = '\0';
			strncpy(dst + out, oledd_data_resolve(ctx, tok), len - out - 1);
			out = strlen(dst);
		}
	}
	dst[out] = '\0';
}

static void draw_bar(int x, int y, int w, int h, double value)
{
	int fill;

	if (value < 0.0)
		value = 0.0;
	if (value > 1.0)
		value = 1.0;
	drawRect(x, y, w, h, WHITE);
	fill = (int)((double)(w - 2) * value);
	if (fill < 1 && value > 0.01)
		fill = 1;
	if (fill > 0)
		fillRect(x + 1, y + 1, fill, h - 2, WHITE);
}

static void draw_sparkline(int x, int y, int w, int h, const int *values,
			   int count)
{
	int i, maxv = 1;

	if (!values || count <= 0)
		return;
	for (i = 0; i < count; i++)
		if (values[i] > maxv)
			maxv = values[i];
	for (i = 0; i < count && i < w; i++) {
		int bar_h = (values[i] * (h - 1)) / maxv;

		if (bar_h < 1)
			bar_h = 1;
		fillRect(x + i, y + h - bar_h, 1, bar_h, WHITE);
	}
}

static void render_element(const oledd_element_t *el, struct oledd_data_ctx *ctx)
{
	char text[64];

	if (!el)
		return;

	switch (el->type) {
	case EL_RECT:
		if (el->fill)
			fillRect(el->x, el->y, el->w, el->h, WHITE);
		else
			drawRect(el->x, el->y, el->w, el->h, WHITE);
		break;
	case EL_LINE:
		drawLine(el->x1, el->y1, el->x2, el->y2, WHITE);
		break;
	case EL_BAR: {
		double v = el->value;

		if (el->value_token[0])
			v = oledd_data_resolve_float(ctx, el->value_token);
		draw_bar(el->x, el->y, el->w, el->h, v);
		break;
	}
	case EL_ICON:
		oledd_icon_draw(el->x, el->y, el->icon_name, el->icon_size);
		break;
	case EL_SPARKLINE:
		if (el->data_source[0] && !strcmp(el->data_source, "ping"))
			draw_sparkline(el->x, el->y, el->w, el->h, ctx->sparkline,
				       ctx->spark_count);
		else
			draw_sparkline(el->x, el->y, el->w, el->h,
				       el->spark_values, el->spark_count);
		break;
	case EL_TEXT:
	default:
		subst_tokens(text, sizeof(text), el->text, ctx);
		oledd_font_draw_aligned(parse_font(el->font), el->x, el->y, el->x,
					el->align[0] ? el->align : "left", text,
					el->invert);
		break;
	}
}

void oledd_pages_draw_indicator(int current, int total)
{
	int i, spacing = 6;
	int start_x = (oled_lcd_width() - total * spacing) / 2;
	int y = 61;

	if (total <= 1)
		return;
	for (i = 0; i < total; i++) {
		int cx = start_x + i * spacing;

		if (i == current)
			fillCircle(cx, y, 2, WHITE);
		else
			drawCircle(cx, y, 1, WHITE);
	}
}

static int parse_element(el_type_t type, struct blob_attr *attr,
			 oledd_element_t *el)
{
	enum {
		EL_T,
		EL_X,
		EL_Y,
		EL_W,
		EL_H,
		EL_X1,
		EL_Y1,
		EL_X2,
		EL_Y2,
		EL_TEXT,
		EL_FONT,
		EL_ALIGN,
		EL_INVERT,
		EL_FILL,
		EL_NAME,
		EL_SIZE,
		EL_VALUE,
		EL_VALUES,
		EL_DATA,
		__EL_MAX,
	};
	static const struct blobmsg_policy pol[__EL_MAX] = {
		[EL_T] = { .name = "type", .type = BLOBMSG_TYPE_STRING },
		[EL_X] = { .name = "x", .type = BLOBMSG_TYPE_INT32 },
		[EL_Y] = { .name = "y", .type = BLOBMSG_TYPE_INT32 },
		[EL_W] = { .name = "w", .type = BLOBMSG_TYPE_INT32 },
		[EL_H] = { .name = "h", .type = BLOBMSG_TYPE_INT32 },
		[EL_X1] = { .name = "x1", .type = BLOBMSG_TYPE_INT32 },
		[EL_Y1] = { .name = "y1", .type = BLOBMSG_TYPE_INT32 },
		[EL_X2] = { .name = "x2", .type = BLOBMSG_TYPE_INT32 },
		[EL_Y2] = { .name = "y2", .type = BLOBMSG_TYPE_INT32 },
		[EL_TEXT] = { .name = "text", .type = BLOBMSG_TYPE_STRING },
		[EL_FONT] = { .name = "font", .type = BLOBMSG_TYPE_STRING },
		[EL_ALIGN] = { .name = "align", .type = BLOBMSG_TYPE_STRING },
		[EL_INVERT] = { .name = "invert", .type = BLOBMSG_TYPE_BOOL },
		[EL_FILL] = { .name = "fill", .type = BLOBMSG_TYPE_BOOL },
		[EL_NAME] = { .name = "name", .type = BLOBMSG_TYPE_STRING },
		[EL_SIZE] = { .name = "size", .type = BLOBMSG_TYPE_INT32 },
		[EL_VALUE] = { .name = "value", .type = BLOBMSG_TYPE_STRING },
		[EL_VALUES] = { .name = "values", .type = BLOBMSG_TYPE_ARRAY },
		[EL_DATA] = { .name = "data", .type = BLOBMSG_TYPE_STRING },
	};
	struct blob_attr *tb[__EL_MAX];
	struct blob_attr *cur;
	int rem;

	(void)type;
	memset(el, 0, sizeof(*el));
	blobmsg_parse(pol, __EL_MAX, tb, blob_data(attr), blob_len(attr));

	if (tb[EL_T]) {
		const char *t = blobmsg_get_string(tb[EL_T]);

		if (!strcmp(t, "rect"))
			el->type = EL_RECT;
		else if (!strcmp(t, "line"))
			el->type = EL_LINE;
		else if (!strcmp(t, "bar"))
			el->type = EL_BAR;
		else if (!strcmp(t, "icon"))
			el->type = EL_ICON;
		else if (!strcmp(t, "sparkline"))
			el->type = EL_SPARKLINE;
		else
			el->type = EL_TEXT;
	}

	if (tb[EL_X])
		el->x = blobmsg_get_u32(tb[EL_X]);
	if (tb[EL_Y])
		el->y = blobmsg_get_u32(tb[EL_Y]);
	if (tb[EL_W])
		el->w = blobmsg_get_u32(tb[EL_W]);
	if (tb[EL_H])
		el->h = blobmsg_get_u32(tb[EL_H]);
	if (tb[EL_X1])
		el->x1 = blobmsg_get_u32(tb[EL_X1]);
	if (tb[EL_Y1])
		el->y1 = blobmsg_get_u32(tb[EL_Y1]);
	if (tb[EL_X2])
		el->x2 = blobmsg_get_u32(tb[EL_X2]);
	if (tb[EL_Y2])
		el->y2 = blobmsg_get_u32(tb[EL_Y2]);
	if (tb[EL_TEXT])
		strncpy(el->text, blobmsg_get_string(tb[EL_TEXT]),
			sizeof(el->text) - 1);
	if (tb[EL_FONT])
		strncpy(el->font, blobmsg_get_string(tb[EL_FONT]),
			sizeof(el->font) - 1);
	if (tb[EL_ALIGN])
		strncpy(el->align, blobmsg_get_string(tb[EL_ALIGN]),
			sizeof(el->align) - 1);
	if (tb[EL_INVERT])
		el->invert = blobmsg_get_bool(tb[EL_INVERT]) ? 1 : 0;
	if (tb[EL_FILL])
		el->fill = blobmsg_get_bool(tb[EL_FILL]) ? 1 : 0;
	if (tb[EL_NAME])
		strncpy(el->icon_name, blobmsg_get_string(tb[EL_NAME]),
			sizeof(el->icon_name) - 1);
	if (tb[EL_SIZE])
		el->icon_size = (int)blobmsg_get_u32(tb[EL_SIZE]);
	if (tb[EL_DATA])
		strncpy(el->data_source, blobmsg_get_string(tb[EL_DATA]),
			sizeof(el->data_source) - 1);
	if (tb[EL_VALUE]) {
		if (blobmsg_type(tb[EL_VALUE]) == BLOBMSG_TYPE_STRING) {
			const char *vs = blobmsg_get_string(tb[EL_VALUE]);
			size_t tl;

			if (vs[0] == '{') {
				tl = strlen(vs + 1);
				if (tl && vs[1 + tl - 1] == '}')
					tl--;
				if (tl >= sizeof(el->value_token))
					tl = sizeof(el->value_token) - 1;
				memcpy(el->value_token, vs + 1, tl);
				el->value_token[tl] = '\0';
			} else {
				el->value = atof(vs);
			}
		} else {
			el->value = (double)blobmsg_get_u32(tb[EL_VALUE]) / 100.0;
		}
	}
	if (tb[EL_VALUES]) {
		rem = blobmsg_data_len(tb[EL_VALUES]);
		blobmsg_for_each_attr(cur, tb[EL_VALUES], rem) {
			if (el->spark_count >= OLEDD_MAX_SPARK)
				break;
			if (blobmsg_type(cur) == BLOBMSG_TYPE_INT32)
				el->spark_values[el->spark_count++] =
				    (int)blobmsg_get_u32(cur);
		}
	}
	return 0;
}

static int parse_page(struct blob_attr *attr, oledd_page_t *page)
{
	enum {
		PG_ID,
		PG_TITLE,
		PG_TAB,
		PG_ENABLED,
		PG_ELEMENTS,
		__PG_MAX,
	};
	static const struct blobmsg_policy pol[__PG_MAX] = {
		[PG_ID] = { .name = "id", .type = BLOBMSG_TYPE_STRING },
		[PG_TITLE] = { .name = "title", .type = BLOBMSG_TYPE_STRING },
		[PG_TAB] = { .name = "tabIcon", .type = BLOBMSG_TYPE_STRING },
		[PG_ENABLED] = { .name = "enabled", .type = BLOBMSG_TYPE_BOOL },
		[PG_ELEMENTS] = { .name = "elements", .type = BLOBMSG_TYPE_ARRAY },
	};
	struct blob_attr *tb[__PG_MAX];
	struct blob_attr *cur;
	int rem;

	memset(page, 0, sizeof(*page));
	page->enabled = 1;
	blobmsg_parse(pol, __PG_MAX, tb, blob_data(attr), blob_len(attr));

	if (tb[PG_ID])
		strncpy(page->id, blobmsg_get_string(tb[PG_ID]),
			sizeof(page->id) - 1);
	if (tb[PG_TITLE])
		strncpy(page->title, blobmsg_get_string(tb[PG_TITLE]),
			sizeof(page->title) - 1);
	if (tb[PG_TAB])
		strncpy(page->tab_icon, blobmsg_get_string(tb[PG_TAB]),
			sizeof(page->tab_icon) - 1);
	if (tb[PG_ENABLED])
		page->enabled = blobmsg_get_bool(tb[PG_ENABLED]) ? 1 : 0;

	if (tb[PG_ELEMENTS]) {
		rem = blobmsg_data_len(tb[PG_ELEMENTS]);
		blobmsg_for_each_attr(cur, tb[PG_ELEMENTS], rem) {
			if (page->element_count >= OLEDD_MAX_ELEMENTS)
				break;
			parse_element(EL_TEXT, cur,
				      &page->elements[page->element_count++]);
		}
	}
	return page->enabled ? 0 : 1;
}

int oledd_pages_load(const char *path)
{
	struct blob_buf b = {};
	enum {
		ROOT_PAGES,
		__ROOT_MAX,
	};
	static const struct blobmsg_policy root_pol[__ROOT_MAX] = {
		[ROOT_PAGES] = { .name = "pages", .type = BLOBMSG_TYPE_ARRAY },
	};
	struct blob_attr *tb[__ROOT_MAX];
	struct blob_attr *cur;
	int rem, skip;

	oledd_pages_free();
	blob_buf_init(&b, 0);
	if (!blobmsg_add_json_from_file(&b, path)) {
		syslog(LOG_ERR, "failed to parse pages JSON: %s", path);
		blob_buf_free(&b);
		return -1;
	}

	blobmsg_parse(root_pol, __ROOT_MAX, tb, blob_data(b.head), blob_len(b.head));
	if (!tb[ROOT_PAGES]) {
		blob_buf_free(&b);
		return -1;
	}

	rem = blobmsg_data_len(tb[ROOT_PAGES]);
	blobmsg_for_each_attr(cur, tb[ROOT_PAGES], rem) {
		oledd_page_t tmp;

		if (g_page_count >= OLEDD_MAX_PAGES)
			break;
		skip = parse_page(cur, &tmp);
		if (skip)
			continue;
		g_pages[g_page_count++] = tmp;
	}

	blob_buf_free(&b);
	syslog(LOG_INFO, "loaded %d OLED pages from %s", g_page_count, path);
	return g_page_count > 0 ? 0 : -1;
}

void oledd_pages_free(void)
{
	memset(g_pages, 0, sizeof(g_pages));
	g_page_count = 0;
}

int oledd_pages_count(void)
{
	return g_page_count;
}

const char *oledd_pages_id(int idx)
{
	if (idx < 0 || idx >= g_page_count)
		return "";
	return g_pages[idx].id;
}

const char *oledd_pages_tab_icon(int idx)
{
	if (idx < 0 || idx >= g_page_count)
		return "";
	return g_pages[idx].tab_icon;
}

int oledd_pages_index_by_id(const char *id)
{
	int i;

	if (!id)
		return -1;
	for (i = 0; i < g_page_count; i++) {
		if (!strcmp(g_pages[i].id, id))
			return i;
	}
	return -1;
}

void oledd_pages_render(int page_idx, struct ubus_context *ubus,
			double elapsed_sec)
{
	struct oledd_data_ctx ctx = { .ubus = ubus, .elapsed_sec = elapsed_sec };
	oledd_page_t *page;
	int i;

	if (page_idx < 0 || page_idx >= g_page_count)
		return;

	page = &g_pages[page_idx];
	oledd_data_refresh(&ctx);

	for (i = 0; i < page->element_count; i++)
		render_element(&page->elements[i], &ctx);

	fillRect(0, 60, oled_lcd_width(), 4, BLACK);
	oledd_pages_draw_indicator(page_idx, g_page_count);
}
