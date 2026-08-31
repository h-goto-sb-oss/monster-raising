# -*- coding: utf-8 -*-
"""
build_fusion_recipes.py

配合(合体)レシピ表を自動生成し、game/src/data/fusionRecipes.json を出力する。

読み込み専用: step1_normalized / step2_dedup / step3_fusion 配下は一切書き換えない。

================================================================================
なぜ自動生成するのか
================================================================================
手設計レシピ(step3_fusion/fixed_recipe_seeds.json)は30件しかなく、実測すると
    最上位29体中、野生モンスターから到達できるのは 1体だけ
    上位57体中、レシピが存在するのは 11体だけ
という状態で、そもそも遊べない。そこで「手設計30件を最優先の特殊レシピとして
温存したまま」、全モンスターに入手経路が通る基本レシピ表を機械生成する。

================================================================================
生成ルール
================================================================================
[1] 階級(tier)の決まり方
    血統(bloodline)と相手(partner)の階級を比べる。
      - 相手が血統と「同格以上」  -> 結果は血統の1段上 (up)
      - 相手が血統より「格下」    -> 結果は血統と同じ階級 (same)
    つまり
      下位 x 下位以上   -> 中位
      中位 x 中位以上   -> 上位          中位 x 下位   -> 中位 (横移動)
      上位 x 上位以上   -> 最上位        上位 x 中位/下位 -> 上位 (横移動)
      最上位 x 何でも   -> 最上位
    横移動(same)を用意しているのは、中位・上位で袋小路にならないようにするため。
    「格下を食わせるとタイプや個体は変えられるが階級は上がらない」という設計。

[2] 結果タイプの決まり方(フォールバック連鎖)
    DESIGN_NOTES.md の「血統側のタイプが子の基本タイプ」を原則とする。
    ただし目標階級にそのタイプのモンスターが1体も居ない場合があるため、
    以下の順に降りる。どの規則が発火したかは type_rule に必ず記録する。
      1. 血統タイプ      : (血統タイプ, 目標階級) に採用モンスターが居る
      2. 相手タイプ      : 居ないので相手側のタイプへ寄せる  ★ユーザー承認済みの仕様変更
      3. 行列既定タイプ  : type_fusion_matrix.json の result_primary_type
      4. タイプ代替      : それでも駄目なら、その階級で最も層が厚いタイプへ
    ※実データ上、行列の result_primary_type は常に bloodline_type と等しいため
      規則3は事実上発火しない(監査用に残している)。
    例) スライムは下位4体しか存在せず中位以降が居ない
        -> スライム血統の配合は必ず「相手タイプ」へ乗り換わる。

[3] 手設計レシピの優先
    fixed_recipe_seeds.json の30件は source="手設計" として原文のまま保持し、
    UI は必ず special を先に引く。同じ組み合わせなら手設計が勝つ。

[4] hidden
    上位/最上位の結果は hidden=true (UIでは「？？？」表示)。中位は hidden=false。

================================================================================
出力データ構造 (game/src/data/fusionRecipes.json)
================================================================================
285x285=81,225通りを列挙すると巨大になるので、
「結果は (血統の個体, 相手のタイプ, 階級の向き) だけで決まる」という性質を使って
(bloodline_id) x (direction) x (partner_type) で引ける表に畳んでいる。

{
  "meta": {...},
  "tier_order":   ["下位","中位","上位","最上位"],
  "tier_advance": {"下位":"中位", ...},
  "special": [                      # 手設計30件。UIはこちらを先に検索する
    {recipe_id, source, recipe_kind, bloodline_id, partner_ids[], result_id,
     result_tier, result_type, type_rule, hidden, rationale}
  ],
  "type_rules": ["血統タイプ","相手タイプ","行列既定タイプ","タイプ代替"],  # 添字=下のコード
  "by_bloodline": {
    "<血統モンスターid>": {
      "up":   {"result_tier":"中位", "hidden":false,
               # 相手タイプ -> [result_id, result_type, type_ruleのコード]
               "partners": {"<相手タイプ>": ["U2-05","けもの",0]}},
      "same": {...} または null
    }
  }
}

自動生成分の recipe_id は保存しない。ファイル肥大を避けるため
    "G:<血統id>:<direction>:<相手タイプ>"   (例 "G:U1-02:up:けもの")
という決定的な書式でUI側が組み立てる。再生成しても不変。
result_tier / hidden は向き単位で共通なので上位階層へ括り出してある。

UI側の引き方 (O(1)):
  1. special から (bloodline_id, partner_ids == [partner_id]) 完全一致を探す
  2. 無ければ direction = (相手の階級 >= 血統の階級) ? "up" : "same"
     by_bloodline[血統id][direction].partners[相手のタイプ]
  3. それも無ければ「レシピ無し」
存在しない相手(例: 中位以上のスライムは0体)のキーは最初から生成しない。

================================================================================
自己検証
================================================================================
野生入手可能な下位+中位=199体だけを初期集合として、レシピを不動点まで適用する
到達可能性シミュレーションを実行し、上位57体・最上位29体が100%到達可能でなければ
孤立モンスターを列挙して異常終了する。
"""

