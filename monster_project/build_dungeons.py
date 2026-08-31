# -*- coding: utf-8 -*-
"""
build_dungeons.py

ダンジョン12本の連鎖(1本クリアで次が解放)を自動生成し、
game/src/data/dungeons.json を出力する。

読み込み専用: step1_normalized / step2_dedup / step3_fusion 配下は一切書き換えない。
入力は game/src/data/{monsters,skills,items}.json だけ。

================================================================================
なぜ自動生成するのか
================================================================================
12本 x 3〜6エンカウント x 最大3体 = 100体を超える敵リストを手で書くと、
「難易度の段差」も「種族のかぶり」も目視では管理できない。
ここでは
    敵の階級と レベルの曲線     -> 表(DUNGEONS)で宣言
    どの種族を当てはめるか      -> テーマ(名前の接頭辞/タイプ)+ 未使用優先で自動選択
    それで本当に遊べるのか      -> 経験値シミュレーションと戦闘シミュレーションで検証
という分業にして、遊べることを機械が保証する形にしている。

================================================================================
敵にレベルがある前提
================================================================================
v0.4 から敵は種族の素ステータスではなく「そのレベルでのステータス」で戦う
(engine/stats.js の createCombatant + engine/growth.js の statsAtLevel)。
個体値は中央値固定(15 = 補正1.00)、プラス値0。つまり
    敵ステータス[s] = 種族基礎[s] + (Lv-1) x 種族成長率[s]
であり、このファイルの Python 側の実装(enemy_stats_at)と完全に一致する。
技も learnset をレベルまで解決するので、深いダンジョンの敵は技も強い。

================================================================================
難易度のツマミ (序盤ほど手前に置いてある)
================================================================================
DUNGEONS 表の各行が1本のダンジョン。序盤で効くのは主にこの4つ:

  party        : そのダンジョンに挑む時点で想定するパーティー人数。
                 物語は1体で始まり、野生の仲間化(下位12%)でしか増えないので
                 D1=1人、D2〜D3=2人、D4以降=3人。
                 encounters の敵数はこれを超えないこと(1対3は理不尽)。
  encounters   : 各エンカウントの敵の数。序盤は短く・少なく。
  threat_max   : Lv1換算の「敵の攻撃力の目安」の上限。
                 これを小さくするほど、同じ下位でも殴ってこない種族だけが選ばれる。
                 D1=5.0 でスライム系(こうげき7/威力12)だけになる。
  mob_band     : 雑魚のレベル帯を推奨レベルに対する比で表したもの。
                 (0.70, 0.95) なら 推奨Lv40 のとき Lv28〜Lv38 が並ぶ。
  boss         : (護衛の数, ボスのレベル比, 雑魚最高レベルからの最低上乗せ)。

後半のツマミは mob_tiers(雑魚の階級)/ boss_tier / rec(推奨レベル)/ player_tier。

重要: 雑魚のレベルは推奨レベルより **下** に置いてある。
HP/MPがエンカウント間で持ち越されるので、雑魚と互角の強さだと
「5連戦の途中で必ず死ぬ」ダンジョンになる。雑魚は推奨レベルより下、
ボスだけが推奨レベルより上、という配置がこのゲームの正しい形。

player_tier : そのダンジョンに挑む頃、プレイヤーが使っていると想定する階級。
              階級が1段違うと成長率がほぼ倍になる(下位5.8 / 中位11.2 / 上位20.3 per Lv)
              ので、同レベルでも階級が違えば勝負にならない。
              階級が切り替わる手前のダンジョンのボスに次の階級を置き、
              「そろそろ配合しろ」という信号にしている。
              なお配合すると子はLv1に戻るため、経験値シミュレーションは
              (レベルを引き継ぐ前提なので)やや楽観的に出る。
              その分の余裕として、各ダンジョンで次の推奨レベルを上回ることを求める。

================================================================================
自己検証 (どれか落ちたら異常終了)
================================================================================
1. 参照している monsterId / itemId が全て実在するか
2. 敵数が想定パーティー人数を超えていないか / レベルが単調に上がるか
3. 経験値シミュレーション: 各ダンジョンを1周すると、次のダンジョンの
   推奨レベルに届くか (届かない = 無限に周回させられる)
4. 戦闘シミュレーション: 想定パーティーで1本を通しで戦って(HP/MPは持ち越し)
   勝率が下限を超えるか。序盤は「余裕を持って勝てる」ことまで見る。
5. 下位/中位の種族カバー率(野生で仲間にできる種族にどれだけ出会えるか)
"""

import json
import random
import sys
from datetime import datetime
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

PROJECT_ROOT = Path(__file__).resolve().parent
GAME_ROOT = PROJECT_ROOT.parent / "game"
DATA_DIR = GAME_ROOT / "src" / "data"

MONSTERS_JSON = DATA_DIR / "monsters.json"
SKILLS_JSON = DATA_DIR / "skills.json"
ITEMS_JSON = DATA_DIR / "items.json"
OUT_JSON = DATA_DIR / "dungeons.json"

BACKGROUNDS = {"grassland", "cave", "ancient_ruins", "lava_cavern", "snow_mountain"}

# --------------------------------------------------------------------------
# 階層とエンカウント率 (v0.5「歩けるダンジョン」から)
# --------------------------------------------------------------------------
# ダンジョンは固定の戦闘リストではなく、実際にフロアを歩いて進む形になった。
# エンカウントは歩数で起きるので、この表が決めた戦闘数を「1戦あたりの歩数」に
# 翻訳して JSON へ持たせる。翻訳しないと「6戦ぶんの強さで設計したのに
# 実際は20戦した(または1戦もしなかった)」ということが起きる。
#
# フロアの絵は3種類しかないので12本のダンジョンで使い回す。
# 見分けはダンジョンごとの戦闘背景と色味でつける。
FLOOR_MAPS_DIR = DATA_DIR / "maps"
FLOOR_MAP_FILES = ["floor_01.json", "floor_02.json", "floor_03.json"]

# 実際の歩数は最短経路ちょうどにはならない。曲がり角で行き過ぎたり
# 宝箱の方へ寄り道したりするぶんの割り増し。
EXPLORE_FACTOR = 1.35

# 1戦あたりの歩数の許容範囲。
#   下限 = これより短いと歩くのが苦痛になる
#   上限 = これより長いと1フロアに1回も戦闘が起きず、雑魚が居ないのと同じ
ENCOUNTER_STEPS_MIN = 10
ENCOUNTER_STEPS_MAX = 16


def floors_for(spec):
    """階層数。雑魚エンカウントの本数に合わせて 1〜3層にする。

    2戦   -> 1層 (序盤のチュートリアル。下り階段の先がすぐボス)
    3〜4戦 -> 2層
    5戦〜  -> 3層
    """
    n = len(spec["encounters"])
    if n <= 2:
        return 1
    if n <= 4:
        return 2
    return 3


def floor_walk_lengths():
    """各フロアの「上り階段 -> 下り階段」の最短歩数を、実際のマップから測る。

    真実はマップ側 (game/src/data/maps/floor_0*.json) にある。ここは読むだけ。
    通れるマスは walkable_tiles のホワイトリストから collisions を引いたもの。
    """
    from collections import deque

    lengths = []
    for name in FLOOR_MAP_FILES:
        data = json.loads((FLOOR_MAPS_DIR / name).read_text(encoding="utf-8"))
        walk = {tuple(t) for t in data["walkable_tiles"]}
        for c in data.get("collisions", []):
            x, y, w, h = c["rect_tiles"]
            for yy in range(y, y + h):
                for xx in range(x, x + w):
                    walk.discard((xx, yy))
        start, goal = tuple(data["stairs"]["up"]), tuple(data["stairs"]["down"])
        queue, seen, found = deque([(start, 0)]), {start}, None
        while queue:
            (cx, cy), d = queue.popleft()
            if (cx, cy) == goal:
                found = d
                break
            for nxt in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                if nxt in walk and nxt not in seen:
                    seen.add(nxt)
                    queue.append((nxt, d + 1))
        if found is None:
            raise SystemExit(f"[ERROR] {name}: 上り階段から下り階段へ到達できません")
        lengths.append(found)
    return lengths


