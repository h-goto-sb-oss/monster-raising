# -*- coding: utf-8 -*-
"""
build_game_data.py

既存の統合台帳(step2_dedup/monster_master_330.json)から、
プレイ可能なゲーム用データ(game/src/data/*)を生成するパイプライン。

読み込み専用: step1_normalized / step2_dedup / step3_fusion 配下のファイルは
一切書き換えない。出力は全て Monser_Raising/game/ 配下。

status によって振り分け:
  - 採用       -> ゲーム本体のロースターとして使用 (monsters.json)
  - 保留       -> monsters_pending.json に隔離。ゲームからは絶対に読み込まない。
  - 除外候補   -> monsters_excluded.json に隔離。ゲームからは絶対に読み込まない。

★★★ 重要 ★★★
本スクリプトが生成する能力値・技リストは、ゲームデザインが未確定な現時点での
「仮データ」である。GAME_SPEC_V0_1.md の「11. ゲーム化までに決めること」が
確定した時点で、本スクリプトの係数テーブル・skills.json を差し替えること。
"""

import hashlib
import json
import random
import shutil
from pathlib import Path

# ---------------------------------------------------------------------------
# パス設定
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent
STEP2_DIR = PROJECT_ROOT / "step2_dedup"
STEP1_SPRITES_DIR = PROJECT_ROOT / "step1_normalized" / "sprites"
STEP3_DIR = PROJECT_ROOT / "step3_fusion"

GAME_ROOT = PROJECT_ROOT.parent / "game"
DATA_DIR = GAME_ROOT / "src" / "data"
SPRITES_OUT_DIR = GAME_ROOT / "public" / "assets" / "monsters"

MASTER_JSON = STEP2_DIR / "monster_master_330.json"
SUMMARY_JSON = STEP2_DIR / "master_summary.json"
FUSION_MATRIX_JSON = STEP3_DIR / "type_fusion_matrix.json"
FUSION_RECIPES_JSON = STEP3_DIR / "fixed_recipe_seeds.json"

SKILLS_JSON = DATA_DIR / "skills.json"  # 既存(手動作成)を読み込むだけ。生成はしない。

# ---------------------------------------------------------------------------
# 仮データ設計: 階級別の基礎ステータステーブル (TEMPORARY / PLACEHOLDER)
# GAME_SPEC_V0_1.md 6章の「成長率は種族・属性・★段階で変える」方針の仮実装。
# 正式な成長式・経験値テーブルが決まるまでの初期値(Lv1相当)としてのみ使う。
# ---------------------------------------------------------------------------
TIER_BASE_STATS = {
    "下位":   {"hp": 28,  "mp": 8,  "atk": 9,  "def": 7,  "int": 6,  "spd": 8},
    "中位":   {"hp": 48,  "mp": 16, "atk": 15, "def": 12, "int": 11, "spd": 12},
    "上位":   {"hp": 80,  "mp": 28, "atk": 24, "def": 19, "int": 18, "spd": 17},
    "最上位": {"hp": 130, "mp": 45, "atk": 36, "def": 29, "int": 28, "spd": 24},
}

TIER_STARS = {"下位": 1, "中位": 2, "上位": 3, "最上位": 4}

# タイプごとの得意分野係数 (TEMPORARY / PLACEHOLDER)。該当ステータスにのみ乗算。
TYPE_MULTIPLIERS = {
    "ドラゴン": {"atk": 1.25, "int": 1.1},
    "スライム": {"hp": 1.3, "def": 1.2, "atk": 0.8},
    "幻魔":     {"mp": 1.4, "int": 1.3, "def": 0.85},
    "鳥翼":     {"spd": 1.35, "def": 0.85},
    "けもの":   {"atk": 1.15, "spd": 1.15},
    "むし":     {"spd": 1.1, "hp": 0.9},
    "水棲":     {"hp": 1.1, "def": 1.1},
    "物質":     {"def": 1.35, "spd": 0.8},
    "不死":     {"mp": 1.2, "int": 1.15, "spd": 0.9},
    "自然":     {"hp": 1.15, "mp": 1.1},
}

# 1レベルあたりの成長量 = Lv1ステータス x この比率 (TEMPORARY / PLACEHOLDER)。
# GAME_SPEC_V0_1.md 6章「★が高いほど、同レベルでの成長を良くする」。
# タイプ係数は compute_stats 側で既に効いているので、成長率もタイプの得意分野を継ぐ。
TIER_GROWTH_RATIO = {"下位": 0.085, "中位": 0.095, "上位": 0.105, "最上位": 0.115}

# 種族が技を覚えるレベルの階級補正。★が高いほど早く覚える。
# rank1(learnLevel=1)の技には適用しない = どの階級もLv1で1つは技を持つ。
TIER_LEARN_OFFSET = {"下位": 4, "中位": 2, "上位": 0, "最上位": -3}

