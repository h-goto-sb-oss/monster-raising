#!/usr/bin/env python3
"""10タイプの合体行列と、固定モンスター試作レシピを生成する。"""

from __future__ import annotations

import csv
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
MASTER = ROOT / "step2_dedup" / "monster_master_330.json"
OUT = ROOT / "step3_fusion"

TYPES = ["スライム", "ドラゴン", "けもの", "鳥翼", "自然", "むし", "水棲", "物質", "不死", "幻魔"]
TYPE_INFO = {
    "スライム": {"body": "粘体・滴・弾力", "gift": "柔軟、分裂、吸収"},
    "ドラゴン": {"body": "鱗・角・尾・ブレス器官", "gift": "鱗、息、威圧"},
    "けもの": {"body": "毛皮・牙・四肢", "gift": "本能、嗅覚、突進"},
    "鳥翼": {"body": "翼・羽毛・くちばし", "gift": "飛行、風、歌声"},
    "自然": {"body": "葉・菌糸・樹皮・花", "gift": "再生、胞子、根"},
    "むし": {"body": "外骨格・複眼・節足", "gift": "毒、糸、群れ"},
    "水棲": {"body": "ひれ・えら・殻・触手", "gift": "水中適応、泡、潮"},
    "物質": {"body": "鉱石・道具・機械・建築", "gift": "装甲、機構、無機質化"},
    "不死": {"body": "骨・霊火・影・包帯", "gift": "呪い、吸収、夜行"},
    "幻魔": {"body": "魔力体・人型・異界器官", "gift": "魔法、幻惑、儀式"},
}

