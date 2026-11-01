"""生成 PWA / iOS 图标。

用法：python scripts/make-icons.py
需要 Pillow。源图是 public/icon.png（512×512，圆角处透明）。
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SRC = PUBLIC / "icon.png"

# 圆角外的透明区域填成图标本身的蓝色，iOS 的圆角遮罩才不会露出白边
BLEED_TOP = (65, 88, 207)
BLEED_BOTTOM = (50, 69, 170)


def full_bleed(size: int) -> Image.Image:
    """把圆角图标铺到渐变蓝底上，得到没有透明像素的方形图。"""
    from PIL import ImageDraw

    base = Image.new("RGB", (512, 512))
    draw = ImageDraw.Draw(base)
    for y in range(512):
        t = y / 511
        color = tuple(round(BLEED_TOP[i] + (BLEED_BOTTOM[i] - BLEED_TOP[i]) * t) for i in range(3))
        draw.line([(0, y), (511, y)], fill=color)
    icon = Image.open(SRC).convert("RGBA")
    base.paste(icon, (0, 0), icon)
    return base.resize((size, size), Image.LANCZOS)


def main() -> None:
    icon = Image.open(SRC).convert("RGBA")
    icon.resize((192, 192), Image.LANCZOS).save(PUBLIC / "icon-192.png")
    icon.save(PUBLIC / "icon-512.png")
    full_bleed(512).save(PUBLIC / "icon-maskable-512.png")
    full_bleed(180).save(PUBLIC / "apple-touch-icon.png")
    print("icons written")


if __name__ == "__main__":
    main()