import json
import re
import sys
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

# ---------------------------------------------------------------------------
# パス設定
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent
STEP2_DIR = PROJECT_ROOT / "step2_dedup"
STEP3_DIR = PROJECT_ROOT / "step3_fusion"

GAME_ROOT = PROJECT_ROOT.parent / "game"
DATA_DIR = GAME_ROOT / "src" / "data"

MASTER_JSON = STEP2_DIR / "monster_master_330.json"
FUSION_MATRIX_JSON = STEP3_DIR / "type_fusion_matrix.json"
SEEDS_JSON = STEP3_DIR / "fixed_recipe_seeds.json"

OUT_JSON = DATA_DIR / "fusionRecipes.json"

STATUS_ACTIVE = "採用"

TIER_ORDER = ["下位", "中位", "上位", "最上位"]
TIER_INDEX = {t: i for i, t in enumerate(TIER_ORDER)}
TIER_ADVANCE = {"下位": "中位", "中位": "上位", "上位": "最上位", "最上位": "最上位"}

# 野生で捕まえられる階級 (GAME_SPEC_V0_1.md「上位種以降は野生ではほぼ見かけない」)
WILD_TIERS = {"下位", "中位"}

HIDDEN_TIERS = {"上位", "最上位"}

RULE_BLOODLINE = "血統タイプ"
RULE_PARTNER = "相手タイプ"
RULE_MATRIX = "行列既定タイプ"
RULE_SUBSTITUTE = "タイプ代替"
RULE_HANDMADE = "手設計"

# by_bloodline のタプル3番目に入るコード。fusionRecipes.json の "type_rules" と同じ順。
TYPE_RULE_LIST = [RULE_BLOODLINE, RULE_PARTNER, RULE_MATRIX, RULE_SUBSTITUTE]
TYPE_RULE_CODE = {name: i for i, name in enumerate(TYPE_RULE_LIST)}

# 自動生成レシピのID書式(ファイルには保存せず、UI側で組み立てる)
GENERATED_RECIPE_ID_FORMAT = "G:<bloodline_id>:<direction>:<partner_type>"


# ---------------------------------------------------------------------------
# 読み込み
# ---------------------------------------------------------------------------
def load_inputs():
    with open(MASTER_JSON, encoding="utf-8") as f:
        master = json.load(f)
    active = [m for m in master if m.get("status") == STATUS_ACTIVE]

    with open(FUSION_MATRIX_JSON, encoding="utf-8") as f:
        matrix_rows = json.load(f)
    matrix = {}
    for row in matrix_rows:
        matrix[(row["bloodline_type"], row["partner_type"])] = row["result_primary_type"]

    with open(SEEDS_JSON, encoding="utf-8") as f:
        seeds = json.load(f)

    return active, matrix, seeds