TIER_ORDER = ["下位", "中位", "上位", "最上位"]
TIER_INDEX = {t: i for i, t in enumerate(TIER_ORDER)}
WILD_TIERS = ("下位", "中位")  # 野生で仲間にできる階級 = カバー率の分母

# --------------------------------------------------------------------------
# バランス定数 — game/src/engine/growth.js と必ず一致させること
# --------------------------------------------------------------------------
MAX_LEVEL = 99
LEVEL_CURVE_COEF = 6
LEVEL_CURVE_POWER = 2.0          # expToNextLevel の指数
STAR_EXP_FACTOR = {1: 1.0, 2: 1.35, 3: 1.8, 4: 2.4}
TIER_EXP_FACTOR = {"下位": 1.0, "中位": 1.6, "上位": 2.4, "最上位": 3.5}
EXP_LEVEL_POWER = 1.1            # enemyExpValue のレベル指数
ENEMY_IV = 15                    # 敵の個体値は中央値固定 -> 成長補正ちょうど1.00
ENEMY_IV_FACTOR = 0.85 + ENEMY_IV / 100.0
MAX_LEARNED_SKILLS = 10

# damage.js
BASE_DODGE_CHANCE = 0.05
SPD_DODGE_FACTOR = 0.001
CRIT_CHANCE = 0.06
CRIT_MULTIPLIER = 1.5
VARIANCE = (0.9, 1.1)

# ailments.js (シミュレーション用の近似)
POISON_HP_RATIO = 0.07
PARALYSIS_FAIL_CHANCE = 0.4
AILMENT_SKIP_CHANCE = 0.45       # 行動を奪う系がかかっている間、1ターンを失う確率
AILMENT_TURNS = 4

# ai.js
ENEMY_SKILL_CHANCE = 0.5

# 検証のしきい値
BATTLE_TRIALS = 400
# 勝率の下限。序盤は「余裕を持って勝てる」ことを、最後の2本は
# 「壁だが越えられる」ことを求める。壁を壁のまま残すために下限を分けてある。
MIN_WIN_RATE = 0.70              # 中盤(D4〜D10)
EARLY_MIN_WIN_RATE = 0.90        # 序盤(D1〜D3): ソロ〜2体でも負けない
WALL_MIN_WIN_RATE = 0.55         # 最上位ボスの2本(D11〜D12): 意図的に壁
MIN_WILD_COVERAGE = 0.40         # 下位+中位のカバー率の下限


