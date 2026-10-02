from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageStat


TARGETS = {
    "iphone-6.5": (1242, 2688),
    "ipad-13": (2064, 2752),
}

NAMES = (
    "01-home",
    "02-levels",
    "03-gameplay-level-4",
    "04-gameplay-level-7",
    "05-gameplay-level-9",
)


def edge_color(image: Image.Image, top: bool) -> tuple[int, int, int]:
    width, height = image.size
    band_height = max(4, height // 18)
    y0 = 0 if top else height - band_height
    band = image.crop((0, y0, width, y0 + band_height)).convert("RGB")
    stat = ImageStat.Stat(band.resize((1, 1), Image.Resampling.LANCZOS))
    return tuple(round(channel) for channel in stat.mean[:3])


def gradient_canvas(size: tuple[int, int], top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    width, height = size
    gradient = Image.new("RGB", (1, height))
    pixels = gradient.load()
    for y in range(height):
        ratio = y / max(1, height - 1)
        pixels[0, y] = tuple(round(top[index] * (1 - ratio) + bottom[index] * ratio) for index in range(3))
    return gradient.resize((width, height), Image.Resampling.BILINEAR)


def add_subtle_depth(canvas: Image.Image, frame_box: tuple[int, int, int, int]) -> None:
    left, top, right, bottom = frame_box
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    spread = max(8, canvas.width // 120)
    draw.rectangle(
        (left - spread, top, right + spread, bottom),
        fill=(0, 44, 78, 70),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(10, canvas.width // 75)))
    canvas.paste(shadow, (0, 0), shadow)


def render(source: Path, target_size: tuple[int, int], destination: Path) -> None:
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")

    canvas = gradient_canvas(target_size, edge_color(image, True), edge_color(image, False))
    fitted = ImageOps.contain(image, target_size, Image.Resampling.LANCZOS)
    left = (target_size[0] - fitted.width) // 2
    top = (target_size[1] - fitted.height) // 2
    frame_box = (left, top, left + fitted.width, top + fitted.height)
    if left > 8:
        add_subtle_depth(canvas, frame_box)
    canvas.paste(fitted, (left, top))
    destination.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(destination, format="PNG", optimize=True, compress_level=9)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path)
    parser.add_argument("output_dir", type=Path)
    args = parser.parse_args()

    sources = [args.source_dir / f"{index}.png" for index in range(1, 6)]
    missing = [str(path) for path in sources if not path.is_file()]
    if missing:
        raise FileNotFoundError("Missing source screenshots: " + ", ".join(missing))

    for folder, target_size in TARGETS.items():
        for source, name in zip(sources, NAMES, strict=True):
            render(source, target_size, args.output_dir / folder / f"{name}.png")


if __name__ == "__main__":
    main()