# ---------------------------------------------------------------------------
# 生成
# ---------------------------------------------------------------------------
def build(active, matrix, seeds):
    by_id = {m["id"]: m for m in active}
    types = sorted({m["type"] for m in active})

    # (タイプ, 階級) -> 採用モンスターid一覧
    pool = {}
    for m in active:
        pool.setdefault((m["type"], m["tier"]), []).append(m["id"])
    for key in pool:
        pool[key].sort()

    # 階級ごとに、その階級に存在するタイプ
    types_at_tier = {t: sorted({ty for (ty, ti) in pool if ti == t}) for t in TIER_ORDER}

    # 「タイプ代替」用: 各階級で最も層が厚いタイプ(同数なら名前順)
    substitute_type = {}
    for t in TIER_ORDER:
        cands = types_at_tier[t]
        if cands:
            substitute_type[t] = max(cands, key=lambda ty: (len(pool[(ty, t)]), ty))

    # -----------------------------------------------------------------------
    # 手設計レシピ (verbatim保持)
    # -----------------------------------------------------------------------
    special = []
    for s in seeds:
        target = by_id.get(s["target_id"])
        tier = s.get("target_tier") or (target["tier"] if target else "上位")
        special.append({
            "recipe_id": s["recipe_id"],
            "source": RULE_HANDMADE,
            "recipe_kind": s.get("recipe_kind"),
            "bloodline_id": s["bloodline_id"],
            "partner_ids": list(s["partner_ids"]),
            "result_id": s["target_id"],
            "result_tier": tier,
            "result_type": s.get("target_type"),
            "type_rule": RULE_HANDMADE,
            "hidden": tier in HIDDEN_TIERS,
            "rationale": s.get("design_rationale", ""),
        })

    # -----------------------------------------------------------------------
    # 自動生成: まず「枠(slot)」を全部作る
    # -----------------------------------------------------------------------
    def usable_partner_types(bl_tier, direction):
        """その向きで実在しうる相手タイプだけを返す(居ない組み合わせは作らない)。"""
        bi = TIER_INDEX[bl_tier]
        if direction == "up":
            allowed = [t for t in TIER_ORDER if TIER_INDEX[t] >= bi]
        else:
            allowed = [t for t in TIER_ORDER if TIER_INDEX[t] < bi]
        return [ty for ty in types if any((ty, t) in pool for t in allowed)]

    def resolve_result_type(bl_type, partner_type, result_tier):
        if (bl_type, result_tier) in pool:
            return bl_type, RULE_BLOODLINE
        if (partner_type, result_tier) in pool:
            return partner_type, RULE_PARTNER
        mt = matrix.get((bl_type, partner_type))
        if mt and (mt, result_tier) in pool:
            return mt, RULE_MATRIX
        return substitute_type[result_tier], RULE_SUBSTITUTE

    slots = []
    for m in sorted(active, key=lambda x: x["id"]):
        bl_tier = m["tier"]
        for direction in ("up", "same"):
            if direction == "same" and TIER_INDEX[bl_tier] == 0:
                continue  # 下位より下は無いので横移動は存在しない
            result_tier = TIER_ADVANCE[bl_tier] if direction == "up" else bl_tier
            for pt in usable_partner_types(bl_tier, direction):
                rtype, rule = resolve_result_type(m["type"], pt, result_tier)
                slots.append({
                    "bloodline_id": m["id"],
                    "bloodline_tier": bl_tier,
                    "direction": direction,
                    "partner_type": pt,
                    "result_tier": result_tier,
                    "result_type": rtype,
                    "type_rule": rule,
                })

    # -----------------------------------------------------------------------
    # 枠に結果モンスターを割り当てる
    #   (結果タイプ, 結果階級) ごとに、まず「階級が上がる枠(promoting)」を
    #   ラウンドロビンで配り、そのグループの全個体が必ず1枠以上を得るようにする。
    #   promoting枠の血統は必ず結果より下の階級なので、下から順に到達性が繋がる。
    #   横移動枠はその続きから配り、バリエーションを増やす。
    # -----------------------------------------------------------------------
    groups = {}
    for s in slots:
        groups.setdefault((s["result_type"], s["result_tier"]), []).append(s)

    for (rtype, rtier), gslots in sorted(groups.items()):
        members = pool[(rtype, rtier)]
        promoting = sorted(
            [s for s in gslots if TIER_INDEX[s["bloodline_tier"]] < TIER_INDEX[rtier]],
            key=lambda s: (s["bloodline_id"], s["partner_type"]),
        )
        sideways = sorted(
            [s for s in gslots if TIER_INDEX[s["bloodline_tier"]] >= TIER_INDEX[rtier]],
            key=lambda s: (s["bloodline_id"], s["partner_type"]),
        )
        if promoting and len(promoting) < len(members):
            print(f"[WARN] ({rtype},{rtier}) の昇格枠 {len(promoting)} < 個体数 {len(members)}"
                  f" -> 一部が到達不能になる可能性")
        for i, s in enumerate(promoting):
            s["result_id"] = members[i % len(members)]
        for i, s in enumerate(sideways):
            idx = (i + len(promoting)) % len(members)
            # 横移動(階級据え置き)で血統自身が出ると、2体消費して同じ1体が戻るだけの
            # 罠レシピになる。別個体へずらし、その階級にその個体しか居なければ枠を捨てる。
            if members[idx] == s["bloodline_id"]:
                if len(members) == 1:
                    s["result_id"] = None
                    continue
                idx = (idx + 1) % len(members)
            s["result_id"] = members[idx]

    slots = [s for s in slots if s.get("result_id")]

    # -----------------------------------------------------------------------
    # 出力構造へ畳む
    # -----------------------------------------------------------------------
    by_bloodline = {}
    counter = 0
    for s in sorted(slots, key=lambda x: (x["bloodline_id"], x["direction"], x["partner_type"])):
        counter += 1
        entry = by_bloodline.setdefault(s["bloodline_id"], {"up": None, "same": None})
        bucket = entry[s["direction"]]
        if bucket is None:
            bucket = {
                "result_tier": s["result_tier"],
                "hidden": s["result_tier"] in HIDDEN_TIERS,
                "partners": {},
            }
            entry[s["direction"]] = bucket
        # [result_id, result_type, type_ruleのコード] のタプル形式(ファイルサイズ対策)
        bucket["partners"][s["partner_type"]] = [
            s["result_id"], s["result_type"], TYPE_RULE_CODE[s["type_rule"]],
        ]

    data = {
        "meta": {
            "generated_by": "monster_project/build_fusion_recipes.py",
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "sources": [
                "step2_dedup/monster_master_330.json (採用のみ)",
                "step3_fusion/type_fusion_matrix.json",
                "step3_fusion/fixed_recipe_seeds.json",
            ],
            "lookup": "1) special を (bloodline_id, partner_ids==[partner_id]) で検索 "
                      "2) 無ければ by_bloodline[血統id][相手が同格以上なら'up'/格下なら'same']"
                      ".partners[相手のタイプ]",
            "note": "結果は (血統の個体, 相手のタイプ, 階級の向き) だけで決まるため、"
                    "285x285の総当たりではなくこの形に畳んである。",
            "partner_entry_format": "[result_id, result_type, type_rules配列への添字]",
            "generated_recipe_id_format": GENERATED_RECIPE_ID_FORMAT,
            "counts": {
                "special": len(special),
                "generated": counter,
                "total": len(special) + counter,
            },
        },
        "tier_order": TIER_ORDER,
        "tier_advance": TIER_ADVANCE,
        "wild_tiers": sorted(WILD_TIERS, key=lambda t: TIER_INDEX[t]),
        "type_rules": TYPE_RULE_LIST,
        "special": special,
        "by_bloodline": by_bloodline,
    }
    return data, by_id, pool, counter


