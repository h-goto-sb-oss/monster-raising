#!/usr/bin/env python3
"""Normalize 11 monster sheets into a deterministic 6x5 / 300px grid.

The script never overwrites source images. It groups every connected alpha
component with the nearest expected grid slot, preserving detached effects such
as bubbles and sparks, then centers the complete sprite in a 300x300 cell.
"""

from __future__ import annotations

import csv
import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path("/workspace/scratch/c0e4bfe93532")
PROJECT = ROOT / "monster_project"
OUTPUT = PROJECT / "step1_normalized"
SHEETS_DIR = OUTPUT / "sheets"
SPRITES_DIR = OUTPUT / "sprites"
QA_DIR = OUTPUT / "qa"

COLS = 6
ROWS = 5
CELL = 300
SAFE = 260
MARGIN = (CELL - SAFE) // 2
SHEET_SIZE = (COLS * CELL, ROWS * CELL)


SOURCES = [
    ("U1", "送付画像1", "下位候補", ROOT / "upload/07-JRPG-30-.png"),
    ("U2", "送付画像2", "下位候補", ROOT / "upload/06-30-.png"),
    ("U3", "送付画像3", "下位候補", ROOT / "upload/03-png"),
    ("U4", "送付画像4", "上位候補", ROOT / "upload/04-30-.png"),
    ("U5", "送付画像5", "中位候補", ROOT / "upload/02-30-.png"),
    ("U6", "送付画像6", "混合候補", ROOT / "upload/01-30-sprites.png"),
    ("G1", "今回生成・下位1", "下位", ROOT / "monster_lower_01.png"),
    ("G2", "今回生成・下位2", "下位", ROOT / "monster_lower_02.png"),
    ("G3", "今回生成・中位", "中位", ROOT / "monster_middle.png"),
    ("G4", "今回生成・上位", "上位", ROOT / "monster_upper.png"),
    ("G5", "今回生成・最上位", "最上位", ROOT / "monster_super_mixed.png"),
]


@dataclass
class SpriteRecord:
    id: str
    sheet_id: str
    sheet_name: str
    tier: str
    row: int
    col: int
    source: str
    output: str
    source_bbox: list[int]
    source_size: list[int]
    output_bbox: list[int]
    output_size: list[int]
    scale: float
    extraction_method: str
    component_count: int
    source_alpha_pixels: int
    output_alpha_pixels: int
    safe_margin_ok: bool


def ensure_dirs() -> None:
    for p in (SHEETS_DIR, SPRITES_DIR, QA_DIR):
        p.mkdir(parents=True, exist_ok=True)


def alpha_components(image: Image.Image) -> tuple[np.ndarray, list[dict]]:
    rgba = np.asarray(image.convert("RGBA"))
    binary = rgba[:, :, 3] > 8
    labels, count = ndimage.label(binary, structure=np.ones((3, 3), dtype=np.uint8))
    objects = ndimage.find_objects(labels)
    components: list[dict] = []
    for label_id in range(1, count + 1):
        sl = objects[label_id - 1]
        if sl is None:
            continue
        local = labels[sl] == label_id
        area = int(local.sum())
        if area < 2:
            continue
        cy, cx = ndimage.center_of_mass(binary, labels, label_id)
        components.append({"label": label_id, "area": area, "cx": float(cx), "cy": float(cy)})
    return labels, components


def assign_components(width: int, height: int, components: list[dict]) -> list[list[int]]:
    centers = [
        ((col + 0.5) * width / COLS, (row + 0.5) * height / ROWS)
        for row in range(ROWS)
        for col in range(COLS)
    ]
    assigned: list[list[int]] = [[] for _ in range(COLS * ROWS)]
    for component in components:
        cx, cy = component["cx"], component["cy"]
        slot = min(
            range(COLS * ROWS),
            key=lambda i: ((cx - centers[i][0]) / (width / COLS)) ** 2
            + ((cy - centers[i][1]) / (height / ROWS)) ** 2,
        )
        assigned[slot].append(component["label"])
    return assigned


def extract_slot(image: Image.Image, labels: np.ndarray, label_ids: list[int]) -> tuple[Image.Image, tuple[int, int, int, int], int]:
    if not label_ids:
        raise ValueError("Empty slot")
    rgba = np.asarray(image.convert("RGBA")).copy()
    mask = np.isin(labels, label_ids)
    rgba[:, :, 3] = np.where(mask, rgba[:, :, 3], 0)
    ys, xs = np.where(mask)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    crop = Image.fromarray(rgba, "RGBA").crop(bbox)
    return crop, bbox, int(mask.sum())