# ==========================================================================
# ダンジョン表 — ここが設計そのもの
# ==========================================================================
# encounters : 各エンカウントの敵の数 (最後にボス戦が1つ追加される)。
# mob_band   : 雑魚のレベル帯 (推奨レベルに対する比。先頭から末尾へ線形に上がる)。
# boss       : (護衛の数, ボスのレベル比, 雑魚最高レベルからの最低上乗せ)
# mob_tiers  : 雑魚の階級。エンカウント内で先頭から順に割り当てる(足りなければ循環)。
# theme      : 名前の接頭辞の優先順。ここに居なければ theme_types、それも無ければ階級全体。
# threat_max : Lv1換算の攻撃力目安の上限 (None = 制限なし)。序盤専用のツマミ。
DUNGEONS = [
    # ---- 序盤: ソロ〜2体。ここは「勝てること」が最優先 --------------------
    dict(
        name="はじまりの草原", background="grassland", rec=1, party=1, player_tier="下位",
        description="町の門を出てすぐ、風のやわらかい草原。のんびりした魔物しかいない。まずはここで一歩を踏み出そう。",
        encounters=[1, 1], mob_band=(1.0, 1.0), boss=(0, 1.0, 2), boss_tier="下位",
        mob_tiers=["下位"], theme=["スライム"], theme_types=["スライム"], threat_max=5.0,
        rewards=[("item_yakusou", 3)],
    ),
    dict(
        name="そよかぜの小道", background="grassland", rec=3, party=2, player_tier="下位",
        description="草原の先へ続く、踏みならされた小道。草かげから弱い魔物が顔を出す。仲間が1体ふえたら来るとよい。",
        encounters=[1, 2], mob_band=(0.55, 0.80), boss=(0, 1.05, 2), boss_tier="下位",
        mob_tiers=["下位"], theme=["リーフ", "スライム"], theme_types=["自然", "スライム"], threat_max=6.5,
        rewards=[("item_yakusou", 3), ("item_dokukeshisou", 2)],
    ),
    dict(
        name="ざわめきの樹海", background="grassland", rec=5, party=2, player_tier="下位",
        description="見上げるほどの木々が日をさえぎる森。虫の羽音と、草をかき分ける足音が絶えない。",
        encounters=[2, 2, 2], mob_band=(0.55, 0.80), boss=(1, 1.05, 2), boss_tier="下位",
        mob_tiers=["下位"], theme=["リーフ"], theme_types=["自然", "むし", "けもの"], threat_max=9.5,
        rewards=[("item_jouyakusou", 2), ("item_mahounomizu", 2)],
    ),
    # ---- 中盤の入口: ボスに中位が出る = 「そろそろ配合しろ」の合図 --------
    dict(
        name="こだまの洞窟", background="cave", rec=7, party=3, player_tier="下位",
        description="足音がいつまでも返ってくる横穴。灯りの届かない奥で、硬いものが動く気配がする。",
        encounters=[2, 3, 3, 3], mob_band=(0.50, 0.80), boss=(1, 1.35, 3), boss_tier="下位",
        mob_tiers=["下位"], theme=["ノクス", "クリスタ", "ゴルド"],
        theme_types=["物質", "むし"], threat_max=None,
        rewards=[("item_jouyakusou", 3), ("item_hoshiniku", 1)],
    ),
    # ---- 中位帯。雑魚は「下位2 + 中位1」で、プレイヤーの中位より格下にする ----
    dict(
        name="忘れられた坑道", background="cave", rec=9, party=3, player_tier="中位",
        description="掘りかけのまま捨てられた坑道。錆びたトロッコの向こうから、毒のにおいが流れてくる。",
        encounters=[3, 3, 3, 3, 3], mob_band=(0.50, 0.80), boss=(1, 1.10, 2), boss_tier="中位",
        mob_tiers=["下位", "下位", "中位"], theme=["ヴェノ", "ノクス"],
        theme_types=["物質", "むし", "不死"], threat_max=None,
        rewards=[("item_jouyakusou", 3), ("item_sekaijunoha", 1)],
    ),
    dict(
        name="苔むした神殿址", background="ancient_ruins", rec=12, party=3, player_tier="中位",
        description="名も残らぬ神を祀っていた石造りの址。倒れた柱のあいだを、古い気配がさまよっている。",
        encounters=[3, 3, 3, 3, 3], mob_band=(0.50, 0.80), boss=(1, 1.10, 2), boss_tier="中位",
        mob_tiers=["下位", "下位", "中位"], theme=["アストラ", "ソナ", "クロノ"],
        theme_types=["不死", "物質", "幻魔"], threat_max=None,
        rewards=[("item_jouyakusou", 3), ("item_mezamenosuzu", 2), ("item_chikaranotane", 1)],
    ),
    dict(
        name="常冬の裾野", background="snow_mountain", rec=15, party=3, player_tier="中位",
        description="一年じゅう雪が解けない山のふもと。吹きさらしの斜面を、白い影がゆっくりと横切る。",
        encounters=[3, 3, 3, 3, 3], mob_band=(0.50, 0.80), boss=(1, 1.10, 2), boss_tier="中位",
        mob_tiers=["下位", "中位", "中位"], theme=["フロスト", "アクア"],
        theme_types=["けもの", "水棲", "自然"], threat_max=None,
        rewards=[("item_tokujouyakusou", 2), ("item_maryokunoshizuku", 2), ("item_mamorinotane", 1)],
    ),
    # ---- 上位への入口: ボスに上位が出る ----------------------------------
    dict(
        name="灼熱の火口道", background="lava_cavern", rec=19, party=3, player_tier="中位",
        description="溶けた岩が川になって流れる火口の道。熱気だけで息が上がり、立っているだけで体力がけずられる。",
        encounters=[3, 3, 3, 3, 3], mob_band=(0.50, 0.80), boss=(1, 1.10, 2), boss_tier="上位",
        mob_tiers=["下位", "中位", "中位"], theme=["フレア", "ボルト"],
        theme_types=["ドラゴン", "物質", "幻魔"], threat_max=None,
        rewards=[("item_tokujouyakusou", 2), ("item_koukyuuniku", 1), ("item_subayasanotane", 1)],
    ),
    # ---- 上位帯 ----------------------------------------------------------
    dict(
        name="凍てつく尖塔", background="snow_mountain", rec=24, party=3, player_tier="上位",
        description="氷が氷を積み上げてできた塔。頂に近づくほど寒さが牙になり、はいた息が白いうちに凍りつく。",
        encounters=[3, 3, 3, 3, 3], mob_band=(0.50, 0.80), boss=(2, 1.10, 2), boss_tier="上位",
        mob_tiers=["下位", "中位", "上位"], theme=["フロスト", "ソナ", "クリスタ"],
        theme_types=["物質", "幻魔", "けもの"], threat_max=None,
        rewards=[("item_tokujouyakusou", 3), ("item_sekaijunoha", 2), ("item_kashikosanotane", 1)],
    ),
    dict(
        name="星辰の大回廊", background="ancient_ruins", rec=30, party=3, player_tier="上位",
        description="天井に星図がきざまれた、終わりの見えない回廊。ここでは時の流れがわずかにねじれている。",
        encounters=[3, 3, 3, 3, 3], mob_band=(0.50, 0.80), boss=(2, 1.10, 2), boss_tier="上位",
        mob_tiers=["中位", "中位", "上位"], theme=["アストラ", "クロノ", "ゴルド"],
        theme_types=["幻魔", "物質", "不死"], threat_max=None,
        rewards=[("item_tokujouyakusou", 3), ("item_sekaijunoshizuku", 1), ("item_inochinokinomi", 1)],
    ),
    # ---- 最上位のボスが出る2本 -------------------------------------------
    dict(
        name="溶岩竜の巣", background="lava_cavern", rec=38, party=3, player_tier="上位",
        description="火口のさらに底、竜が卵を抱くための熱だまり。近づくものは灰になるという。",
        encounters=[3, 3, 3, 3, 3], mob_band=(0.50, 0.80), boss=(1, 0.90, 2), boss_tier="最上位",
        mob_tiers=["中位", "中位", "上位"], theme=["フレア", "ボルト", "ゴルド"],
        theme_types=["ドラゴン", "物質", "けもの"], threat_max=None,
        rewards=[("item_sekaijunoshizuku", 1), ("item_sekaijunoha", 2), ("item_saikoukyuuniku", 1)],
    ),
    dict(
        name="天穹の玉座", background="ancient_ruins", rec=46, party=3, player_tier="上位",
        description="雲を抜けた先に浮かぶ、最果ての玉座。ここを踏破した者だけが、この世界のいただきを知る。",
        encounters=[3, 3, 3, 3, 3], mob_band=(0.50, 0.82), boss=(1, 0.95, 3), boss_tier="最上位",
        mob_tiers=["中位", "上位", "上位"], theme=["アストラ", "アルカ", "ソル", "ノクス"],
        theme_types=["幻魔", "ドラゴン", "不死"], threat_max=None,
        rewards=[("item_sekaijunoshizuku", 2), ("item_saikoukyuuniku", 2), ("item_fushiginakinomi", 1)],
    ),
]

# ==========================================================================
# 宝箱の中身 — 「大金 / 少しレアなどうぐ / ときどき からっぽ」
# ==========================================================================
# v0.6 で、ダンジョンの拾いものが2種類になった。
#
#   床のどうぐ … やくそう・まほうの水・どくけしそう。歩いて踏むだけで拾える。
#                安いものが1フロアに数個ころがっている(game/src/field/maps.js)。
#   宝箱       … わざわざ近づいて開けるもの。だから床と同じ物が出てはいけない。
#                ここで決めるのは「ゴールド」と「床には落ちていない上位のどうぐ」。
#
# 宝箱は開けるまで中身が分からないほうが宝箱らしいので、はずれ(からっぽ)も置く。
# 割合は CHEST_MIX。1フロア2個 x 1〜3階 = 1回の潜りで2〜6個開けるので、
# からっぽ18%なら3階のダンジョンで1個くらい出会う。
# 「たまに損した気分になる」を出しつつ、宝箱を素通りさせない値。
CHEST_MIX = {
    "empty": 0.18,   # からっぽ
    "gold": 0.34,    # ゴールドだけ
    "item": 0.33,    # どうぐだけ
    "both": 0.15,    # ゴールド + どうぐ (当たり)
}

# ゴールドの額。まだ買い物はできない(どうぐ屋は準備中)ので、
# ここは「そのダンジョン帯のどうぐ数個ぶん」という基準だけで決めてある。
#   base = GOLD_BASE + 推奨レベル x GOLD_PER_LEVEL  (5G単位に丸める)
#   実際の額 = base x (1 + GOLD_PER_FLOOR x 階) x (1 ± GOLD_SPREAD)
# D1の1階で 17〜33G、D12の3階で 620〜1150G になる。
GOLD_BASE = 14
GOLD_PER_LEVEL = 11
GOLD_PER_FLOOR = 0.35
GOLD_SPREAD = 0.30