# ---------------------------------------------------------------------------
# 自己検証: 野生入手分だけから不動点まで到達可能性を広げる
# ---------------------------------------------------------------------------
def verify_reachability(data, by_id):
    active_ids = set(by_id)
    reachable = {mid for mid, m in by_id.items() if m["tier"] in WILD_TIERS}

    def partner_exists(partner_type, bl_tier, direction):
        bi = TIER_INDEX[bl_tier]
        for pid in reachable:
            p = by_id[pid]
            if p["type"] != partner_type:
                continue
            pi = TIER_INDEX[p["tier"]]
            if direction == "up" and pi >= bi:
                return True
            if direction == "same" and pi < bi:
                return True
        return False

    changed = True
    while changed:
        changed = False
        for rec in data["special"]:
            if rec["result_id"] in reachable:
                continue
            if rec["bloodline_id"] not in reachable:
                continue
            if not all(pid in reachable for pid in rec["partner_ids"]):
                continue
            if rec["result_id"] in active_ids:
                reachable.add(rec["result_id"])
                changed = True
        for bl_id, dirs in data["by_bloodline"].items():
            if bl_id not in reachable:
                continue
            bl_tier = by_id[bl_id]["tier"]
            for direction, bucket in dirs.items():
                if not bucket:
                    continue
                for ptype, rec in bucket["partners"].items():
                    result_id = rec[0]
                    if result_id in reachable:
                        continue
                    if partner_exists(ptype, bl_tier, direction):
                        reachable.add(result_id)
                        changed = True

    return reachable