def extract_grid_cell(image: Image.Image, labels: np.ndarray, row: int, col: int) -> tuple[Image.Image, tuple[int, int, int, int], int, int]:
    """Deterministic fallback for a row containing alpha-connected neighbors."""
    x0 = round(col * image.width / COLS)
    x1 = round((col + 1) * image.width / COLS)
    y0 = round(row * image.height / ROWS)
    y1 = round((row + 1) * image.height / ROWS)
    region = image.crop((x0, y0, x1, y1)).convert("RGBA")
    rgba = np.asarray(region).copy()
    alpha = rgba[:, :, 3]
    local_labels, local_count = ndimage.label(alpha > 8, structure=np.ones((3, 3), dtype=np.uint8))
    local_objects = ndimage.find_objects(local_labels)
    local_components = []
    for label_id in range(1, local_count + 1):
        sl = local_objects[label_id - 1]
        if sl is None:
            continue
        area = int((local_labels[sl] == label_id).sum())
        local_components.append((label_id, sl, area))
    if local_components:
        largest = max(area for _, _, area in local_components)
        height, width = alpha.shape
        for label_id, sl, area in local_components:
            ysl, xsl = sl
            touches_edge = xsl.start <= 2 or ysl.start <= 2 or xsl.stop >= width - 2 or ysl.stop >= height - 2
            if touches_edge and area < largest * 0.20:
                rgba[local_labels == label_id, 3] = 0
    region = Image.fromarray(rgba, "RGBA")
    alpha = rgba[:, :, 3]
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise ValueError(f"Grid fallback is empty at row={row + 1}, col={col + 1}")
    local_bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    global_bbox = (x0 + local_bbox[0], y0 + local_bbox[1], x0 + local_bbox[2], y0 + local_bbox[3])
    label_count = len(set(np.unique(labels[y0:y1, x0:x1])) - {0})
    return region.crop(local_bbox), global_bbox, int((alpha > 8).sum()), label_count


def normalize_sprite(sprite: Image.Image) -> tuple[Image.Image, float, tuple[int, int, int, int]]:
    bbox = sprite.getbbox()
    if bbox is None:
        raise ValueError("Transparent sprite")
    sprite = sprite.crop(bbox)
    width, height = sprite.size
    scale = min(SAFE / width, SAFE / height)
    out_w = max(1, round(width * scale))
    out_h = max(1, round(height * scale))
    resized = sprite.resize((out_w, out_h), Image.Resampling.NEAREST)
    cell = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    x = (CELL - out_w) // 2
    y = (CELL - out_h) // 2
    cell.alpha_composite(resized, (x, y))
    return cell, scale, (x, y, x + out_w, y + out_h)