# 宝箱から出る どうぐ。(itemId, 個数, 重み)。
# キーは「このダンジョン番号から下のバンドを使う」の開始番号(1始まり)。
#
# 床に落ちている やくそう / まほうの水 / どくけしそう は **入れない**。
# 宝箱を開けて床と同じ物が出ると、宝箱を開ける理由がなくなる。
# たね・きのみ(恒久強化)は重みを低くしてある。永久に能力が上がるので、
# 「ときどき出るからまた潜る」の側に置きたい。
CHEST_BANDS = [
    (1, [  # D1〜D2: まだ物量が命。上位の回復と、状態異常の備え
        ("item_jouyakusou", 2, 4),
        ("item_mezamenosuzu", 2, 3),
        ("item_mahinaoshinotsuyu", 2, 3),
        ("item_hoshiniku", 1, 2),
        ("item_kimeranotsubasa", 1, 2),
    ]),
    (3, [  # D3〜D4: MP回復と万能薬が入ってくる
        ("item_jouyakusou", 3, 4),
        ("item_seinarumizu", 2, 3),
        ("item_maryokunoshizuku", 1, 3),
        ("item_bannouyaku", 1, 2),
        ("item_hoshiniku", 2, 2),
        ("item_kimeranotsubasa", 2, 1),
    ]),
    (5, [  # D5〜D6: たねが出はじめる = 宝箱を開ける動機がひとつ増える
        ("item_tokujouyakusou", 1, 4),
        ("item_maryokunoshizuku", 2, 3),
        ("item_bannouyaku", 2, 3),
        ("item_sekaijunoha", 1, 2),
        ("item_chikaranotane", 1, 1),
        ("item_mamorinotane", 1, 1),
    ]),
    (7, [  # D7〜D8
        ("item_tokujouyakusou", 2, 4),
        ("item_maryokunoshizuku", 3, 3),
        ("item_sekaijunoha", 1, 3),
        ("item_bannouyaku", 2, 2),
        ("item_koukyuuniku", 1, 2),
        ("item_subayasanotane", 1, 1),
        ("item_kashikosanotane", 1, 1),
    ]),
    (9, [  # D9〜D10: きのみとしずくが射程に入る
        ("item_tokujouyakusou", 3, 4),
        ("item_sekaijunoha", 2, 3),
        ("item_koukyuuniku", 2, 2),
        ("item_ikazuchinotsue", 1, 2),
        ("item_inochinokinomi", 1, 1),
        ("item_fushiginakinomi", 1, 1),
        ("item_sekaijunoshizuku", 1, 1),
    ]),
    (11, [  # D11〜D12: 最深部。踏破報酬に近いものが宝箱からも出る
        ("item_tokujouyakusou", 3, 3),
        ("item_sekaijunoha", 3, 3),
        ("item_sekaijunoshizuku", 1, 3),
        ("item_saikoukyuuniku", 1, 2),
        ("item_ikazuchinotsue", 2, 2),
        ("item_inochinokinomi", 1, 2),
        ("item_fushiginakinomi", 1, 2),
    ]),
]

# 床に落ちている安物。宝箱に入れてはいけないもの = game/src/field/maps.js の
# FLOOR_ITEM_BANDS に出てくる品。二重管理になるので、ここでは検証にだけ使う。
FLOOR_LITTER = {"item_yakusou", "item_mahounomizu", "item_dokukeshisou"}


def chest_band(dungeon_no):
    """ダンジョン番号(1始まり)に対応する宝箱の品ぞろえ。"""
    band = CHEST_BANDS[0][1]
    for first, entries in CHEST_BANDS:
        if dungeon_no >= first:
            band = entries
    return band


def chest_table(dungeon_no, rec):
    """dungeons.json に載せる宝箱の表。"""
    base = int(round((GOLD_BASE + rec * GOLD_PER_LEVEL) / 5.0) * 5)
    return {
        "mix": dict(CHEST_MIX),
        "gold": {"base": base, "perFloor": GOLD_PER_FLOOR, "spread": GOLD_SPREAD},
        "items": [
            {"itemId": iid, "count": n, "weight": w} for iid, n, w in chest_band(dungeon_no)
        ],
    }


# シミュレーションでプレイヤーが持っていると仮定する回復どうぐ
# (司祭が毎回やくそうをくれる + 踏破報酬 の範囲に収まる想定)
SIM_POTIONS = [
    # (適用する最初のダンジョン番号, 回復量, 個数)
    (1, 30, 6),     # やくそう
    (4, 80, 6),     # じょうやくそう
    (8, 200, 6),    # とくじょうやくそう
]


# ==========================================================================
# 読み込み
# ==========================================================================
def load_inputs():
    with open(MONSTERS_JSON, encoding="utf-8") as f:
        monsters = json.load(f)
    with open(SKILLS_JSON, encoding="utf-8") as f:
        skills = json.load(f)
    with open(ITEMS_JSON, encoding="utf-8") as f:
        items = json.load(f)
    return monsters, {s["id"]: s for s in skills}, {i["id"]: i for i in items}


# ==========================================================================
# 敵ステータス — engine/growth.js statsAtLevel と同じ式
# ==========================================================================
STAT_KEYS = ("hp", "mp", "atk", "def", "int", "spd")


def enemy_stats_at(species, level):
    lv = max(1, min(MAX_LEVEL, level))
    return {
        k: species["stats"][k] + int((lv - 1) * species["growth"][k] * ENEMY_IV_FACTOR)
        for k in STAT_KEYS
    }


def enemy_skills_at(species, level, skills_by_id):
    """learnset をレベルまで解決する (applySkillLearning と同じく同系統は上位で上書き)。"""
    learned = []
    for e in sorted(species.get("learnset", []), key=lambda e: e["level"]):
        if e["level"] > level:
            continue
        skill = skills_by_id.get(e["skillId"])
        if not skill or skill["id"] in learned:
            continue
        line = skill.get("line")
        if line:
            lower = [
                sid for sid in learned
                if skills_by_id[sid].get("line") == line
                and (skills_by_id[sid].get("rank") or 1) < (skill.get("rank") or 1)
            ]
            if lower:
                learned = [sid for sid in learned if sid not in lower]
            elif any(
                skills_by_id[sid].get("line") == line
                and (skills_by_id[sid].get("rank") or 1) > (skill.get("rank") or 1)
                for sid in learned
            ):
                continue
        if len(learned) >= MAX_LEARNED_SKILLS:
            continue
        learned.append(skill["id"])
    return learned or list(species.get("skills", []))


def expected_exp(species, level):
    """engine/growth.js enemyExpValue と同じ式。"""
    s = enemy_stats_at(species, level)
    raw = s["hp"] / 4 + s["mp"] / 2 + s["atk"] + s["def"] + s["int"] + s["spd"]
    factor = TIER_EXP_FACTOR.get(species["tier"], 1.0)
    return max(1, round(raw * factor * (max(1, level) ** EXP_LEVEL_POWER)))


def exp_to_next(level, star):
    if level >= MAX_LEVEL:
        return float("inf")
    return round(LEVEL_CURVE_COEF * (level ** LEVEL_CURVE_POWER) * STAR_EXP_FACTOR.get(star, 1.0))


# ==========================================================================
# 種族の選択
# ==========================================================================
def lv1_threat(species, skills_by_id):
    """Lv1での「殴ってくる強さ」の目安。序盤ダンジョンの足切りに使う。"""
    st = species["stats"]
    powers = [
        skills_by_id[e["skillId"]].get("power") or 0
        for e in species.get("learnset", [])
        if e["level"] <= 1 and e["skillId"] in skills_by_id
    ]
    best = max(powers) if powers else 20
    return max(st["atk"], st["int"]) * (best / 20.0)