def write_json(path, data):
    """by_bloodline は1血統1行に畳んで書き出す(全体をindentすると数MBになるため)。

    上位階層は indent=1 で読みやすさを保ち、血統ごとの中身だけを
    コンパクト表現にする。差分レビューも1血統1行で見やすい。
    """
    payload = dict(data)
    payload["by_bloodline"] = {
        bid: "\x00" + json.dumps(dirs, ensure_ascii=False, separators=(",", ":")) + "\x00"
        for bid, dirs in data["by_bloodline"].items()
    }
    text = json.dumps(payload, ensure_ascii=False, indent=1)

    # プレースホルダで包んだ部分だけ、エスケープを戻して素のJSONへ差し替える。
    # (対象データにバックスラッシュは含まれないので \" の復元だけで足りる)
    def unwrap(match):
        return match.group(1).replace('\\"', '"')

    text = re.sub(r'"\\u0000(.*?)\\u0000"', unwrap, text)

    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def main():
    active, matrix, seeds = load_inputs()
    data, by_id, pool, generated_count = build(active, matrix, seeds)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_JSON, data)

    reachable = verify_reachability(data, by_id)

    print("=== build_fusion_recipes.py 実行結果 ===")
    print(f"採用モンスター : {len(active)} 体")
    print(f"手設計レシピ   : {len(data['special'])} 件 (verbatim保持 / 最優先)")
    print(f"自動生成レシピ : {generated_count} 件")
    print(f"レシピ合計     : {len(data['special']) + generated_count} 件")
    print(f"出力           : {OUT_JSON} ({OUT_JSON.stat().st_size / 1024:.0f} KB)")

    # type_rule の内訳
    rule_counts = {}
    for dirs in data["by_bloodline"].values():
        for bucket in dirs.values():
            if not bucket:
                continue
            for rec in bucket["partners"].values():
                rule = TYPE_RULE_LIST[rec[2]]
                rule_counts[rule] = rule_counts.get(rule, 0) + 1
    print("--- 結果タイプ決定規則の内訳 ---")
    for rule in (RULE_BLOODLINE, RULE_PARTNER, RULE_MATRIX, RULE_SUBSTITUTE):
        print(f"  {rule:<12}: {rule_counts.get(rule, 0)} 件")

    print("--- 到達可能性 (初期集合=野生入手可能な下位+中位のみ) ---")
    ok = True
    orphans_all = {}
    for tier in TIER_ORDER:
        ids = sorted(mid for mid, m in by_id.items() if m["tier"] == tier)
        got = [mid for mid in ids if mid in reachable]
        orphans = [mid for mid in ids if mid not in reachable]
        pct = 100.0 * len(got) / len(ids) if ids else 100.0
        mark = "OK" if not orphans else "NG"
        print(f"  {tier:<4}: {len(got):>3}/{len(ids):>3} 到達 ({pct:5.1f}%) [{mark}]")
        if tier in ("上位", "最上位") and orphans:
            ok = False
            orphans_all[tier] = orphans
    wild = sum(1 for m in by_id.values() if m["tier"] in WILD_TIERS)
    print(f"  初期集合(野生) : {wild} 体")
    print(f"  到達合計       : {len(reachable)}/{len(by_id)} 体")

    if not ok:
        print("[ERROR] 到達できないモンスターが残っています:")
        for tier, orphans in orphans_all.items():
            for mid in orphans:
                print(f"  - {tier} {mid} {by_id[mid]['working_name']} ({by_id[mid]['type']})")
        raise SystemExit(1)

    print("[OK] 上位・最上位ともに 100% 到達可能。")


if __name__ == "__main__":
    main()