def checkerboard(size: tuple[int, int], block: int = 20) -> Image.Image:
    w, h = size
    canvas = Image.new("RGB", size, "#202538")
    draw = ImageDraw.Draw(canvas)
    for y in range(0, h, block):
        for x in range(0, w, block):
            if (x // block + y // block) % 2:
                draw.rectangle((x, y, x + block - 1, y + block - 1), fill="#303750")
    return canvas


def qa_preview(sheet: Image.Image, output: Path) -> None:
    bg = checkerboard(sheet.size)
    bg.paste(sheet, mask=sheet.getchannel("A"))
    draw = ImageDraw.Draw(bg)
    for x in range(0, sheet.width + 1, CELL):
        draw.line((x, 0, x, sheet.height), fill="#ffcc4d", width=3)
    for y in range(0, sheet.height + 1, CELL):
        draw.line((0, y, sheet.width, y), fill="#ffcc4d", width=3)
    for row in range(ROWS):
        for col in range(COLS):
            x0, y0 = col * CELL + MARGIN, row * CELL + MARGIN
            x1, y1 = (col + 1) * CELL - MARGIN, (row + 1) * CELL - MARGIN
            draw.rectangle((x0, y0, x1, y1), outline="#49e3a8", width=2)
    bg.resize((900, 750), Image.Resampling.NEAREST).save(output, optimize=True)


def process_sheet(sheet_id: str, sheet_name: str, tier: str, source: Path) -> tuple[list[SpriteRecord], dict]:
    image = Image.open(source).convert("RGBA")
    labels, components = alpha_components(image)
    assigned = assign_components(image.width, image.height, components)
    fallback_rows = {index // COLS for index, label_ids in enumerate(assigned) if not label_ids}
    # The generated upper and super-tier sheets contain touching auras and
    # ornaments. Their intended cells remain regular, so geometric row slicing
    # is safer than treating touching alpha as one monster.
    if sheet_id in {"G4", "G5"}:
        fallback_rows = set(range(ROWS))
    output_sheet = Image.new("RGBA", SHEET_SIZE, (0, 0, 0, 0))
    records: list[SpriteRecord] = []

    for index, label_ids in enumerate(assigned):
        row, col = divmod(index, COLS)
        monster_id = f"{sheet_id}-{index + 1:02d}"
        if row in fallback_rows:
            raw, source_bbox, source_pixels, component_count = extract_grid_cell(image, labels, row, col)
            extraction_method = "fractional-grid-row-fallback"
        else:
            raw, source_bbox, source_pixels = extract_slot(image, labels, label_ids)
            component_count = len(label_ids)
            extraction_method = "nearest-component-grouping"
        cell, scale, output_bbox = normalize_sprite(raw)
        sprite_path = SPRITES_DIR / f"{monster_id}.png"
        cell.save(sprite_path, optimize=True)
        output_sheet.alpha_composite(cell, (col * CELL, row * CELL))

        alpha = np.asarray(cell)[:, :, 3]
        ys, xs = np.where(alpha > 8)
        bbox = [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]
        safe_ok = bbox[0] >= MARGIN and bbox[1] >= MARGIN and bbox[2] <= CELL - MARGIN and bbox[3] <= CELL - MARGIN
        records.append(
            SpriteRecord(
                id=monster_id,
                sheet_id=sheet_id,
                sheet_name=sheet_name,
                tier=tier,
                row=row + 1,
                col=col + 1,
                source=str(source.relative_to(ROOT)),
                output=str(sprite_path.relative_to(PROJECT)),
                source_bbox=list(source_bbox),
                source_size=[raw.width, raw.height],
                output_bbox=bbox,
                output_size=[CELL, CELL],
                scale=round(scale, 6),
                extraction_method=extraction_method,
                component_count=component_count,
                source_alpha_pixels=source_pixels,
                output_alpha_pixels=int((alpha > 8).sum()),
                safe_margin_ok=safe_ok,
            )
        )

    sheet_path = SHEETS_DIR / f"{sheet_id}.png"
    output_sheet.save(sheet_path, optimize=True)
    qa_preview(output_sheet, QA_DIR / f"{sheet_id}_qa.png")
    report = {
        "sheet_id": sheet_id,
        "sheet_name": sheet_name,
        "tier": tier,
        "source": str(source.relative_to(ROOT)),
        "source_size": list(image.size),
        "source_components": len(components),
        "output": str(sheet_path.relative_to(PROJECT)),
        "output_size": list(output_sheet.size),
        "sprites": len(records),
        "empty_cells": sum(record.source_alpha_pixels == 0 for record in records),
        "safe_cells": sum(record.safe_margin_ok for record in records),
        "min_scale": round(min(record.scale for record in records), 4),
        "max_scale": round(max(record.scale for record in records), 4),
    }
    return records, report


def build_overview() -> None:
    thumb_w, thumb_h = 450, 375
    canvas = Image.new("RGB", (thumb_w * 3, thumb_h * 4), "#111526")
    draw = ImageDraw.Draw(canvas)
    for i, (sheet_id, _, _, _) in enumerate(SOURCES):
        qa = Image.open(QA_DIR / f"{sheet_id}_qa.png").convert("RGB")
        qa = qa.resize((thumb_w, thumb_h), Image.Resampling.NEAREST)
        x, y = (i % 3) * thumb_w, (i // 3) * thumb_h
        canvas.paste(qa, (x, y))
        draw.rectangle((x + 4, y + 4, x + 60, y + 32), fill="#05060b")
        draw.text((x + 12, y + 8), sheet_id, fill="#ffffff")
    canvas.save(QA_DIR / "overview.jpg", quality=90, optimize=True)


def main() -> None:
    ensure_dirs()
    all_records: list[SpriteRecord] = []
    sheet_reports: list[dict] = []
    for source in SOURCES:
        records, report = process_sheet(*source)
        all_records.extend(records)
        sheet_reports.append(report)
    build_overview()

    manifest = {
        "spec": {
            "columns": COLS,
            "rows": ROWS,
            "sheet_width": SHEET_SIZE[0],
            "sheet_height": SHEET_SIZE[1],
            "cell_width": CELL,
            "cell_height": CELL,
            "safe_width": SAFE,
            "safe_height": SAFE,
            "background": "transparent",
            "resize_filter": "nearest-neighbor",
        },
        "sheets": sheet_reports,
        "sprites": [asdict(record) for record in all_records],
    }
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    with (OUTPUT / "manifest.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(asdict(all_records[0]).keys()))
        writer.writeheader()
        for record in all_records:
            row = asdict(record)
            for key, value in row.items():
                if isinstance(value, list):
                    row[key] = "x".join(map(str, value))
            writer.writerow(row)

    failures = [r.id for r in all_records if not r.safe_margin_ok]
    summary = {
        "sheets": len(sheet_reports),
        "sprites": len(all_records),
        "expected_sprites": len(SOURCES) * COLS * ROWS,
        "safe_margin_failures": failures,
        "all_sheet_sizes_ok": all(r["output_size"] == list(SHEET_SIZE) for r in sheet_reports),
        "all_cell_counts_ok": all(r["sprites"] == COLS * ROWS for r in sheet_reports),
        "all_cells_nonempty": all(r["empty_cells"] == 0 for r in sheet_reports),
        "geometry_score_out_of_10": 10 if not failures else max(0, 10 - len(failures)),
    }
    (OUTPUT / "qa_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