class Picker:
    """テーマに沿って、まだ使っていない種族を優先しながら敵を選ぶ。

    テーマの層が薄い階級(例: フロスト系の上位は1体しかいない)でも
    止まらないよう、接頭辞 -> タイプ -> 階級全体 と自動的に降りる。
    """

    def __init__(self, monsters, skills_by_id):
        self.by_tier = {}
        for m in monsters:
            self.by_tier.setdefault(m["tier"], []).append(m)
        for lst in self.by_tier.values():
            lst.sort(key=lambda m: m["id"])
        self.skills_by_id = skills_by_id
        self.threat = {m["id"]: lv1_threat(m, skills_by_id) for m in monsters}
        self.used = set()          # 全ダンジョン通して1度でも出た種族
        self.fallback_hits = {"prefix": 0, "type": 0, "tier": 0}

    def _candidates(self, tier, spec, stage):
        pool = self.by_tier.get(tier, [])
        if stage == "prefix":
            prefixes = spec.get("theme") or []
            pool = [m for m in pool if any(m["name"].startswith(p) for p in prefixes)]
        elif stage == "type":
            types = spec.get("theme_types") or []
            pool = [m for m in pool if m["type"] in types]
        cap = spec.get("threat_max")
        if cap is not None:
            pool = [m for m in pool if self.threat[m["id"]] <= cap]
        return pool

    def pick(self, tier, spec, exclude):
        """1体選ぶ。exclude はそのエンカウント内での重複よけ。

        2周する:
          1周目 = まだ一度も使っていない種族を、接頭辞 -> タイプ -> 階級全体 の順に探す
          2周目 = それでも見つからなければ、使い回しを許して同じ順に探す
        1周目で階級全体まで降りるのが要点。テーマの層が薄いからといって
        同じ種族を使い回すと、図鑑に出会える種族が一気に減ってしまう。
        """
        for allow_reuse in (False, True):
            for stage in ("prefix", "type", "tier"):
                pool = [m for m in self._candidates(tier, spec, stage) if m["id"] not in exclude]
                if not allow_reuse:
                    pool = [m for m in pool if m["id"] not in self.used]
                if not pool:
                    continue
                chosen = pool[0]
                self.used.add(chosen["id"])
                self.fallback_hits[stage] += 1
                return chosen
        # threat_max が厳しすぎて誰も居ない場合だけここへ来る = 設計ミス
        raise SystemExit(
            f"[ERROR] {spec['name']}: 階級 {tier} に条件を満たす種族が居ません"
            f" (threat_max={spec.get('threat_max')})"
        )

    def pick_boss(self, tier, spec, exclude):
        """ボスは「その階級で最も手強い種族」から、まだ使っていないものを選ぶ。"""
        pool = [m for m in self.by_tier.get(tier, []) if m["id"] not in exclude]
        prefixes = spec.get("theme") or []
        themed = [m for m in pool if any(m["name"].startswith(p) for p in prefixes)]
        if not themed:
            themed = [m for m in pool if m["type"] in (spec.get("theme_types") or [])]
        if not themed:
            themed = pool
        themed.sort(key=lambda m: (-sum(m["stats"].values()), m["id"]))
        fresh = [m for m in themed if m["id"] not in self.used]
        chosen = (fresh or themed)[0]
        self.used.add(chosen["id"])
        return chosen


# ==========================================================================
# 生成
# ==========================================================================
def build(monsters, skills_by_id):
    picker = Picker(monsters, skills_by_id)
    out = []
    walk_lengths = floor_walk_lengths()

    for i, spec in enumerate(DUNGEONS):
        rec = spec["rec"]
        encounters = []
        mob_ids = []

        counts = spec["encounters"]
        lo, hi = spec["mob_band"]
        for e, count in enumerate(counts):
            frac = 0.0 if len(counts) == 1 else e / (len(counts) - 1)
            level = max(1, round(rec * (lo + (hi - lo) * frac)))
            if e > 0:
                level = max(level, encounters[-1]["level"])
            tiers = spec["mob_tiers"]
            seen = set()
            enemies = []
            for s in range(count):
                m = picker.pick(tiers[s % len(tiers)], spec, seen)
                seen.add(m["id"])
                mob_ids.append(m["id"])
                enemies.append({"id": m["id"], "level": level})
            encounters.append({
                "id": f"encounter_{e + 1}",
                "level": level,
                "enemies": enemies,
            })

        escorts, boss_ratio, boss_min_step = spec["boss"]
        boss_level = max(round(rec * boss_ratio), encounters[-1]["level"] + boss_min_step)
        boss_level = min(MAX_LEVEL, boss_level)
        boss = picker.pick_boss(spec["boss_tier"], spec, set())
        boss_enemies = [{"id": boss["id"], "level": boss_level}]
        seen = {boss["id"]}
        # 護衛は「そのダンジョンで一番強い雑魚」と同じレベル。
        # ボスと同格にすると、ボス戦だけ別ゲームになってしまう。
        escort_level = max(1, encounters[-1]["level"])
        for _ in range(escorts):
            m = picker.pick(spec["mob_tiers"][-1], spec, seen)
            seen.add(m["id"])
            mob_ids.append(m["id"])
            boss_enemies.append({"id": m["id"], "level": escort_level})
        encounters.append({
            "id": "encounter_boss",
            "level": boss_level,
            "isBoss": True,
            "enemies": boss_enemies,
        })

        # --- 階層と、歩数あたりのエンカウント率 --------------------------
        # 「このダンジョンは雑魚N戦ぶんの強さで設計した」を
        # 「1戦あたり何歩か」に翻訳する。踏破に必要な歩数を実測の最短経路から
        # 見積もり、雑魚の戦闘数で割るだけ。
        floors = floors_for(spec)
        expected_steps = sum(walk_lengths[f % len(walk_lengths)] for f in range(floors))
        expected_steps *= EXPLORE_FACTOR
        mob_fights = max(1, len(spec["encounters"]))
        encounter_steps = int(round(expected_steps / mob_fights))
        encounter_steps = max(ENCOUNTER_STEPS_MIN, min(ENCOUNTER_STEPS_MAX, encounter_steps))

        out.append({
            "id": f"dungeon_{i + 1:02d}",
            "name": spec["name"],
            "description": spec["description"],
            "background": spec["background"],
            "recommendedLevel": rec,
            "partySizeHint": spec["party"],
            "locked": i > 0,
            # 歩けるダンジョン用。floors 階ぶん歩き、最下層の下り階段の先がボス。
            # encounterSteps は「平均何歩で1戦」。実際はこの値を中心にばらつく
            # (game/src/engine/dungeonRun.js)。
            "floors": floors,
            "encounterSteps": encounter_steps,
            "encounters": encounters,
            "clearReward": [{"itemId": iid, "count": n} for iid, n in spec["rewards"]],
            # 宝箱の中身。踏破報酬とは別の表で、床の拾いものとも別。
            "chest": chest_table(i + 1, rec),
        })

    return out, picker


# ==========================================================================
# 経験値シミュレーション
# ==========================================================================
TIER_STAR = {"下位": 1, "中位": 2, "上位": 3, "最上位": 4}


def player_tier_for(index):
    """そのダンジョンに挑む頃、プレイヤーが使っていると想定する階級。"""
    return DUNGEONS[index]["player_tier"]


def player_star_for(index):
    return TIER_STAR[player_tier_for(index)]


def simulate_exp(dungeons, by_id):
    """各ダンジョンを1周ずつクリアしたときの到達レベルを追う。"""
    level, exp = 1, 0
    rows = []
    for i, d in enumerate(dungeons):
        party = max(1, d["partySizeHint"])
        star = player_star_for(i)
        total = 0
        for enc in d["encounters"]:
            for e in enc["enemies"]:
                total += expected_exp(by_id[e["id"]], e["level"])
        share = total // party
        exp += share
        while level < MAX_LEVEL:
            need = exp_to_next(level, star)
            if exp < need:
                break
            exp -= need
            level += 1
        nxt = dungeons[i + 1]["recommendedLevel"] if i + 1 < len(dungeons) else None
        rows.append({
            "index": i, "name": d["name"], "rec": d["recommendedLevel"],
            "gain": share, "level": level, "next_rec": nxt,
        })
    return rows


