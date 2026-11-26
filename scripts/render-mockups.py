"""Render wireframe mockups for the plugin-sync settings page.

Design samples only: this draws static images, it does not exercise the plugin.
Run: python scripts/render-mockups.py
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "mockups")
os.makedirs(OUT, exist_ok=True)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhl.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            index = 0
            try:
                return ImageFont.truetype(path, size, index=index)
            except OSError:
                continue
    return ImageFont.load_default()


class Theme:
    def __init__(self, dark: bool = False):
        self.dark = dark
        self.bg = "#1b1c20" if dark else "#ffffff"
        self.surface = "#24262b" if dark else "#f7f8fa"
        self.surface2 = "#2c2f35" if dark else "#eef0f4"
        self.border = "#3a3d44" if dark else "#e3e6eb"
        self.text = "#ececee" if dark else "#1f2328"
        self.muted = "#9aa0a6" if dark else "#6b7280"
        self.accent = "#6f8fff" if dark else "#2f6fed"
        self.accent_bg = "#26304a" if dark else "#eaf0ff"
        self.ok = "#5cba85" if dark else "#1f8a4c"
        self.warn = "#e2b04a" if dark else "#a86400"
        self.danger = "#e36b6b" if dark else "#b3261e"


class Canvas:
    def __init__(self, theme: Theme, width: int = 860, height: int = 1120):
        self.t = theme
        self.w = width
        self.h = height
        self.img = Image.new("RGB", (width, height), theme.bg)
        self.d = ImageDraw.Draw(self.img)

    # ---- primitives -------------------------------------------------
    def text(self, xy, value, size=14, color=None, bold=False, anchor="la", max_width=None):
        f = font(size, bold)
        color = color or self.t.text
        if max_width:
            value = self._ellipsize(value, f, max_width)
        self.d.text(xy, value, font=f, fill=color, anchor=anchor)

    def _ellipsize(self, value, f, max_width):
        if self.d.textlength(value, font=f) <= max_width:
            return value
        while value and self.d.textlength(value + "…", font=f) > max_width:
            value = value[:-1]
        return value + "…"

    def box(self, xy, fill=None, outline=None, radius=8, width=1):
        self.d.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)

    def line(self, xy, color=None, width=1):
        self.d.line(xy, fill=color or self.t.border, width=width)

    def divider(self, y, x0=32, x1=None):
        self.line((x0, y, x1 or self.w - 32, y))

    def badge(self, xy, label, fg, bg, size=12):
        f = font(size)
        pad_x, pad_y = 8, 4
        w = self.d.textlength(label, font=f)
        x, y = xy
        self.d.rounded_rectangle((x, y, x + w + pad_x * 2, y + size + pad_y * 2), radius=6, fill=bg)
        self.d.text((x + pad_x, y + pad_y - 1), label, font=f, fill=fg)
        return x + w + pad_x * 2

    def button(self, xy, label, primary=False, disabled=False, size=13, ghost=False):
        f = font(size)
        w = self.d.textlength(label, font=f) + 26
        h = 32
        x, y = xy
        t = self.t
        if primary:
            fill = t.accent if not disabled else (t.surface2 if not t.dark else "#33363c")
            fg = "#ffffff" if not disabled else t.muted
            outline = None
        elif ghost:
            fill = None
            fg = t.muted if disabled else t.accent
            outline = None
        else:
            fill = t.bg
            fg = t.muted if disabled else t.text
            outline = t.border
        if fill is not None or outline is not None:
            self.d.rounded_rectangle((x, y, x + w, y + h), radius=8, fill=fill, outline=outline, width=1)
        self.d.text((x + w / 2, y + h / 2 - 1), label, font=f, fill=fg, anchor="mm")
        return x + w

    def checkbox(self, xy, checked=False, disabled=False):
        x, y = xy
        t = self.t
        outline = t.border if disabled else (t.accent if checked else t.muted)
        self.d.rounded_rectangle((x, y, x + 16, y + 16), radius=4, fill=t.bg, outline=outline, width=1)
        if checked:
            self.d.line((x + 4, y + 8, x + 7, y + 12, x + 12, y + 4), fill=t.accent, width=2)

    def dot(self, xy, color):
        x, y = xy
        self.d.ellipse((x, y, x + 8, y + 8), fill=color)

    def input(self, xy, width, value, placeholder=False, focused=False):
        t = self.t
        x, y = xy
        outline = t.accent if focused else t.border
        self.d.rounded_rectangle((x, y, x + width, y + 34), radius=8, fill=t.bg, outline=outline, width=1)
        self.text((x + 10, y + 9), value, 13, t.muted if placeholder else t.text, max_width=width - 22)

    def card(self, xy):
        self.box(xy, fill=self.t.surface, outline=self.t.border, radius=10)

    def save(self, name):
        path = os.path.join(OUT, name)
        self.img.save(str(path), format="PNG")
        print("wrote", os.path.relpath(path, os.path.join(os.path.dirname(__file__), "..")))


# ----------------------------------------------------------------------
# Sample A: single workbench (recommended)
# ----------------------------------------------------------------------
def sample_a(dark=False, name="sample-a-workbench.png"):
    t = Theme(dark)
    c = Canvas(t, 860, 1000)
    c.text((32, 20), "方案 A · 单页工作台（推荐）", 11, t.muted, bold=True)
    c.text((32, 40), "插件清单同步", 22, t.text, bold=True)
    c.text((32, 72), "通过 WebDAV 在机器之间同步插件清单；插件源码、设置和凭据不离开本机。", 13, t.muted, max_width=700)

    # connection bar
    c.line((32, 104, c.w - 32, 104))
    c.dot((32, 122), t.ok)
    c.text((48, 117), "已连接 app.koofr.net/dav/Koofr/WebDAV/Tool/temp", 13, t.text, max_width=520)
    c.badge((596, 115), "WebDAV 锁", t.accent, t.accent_bg)
    c.button((716, 110), "编辑", ghost=True)
    c.line((32, 158, c.w - 32, 158))

    # inventory card
    c.card((32, 178, c.w - 32, 384))
    c.text((52, 196), "插件清单", 16, t.text, bold=True)
    c.text((c.w - 52, 198), "16 个插件", 13, t.muted, anchor="ra")
    c.text((52, 222), "安装来源、确切版本和启用状态", 12, t.muted)

    metrics = [("本机", "16"), ("远端", "18"), ("待处理", "3"), ("备份", "4")]
    x = 52
    for label, value in metrics:
        c.text((x, 252), value, 22, t.warn if label == "待处理" and value != "0" else t.text, bold=True)
        c.text((x, 282), label, 12, t.muted)
        x += 150
    c.text((52, 308), "上次检查 15:12 · 上次发布 14:58（新增 2 / 更新 1）", 12, t.muted)

    c.button((c.w - 52 - 248, 330), "重新检查", ghost=True)
    c.button((c.w - 52 - 96, 328), "发布", primary=True)
    c.text((52, 338), "其中 1 项是冲突，需要你选择保留哪一侧", 13, t.warn)

    # differences
    c.text((32, 408), "差异", 16, t.text, bold=True)
    c.text((32, 436), "待安装 2 · 待升级 1 · 冲突 1", 13, t.muted)
    c.button((c.w - 32 - 108, 428), "全部应用", primary=False)

    rows = [
        ("install", "dsh-notes", "安装", "—", "1.2.0", True),
        ("install", "dsh-mnemon", "安装", "—", "0.4.1", True),
        ("upgrade", "dsh-context", "升级", "0.87.0", "0.88.0", False),
        ("manual", "dsh-purge", "需手动 · 未钉版本", "1.3.6", "—", None),
    ]
    y = 470
    c.box((32, y, c.w - 32, y + 34), fill=t.surface2, radius=6)
    c.text((52, y + 9), "选择", 12, t.muted)
    c.text((110, y + 9), "插件", 12, t.muted)
    c.text((330, y + 9), "差异", 12, t.muted)
    c.text((500, y + 9), "本机", 12, t.muted)
    c.text((650, y + 9), "WebDAV", 12, t.muted)
    y += 34
    for _, plugin, kind, local, remote, checked in rows:
        c.line((32, y, c.w - 32, y), t.border)
        if checked is None:
            c.text((52, y + 14), "—", 13, t.muted)
        else:
            c.checkbox((52, y + 11), checked)
        c.text((110, y + 12), plugin, 13, t.text)
        color = t.warn if kind in ("升级",) else (t.muted if kind.startswith("需手动") else t.text)
        c.text((330, y + 12), kind, 12, color, max_width=160)
        c.text((500, y + 12), local, 12, t.muted)
        c.text((650, y + 12), remote, 12, t.text)
        y += 40
    c.button((c.w - 32 - 128, y + 12), "应用所选 2 项", primary=False)

    # conflicts
    y += 66
    c.text((32, y), "需要你决定的差异", 16, t.text, bold=True)
    y += 30
    c.card((32, y, c.w - 32, y + 132))
    c.text((52, y + 14), "dsh-context", 14, t.text, bold=True)
    c.text((52, y + 38), "本机 0.87.0 · WebDAV 0.89.0 · 上次同步 0.87.0", 12, t.muted)
    c.text((52, y + 62), "两边都改过。选择一侧后，另一侧会在它下次同步时处理。", 12, t.muted, max_width=740)
    c.button((52, y + 86), "保留本机版本，发布到 WebDAV", primary=False)
    c.button((356, y + 86), "采用 WebDAV 版本", primary=False)

    # planned scopes
    y += 160
    c.line((32, y, c.w - 32, y))
    c.text((32, y + 14), "预留范围：DSH 设置 · 模型配置 · MCP 配置 · Skill 配置（暂未开放）", 12, t.muted)
    c.d.line((c.w - 46, y + 16, c.w - 40, y + 22, c.w - 34, y + 16), fill=t.muted, width=2)
    c.save(name)


# ----------------------------------------------------------------------
# Sample B: step wizard
# ----------------------------------------------------------------------
def sample_b(name="sample-b-wizard.png"):
    t = Theme(False)
    c = Canvas(t, 860, 820)
    c.text((32, 20), "方案 B · 分步向导", 11, t.muted, bold=True)
    c.text((32, 40), "插件清单同步", 22, t.text, bold=True)
    c.text((32, 72), "三步完成初次配置与第一次同步。", 13, t.muted)

    steps = [("1", "连接 WebDAV", "done"), ("2", "检查差异", "current"), ("3", "处理差异", "todo")]
    x = 32
    for index, (number, label, state) in enumerate(steps, start=1):
        active = state == "current"
        done = state == "done"
        fill = t.accent if active else (t.accent_bg if done else t.surface2)
        fg = "#ffffff" if active else (t.accent if done else t.muted)
        c.d.ellipse((x, 96, x + 26, 122), fill=fill)
        c.text((x + 13, 109), number, 12, fg, anchor="mm", bold=True)
        c.text((x + 36, 103), label, 13, t.text if active else t.muted)
        x += 200
        if index < 3:
            c.line((x - 158, 109, x - 12, 109), t.border, 2)

    c.card((32, 160, c.w - 32, 486))
    c.text((56, 172), "连接 WebDAV", 16, t.text, bold=True)
    c.text((56, 200), "使用同一个已存在的 HTTPS 目录；建议单独建目录并限制账号权限。", 12, t.muted, max_width=720)

    c.text((56, 232), "HTTPS 文件夹地址", 12, t.muted)
    c.input((56, 250), 720, "https://app.koofr.net/dav/Koofr/WebDAV/Tool/temp/")
    c.text((56, 296), "用户名", 12, t.muted)
    c.input((56, 314), 348, "1057372918@qq.com")
    c.text((428, 296), "密码", 12, t.muted)
    c.input((428, 314), 348, "已保存（留空保留）", placeholder=True)
    c.text((56, 360), "远端备份保留", 12, t.muted)
    c.input((56, 378), 120, "10")
    c.text((190, 388), "份（0–50，当前清单不计入）", 12, t.muted)
    c.checkbox((56, 432))
    c.text((80, 431), "发布时自动安装缺失插件（会从远端清单下载安装）", 12, t.text)

    c.button((c.w - 56 - 150, 506), "保存并测试连接", primary=True)
    c.button((c.w - 56 - 150 - 96, 506), "上一步", ghost=True, disabled=True)

    c.line((32, 556, c.w - 32, 556))
    c.text((32, 574), "第 2 步预览（尚未执行）", 13, t.muted)
    c.card((32, 602, c.w - 32, 740))
    c.text((56, 620), "检查差异", 15, t.text, bold=True)
    c.text((56, 646), "只读取远端清单，不会写入或安装任何插件。", 12, t.muted)
    c.text((56, 676), "预计结果：8 项待安装 · 2 项可发布 · 1 项需你决定", 13, t.text)
    c.button((c.w - 56 - 96, 676), "检查", primary=False, disabled=True)

    c.save(name)


# ----------------------------------------------------------------------
# Sample C: master-detail with scope list
# ----------------------------------------------------------------------
def sample_c(name="sample-c-master-detail.png"):
    t = Theme(False)
    c = Canvas(t, 860, 800)
    c.text((32, 20), "方案 C · 主从分栏", 11, t.muted, bold=True)
    c.text((32, 40), "插件清单同步", 22, t.text, bold=True)
    c.text((32, 72), "左侧选择同步范围，右侧查看状态与差异。", 13, t.muted)

    # left rail
    c.box((32, 96, 292, 660), fill=t.surface, outline=t.border, radius=10)
    c.text((52, 116), "同步内容", 13, t.muted, bold=True)
    scopes = [
        ("插件清单", "16 个 · 待处理 3", True, True),
        ("DSH 设置", "暂未开放", False, False),
        ("模型配置", "暂未开放", False, False),
        ("MCP 配置", "暂未开放", False, False),
        ("Skill 配置", "暂未开放", False, False),
    ]
    y = 148
    for label, meta, active, enabled in scopes:
        if active:
            c.box((40, y - 8, 284, y + 42), fill=t.accent_bg, outline=None, radius=8)
        c.dot((56, y + 6), t.ok if enabled else t.border)
        c.text((72, y), label, 13, t.text if enabled else t.muted, bold=active)
        c.text((72, y + 20), meta, 11, t.muted)
        y += 58

    # right detail
    rx0, rx1 = 316, c.w - 32
    c.card((rx0, 96, rx1, 360))
    c.text((rx0 + 24, 116), "插件清单", 16, t.text, bold=True)
    c.text((rx1 - 24, 118), "16 个插件", 12, t.muted, anchor="ra")
    x = rx0 + 24
    for label, value in [("本机", "16"), ("远端", "18"), ("待处理", "3"), ("备份", "4")]:
        c.text((x, 150), value, 20, t.warn if label == "待处理" else t.text, bold=True)
        c.text((x, 178), label, 11, t.muted)
        x += 118
    c.text((rx0 + 24, 206), "上次检查 15:12 · 上次发布 14:58（新增 2 / 更新 1）", 12, t.muted)
    c.button((rx1 - 24 - 96, 240), "发布", primary=True)
    c.button((rx1 - 24 - 96 - 104, 240), "检查差异", ghost=True)
    c.text((rx0 + 24, 248), "有 1 项需要你决定", 12, t.warn)

    c.card((rx0, 380, rx1, 660))
    c.text((rx0 + 24, 400), "差异与冲突", 15, t.text, bold=True)
    c.text((rx0 + 24, 426), "待安装 2 · 待升级 1 · 冲突 1", 12, t.muted)
    rows = [("dsh-notes", "安装", "— → 1.2.0", True), ("dsh-mnemon", "安装", "— → 0.4.1", True),
            ("dsh-context", "升级", "0.87.0 → 0.88.0", False)]
    y = 456
    for plugin, kind, change, checked in rows:
        c.checkbox((rx0 + 24, y + 2), checked)
        c.text((rx0 + 50, y), plugin, 13, t.text)
        c.text((rx0 + 220, y), kind, 12, t.warn if kind == "升级" else t.muted)
        c.text((rx0 + 316, y), change, 12, t.muted)
        y += 34
    c.line((rx0 + 24, y + 6, rx1 - 24, y + 6))
    c.text((rx0 + 24, y + 18), "冲突：dsh-context 两边都改过", 12, t.warn)
    c.button((rx0 + 24, y + 42), "保留本机", primary=False)
    c.button((rx0 + 24 + 108, y + 42), "采用 WebDAV", primary=False)
    c.text((rx1 - 24, y + 52), "冲突需单独确认", 11, t.muted, anchor="ra")

    c.line((32, 684, c.w - 32, 684))
    c.text((32, 702), "预留范围不会参与检测、上传、下载或应用。", 12, t.muted)
    c.save(name)



# ----------------------------------------------------------------------
# Sample A2: module cards with per-scope direction
# ----------------------------------------------------------------------
MODULES = [
    ("插件清单", "16 个插件 · 远端 16", "enabled"),
    ("DSH 设置", "暂未开放", "reserved"),
    ("模型配置", "暂未开放", "reserved"),
    ("MCP 配置", "暂未开放", "reserved"),
    ("Skill 配置", "暂未开放", "reserved"),
]
DIRECTIONS = ["仅上传", "仅下载", "双向（并集）"]


def segmented(c, xy, labels, active, width=280, disabled=False):
    x, y = xy
    t = c.t
    seg_w = width / len(labels)
    c.d.rounded_rectangle((x, y, x + width, y + 30), radius=8, fill=t.surface2, outline=t.border, width=1)
    for index, label in enumerate(labels):
        sx = x + index * seg_w
        if index == active and not disabled:
            c.d.rounded_rectangle((sx + 2, y + 2, sx + seg_w - 2, y + 28), radius=6, fill=t.bg, outline=t.border, width=1)
        color = t.muted if disabled else (t.text if index == active else t.muted)
        c.text((sx + seg_w / 2, y + 15), label, 12, color, anchor="mm")


def module_card(c, top, name, meta, state, direction=0, error=None, last="15:12"):
    t = c.t
    left, right = 32, c.w - 32
    failed = state == "failed"
    reserved = state == "reserved"
    if reserved:
        c.box((left, top, right, top + 52), fill=t.surface, outline=t.border, radius=10)
        c.dot((left + 20, top + 22), t.border)
        c.text((left + 36, top + 15), name, 14, t.muted, bold=True)
        c.badge((left + 36 + c.d.textlength(name, font=font(14, True)) + 10, top + 16), "暂未开放", t.muted, t.surface2)
        return top + 52 + 10

    height = 96 if not failed else 104
    c.box((left, top, right, top + height), fill=t.surface, outline=t.border, radius=10)
    if failed:
        c.d.rounded_rectangle((left, top + 14, left + 3, top + height - 14), radius=2, fill=t.danger)
    c.dot((left + 20, top + 24), t.danger if failed else t.ok)
    c.text((left + 36, top + 16), name, 15, t.text, bold=True)
    badge_x = left + 36 + c.d.textlength(name, font=font(15, True)) + 10
    if failed:
        c.badge((badge_x, top + 17), "同步失败", t.danger, "#fdeaea" if not t.dark else "#3a2224")
    else:
        c.badge((badge_x, top + 17), "已同步", t.ok, "#e8f5ec" if not t.dark else "#22321f")
    c.text((right - 20, top + 18), meta, 12, t.muted, anchor="ra")

    if failed:
        c.text((left + 36, top + 42), f"上次尝试失败：{error}", 12, t.danger, max_width=560)
        segmented(c, (left + 20, top + 62), DIRECTIONS, direction)
        c.button((right - 20 - 64, top + 60), "重试", primary=False)
    else:
        c.text((left + 36, top + 42), f"上次同步 {last} · {DIRECTIONS[direction]}", 12, t.muted)
        segmented(c, (left + 20, top + 62), DIRECTIONS, direction)
        c.button((right - 20 - 64, top + 60), "同步", primary=False)
    return top + height + 14


def sample_a2(dark=False, name="sample-d-modules.png"):
    t = Theme(dark)
    c = Canvas(t, 860, 660)
    c.text((32, 20), "方案 D · 模块卡片 + 方向规则（推荐）", 11, t.muted, bold=True)
    c.text((32, 40), "插件清单同步", 22, t.text, bold=True)
    c.text((32, 72), "每个同步项一张卡片，各自选方向；成功绿色，失败红色，未开放灰色。", 13, t.muted)

    c.line((32, 100, c.w - 32, 100))
    c.dot((32, 118), t.ok)
    c.text((48, 113), "已连接 app.koofr.net/dav/Koofr/WebDAV/Tool/temp", 13, t.text, max_width=520)
    c.badge((596, 111), "WebDAV 锁", t.accent, t.accent_bg)
    c.button((716, 106), "编辑", ghost=True)
    c.line((32, 152, c.w - 32, 152))

    y = 172
    y = module_card(c, y, "插件清单", "16 个插件 · 远端 16", "enabled", direction=2)
    for label, meta, state in MODULES[1:]:
        y = module_card(c, y, label, meta, state)
    c.text((32, y + 2), "方向：仅上传 = 只把本机清单推到远端；仅下载 = 只把远端清单取回本机；双向（并集）= 两边合并，冲突单独确认。", 12, t.muted, max_width=796)
    c.save(name)


def sample_a3(dark=False, name="sample-e-module-details.png"):
    t = Theme(dark)
    c = Canvas(t, 860, 580)
    c.text((32, 20), "方案 D · 展开某个模块后的差异", 11, t.muted, bold=True)
    c.text((32, 40), "插件清单同步", 22, t.text, bold=True)
    c.text((32, 72), "默认只看模块状态；需要时再展开差异，冲突仍单独确认。", 13, t.muted)

    c.line((32, 100, c.w - 32, 100))
    c.dot((32, 118), t.ok)
    c.text((48, 113), "已连接 app.koofr.net/dav/Koofr/WebDAV/Tool/temp", 13, t.text, max_width=520)
    c.button((716, 106), "编辑", ghost=True)
    c.line((32, 152, c.w - 32, 152))

    top = 168
    left, right = 32, c.w - 32
    c.box((left, top, right, top + 330), fill=t.surface, outline=t.border, radius=10)
    c.dot((left + 20, top + 22), t.ok)
    c.text((left + 36, top + 14), "插件清单", 15, t.text, bold=True)
    c.badge((left + 120, top + 15), "部分待处理", t.warn, "#fdf3e3" if not t.dark else "#332a1a")
    c.text((right - 20, top + 16), "16 个插件 · 远端 18", 12, t.muted, anchor="ra")
    c.text((left + 36, top + 40), "上次同步 15:12 · 双向（并集）", 12, t.muted)
    segmented(c, (left + 20, top + 58), DIRECTIONS, 2)
    c.button((right - 20 - 64, top + 56), "同步", primary=False)
    c.button((right - 20 - 140, top + 56), "收起差异", ghost=True)

    c.line((left + 20, top + 100, right - 20, top + 100))
    c.text((left + 20, top + 112), "待上传 2 · 待下载 1 · 冲突 1", 12, t.muted)
    rows = [("dsh-notes", "仅远端有", "— → 1.2.0", "下载"), ("dsh-mnemon", "本机较新", "0.5.0 → 0.4.1", "保留"),
            ("dsh-context", "两边都改过", "0.87.0 / 0.89.0", "冲突")]
    y = top + 138
    for plugin, kind, change, action in rows:
        c.text((left + 20, y), plugin, 13, t.text)
        c.text((left + 190, y), kind, 12, t.muted)
        c.text((left + 360, y), change, 12, t.muted)
        color = t.danger if action == "冲突" else t.muted
        c.text((left + 540, y), action, 12, color)
        y += 30
    c.text((left + 20, y + 10), "冲突（需单独确认）", 12, t.warn)
    c.text((left + 20, y + 32), "dsh-context · 本机 0.87.0 / WebDAV 0.89.0 / 上次同步 0.87.0", 12, t.muted, max_width=740)
    c.button((left + 20, y + 54), "保留本机", primary=False)
    c.button((left + 128, y + 54), "采用 WebDAV", primary=False)
    c.text((left, top + 344), "仅下载：远端较旧的行不会覆盖本机；仅上传：不会改动本机插件。", 12, t.muted, max_width=796)

    c.save(name)


def sample_f(dark=False, name="sample-f-failed.png"):
    t = Theme(dark)
    c = Canvas(t, 860, 640)
    c.text((32, 20), "方案 D · 同步失败状态", 11, t.muted, bold=True)
    c.text((32, 40), "插件清单同步", 22, t.text, bold=True)
    c.text((32, 72), "失败用红色：卡片左侧红条 + 原因 + 重试；其他模块不受影响。", 13, t.muted)

    c.line((32, 100, c.w - 32, 100))
    c.dot((32, 118), t.ok)
    c.text((48, 113), "已连接 app.koofr.net/dav/Koofr/WebDAV/Tool/temp", 13, t.text, max_width=520)
    c.button((716, 106), "编辑", ghost=True)
    c.line((32, 152, c.w - 32, 152))

    y = module_card(c, 172, "插件清单", "16 个插件 · 远端 18", "failed", direction=2,
                    error="远端清单被其他设备锁定（HTTP 423），稍后重试")
    y = module_card(c, y, "插件清单（仅下载）", "16 个插件 · 远端 16", "enabled", direction=1, last="21:04")
    for label, meta, state in MODULES[1:]:
        y = module_card(c, y, label, meta, state)
    c.save(name)




# ----------------------------------------------------------------------
# Sample G: two pages — sync modules / connection (WebDAV or Git)
# ----------------------------------------------------------------------
def tabs(c, xy, labels, active):
    t = c.t
    x, y = xy
    widths = [c.d.textlength(label, font=font(13, True)) + 32 for label in labels]
    for index, (label, w) in enumerate(zip(labels, widths)):
        selected = index == active
        if selected:
            c.d.rounded_rectangle((x, y, x + w, y + 32), radius=8, fill=t.surface)
            c.d.rounded_rectangle((x + 12, y + 29, x + w - 12, y + 32), radius=1, fill=t.accent)
        c.text((x + w / 2, y + 16), label, 13, t.text if selected else t.muted, anchor="mm", bold=selected)
        x += w + 4


def sample_g1(name="sample-g1-sync-page.png"):
    t = Theme(False)
    c = Canvas(t, 860, 580)
    c.text((32, 20), "方案 D+ · 同步页", 11, t.muted, bold=True)
    c.text((32, 40), "插件清单同步", 22, t.text, bold=True)
    tabs(c, (32, 74), ["同步", "连接"], 0)
    c.text((c.w - 32, 82), "● WebDAV · app.koofr.net/dav/…/temp", 12, t.muted, anchor="ra")
    c.line((32, 120, c.w - 32, 120))

    y = 140
    y = module_card(c, y, "插件清单", "16 个插件 · 远端 16", "enabled", direction=2)
    for label, meta, state in MODULES[1:]:
        y = module_card(c, y, label, meta, state)
    c.text((32, y + 2), "方向：仅上传 = 只推远端；仅下载 = 只取回本机；双向（并集）= 两边合并，冲突单独确认。", 12, t.muted, max_width=796)
    c.save(name)


def field(c, xy, width, label, value, placeholder=False):
    x, y = xy
    c.text((x, y), label, 12, c.t.muted)
    c.input((x, y + 18), width, value, placeholder=placeholder)


def sample_g2(name="sample-g2-connection-webdav.png"):
    t = Theme(False)
    c = Canvas(t, 860, 620)
    c.text((32, 20), "方案 D+ · 连接页（WebDAV）", 11, t.muted, bold=True)
    c.text((32, 40), "插件清单同步", 22, t.text, bold=True)
    tabs(c, (32, 74), ["同步", "连接"], 1)
    c.line((32, 120, c.w - 32, 120))

    c.text((32, 140), "传输方式", 13, t.text, bold=True)
    segmented(c, (32, 166), ["WebDAV", "Git"], 0, width=280)
    c.text((330, 174), "两个传输互斥：切换后需重新检查差异。", 12, t.muted)

    left, right = 32, c.w - 32
    c.box((left, 214, right, 214 + 324), fill=t.surface, outline=t.border, radius=10)
    field(c, (52, 232), 720, "HTTPS 文件夹地址", "https://app.koofr.net/dav/Koofr/WebDAV/Tool/temp/")
    field(c, (52, 300), 348, "用户名", "1057372918@qq.com")
    field(c, (428, 300), 344, "密码", "已保存（留空保留）", placeholder=True)
    field(c, (52, 368), 150, "远端备份保留", "10")
    c.text((216, 386), "份（0–50，当前清单不计入）", 12, t.muted)
    c.checkbox((52, 438))
    c.text((76, 437), "发布时自动安装缺失插件（会从远端清单下载安装）", 12, t.text)
    c.button((right - 20 - 88, 476), "测试连接", primary=False)
    c.button((right - 20 - 88 - 88, 476), "保存", primary=True)
    c.text((52, 484), "保存后回到「同步」页，先检查差异再同步。", 12, t.muted)

    c.text((32, 560), "说明：WebDAV 用一份 dsh-sync.json 保存当前清单与历史版本，写入前会探测服务器是否支持条件写入或独占锁。", 12, t.muted, max_width=796)
    c.save(name)


def sample_g3(name="sample-g3-connection-git.png"):
    t = Theme(False)
    c = Canvas(t, 860, 710)
    c.text((32, 20), "方案 D+ · 连接页（Git）", 11, t.muted, bold=True)
    c.text((32, 40), "插件清单同步", 22, t.text, bold=True)
    tabs(c, (32, 74), ["同步", "连接"], 1)
    c.line((32, 120, c.w - 32, 120))

    c.text((32, 140), "传输方式", 13, t.text, bold=True)
    segmented(c, (32, 166), ["WebDAV", "Git"], 1, width=280)
    c.text((330, 174), "两个传输互斥：切换后需重新检查差异。", 12, t.muted)

    left, right = 32, c.w - 32
    c.box((left, 214, right, 214 + 396), fill=t.surface, outline=t.border, radius=10)
    field(c, (52, 232), 720, "仓库地址", "git@github.com:kamisangk/dsh-sync-data.git")
    field(c, (52, 300), 348, "分支", "main")
    field(c, (428, 300), 344, "认证方式", "SSH 密钥（使用系统 ssh-agent）", placeholder=True)
    field(c, (52, 368), 348, "HTTPS 令牌（选 HTTPS 时使用）", "已保存（留空保留）", placeholder=True)
    field(c, (428, 368), 344, "提交作者", "dsh-sync@localhost", placeholder=True)
    field(c, (52, 436), 720, "本地仓库目录", "~/.dsh/dsh-sync/git", placeholder=True)
    c.text((52, 504), "远程仓库需为私有仓库；清单文件为仓库根目录的 dsh-sync.json，历史由提交保存。", 12, t.muted, max_width=740)
    c.button((right - 20 - 92, 548), "测试连接", primary=False)
    c.button((right - 20 - 92 - 92, 548), "保存", primary=True)

    c.text((32, 632), "Git 模式不会做文本合并：先读 origin/分支 上的清单，按并集规则在内存里合并，再提交；推送被拒时拉取后重算，因此不会产生 .git 冲突文件。", 12, t.muted, max_width=796)
    c.save(name)


if __name__ == "__main__":
    sample_a(False, "sample-a-workbench.png")
    sample_a(True, "sample-a-workbench-dark.png")
    sample_b()
    sample_c()
    sample_a2(False, "sample-d-modules.png")
    sample_a3(False, "sample-e-module-details.png")
    sample_f(False, "sample-f-failed.png")
    sample_g1()
    sample_g2()
    sample_g3()