FIXED_RECIPES = [
    ("F001", ["U2-03", "U2-10"], "U4-06", "苔岩の体へ火精の核を入れ、溶岩巨像を作る"),
    ("F002", ["U2-09", "U2-10"], "U4-13", "甲羅へ火山性を定着させる"),
    ("F003", ["U1-16", "U2-22"], "U4-19", "森の子ジカへ星精の加護を与える"),
    ("F004", ["U2-11", "U2-10"], "U4-22", "黒い鳥へ火精の核を継承する"),
    ("F005", ["U1-30", "U3-17", "G1-21"], "U4-21", "水竜へ魚の水中適応と磁性装甲を加える"),
    ("F006", ["U1-08", "U5-29"], "U4-23", "小ガイコツを血統に、死神の呪力を王格へ凝縮する"),
    ("F007", ["U1-26", "U5-22"], "U4-24", "捕食器官と巨樹の生命力を固定する"),
    ("F008", ["U2-04", "U2-22"], "U5-11", "氷兎へ星月の性質を混ぜる"),
    ("F009", ["U2-14", "G1-17"], "U5-15", "旅キノコへ音の器官を加える"),
    ("F010", ["U1-09", "U1-03"], "U5-18", "鉱石を掘る本能と結晶甲殻を合わせる"),
    ("F011", ["G1-08", "G2-12"], "G3-02", "器の体へ蒸気生命を宿す"),
    ("F012", ["G1-09", "G1-21", "G2-06"], "G3-30", "時計・磁力・天体指向を一つの機構へ統合する"),
    ("F013", ["G1-10", "G1-29"], "G3-09", "収納ミミックへ伸縮機構を加え旅行かばん化する"),
    ("F014", ["G1-06", "G1-22"], "G3-13", "ぜんまい人形を安全ピンの関節で戦闘用にする"),
    ("F015", ["G1-18", "G1-30"], "G3-01", "音の道具と多数のボタンを蛇腹装甲へまとめる"),
    ("F016", ["G3-30", "G3-17", "G2-05"], "G5-24", "中位方位機構へ小世界とオーロラ動力を組み込み、無限方位盤へ昇華する"),
    ("F017", ["G3-28", "G3-24"], "G4-10", "鏡霊を騎士の血統へ封じ、迷宮装甲にする"),
    ("F018", ["G3-03", "G3-14", "G2-01"], "G4-08", "音盤・多脚・影だまりから巨大演奏魔を作る"),
    ("F019", ["G3-11", "G3-22", "G2-06"], "G4-09", "風力炉へ隕石核を落とし込む"),
    ("F020", ["G3-20", "G3-18"], "G4-22", "二つの都市設備を遊園地を背負う巨像へ拡張する"),
    ("F021", ["G4-02", "G5-24"], "G5-16", "宮殿時計と無限方位盤を世界時計へ統合する"),
    ("F022", ["G4-10", "G4-23"], "G5-11", "鏡迷宮へ月観測の聖性を加える"),
    ("F023", ["G4-12", "G4-30"], "G5-19", "黒穴魔術と異次元門を固定して虚空の主を作る"),
    ("F024", ["G4-28", "G4-30"], "G5-17", "虹大聖堂を異界へ接続し星雲化する"),
    ("F025", ["G4-09", "G4-06"], "G5-20", "隕石炉と黒曜石の音楽箱を星鍛造炉へ昇華する"),
    ("F026", ["G4-16", "G4-26"], "G5-29", "操り王へ多数の王権を集め宇宙皇帝化する"),
    ("F027", ["G4-03", "G4-17"], "G5-12", "日食の支配力と賭けの魔性を道化王へまとめる"),
    ("F028", ["G4-15", "G4-23"], "G5-15", "光の翼と月観測を天球観測神へ昇華する"),
    ("F029", ["G4-01", "G4-19", "G4-24"], "G5-06", "三種の巨大な響きを山の守護者へ束ねる"),
    ("F030", ["G4-16", "G4-04", "G4-30"], "G5-27", "人形劇・幽霊船・異界門から夢劇場を成立させる"),
]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    master = json.loads(MASTER.read_text(encoding="utf-8"))
    by_id = {row["id"]: row for row in master}
    matrix = []
    for bloodline in TYPES:
        for partner in TYPES:
            matrix.append({
                "bloodline_type": bloodline,
                "partner_type": partner,
                "result_primary_type": bloodline,
                "partner_influence": TYPE_INFO[partner]["gift"],
                "visual_rule": f"{TYPE_INFO[bloodline]['body']}を主身体に保ち、{TYPE_INFO[partner]['body']}を20〜35%加える",
                "system_rule": "基本レシピ。相手要素は副タグ・外見・耐性・継承特技へ反映",
            })
    with (OUT / "type_fusion_matrix.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(matrix[0])); writer.writeheader(); writer.writerows(matrix)
    (OUT / "type_fusion_matrix.json").write_text(json.dumps(matrix, ensure_ascii=False, indent=2), encoding="utf-8")

    recipes = []
    for rid, inputs, target, rationale in FIXED_RECIPES:
        missing = [monster_id for monster_id in inputs + [target] if monster_id not in by_id]
        if missing:
            raise RuntimeError(f"{rid}: missing IDs {missing}")
        target_row = by_id[target]
        input_rows = [by_id[monster_id] for monster_id in inputs]
        recipes.append({
            "recipe_id": rid, "recipe_kind": "固定×固定" if len(inputs) == 2 else "複数固定の特殊合体",
            "bloodline_id": inputs[0], "bloodline_name": input_rows[0]["working_name"],
            "partner_ids": inputs[1:], "partner_names": [row["working_name"] for row in input_rows[1:]],
            "target_id": target, "target_name": target_row["working_name"], "target_tier": target_row["tier"],
            "target_type": target_row["type"], "design_rationale": rationale,
            "status": "試作・能力システム確定後に再検証",
        })
    (OUT / "fixed_recipe_seeds.json").write_text(json.dumps(recipes, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_recipes = [{**r, "partner_ids": "|".join(r["partner_ids"]), "partner_names": "|".join(r["partner_names"])} for r in recipes]
    with (OUT / "fixed_recipe_seeds.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(csv_recipes[0])); writer.writeheader(); writer.writerows(csv_recipes)

    type_counts = {t: sum(1 for row in master if row["status"] != "除外候補" and row["type"] == t) for t in TYPES}
    lines = ["# 合体システム設計 v0.1", "", "## 変更しない基本原則", "",
             "- 血統側のタイプを結果の主タイプにする。", "- 相手側は副タグ、外見、耐性、継承特技へ影響する。",
             "- タイプ×タイプは常設の基本合体。", "- タイプ×固定／固定×タイプは特定モチーフを狙う中級合体。",
             "- 固定×固定と複数固定は、上位・最上位を狙う発見型レシピ。", "- 同種×同種は純化、限界強化、特殊個体の入口として予約する。",
             "- 能力値、耐性値、特技名、生息地は未確定のため、現段階では数値化しない。", "", "## 現在の10タイプ", ""]
    for type_name in TYPES:
        lines.append(f"- {type_name}: 主身体は{TYPE_INFO[type_name]['body']}。相手へ与える要素は{TYPE_INFO[type_name]['gift']}。現在{type_counts[type_name]}体。")
    lines += ["", "## 生成済み資料", "", "- `type_fusion_matrix.csv`: 10×10＝100通りの基本規則。", "- `fixed_recipe_seeds.csv`: 固定合体の試作30件。",
              "", "## 次に必要な判断", "", "- 保留25体の採否を確定してから、固定レシピを本採番する。",
              "- 能力・耐性・特技のコスト式が決まってから、合体難度と継承枠を数値化する。",
              "- 物質タイプが多いため、追加モンスターは鳥翼・むし・水棲・スライムを優先する。", ""]
    (OUT / "FUSION_DESIGN.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"type_rules": len(matrix), "fixed_seed_recipes": len(recipes), "type_counts": type_counts}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