# ==========================================================================
# 戦闘シミュレーション (damage.js / BattleEngine.js の要点を再現)
# ==========================================================================
class Fighter:
    __slots__ = ("name", "species", "level", "stats", "hp", "mp", "skills",
                 "is_player", "ail_turns", "poison", "potions")

    def __init__(self, species, level, skills_by_id, is_player, potions=0):
        self.species = species
        self.level = level
        self.name = species["name"]
        self.stats = enemy_stats_at(species, level)
        self.hp = self.stats["hp"]
        self.mp = self.stats["mp"]
        self.skills = [skills_by_id[s] for s in enemy_skills_at(species, level, skills_by_id)
                       if s in skills_by_id]
        self.is_player = is_player
        self.ail_turns = 0
        self.poison = 0
        self.potions = potions


def variance(rng):
    return VARIANCE[0] + rng.random() * (VARIANCE[1] - VARIANCE[0])


def roll_dodge(rng, atk, dfn):
    chance = max(0.0, min(0.75, BASE_DODGE_CHANCE + (dfn.stats["spd"] - atk.stats["spd"]) * SPD_DODGE_FACTOR))
    return rng.random() < chance


def damage_of(rng, actor, target, kind, power):
    if kind != "ブレス" and roll_dodge(rng, actor, target):
        return 0
    if kind == "ブレス":
        raw = power * variance(rng)
        return max(1, round(raw))
    if kind == "呪文":
        raw = actor.stats["int"] * (power / 20.0) - target.stats["def"] * 0.3
    else:
        raw = actor.stats["atk"] * (power / 20.0) - target.stats["def"] * 0.5
    raw = max(1, raw) * variance(rng)
    if rng.random() < CRIT_CHANCE:
        raw *= CRIT_MULTIPLIER
    return max(1, round(raw))


def offensive_skills(f):
    return [s for s in f.skills
            if (s.get("power") or 0) > 0
            and s.get("type") in ("物理", "呪文", "ブレス")
            and (s.get("mpCost") or 0) <= f.mp]


def best_attack(rng, f, target):
    """プレイヤーの手: 通常こうげき と とくぎ のうち期待ダメージが高い方。"""
    best = ("attack", None, f.stats["atk"] - target.stats["def"] * 0.5)
    for s in offensive_skills(f):
        p = s.get("power") or 0
        hits = max(1, s.get("hits") or 1)
        if s["type"] == "呪文":
            exp = (f.stats["int"] * (p / 20.0) - target.stats["def"] * 0.3) * hits
        elif s["type"] == "ブレス":
            exp = p * hits
        else:
            exp = (f.stats["atk"] * (p / 20.0) - target.stats["def"] * 0.5) * hits
        if exp > best[2]:
            best = ("skill", s, exp)
    return best


def act(rng, actor, foes, allies, log):
    """1体ぶんの行動。倒した数は呼び出し側が hp で判断する。"""
    if actor.ail_turns > 0:
        actor.ail_turns -= 1
        if rng.random() < AILMENT_SKIP_CHANCE:
            return
    alive = [f for f in foes if f.hp > 0]
    if not alive:
        return

    if actor.is_player:
        # HPが半分を切ったら回復どうぐ (1ターン使う)
        hurt = [a for a in allies if 0 < a.hp < a.stats["hp"] * 0.5]
        if hurt and actor.potions:
            amount, count = actor.potions[0], actor.potions[1]
            if count > 0:
                target = min(hurt, key=lambda a: a.hp / a.stats["hp"])
                target.hp = min(target.stats["hp"], target.hp + round(amount * variance(rng)))
                actor.potions = (amount, count - 1)
                return
        target = min(alive, key=lambda f: f.hp)
        kind, skill, _ = best_attack(rng, actor, target)
        if kind == "skill":
            actor.mp -= skill.get("mpCost") or 0
            for _ in range(max(1, skill.get("hits") or 1)):
                target.hp -= damage_of(rng, actor, target, skill["type"], skill.get("power") or 0)
        else:
            target.hp -= damage_of(rng, actor, target, "物理", 20)
        return

    # 敵AI: 50%で使える技からランダム、それ以外は通常こうげき
    usable = [s for s in actor.skills if (s.get("mpCost") or 0) <= actor.mp]
    target = rng.choice(alive)
    if usable and rng.random() < ENEMY_SKILL_CHANCE:
        s = rng.choice(usable)
        actor.mp -= s.get("mpCost") or 0
        power = s.get("power") or 0
        if s.get("heal") or s["type"] == "回復":
            hurt = [a for a in allies if 0 < a.hp < a.stats["hp"]]
            if hurt:
                t = min(hurt, key=lambda a: a.hp)
                t.hp = min(t.stats["hp"], t.hp + round(power * variance(rng)))
            return
        if power <= 0:
            # 強化/弱体/状態異常だけの技
            if s.get("ailment") and rng.random() < (s.get("ailmentChance") or 0.3):
                if s["ailment"] == "どく":
                    target.poison = AILMENT_TURNS
                else:
                    target.ail_turns = AILMENT_TURNS
            return
        targets = alive if s.get("target") == "敵全体" else [target]
        for t in targets:
            for _ in range(max(1, s.get("hits") or 1)):
                t.hp -= damage_of(rng, actor, t, s["type"], power)
            if s.get("ailment") and rng.random() < (s.get("ailmentChance") or 0.3) and t.hp > 0:
                if s["ailment"] == "どく":
                    t.poison = AILMENT_TURNS
                else:
                    t.ail_turns = AILMENT_TURNS
        return
    target.hp -= damage_of(rng, actor, target, "物理", 20)


def run_battle(rng, players, enemies, max_turns=60):
    for _ in range(max_turns):
        order = sorted([f for f in players + enemies if f.hp > 0],
                       key=lambda f: -f.stats["spd"])
        for f in order:
            if f.hp <= 0:
                continue
            if all(p.hp <= 0 for p in players) or all(e.hp <= 0 for e in enemies):
                break
            foes = enemies if f.is_player else players
            allies = players if f.is_player else enemies
            act(rng, f, foes, allies, None)
        for f in players + enemies:
            if f.poison > 0 and f.hp > 0:
                f.hp -= max(1, int(f.stats["hp"] * POISON_HP_RATIO))
                f.poison -= 1
        if all(e.hp <= 0 for e in enemies):
            return True
        if all(p.hp <= 0 for p in players):
            return False
    return all(e.hp <= 0 for e in enemies)