# 1体が自然に覚える「系統の数」。
# skills.json が10タイプ x 18技まで増えたので、タイプの技を全部渡すと
# MAX_LEARNED_SKILLS(10) を超えてしまい、後半の技を永遠に覚えられなくなる。
# 同系統(line)は上位が下位を上書きするので 1系統 = 常時1枠。
# ここで系統を絞ることで、同じタイプでも個体ごとに覚える技が変わる。
TIER_LEARN_GROUPS = {"下位": 4, "中位": 5, "上位": 6, "最上位": 7}

# 敵として出したときに使ってくる技の上限レベル。
# 敵は常にレベル1相当なのに全技を使えてしまうと下位の敵が最上位技を撃つ。
TIER_ENEMY_SKILL_CAP = {"下位": 12, "中位": 22, "上位": 36, "最上位": 50}

STATUS_ACTIVE = "採用"
STATUS_PENDING = "保留"
STATUS_EXCLUDED = "除外候補"


def compute_stats(tier: str, type_: str) -> dict:
    """階級 x タイプ から仮の初期ステータスを算出する (TEMPORARY)。"""
    base = dict(TIER_BASE_STATS.get(tier, TIER_BASE_STATS["下位"]))
    mult = TYPE_MULTIPLIERS.get(type_, {})
    stats = {}
    for key, value in base.items():
        factor = mult.get(key, 1.0)
        stats[key] = max(1, round(value * factor))
    return stats


def compute_growth(tier: str, stats: dict) -> dict:
    """1レベルあたりの素の成長量 (TEMPORARY)。Lv1ステータスに比例させる。"""
    ratio = TIER_GROWTH_RATIO.get(tier, TIER_GROWTH_RATIO["下位"])
    return {k: round(v * ratio, 2) for k, v in stats.items()}


def compute_affinity(type_: str) -> dict:
    """得意度: タイプ係数を最大値で割って 0〜1 に正規化したもの。

    プラス値のボーナス倍率 (engine/growth.js) はこの得意度で重み付けする。
    成長量そのもの(compute_growth)は HP が桁で大きいため、
    「HP/(最大成長量)」だと全種族でHPが1.0になり "得意ステ" にならない。
    そこで階級由来のスケールを外した「タイプの得意分野プロファイル」を
    得意度として別に出力する。物質なら def=1.0、鳥翼なら spd=1.0 になる。
    """
    mult = TYPE_MULTIPLIERS.get(type_, {})
    values = {k: mult.get(k, 1.0) for k in ("hp", "mp", "atk", "def", "int", "spd")}
    peak = max(values.values())
    return {k: round(v / peak, 3) for k, v in values.items()}


def skill_groups(type_: str, skills_by_type: dict) -> list:
    """
    タイプの技を「系統(line)」でまとめたグループ一覧を返す。
    line が無い単発技は、それ1つで1グループ。
    グループ内は rank -> learnLevel の順に並べる。
    """
    groups = {}
    for s in skills_by_type.get(type_, []):
        key = s.get("line") or f"@{s['id']}"
        groups.setdefault(key, []).append(s)
    for members in groups.values():
        members.sort(key=lambda s: (s.get("rank", 1), s.get("learnLevel", 1)))
    # キー順に固定しておく (辞書の挿入順に依存させない = 再実行しても同じ結果)
    return sorted(groups.items(), key=lambda kv: kv[0])


def pick_groups_for(monster_id: str, tier: str, type_: str, skills_by_type: dict) -> list:
    """
    その個体が自然に覚える系統を選ぶ。
    Lv1技を含む系統は必ず入れる(配合の子がLv1で1つ技を持てるようにするため)。
    残りはモンスターidから決まる固定の乱数で選ぶので、再実行しても同じになる。
    """
    groups = skill_groups(type_, skills_by_type)
    if not groups:
        return []

    starter = None
    others = []
    for key, members in groups:
        if starter is None and any(s.get("learnLevel", 1) <= 1 for s in members):
            starter = (key, members)
        else:
            others.append((key, members))

    want = TIER_LEARN_GROUPS.get(tier, 4)
    seed = int(hashlib.md5(monster_id.encode("utf-8")).hexdigest()[:8], 16)
    rng = random.Random(seed)
    extra_count = max(0, min(len(others), want - (1 if starter else 0)))
    extra = rng.sample(others, extra_count) if extra_count else []

    chosen = ([starter] if starter else []) + extra
    return chosen


def build_learnset(monster_id: str, tier: str, type_: str, skills_by_type: dict) -> list:
    """種族が自然に覚える技リスト [{skillId, level}] を習得レベル順で返す。"""
    offset = TIER_LEARN_OFFSET.get(tier, 0)
    entries = []
    for _key, members in pick_groups_for(monster_id, tier, type_, skills_by_type):
        for s in members:
            base = s.get("learnLevel", 1)
            level = 1 if base <= 1 else max(2, min(50, base + offset))
            entries.append({"skillId": s["id"], "level": level})
    entries.sort(key=lambda e: (e["level"], e["skillId"]))
    return entries


def enemy_skills_from(learnset: list, tier: str) -> list:
    """敵として使ってくる技。習得レベルが階級の上限を超えるものは持たせない。"""
    cap = TIER_ENEMY_SKILL_CAP.get(tier, 12)
    ids = [e["skillId"] for e in learnset if e["level"] <= cap]
    if not ids and learnset:
        ids = [learnset[0]["skillId"]]
    return ids


