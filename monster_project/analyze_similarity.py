#!/usr/bin/env python3
"""330体の視覚・説明文・モチーフ類似度を算出し、比較用資料を作る。"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity


ROOT = Path(__file__).resolve().parent
CATALOG = ROOT.parent / "monster_catalog_330.html"
SPRITES = ROOT / "step1_normalized" / "sprites"
OUT = ROOT / "step2_dedup"


def load_entries() -> list[dict]:
    html = CATALOG.read_text(encoding="utf-8")
    match = re.search(r"const entries=(.*?);\nconst storageKey", html, re.S)
    if not match:
        raise RuntimeError("catalog entries not found")
    return json.loads(match.group(1))


def sprite_features(path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    image = Image.open(path).convert("RGBA")
    rgba = np.asarray(image)
    alpha = rgba[..., 3]
    ys, xs = np.where(alpha > 8)
    if len(xs):
        pad = 5
        x0, x1 = max(0, xs.min() - pad), min(image.width, xs.max() + pad + 1)
        y0, y1 = max(0, ys.min() - pad), min(image.height, ys.max() + pad + 1)
        image = image.crop((x0, y0, x1, y1))
    image.thumbnail((56, 56), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    canvas.alpha_composite(image, ((64 - image.width) // 2, (64 - image.height) // 2))
    arr = np.asarray(canvas).astype(np.float32) / 255.0
    a = arr[..., 3]
    # 背景色に左右されないシルエットと、暗背景上の色・明暗。
    silhouette = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((32, 32))).astype(np.float32).ravel() / 255
    rgb = arr[..., :3] * a[..., None] + 0.08 * (1 - a[..., None])
    rgb_small = np.asarray(Image.fromarray((rgb * 255).astype(np.uint8)).resize((24, 24))).astype(np.float32).ravel() / 255
    opaque = arr[..., :3][a > 0.1]
    hist = []
    for channel in range(3):
        h, _ = np.histogram(opaque[:, channel] if len(opaque) else [0], bins=12, range=(0, 1), density=True)
        hist.extend(h)
    return silhouette, rgb_small, np.asarray(hist, dtype=np.float32)


def make_contact(entries: list[dict], pairs: list[dict], path: Path, max_pairs: int = 120) -> None:
    tile_w, tile_h = 190, 178
    cols = 4
    rows = (min(len(pairs), max_pairs) + cols - 1) // cols
    sheet = Image.new("RGB", (tile_w * cols, tile_h * rows), "#101526")
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    by_id = {entry["id"]: entry for entry in entries}
    for index, pair in enumerate(pairs[:max_pairs]):
        x = (index % cols) * tile_w
        y = (index // cols) * tile_h
        draw.rectangle((x + 2, y + 2, x + tile_w - 3, y + tile_h - 3), outline="#43516e", width=2)
        for side, monster_id in enumerate((pair["a"], pair["b"])):
            sprite = Image.open(SPRITES / f"{monster_id}.png").convert("RGBA")
            sprite.thumbnail((82, 98), Image.Resampling.NEAREST)
            px = x + 7 + side * 92 + (82 - sprite.width) // 2
            py = y + 23 + (98 - sprite.height) // 2
            sheet.paste(sprite, (px, py), sprite)
            draw.text((x + 8 + side * 92, y + 7), monster_id, fill="white", font=font)
        score = f"総合 {pair['combined']:.3f} / 視覚 {pair['visual']:.3f} / 文 {pair['text']:.3f}"
        draw.text((x + 7, y + 126), score, fill="#90d7ff", font=font)
        a_desc = by_id[pair["a"]]["description"][:15]
        b_desc = by_id[pair["b"]]["description"][:15]
        draw.text((x + 7, y + 142), a_desc, fill="#d8deea", font=font)
        draw.text((x + 7, y + 157), b_desc, fill="#d8deea", font=font)
    sheet.save(path, quality=92)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    entries = load_entries()
    silhouettes, rgbs, hists = [], [], []
    for entry in entries:
        s, r, h = sprite_features(SPRITES / f"{entry['id']}.png")
        silhouettes.append(s)
        rgbs.append(r)
        hists.append(h)
    silhouettes = np.stack(silhouettes)
    rgbs = np.stack(rgbs)
    hists = np.stack(hists)
    texts = [entry["description"] + " " + " ".join(entry.get("groups", [])) for entry in entries]
    text_matrix = TfidfVectorizer(analyzer="char", ngram_range=(2, 4), min_df=1).fit_transform(texts)
    sim_sil = cosine_similarity(silhouettes)
    sim_rgb = cosine_similarity(rgbs)
    sim_hist = cosine_similarity(hists)
    sim_text = cosine_similarity(text_matrix)
    visual = 0.48 * sim_sil + 0.32 * sim_rgb + 0.20 * sim_hist
    combined = 0.62 * visual + 0.38 * sim_text

    pairs = []
    for i in range(len(entries)):
        for j in range(i + 1, len(entries)):
            # 同階級・隣接階級を重視しつつ、完全な意匠重複は階級を越えて拾う。
            if combined[i, j] >= 0.55 or sim_text[i, j] >= 0.58 or visual[i, j] >= 0.83:
                pairs.append({
                    "a": entries[i]["id"], "b": entries[j]["id"],
                    "a_desc": entries[i]["description"], "b_desc": entries[j]["description"],
                    "combined": round(float(combined[i, j]), 5),
                    "visual": round(float(visual[i, j]), 5),
                    "silhouette": round(float(sim_sil[i, j]), 5),
                    "color": round(float((0.615 * sim_rgb[i, j] + 0.385 * sim_hist[i, j])), 5),
                    "text": round(float(sim_text[i, j]), 5),
                })
    pairs.sort(key=lambda p: (p["combined"], p["text"], p["visual"]), reverse=True)
    (OUT / "similarity_candidates.json").write_text(json.dumps(pairs, ensure_ascii=False, indent=2), encoding="utf-8")
    with (OUT / "similarity_candidates.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(pairs[0]))
        writer.writeheader(); writer.writerows(pairs)
    make_contact(entries, pairs, OUT / "similarity_top120.jpg")
    print(json.dumps({"entries": len(entries), "candidate_pairs": len(pairs), "top": pairs[:12]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