def median_species(monsters, tier):
    pool = sorted([m for m in monsters if m["tier"] == tier],
                  key=lambda m: (sum(m["stats"].values()), m["id"]))
    return pool[len(pool) // 2]


def potion_for(index):
    amount, count = SIM_POTIONS[0][1], SIM_POTIONS[0][2]
    for start, a, c in SIM_POTIONS:
        if index + 1 >= start:
            amount, count = a, c
    return (amount, count)


def simulate_dungeon_battles(dungeon, index, monsters, by_id, skills_by_id, exp_rows, trials=BATTLE_TRIALS):
    """想定パーティーで1本を通しで戦う。HP/MPはエンカウント間で持ち越す。"""
    rng = random.Random(1234 + index)
    proto = median_species(monsters, player_tier_for(index))
    # プレイヤーのレベルは「経験値シミュレーションで実際に到達しているレベル」。
    # ただし推奨レベル未満にはしない(推奨レベルは最低ラインのつもりで置いている)。
    reached = exp_rows[index - 1]["level"] if index > 0 else 1
    level = max(dungeon["recommendedLevel"], reached)
    party_size = max(1, dungeon["partySizeHint"])

    wins = 0
    first_enc_stats = None
    for t in range(trials):
        players = [Fighter(proto, level, skills_by_id, True, potion_for(index))
                   for _ in range(party_size)]
        for p in players:
            p.potions = potion_for(index)
        alive = True
        for enc in dungeon["encounters"]:
            enemies = [Fighter(by_id[e["id"]], e["level"], skills_by_id, False)
                       for e in enc["enemies"]]
            if t == 0 and first_enc_stats is None:
                first_enc_stats = (players[0], enemies[0])
            if not run_battle(rng, players, enemies):
                alive = False
                break
            for p in players:
                p.ail_turns = 0
                p.poison = 0
        if alive:
            wins += 1
    return wins / trials, level, proto


# ==========================================================================
# 出力
# ==========================================================================
def write_json(path, dungeons):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(dungeons, f, ensure_ascii=False, indent=2)
        f.write("\n")


def main():
    monsters, skills_by_id, items_by_id = load_inputs()
    by_id = {m["id"]: m for m in monsters}

    dungeons, picker = build(monsters, skills_by_id)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    write_json(OUT_JSON, dungeons)

    errors = []

    # --- 1. 参照の実在チェック -------------------------------------------
    for d in dungeons:
        if d["background"] not in BACKGROUNDS:
            errors.append(f"{d['id']} 背景 {d['background']} が存在しない")
        for enc in d["encounters"]:
            for e in enc["enemies"]:
                if e["id"] not in by_id:
                    errors.append(f"{d['id']}/{enc['id']} 未知のモンスター {e['id']}")
                if not (1 <= e["level"] <= MAX_LEVEL):
                    errors.append(f"{d['id']}/{enc['id']} レベル範囲外 {e['level']}")
        for r in d["clearReward"]:
            if r["itemId"] not in items_by_id:
                errors.append(f"{d['id']} 未知のどうぐ {r['itemId']}")
        # 宝箱: 品ぞろえの実在と、床の拾いものと かぶっていないこと
        chest = d["chest"]
        if not chest["items"]:
            errors.append(f"{d['id']} 宝箱の品ぞろえが空")
        for r in chest["items"]:
            if r["itemId"] not in items_by_id:
                errors.append(f"{d['id']} 宝箱に未知のどうぐ {r['itemId']}")
            if r["itemId"] in FLOOR_LITTER:
                errors.append(
                    f"{d['id']} 宝箱の {r['itemId']} は床に落ちている安物"
                    f"(宝箱を開ける理由がなくなる)"
                )
            if r["weight"] <= 0 or r["count"] <= 0:
                errors.append(f"{d['id']} 宝箱の {r['itemId']} の重み/個数が0以下")
        total = sum(chest["mix"].values())
        if abs(total - 1.0) > 1e-6:
            errors.append(f"{d['id']} 宝箱の内訳の合計が {total} (1.0 でない)")
        if not (0.0 < chest["mix"]["empty"] < 0.5):
            errors.append(f"{d['id']} からっぽの割合 {chest['mix']['empty']} が極端")
        if chest["gold"]["base"] <= 0:
            errors.append(f"{d['id']} 宝箱のゴールドが0以下")

    # --- 2. 構造チェック --------------------------------------------------
    for i, d in enumerate(dungeons):
        levels = [enc["level"] for enc in d["encounters"]]
        if levels != sorted(levels):
            errors.append(f"{d['id']} エンカウントのレベルが単調でない {levels}")
        for enc in d["encounters"]:
            if len(enc["enemies"]) > d["partySizeHint"]:
                errors.append(
                    f"{d['id']}/{enc['id']} 敵{len(enc['enemies'])}体 > 想定パーティー"
                    f"{d['partySizeHint']}人"
                )
        boss = d["encounters"][-1]
        if not boss.get("isBoss"):
            errors.append(f"{d['id']} 最後のエンカウントがボスでない")
        mob_top = max(enc["level"] for enc in d["encounters"][:-1])
        if boss["level"] <= mob_top:
            errors.append(f"{d['id']} ボスのレベルが雑魚以下")
        if i > 0 and d["recommendedLevel"] <= dungeons[i - 1]["recommendedLevel"]:
            errors.append(f"{d['id']} 推奨レベルが前のダンジョン以下")
        if (i == 0) == d["locked"]:
            errors.append(f"{d['id']} locked の設定が連鎖と合っていない")

    # --- 2b. 歩けるダンジョンの整合 ---------------------------------------
    walk_lengths = floor_walk_lengths()
    for d in dungeons:
        if not (1 <= d["floors"] <= len(FLOOR_MAP_FILES)):
            errors.append(f"{d['id']} 階層数 {d['floors']} がフロアマップの本数に合わない")
        steps = d["encounterSteps"]
        if not (ENCOUNTER_STEPS_MIN <= steps <= ENCOUNTER_STEPS_MAX):
            errors.append(f"{d['id']} エンカウント歩数 {steps} が許容範囲外")
        # 1フロアも歩き切らないうちに全部の戦闘が終わる/1戦も起きない、を弾く
        expected = sum(walk_lengths[f % len(walk_lengths)] for f in range(d["floors"]))
        expected *= EXPLORE_FACTOR
        fights = expected / steps
        mob_fights = len(d["encounters"]) - 1
        if fights < mob_fights * 0.6 or fights > mob_fights * 1.8:
            errors.append(
                f"{d['id']} 想定戦闘数 {mob_fights} に対して 実測見込み {fights:.1f} 戦"
            )

    # --- 3. 経験値シミュレーション ---------------------------------------
    exp_rows = simulate_exp(dungeons, by_id)

    # --- 4. 戦闘シミュレーション -----------------------------------------
    battle_rows = []
    for i, d in enumerate(dungeons):
        rate, level, proto = simulate_dungeon_battles(
            d, i, monsters, by_id, skills_by_id, exp_rows)
        battle_rows.append({"rate": rate, "level": level, "proto": proto})

    # ------------------------------------------------------------------ 出力
    print("=== build_dungeons.py 実行結果 ===")
    print(f"モンスター表   : {len(monsters)} 体")
    print(f"ダンジョン     : {len(dungeons)} 本 (1本クリアで次が解放)")
    print(f"出力           : {OUT_JSON} ({OUT_JSON.stat().st_size / 1024:.1f} KB)")
    print()

    print("--- ダンジョン一覧 ---")
    print("  #  名前            背景            推奨Lv 想定人数 戦闘数 敵数  敵Lv     階級")
    total_slots = 0
    for i, d in enumerate(dungeons):
        enemies = [e for enc in d["encounters"] for e in enc["enemies"]]
        total_slots += len(enemies)
        levels = [e["level"] for e in enemies]
        tiers = sorted({by_id[e["id"]]["tier"] for e in enemies}, key=lambda t: TIER_INDEX[t])
        print(f"  {i + 1:>2} {d['name']:<14} {d['background']:<14} "
              f"{d['recommendedLevel']:>5} {d['partySizeHint']:>6}人 "
              f"{len(d['encounters']):>5} {len(enemies):>4} "
              f"{min(levels):>3}-{max(levels):<3} {'/'.join(tiers)}")
    print(f"  敵スロット合計 : {total_slots}")
    print()

    print("--- 階層とエンカウント率 (歩けるダンジョン) ---")
    print(f"  フロア最短歩数 (上り階段->下り階段): {walk_lengths} / 探索割増 x{EXPLORE_FACTOR}")
    print("  #  名前            階層 踏破の歩数見込み  1戦あたり歩数  想定戦闘数 -> 見込み")
    for i, d in enumerate(dungeons):
        expected = sum(walk_lengths[f % len(walk_lengths)] for f in range(d["floors"]))
        expected *= EXPLORE_FACTOR
        mob_fights = len(d["encounters"]) - 1
        print(f"  {i + 1:>2} {d['name']:<14} {d['floors']:>3}層 {expected:>12.0f}歩 "
              f"{d['encounterSteps']:>12}歩 {mob_fights:>9}戦 -> {expected / d['encounterSteps']:.1f}戦")
    print()

    print("--- ボス ---")
    for i, d in enumerate(dungeons):
        boss_enc = d["encounters"][-1]
        boss = by_id[boss_enc["enemies"][0]["id"]]
        mob_top = max(enc["level"] for enc in d["encounters"][:-1])
        escorts = len(boss_enc["enemies"]) - 1
        print(f"  {i + 1:>2} {boss['name']:<14} {boss['tier']:<4} Lv{boss_enc['level']:<3}"
              f" (雑魚最高 Lv{mob_top} / 護衛{escorts}体) {boss['type']}")
    print()

    print("--- 種族カバー率 ---")
    used = picker.used
    print(f"  出現する種族(全階級) : {len(used)} / {len(monsters)} 体 "
          f"({100.0 * len(used) / len(monsters):.1f}%)")
    wild_pool = [m for m in monsters if m["tier"] in WILD_TIERS]
    wild_used = [m for m in wild_pool if m["id"] in used]
    coverage = len(wild_used) / len(wild_pool)
    for tier in TIER_ORDER:
        pool = [m for m in monsters if m["tier"] == tier]
        got = [m for m in pool if m["id"] in used]
        print(f"  {tier:<4}: {len(got):>3}/{len(pool):>3} ({100.0 * len(got) / len(pool):5.1f}%)")
    print(f"  野生で仲間にできる階級(下位+中位) : {len(wild_used)}/{len(wild_pool)} "
          f"= {100.0 * coverage:.1f}%  [下限 {100 * MIN_WILD_COVERAGE:.0f}%]")
    print(f"  テーマ解決の内訳 : 接頭辞 {picker.fallback_hits['prefix']} / "
          f"タイプ {picker.fallback_hits['type']} / 階級全体 {picker.fallback_hits['tier']}")
    if coverage < MIN_WILD_COVERAGE:
        errors.append(f"下位+中位のカバー率 {100 * coverage:.1f}% が下限を下回る")
    print()

    print("--- 経験値シミュレーション (各ダンジョンを1周ずつクリア) ---")
    print("   #  推奨Lv  1周の獲得exp  到達Lv  次の推奨Lv  判定")
    for r in exp_rows:
        if r["next_rec"] is None:
            verdict = "-"
        elif r["level"] >= r["next_rec"]:
            verdict = f"OK (+{r['level'] - r['next_rec']})"
        else:
            verdict = f"NG (-{r['next_rec'] - r['level']})"
            errors.append(
                f"{r['name']} を1周しても Lv{r['level']} で、次の推奨 Lv{r['next_rec']} に届かない")
        print(f"  {r['index'] + 1:>2} {r['rec']:>6} {r['gain']:>13,} {r['level']:>7} "
              f"{str(r['next_rec']):>11}  {verdict}")
    print(f"  最終到達レベル : Lv{exp_rows[-1]['level']} / {MAX_LEVEL}")
    print()

    print("--- 戦闘シミュレーション (通しで1本、HP/MPは持ち越し) ---")
    print("   #  想定Lv 代表種族        勝率     判定")
    for i, (d, b) in enumerate(zip(dungeons, battle_rows)):
        floor = EARLY_MIN_WIN_RATE if i < 3 else (
            WALL_MIN_WIN_RATE if i >= len(dungeons) - 2 else MIN_WIN_RATE)
        ok = b["rate"] >= floor
        if not ok:
            errors.append(f"{d['name']} の勝率 {b['rate'] * 100:.0f}% が下限 {floor * 100:.0f}% を下回る")
        print(f"  {i + 1:>2} {b['level']:>6} {b['proto']['name']:<14} "
              f"{b['rate'] * 100:>5.1f}%  {'OK' if ok else 'NG'} (下限 {floor * 100:.0f}%)")
    print()

    # --- 序盤の実数値 (ソロLv1が本当に勝てるのか) -------------------------
    print("--- 序盤の実数値: ソロのスターターが はじまりの草原 でどう戦うか ---")
    d1 = dungeons[0]
    starter = median_species(monsters, "下位")
    weakest = sorted([m for m in monsters if m["tier"] == "下位"],
                     key=lambda m: (sum(m["stats"].values()), m["id"]))[0]
    for label, sp in (("中央値のスターター", starter), ("最弱のスターター", weakest)):
        p = Fighter(sp, 1, skills_by_id, True)
        print(f"  {label}: {sp['name']} Lv1 HP{p.stats['hp']} "
              f"こうげき{p.stats['atk']} ぼうぎょ{p.stats['def']} すばやさ{p.stats['spd']}")
        for enc in d1["encounters"]:
            e0 = enc["enemies"][0]
            en = Fighter(by_id[e0["id"]], e0["level"], skills_by_id, False)
            pdmg = max(1, p.stats["atk"] - en.stats["def"] * 0.5)
            e_norm = max(1, en.stats["atk"] - p.stats["def"] * 0.5)
            e_sk = 0
            for s in en.skills:
                pw = s.get("power") or 0
                if pw > 0 and s["type"] == "物理":
                    e_sk = max(e_sk, max(1, en.stats["atk"] * (pw / 20.0) - p.stats["def"] * 0.5))
            edmg = (e_norm + max(e_sk, e_norm)) / 2 if e_sk else e_norm
            tag = "ボス" if enc.get("isBoss") else "雑魚"
            print(f"    {tag} {en.name} Lv{en.level} HP{en.stats['hp']}: "
                  f"こちらの与ダメ {pdmg:.1f}/turn -> 撃破まで {en.stats['hp'] / pdmg:.1f}ターン / "
                  f"相手の与ダメ {edmg:.1f}/turn -> こちらが落ちるまで {p.stats['hp'] / edmg:.1f}ターン")
    solo_rate = battle_rows[0]["rate"]
    print(f"  ソロ通し勝率 (2戦+ボス、HP持ち越し、やくそう{SIM_POTIONS[0][2]}コ): {solo_rate * 100:.1f}%")
    print()

    # --- 難易度の伸び (ダンジョン1との比較) -------------------------------
    print("--- 難易度の伸び (各ダンジョンのボス vs はじまりの草原のボス) ---")
    b1 = dungeons[0]["encounters"][-1]["enemies"][0]
    s1 = enemy_stats_at(by_id[b1["id"]], b1["level"])
    base = sum(s1.values())
    for i, d in enumerate(dungeons):
        be = d["encounters"][-1]["enemies"][0]
        st = enemy_stats_at(by_id[be["id"]], be["level"])
        print(f"  {i + 1:>2} {by_id[be['id']]['name']:<14} Lv{be['level']:<3} "
              f"HP{st['hp']:>5} こうげき{st['atk']:>4} ぼうぎょ{st['def']:>4} "
              f"かしこさ{st['int']:>4} すばやさ{st['spd']:>4}  合計{sum(st.values()):>5} "
              f"(D1ボス比 x{sum(st.values()) / base:.1f})")
    print()

    if errors:
        print("[ERROR] 検証に失敗しました:")
        for e in errors:
            print(f"  - {e}")
        raise SystemExit(1)

    print("[OK] 参照・構造・経験値曲線・戦闘勝率・カバー率、すべて検証を通過しました。")
    print(f"     生成日時 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    main()