def main():
    if not MASTER_JSON.exists():
        raise SystemExit(f"master json not found: {MASTER_JSON}")

    with open(MASTER_JSON, encoding="utf-8") as f:
        monsters = json.load(f)

    with open(SUMMARY_JSON, encoding="utf-8") as f:
        summary = json.load(f)

    # skills.json は本スクリプトの外(手動)で用意されている前提。
    skills_by_type = {}
    if SKILLS_JSON.exists():
        with open(SKILLS_JSON, encoding="utf-8") as f:
            skills = json.load(f)
        for s in skills:
            skills_by_type.setdefault(s["type_tag"], []).append(s)
    else:
        print(f"[WARN] skills.json が見つかりません: {SKILLS_JSON} (技リストは空になります)")

    active, pending, excluded = [], [], []
    for m in monsters:
        status = m.get("status")
        if status == STATUS_ACTIVE:
            active.append(m)
        elif status == STATUS_PENDING:
            pending.append(m)
        elif status == STATUS_EXCLUDED:
            excluded.append(m)
        else:
            print(f"[WARN] 未知のstatus '{status}' (id={m.get('id')}) -> 除外候補として隔離扱い")
            excluded.append(m)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SPRITES_OUT_DIR.mkdir(parents=True, exist_ok=True)

    # --- 隔離ファイル (保留 / 除外候補) : ゲームからは絶対に読み込まない ---
    with open(DATA_DIR / "monsters_pending.json", "w", encoding="utf-8") as f:
        json.dump(pending, f, ensure_ascii=False, indent=2)

    with open(DATA_DIR / "monsters_excluded.json", "w", encoding="utf-8") as f:
        json.dump(excluded, f, ensure_ascii=False, indent=2)

    # --- 採用モンスター: ゲーム用ロースターを生成 ---
    game_monsters = []
    missing_sprites = []
    for m in active:
        mid = m["id"]
        type_ = m["type"]
        tier = m["tier"]

        src_sprite = STEP1_SPRITES_DIR / f"{mid}.png"
        dst_sprite = SPRITES_OUT_DIR / f"{mid}.png"
        if src_sprite.exists():
            shutil.copyfile(src_sprite, dst_sprite)
        else:
            missing_sprites.append(mid)

        stats = compute_stats(tier, type_)
        learnset = build_learnset(mid, tier, type_, skills_by_type)
        game_monsters.append({
            "id": mid,
            "name": m["working_name"],
            "type": type_,
            "secondaryTypes": m.get("secondary_types", []),
            "tier": tier,
            "star": TIER_STARS.get(tier, 1),
            "spriteUrl": f"/assets/monsters/{mid}.png",
            "stats": stats,
            "growth": compute_growth(tier, stats),
            "affinity": compute_affinity(type_),
            "learnset": learnset,
            "skills": enemy_skills_from(learnset, tier),
        })

    with open(DATA_DIR / "monsters.json", "w", encoding="utf-8") as f:
        json.dump(game_monsters, f, ensure_ascii=False, indent=2)

    # --- タイプ合体行列はそのままコピー (外見・副タグの参考資料) ---
    if FUSION_MATRIX_JSON.exists():
        shutil.copyfile(FUSION_MATRIX_JSON, DATA_DIR / "fusionMatrix.json")

    # ★ fusionRecipes.json はここでは生成しない。
    #   手設計30件をそのままコピーすると到達不能なモンスターだらけになるため、
    #   build_fusion_recipes.py が手設計30件+自動生成レシピを合成して出力する。
    #   (ここで上書きするとレシピ表が壊れるので、絶対にコピーを復活させないこと)
    recipes_out = DATA_DIR / "fusionRecipes.json"
    if not recipes_out.exists():
        print(f"[WARN] {recipes_out} がありません。build_fusion_recipes.py を実行してください。")

    # --- 検算 ---
    expected_active = summary.get("status_counts", {}).get(STATUS_ACTIVE)
    ok = (expected_active is None) or (len(game_monsters) == expected_active)

    print("=== build_game_data.py 実行結果 ===")
    print(f"採用       : {len(active)} 体 -> monsters.json ({len(game_monsters)} 件)")
    print(f"保留       : {len(pending)} 体 -> monsters_pending.json (ゲーム未使用)")
    print(f"除外候補   : {len(excluded)} 体 -> monsters_excluded.json (ゲーム未使用)")
    print(f"master_summary.json の採用数({expected_active})と一致: {ok}")
    if missing_sprites:
        print(f"[WARN] スプライトが見つからなかったID ({len(missing_sprites)}件): {missing_sprites[:10]}...")
    print(f"出力先: {DATA_DIR}")
    print(f"スプライトコピー先: {SPRITES_OUT_DIR}")

    if not ok:
        raise SystemExit("[ERROR] 採用数がmaster_summary.jsonと一致しません。")


if __name__ == "__main__":
    main()
