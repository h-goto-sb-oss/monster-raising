# -*- coding: utf-8 -*-
"""
build_field_assets.py

「歩けるマップ」(町・内装・ダンジョン) が使う素材を、読み取り専用の素材集から
game/ へコピー・加工する。素材集そのものには一切書き込まない。

素材集:
    C:/Users/pc/Documents/Codex/2026-08-30/do/outputs/dot_rpg_town_assets
    仕様は grid_v2/GRID_SPEC.md (1マス=64x64px、人物は足元1マス・下中央そろえ)

やること:
  1. 町 / 内装5 / ダンジョン3階層 の PNG を public/assets/field/ へコピー
  2. 各レイアウトJSON を src/data/maps/ へコピー (Vite の import で読む)
  3. 人物18人ぶんの歩行スプライトシートを合成
       素材は 256x256 のセルが 1人=1行 x 8列
       (正面A, 正面B, 背面A, 背面B, 左A, 左B, 右A, 右B)
       8コマぶんのアルファ外接矩形の**和**で切り抜いて、全コマの基準をそろえる。
       コマごとに切ると、歩行の左右で人物が横にズレて見える。
       出力は 96x112 のコマ x 8 で、下中央そろえ(= 足元がコマの下辺)。
  4. 宝箱(閉/開)のスプライトを切り出す
       ダンジョンに置く「本物の宝箱」の絵。閉と開で大きさが変わらないよう、
       2セットの外接矩形の**和**で切ってから同じ倍率で縮める。
  4b. 階段(上り/下り)のスプライトを 64px で切り出す
       フロアの絵には階段が **2x2マス(128px)** で焼き込まれている。
       1マス=64px の決まりから1つだけ外れていて、他の置きものと大きさが揃わない。
       焼き込みだと「1階の上り階段だけ消す」もできない(フロア図は3枚を使い回す)。
       そこで絵からは消して(下の erase_baked_stairs)、素材集の単体絵から
       1マスちょうどのスプライトを書き出し、置きものとして field/maps.js が置く。
  5. 絵に焼き込まれている人物・使えない扉を、まわりの地面で塗りつぶす
       町にも各フロアにも「動かない人物」が描き込まれている。歩けるマップに
       した以上、これは動かないNPCにしか見えない(しかも本物のNPCと二重になる)。
       ダンジョン1階の大扉と宝箱も、開けられないのに開けられそうに見えるので消す。
       消したあとに本物の宝箱を置くのは field/maps.js の仕事。
  6. フロアのレイアウトJSONから、絵ごと消した当たり判定を落とす
       絵から消したのに当たり判定だけ残ると「見えない壁」になる。
  7. どうぐアイコン25枚を縮めて public/assets/items/ へ出し、
     items.json の icon 欄を埋める
       素材は 216x216。ふくろでも戦闘のどうぐ欄でも小さく出すので、
       48x48 まで NEAREST で落とす(下の ITEM_ICON_PX を参照)。
  8. お金(ゴールド)のアイコンを1枚切り出す
       objects_furniture_items の4行2列が「お金」。宝箱がゴールドをくれるように
       なったので、町のHUDとふくろで使う。

再実行しても結果は変わらない(冪等)。
"""

import json
import shutil
from pathlib import Path

from PIL import Image

SRC = Path(r"C:/Users/pc/Documents/Codex/2026-08-30/do/outputs/dot_rpg_town_assets")

# あとから届いた素材の置き場。素材集(SRC)は読み取り専用の別リポジトリなので、
# 追加で描いてもらったものはこちらへ入れて、同じように取り込む。
#   incoming/grassland_and_seisui/    … せいすいのアイコン(フロア図は下で差し替え済み)
#   incoming/future_assets/           … 戦闘エフェクト8種・ボス部屋5・住人5人・雪の町
#   incoming/unique_floors_and_props/ … 5地形 x 3階層のフロア図15枚 + 置きもの12種
INCOMING = Path(__file__).resolve().parent / "incoming"
GRASSLAND_SRC = INCOMING / "grassland_and_seisui"
FUTURE_SRC = INCOMING / "future_assets"

# フロア図15枚と置きもの12種。
#
# **これは2回目の納品**。1回目(incoming/grassland_and_seisui/ と
# incoming/remaining_12_floors/)は、15枚のうち約半分で階段の座標が絵と
# 合っていなかったので取り込まず、置きものだけ使っていた。
# この修正版は 30ヶ所の階段座標が全部 描かれた階段の上に乗っていて、
# 上り階段から下り階段へ歩いて行けることを15枚とも確認してある。
#
# 草原もこちらに含まれる(1回目の草原3枚は これに置き換わった)。
# 5地形とも 30x20マス。地形ごとにレイアウトが違う(1回目のように
# 「草原の使い回しに色を塗っただけ」ではない)。
FLOORS_SRC = INCOMING / "unique_floors_and_props" / "floors"
PROPS_SRC = INCOMING / "unique_floors_and_props" / "props"

# 納品の名前 (cave_b1 …) と、game 側で使う名前 (cave_01 …) の対応。
BIOMES = [
    ("grassland", "grassland"),
    ("cave", "cave"),
    ("ruins", "ruins"),
    ("snow", "snow"),
    ("lava", "lava"),
]

GAME = Path(__file__).resolve().parent.parent / "game"
OUT_IMG = GAME / "public" / "assets" / "field"
OUT_DATA = GAME / "src" / "data" / "maps"
OUT_ITEM_IMG = GAME / "public" / "assets" / "items"
OUT_UI_IMG = GAME / "public" / "assets" / "ui"
OUT_FX_IMG = GAME / "public" / "assets" / "effects"
OUT_AREA_IMG = GAME / "public" / "assets" / "area"
BATTLE_BG_IMG = GAME / "public" / "assets" / "battle_bg"
ITEMS_JSON = GAME / "src" / "data" / "items.json"

# GRID_SPEC の「表示領域は最大96x112px」に合わせたコマの大きさ。
FRAME_W, FRAME_H = 96, 112

# (出力名, 素材シート名, 行番号)。1人 = 1行。
CHARACTERS = [
    ("hero", "characters_key_01", 1),          # 主人公
    ("priestess", "characters_key_01", 2),     # 女僧侶
    ("shopkeeper", "characters_key_01", 3),    # 道具屋
    ("storekeeper", "characters_key_01", 4),   # 預け屋
    ("rancher", "characters_key_02", 1),       # 牧場主
    ("fusionmaster", "characters_key_02", 2),  # 配合マスター
]
# 町をうろつく住人12人 (3シート x 4行)。
CHARACTERS += [
    (f"townsfolk_{i * 4 + row}", f"characters_townsfolk_{i + 1:02d}", row)
    for i in range(3)
    for row in (1, 2, 3, 4)
]

MAP_IMAGES = [
    (SRC / "grid_v2/maps/town_overview_v2.png", "town.png"),
    (SRC / "grid_v2/interiors/protagonist_house_v2.png", "interior_home.png"),
    (SRC / "grid_v2/interiors/church_v2.png", "interior_church.png"),
    (SRC / "grid_v2/interiors/item_shop_v2.png", "interior_item_shop.png"),
    (SRC / "grid_v2/interiors/monster_ranch_v2.png", "interior_ranch.png"),
    (SRC / "grid_v2/interiors/breeding_facility_v2.png", "interior_breeding.png"),
    (SRC / "dungeon/maps/floor_01.png", "floor_01.png"),
    (SRC / "dungeon/maps/floor_02.png", "floor_02.png"),
    (SRC / "dungeon/maps/floor_03.png", "floor_03.png"),
]
# ダンジョンのフロア図 5地形 x 3階層。どれも 30x20マス (1920x1280px) で、
# もとからある洞窟の 20x14 より一回り広い。フロア図の寸法は map_tiles から
# 読むので、ゲーム側は大きさを決め打ちしていない (game/src/field/maps.js)。
MAP_IMAGES += [
    (FLOORS_SRC / f"{src}_b{i}.png", f"{out}_{i:02d}.png")
    for src, out in BIOMES
    for i in (1, 2, 3)
]

# ボス部屋5つ。地形ごとに1部屋で、階(floors)とは関係なく「そのダンジョンの
# ボスと戦う場所」として使う。30x20マスでフロア図と同じ寸法。
# JSONは stairs が空で、代わりに entrance を1マス持つ。
BOSS_ROOMS = ["boss_grassland", "boss_cave", "boss_ruins", "boss_snow", "boss_lava"]
MAP_IMAGES += [(FUTURE_SRC / "boss_rooms" / f"{n}.png", f"{n}.png") for n in BOSS_ROOMS]

# 雪の町。**まだ行き先としては繋いでいない**(2つめの町の中身も、5棟の内装も
# 無いので、着いても何もできない)。素材と当たり判定だけ先に入れておく。
MAP_IMAGES += [(FUTURE_SRC / "snow_town" / "snow_town.png", "snow_town.png")]

MAP_LAYOUTS = [
    (SRC / "grid_v2/maps/town_layout_v2.json", "town.json"),
    (SRC / "grid_v2/interiors/protagonist_house_layout_v2.json", "interior_home.json"),
    (SRC / "grid_v2/interiors/church_layout_v2.json", "interior_church.json"),
    (SRC / "grid_v2/interiors/item_shop_layout_v2.json", "interior_item_shop.json"),
    (SRC / "grid_v2/interiors/monster_ranch_layout_v2.json", "interior_ranch.json"),
    (SRC / "grid_v2/interiors/breeding_facility_layout_v2.json", "interior_breeding.json"),
    (SRC / "dungeon/maps/floor_01.json", "floor_01.json"),
    (SRC / "dungeon/maps/floor_02.json", "floor_02.json"),
    (SRC / "dungeon/maps/floor_03.json", "floor_03.json"),
]
MAP_LAYOUTS += [
    (FLOORS_SRC / f"{src}_b{i}.json", f"{out}_{i:02d}.json")
    for src, out in BIOMES
    for i in (1, 2, 3)
]
MAP_LAYOUTS += [(FUTURE_SRC / "boss_rooms" / f"{n}.json", f"{n}.json") for n in BOSS_ROOMS]
MAP_LAYOUTS += [(FUTURE_SRC / "snow_town" / "snow_town.json", "snow_town.json")]

# 絵から消す矩形と、代わりに貼るきれいな地面の位置 (どちらも px)。
#
# 素材の絵には人物が何人も描き込まれている。1枚絵を眺めるぶんには にぎやかで
# よいのだが、歩けるマップにした以上「ぜったいに動かないNPC」にしか見えない。
# しかも本物のNPC(教会の女僧侶・牧場主・配合マスター)と姿がそのまま重なる。
# だから **町の人物は全員** 消して、にぎわいは MapScene のうろつく住人で作る。
#
# 貼り直しの位置は「なるべく 64px の倍数ずらし」で選んである。
# 町の石畳は 64px ちょうどで繰り返す(実測で完全一致)ので、64の倍数だけ
# ずらして貼ればタイルの継ぎ目がぴたりと合う。ずれた値を使うと石の輪郭が
# ぶつ切りになって、あとから見ると必ず分かる。
#
# 街灯・ベンチのように「人物の後ろにある残したいもの」は、
# **同じものが写っている別の場所**から貼ることで一緒に復元している
# (街灯はマス12と19、ベンチはマス11-12と19-20に同じ絵が置いてある)。
ERASE = {
    "town.png": [
        # 広場の石畳の上に立っている人たち。dx はすべて 64 の倍数。
        {"box": (442, 588, 520, 708), "from_xy": (58, 588), "why": "広場西(マス7,10)の鍛冶屋風の男"},
        {"box": (766, 590, 834, 708), "from_xy": (1214, 590),
         "why": "広場中央(マス12,10)の緑服の男 / 街灯はマス19の街灯ごと貼って復元"},
        {"box": (636, 716, 708, 836), "from_xy": (188, 716), "why": "広場南(マス10,12)の麦わら帽子の子供"},
        {"box": (1014, 708, 1094, 836), "from_xy": (822, 708), "why": "広場中央(マス16,12)の主人公そっくりの人物"},
        {"box": (1086, 588, 1154, 708), "from_xy": (574, 588), "why": "広場東(マス17,10)の白髪の老婦人"},
        {"box": (1274, 716, 1351, 836), "from_xy": (762, 716),
         "why": "広場東(マス20,12)のパン籠の女性 / ベンチはマス11-12のベンチごと貼って復元"},
        {"box": (1596, 588, 1668, 708), "from_xy": (1788, 588), "why": "広場東端(マス25,10)の緑頭巾の少女"},
        # 牧場と配合施設の入口に立つ2人。ここは草地 + 建物(柵・石段)にまたがって
        # いるので、まず草を貼って人物を消し、そのあと BUILDING_REPAIR が
        # 建物のぶんだけ描き戻す。ちょうど「入口から出てきたときに立つマス」に
        # 描かれていて、放っておくと自分と重なってしまう。
        {"box": (378, 1286, 462, 1410), "from_xy": (704, 1216), "why": "牧場の入口(マス6,21)の牧場主"},
        {"box": (1594, 1288, 1668, 1414), "from_xy": (1180, 1288), "why": "配合施設の入口(マス25,21)の配合マスター"},
    ],
    "floor_01.png": [
        {"box": (304, 122, 412, 258), "from_xy": (640, 260), "why": "上り階段の横(マス4,3)の主人公"},
        # 開けられない大扉。マップの北の端に立っていて、この先には何もない。
        # 「開きそうで開かない扉」は無い扉より悪いので、当たり判定ごと消す
        # (当たり判定は STRIP_COLLISIONS が落とす)。
        {"box": (832, 126, 972, 258), "from_xy": (330, 280), "why": "行き先の無い大扉(マス13-14,2-3)"},
        # 焼き込みの宝箱。ここには field/maps.js が本物の宝箱を置き直す
        # (開けたら絵が変わらないといけないので、焼き込みのままでは使えない)。
        {"box": (510, 324, 580, 386), "from_xy": (340, 330), "why": "焼き込みの宝箱(マス8,5)。本物に置きかえる"},
    ],
    "floor_02.png": [
        {"box": (304, 506, 412, 642), "from_xy": (256, 320), "why": "上り階段の横(マス4,9)の主人公"},
    ],
    "floor_03.png": [
        {"box": (304, 442, 412, 578), "from_xy": (704, 264), "why": "上り階段の横(マス4,8)の主人公"},
    ],
    # --- 内装5部屋 -------------------------------------------------------
    # どの部屋も本物のNPCが1人ずついるのに、その真横や真上に同じ姿の人物が
    # 焼き込まれていて「同じ人が2人いる」状態だった。客役の人物も、
    # 当たり判定が無いので主人公がすり抜けてしまう(=幽霊に見える)。
    # 内装の床は木も石も 64px ちょうどで繰り返す(実測で完全一致)ので、
    # 64の倍数だけずらした床を貼れば継ぎ目なく消える。
    "interior_church.png": [
        {"box": (318, 460, 386, 580), "from_xy": (190, 460), "why": "会衆席の前(マス5,8)の老婦人"},
        {"box": (634, 460, 711, 580), "from_xy": (506, 460), "why": "会衆席の前(マス9,8)のパン籠の女性"},
    ],
    "interior_home.png": [
        {"box": (636, 268, 708, 388), "from_xy": (636, 140), "why": "預け屋の真下(マス10,5)の老婦人"},
        {"box": (440, 460, 520, 580), "from_xy": (312, 460), "why": "部屋の中央(マス6,8)の主人公そっくりの人物"},
    ],
    "interior_item_shop.png": [
        {"box": (444, 140, 516, 260), "from_xy": (316, 140), "why": "道具屋の立ち位置(マス7,3)に重なる少女"},
        {"box": (634, 460, 706, 580), "from_xy": (506, 460), "why": "店内(マス10,8)の緑服の少年"},
    ],
    "interior_ranch.png": [
        {"box": (446, 268, 514, 388), "from_xy": (574, 268), "why": "牧場主と同じ姿の人物(マス7,5)"},
        {"box": (636, 460, 707, 580), "from_xy": (508, 460), "why": "小屋の中(マス10,8)の麦わら帽子の子供"},
    ],
    "interior_breeding.png": [
        {"box": (376, 460, 456, 580), "from_xy": (248, 460), "why": "魔法陣の手前(マス5,8)の主人公そっくりの人物"},
    ],
}

# 絵から消したので、当たり判定のほうも落とす名前。
# 残すと「何も無いのに通れないマス」= 見えない壁になる。
STRIP_COLLISIONS = {
    "floor_01.json": ["door", "chest"],
}

# 「素材単体の絵」を貼り直して人物を消す指定。
#
# 建物の入口(教会・牧場・配合施設)と教会の祭壇に立つ人物は、石段・柵・祭壇に
# 重なっているので「近くの地面を貼る」では消せない。幸い素材集には
# 建物や家具の単体絵があり、マップの絵はそれを拡大して貼ったものなので、
# 同じ倍率・同じ位置で貼り直せば人物だけがきれいに消える。
#
# sheet/cell/cell_px/origin は、人物が写っていない範囲だけで最小二乗マッチして
# 求めた値。box はそのうち「実際に貼り直す範囲」= 人物のいるところだけ。
ASSET_REPAIR = {
    "town.png": [
        {"sheet": "buildings", "cell": "r01_c02", "cell_px": 494, "origin": (778, 105),
         "box": (940, 436, 1068, 584), "why": "教会の入口に立つ女僧侶(本物は教会の中にいる)"},
        {"sheet": "buildings", "cell": "r02_c01", "cell_px": 494, "origin": (169, 877),
         "box": (378, 1286, 462, 1410), "why": "牧場の柵を描き戻す(牧場主を消した跡)"},
        {"sheet": "buildings", "cell": "r02_c02", "cell_px": 494, "origin": (1386, 873),
         "box": (1594, 1288, 1668, 1414), "why": "配合施設の石段を描き戻す(配合マスターを消した跡)"},
    ],
    "interior_breeding.png": [
        # 魔法陣の中に立っている配合マスター。本物のNPCは右の系譜台のところに
        # いるので、絵のほうは同じ人がもう1人いるだけになってしまう。
        # 魔法陣は素材集に単体の絵があるので、まるごと貼り直して人物だけ消す。
        {"sheet": "interior_props_extra", "cell": "r04_c01", "cell_px": 289, "origin": (336, 176),
         "box": (444, 256, 524, 400), "why": "魔法陣の中に立つ配合マスター(本物は系譜台のところ)"},
    ],
}


def repair_assets(name, im):
    """素材単体の絵を貼り直して、上に描き込まれた人物を消す。"""
    for spec in ASSET_REPAIR.get(name, []):
        cell = Image.open(SRC / "sprites_256" / spec["sheet"] / f"{spec['cell']}.png").convert("RGBA")
        size = spec["cell_px"]
        ox, oy = spec["origin"]
        clean = Image.new("RGBA", im.size, (0, 0, 0, 0))
        clean.paste(cell.resize((size, size), Image.NEAREST), (ox, oy))
        x0, y0, x1, y1 = spec["box"]
        patch = clean.crop((x0, y0, x1, y1))
        im.paste(patch, (x0, y0), patch)
        print(f"repair {name:14} {spec['box']} <- {spec['cell']}  ({spec['why']})")


def build_character(out_name, sheet, row):
    cells = []
    for col in range(1, 9):
        cells.append(Image.open(SRC / "sprites_256" / sheet / f"r{row:02d}_c{col:02d}.png").convert("RGBA"))

    # 8コマぶんの外接矩形の和 = 全コマ共通の切り抜き枠
    box = None
    for im in cells:
        b = im.getbbox()
        if b is None:
            continue
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])
        )
    if box is None:
        raise SystemExit(f"[ERROR] {out_name}: 中身が空のセルしかありません")

    cw, ch = box[2] - box[0], box[3] - box[1]
    scale = min(FRAME_W / cw, FRAME_H / ch)
    tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))

    sheet_img = Image.new("RGBA", (FRAME_W * 8, FRAME_H), (0, 0, 0, 0))
    for i, im in enumerate(cells):
        cropped = im.crop(box).resize((tw, th), Image.LANCZOS)
        # 下中央そろえ。足元がコマの下辺に来る = マップ上の基準点になる。
        sheet_img.paste(cropped, (i * FRAME_W + (FRAME_W - tw) // 2, FRAME_H - th), cropped)

    out = OUT_IMG / "chars" / f"{out_name}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet_img.save(out, optimize=True)
    return box, (tw, th)


# --- あとから届いた住人5人 -----------------------------------------------
#
# 子供3人と老人2人。素材集の12人と違って、**もう 96x112 の8コマに組んだ状態**で
# 届いている(768x112)。だから build_character のような組み立ては要らない。
#
# ただしそのまま使うと2つ困ることがある。
#
# 1. 足元が4px 浮いている
#      12人ぶんの既存シートは足元がコマの下辺(y=112)ちょうどに来ている。
#      新しい5人は下に4pxの余白があり、そのまま置くと地面から浮いて見える。
#      **中身を縦にずらすだけ**で直す。
#
# 2. 大きさは いじらない
#      build_character は1人ずつ「コマいっぱい」に引き伸ばす。既存の12人が
#      全員112px なのはそのためで、子供(townsfolk_3)が大人と同じ背丈になり、
#      maps.js 側で scale 0.72 をかけて縮め直していた。
#      新しい5人は **描いた時点で背丈が描き分けてある**
#      (子供 80px / 老人 98px / 大人 112px)。ここで引き伸ばすと、その
#      描き分けを一度つぶしてから縮め直すことになり、ドットが二重に
#      なまるだけで何も良くならない。だから拡大縮小は一切しない。
RESIDENTS = [
    "npc_child_boy",
    "npc_child_girl",
    "npc_child_explorer",
    "npc_elderly_man",
    "npc_elderly_woman",
]


def build_resident(name):
    """届いた 768x112 の8コマシートを、足元をコマの下辺にそろえて書き出す。"""
    src = FUTURE_SRC / "residents" / f"{name}.png"
    im = Image.open(src).convert("RGBA")
    if im.size != (FRAME_W * 8, FRAME_H):
        raise SystemExit(
            f"[ERROR] {name}: シートが {im.size} です "
            f"({FRAME_W * 8}x{FRAME_H} = 96x112 の8コマを期待)"
        )

    frames = [im.crop((i * FRAME_W, 0, (i + 1) * FRAME_W, FRAME_H)) for i in range(8)]

    # 8コマぶんの外接矩形の**和**。コマごとに切ると歩行の左右でズレて見える。
    box = None
    for f in frames:
        b = f.getbbox()
        if b is None:
            continue
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])
        )
    if box is None:
        raise SystemExit(f"[ERROR] {name}: 中身が空のシートです")

    # 下へどれだけずらせば足元がコマの下辺に来るか。拡大縮小はしない。
    shift = FRAME_H - box[3]
    out_img = Image.new("RGBA", (FRAME_W * 8, FRAME_H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        out_img.paste(f, (i * FRAME_W, shift), f)

    out = OUT_IMG / "chars" / f"{name}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    out_img.save(out, optimize=True)
    height = box[3] - box[1]
    print(
        f"char  {name:26} bbox={box} 背丈 {height}px "
        f"(コマ高 {FRAME_H}px の {height / FRAME_H:.0%}) 足元を {shift}px 下げた"
    )


def build_residents():
    for name in RESIDENTS:
        build_resident(name)


# --- 戦闘エフェクト ------------------------------------------------------
#
# 1枚 = 1152x192 = 192x192 の6コマ。加工は要らないので、寸法だけ検証して
# そのまま public/assets/effects/ へ写す。ここで検証しておかないと、
# コマ数の違う絵が届いたときに「戦闘中だけ絵がずれる」という
# いちばん気づきにくい壊れ方をする。
EFFECTS = [
    "fx_zangeki", "fx_dageki", "fx_honoo", "fx_koori",
    "fx_kaminari", "fx_kaifuku", "fx_doku", "fx_kyouka",
]
FX_FRAME_PX = 192
FX_FRAMES = 6


def build_effects():
    OUT_FX_IMG.mkdir(parents=True, exist_ok=True)
    for name in EFFECTS:
        src = FUTURE_SRC / "effects" / f"{name}.png"
        im = Image.open(src)
        if im.size != (FX_FRAME_PX * FX_FRAMES, FX_FRAME_PX):
            raise SystemExit(
                f"[ERROR] {name}: {im.size} です "
                f"({FX_FRAME_PX * FX_FRAMES}x{FX_FRAME_PX} = 192pxの6コマを期待)。"
                f" game/src/engine/battle/effects.js の FX_FRAME と合わせてください。"
            )
        if im.mode != "RGBA":
            raise SystemExit(f"[ERROR] {name}: 透過(RGBA)ではありません ({im.mode})")
        shutil.copyfile(src, OUT_FX_IMG / f"{name}.png")
        print(f"fx    {name:26} {im.size} = {FX_FRAME_PX}px x {FX_FRAMES}コマ")


# --- ダンジョンに散らす置きもの ------------------------------------------
#
# 12種。素材は 256x256 の透過PNGで下中央そろえ。宝箱とまったく同じ扱いで、
# 外接矩形で切ってから 1マス(64px)に収まる大きさへ落とす。
# **切ってから長辺で合わせる**ので、背の高い石柱も横長のトロッコも
# マスからはみ出さない。
PROPS = [
    "prop_tsubo", "prop_hone", "prop_taru", "prop_hako", "prop_taimatsu",
    "prop_torokko", "prop_tsuruhashi", "prop_sekichu", "prop_sekizou",
    "prop_tsurara", "prop_yukidaruma", "prop_toke_iwa",
]
PROP_PX = 58  # 1マス64pxの中に置く。宝箱(60px)より気持ち小さく = 主役は宝箱


def build_props():
    out_dir = OUT_IMG / "objects"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in PROPS:
        src = PROPS_SRC / f"{name}.png"
        im = Image.open(src).convert("RGBA")
        box = im.getbbox()
        if box is None:
            raise SystemExit(f"[ERROR] {name}: 中身が空です")
        cropped = im.crop(box)
        cw, ch = cropped.size
        scale = PROP_PX / max(cw, ch)
        tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))
        cropped.resize((tw, th), Image.LANCZOS).save(out_dir / f"{name}.png", optimize=True)
        print(f"prop  {name:26} bbox={box} -> {tw}x{th}")


# --- 焼き込みの階段を消す ------------------------------------------------
#
# 階段は 2x2マス(128x128px)ぶん描き込まれていて、左上のマスが
# レイアウトJSONの stairs.up / stairs.down と一致する(3枚とも実測で一致)。
# その 2x2 は3枚とも全マスが walkable_tiles に載っている素の地面なので、
# 同じ大きさのきれいな地面を貼れば継ぎ目なく消える。
#
# 貼り元は「そのフロア図の中で、置きものも階段も無い 2x2マス」を手で選んだ。
# 地面はランダムな小石まじりの土なので、どこから貼っても継ぎ目は出ない
# (町の石畳と違って 64px の繰り返し模様ではないため、位置合わせも要らない)。
STAIRS_TILE_SPAN = 2  # 焼き込みの階段が占めるマス数(縦横とも)

STAIRS_CLEAN_GROUND = {
    "floor_01.png": (8, 9),   # 南の広間のまん中。小石だけの素の土
    "floor_02.png": (2, 2),   # 北西の隅。柱も柵も無い
    "floor_03.png": (9, 9),   # 中央南。祭壇からも水晶からも離れている
}


def erase_baked_stairs(name, im, src_im):
    """焼き込みの階段(2x2マス)を地面で塗りつぶす。位置はレイアウトJSONから引く。"""
    ground = STAIRS_CLEAN_GROUND.get(name)
    if ground is None:
        return
    layout_path = OUT_DATA / name.replace(".png", ".json")
    if not layout_path.exists():
        raise SystemExit(f"[ERROR] {layout_path} が先に出力されていません")
    data = json.loads(layout_path.read_text(encoding="utf-8"))
    tile = data.get("tile_px", 64)
    span = STAIRS_TILE_SPAN * tile
    gx, gy = ground
    patch = src_im.crop((gx * tile, gy * tile, gx * tile + span, gy * tile + span))
    for which in ("up", "down"):
        pos = (data.get("stairs") or {}).get(which)
        if not pos:
            continue
        x0, y0 = pos[0] * tile, pos[1] * tile
        im.paste(patch, (x0, y0))
        print(f"stair {name:14} {which:4} マス{tuple(pos)} を消去 <- 地面マス{ground}")


def erase_baked_figures():
    """絵から、邪魔になる焼き込みの人物・扉・階段を消す(地面を貼り直す)。"""
    names = sorted(set(ERASE) | set(STAIRS_CLEAN_GROUND))
    for name in names:
        path = OUT_IMG / name
        im = Image.open(path).convert("RGBA")
        # 貼り元は「加工前の絵」から取る。順番によって結果が変わらないようにする。
        src_im = im.copy()
        for spec in ERASE.get(name, []):
            x0, y0, x1, y1 = spec["box"]
            sx, sy = spec["from_xy"]
            patch = src_im.crop((sx, sy, sx + (x1 - x0), sy + (y1 - y0)))
            im.paste(patch, (x0, y0))
            print(f"erase {name:14} {spec['box']} <- {spec['from_xy']}  ({spec['why']})")
        erase_baked_stairs(name, im, src_im)
        repair_assets(name, im)
        im.save(path)


# --- 溶岩のマスを通れなくする --------------------------------------------
#
# 残り4地形は「草原と同じレイアウトに、絵だけ塗り替えた」もの
# (納品の README がそう明言している)。草原には歩ける床が2種類あった:
#   ・うす茶色の道
#   ・草地のパッチ
# 溶岩地形ではこの **草地のパッチが溶岩の池に塗り替えられた**。ところが
# walkable_tiles は草原のままなので、そのまま出すと主人公が煮えたぎる溶岩の上を
# 平気で歩く。ここでレイアウトJSONを作り直して、溶岩のマスを壁にする。
#
# 納品JSONは書きかえない。**書き出したあとの game/src/data/maps/lava_0N.json を
# 絵から導出して上書きする**。だからパイプラインを回し直せば同じ結果になるし、
# 溶岩地形が描き直されて届いても、同じ処理がそのままかかる。
#
# 判定は「マスの過半が溶けた岩の色か」。1点(マスの中心)だけを見る判定も試したが、
# 溶岩には暗い黒ずんだ地殻の模様があって、池のまん中のマスでも中心画素が
# そこに当たると「岩」と誤判定する(実際に池の中に歩けるマスが虫食い状に残った)。
# マス全体の割合で見れば、池のまん中は必ず過半が溶岩になる。
LAVA_LAYOUTS = ["lava_01", "lava_02", "lava_03"]

# 溶岩マスと判定する割合。0.5 = マスの過半。
# これ未満のマス(池のふち)は歩けるまま = 「岸」として残る。
LAVA_MIN_FRACTION = 0.5
LAVA_PIXEL_STEP = 2  # 画素の間引き。64px のマスを 32x32 点で見る

# レイアウトJSONに足す当たり判定の名前。
# field/maps.js の PROP_LINES がこの名前で「溶岩だ、渡れない」を返す。
# ただの壁にすると、溶岩を調べたときに **何も起きない** = 壊れて見える。
LAVA_COLLISION_NAME = "lava_lake"

# 到達性のために歩けるまま残してよい溶岩マスの上限。
#
# 溶岩は絵で描かれていて 64px の格子には乗っていない。b2 と b3 では
# 溶岩の流れが通路をまたいでいて、溶岩マスを全部ふさぐと下り階段へ行けなくなる
# (実測: b2 は1マス、b3 は1マスだけがそういう「渡らないと先へ進めない」マス)。
# そこだけは「溶岩ぎわの足場」として残し、警告に出す。
# ここを超えたら絵とレイアウトが根本的に食い違っているので、黙って
# 通れないフロアを出荷せずに失敗させる。
LAVA_BRIDGE_MAX = 2
LAVA_BRIDGE_MAX_FRACTION = 0.8  # 足場として残してよい溶岩の濃さの上限


def _is_molten(rgb):
    """その画素が「溶けた岩」の色か。岩は無彩色、溶岩は赤〜橙で彩度が高い。"""
    r, g, b = rgb
    mx = max(r, g, b)
    if mx < 60:
        return False          # 暗すぎる = 影か黒い岩
    if r != mx or g < b:
        return False          # 赤が最大でなければ溶岩ではない(青白い氷などを弾く)
    return (mx - min(r, g, b)) / mx > 0.55


def _molten_fraction(px, x, y, tile):
    hit = total = 0
    for yy in range(y * tile, (y + 1) * tile, LAVA_PIXEL_STEP):
        for xx in range(x * tile, (x + 1) * tile, LAVA_PIXEL_STEP):
            total += 1
            if _is_molten(px[xx, yy]):
                hit += 1
    return hit / total


def _reachable(walkable, start):
    """walkable(マスの集合) の上を start から歩いて行ける範囲。"""
    seen = {start}
    stack = [start]
    while stack:
        cx, cy = stack.pop()
        for dx, dy in ((0, 1), (0, -1), (1, 0), (-1, 0)):
            n = (cx + dx, cy + dy)
            if n in seen or n not in walkable:
                continue
            seen.add(n)
            stack.append(n)
    return seen


def derive_lava_blocks():
    """溶岩に塗られたマスを walkable_tiles から外し、当たり判定に変える。"""
    for name in LAVA_LAYOUTS:
        layout_path = OUT_DATA / f"{name}.json"
        image_path = OUT_IMG / f"{name}.png"
        if not layout_path.exists() or not image_path.exists():
            raise SystemExit(f"[ERROR] {name}: レイアウトか絵が先に出力されていません")

        data = json.loads(layout_path.read_text(encoding="utf-8"))
        tile = data.get("tile_px", 64)
        im = Image.open(image_path).convert("RGB")
        px = im.load()
        cols, rows = data["map_tiles"]
        if im.size != (cols * tile, rows * tile):
            raise SystemExit(
                f"[ERROR] {name}: 絵 {im.size} と map_tiles {data['map_tiles']} x {tile}px が合いません"
            )

        walk = [tuple(t) for t in data["walkable_tiles"]]
        up = tuple(data["stairs"]["up"])
        down = tuple(data["stairs"]["down"])

        frac = {t: _molten_fraction(px, t[0], t[1], tile) for t in walk}
        # 階段のマスは絶対にふさがない。ふさぐとフロアに入った瞬間に詰む。
        for t in (up, down):
            if frac.get(t, 0) > LAVA_MIN_FRACTION:
                raise SystemExit(
                    f"[ERROR] {name}: 階段のマス {t} が溶岩に塗られています "
                    f"(溶岩率 {frac[t]:.0%})。絵かレイアウトのどちらかが間違っています。"
                )
        lava = {t for t in walk if frac[t] > LAVA_MIN_FRACTION} - {up, down}

        # 階段どうしが行き来できるか。できないなら、いちばん薄い溶岩マスから
        # 順に足場として開け直す。
        bridges = []
        while True:
            open_tiles = set(walk) - lava
            if down in _reachable(open_tiles, up):
                break
            if len(bridges) >= LAVA_BRIDGE_MAX:
                raise SystemExit(
                    f"[ERROR] {name}: 溶岩をふさぐと下り階段 {down} へ行けません。"
                    f" 足場を {LAVA_BRIDGE_MAX} マス開けても つながりませんでした。"
                    f" 絵とレイアウトが食い違っています(この地形は出荷できません)。"
                )
            here = _reachable(open_tiles, up)
            # 開け直す1マスを選ぶ。到達範囲がいちばん広がるものを取り、
            # 同点なら溶岩が薄いほう。毎回同じ答えになるよう最後は座標で決める。
            best = None
            for t in sorted(lava, key=lambda t: (frac[t], t)):
                gain = len(_reachable(open_tiles | {t}, up)) - len(here)
                if best is None or gain > best[0]:
                    best = (gain, t)
            spot = best[1]
            if frac[spot] > LAVA_BRIDGE_MAX_FRACTION:
                raise SystemExit(
                    f"[ERROR] {name}: 足場に開け直すしかないマス {spot} が"
                    f" 溶岩率 {frac[spot]:.0%} です(上限 {LAVA_BRIDGE_MAX_FRACTION:.0%})。"
                    f" 通路がまるごと溶岩の下です。"
                )
            lava.discard(spot)
            bridges.append((spot, frac[spot]))

        kept = [t for t in walk if t not in lava]
        data["walkable_tiles"] = [list(t) for t in kept]
        data["collisions"] = list(data.get("collisions", [])) + [
            {"name": LAVA_COLLISION_NAME, "rect_tiles": [t[0], t[1], 1, 1]}
            for t in sorted(lava)
        ]
        layout_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

        reach = len(_reachable(set(kept) | {up, down}, up))
        print(
            f"lava  {name:26} 溶岩 {len(lava)} マスを通行止め "
            f"({len(walk)} -> {len(kept)} マス / 階段から {reach} マス到達)"
        )
        for spot, f in bridges:
            print(
                f"      [WARN] {name}: マス{spot} は溶岩 {f:.0%} だが、ここを塞ぐと"
                f" 下り階段へ行けなくなるため 足場として残した"
            )


# --- ダンジョンに置く宝箱 -------------------------------------------------
# objects_furniture_items の2行目が「閉じた宝箱 / 開いた宝箱」。
# 閉と開で絵の大きさが変わると開けた瞬間に宝箱が伸び縮みして見えるので、
# 2枚ぶんの外接矩形の**和**で切ってから、同じ倍率で縮める。
OBJECT_SHEET = "objects_furniture_items"
CHEST_CELLS = [("chest_closed", "r02_c01"), ("chest_open", "r02_c02")]
CHEST_PX = 60  # 1マス64pxの中に収める


def build_chests():
    cells = {name: Image.open(SRC / "sprites_256" / OBJECT_SHEET / f"{cell}.png").convert("RGBA")
             for name, cell in CHEST_CELLS}
    box = None
    for im in cells.values():
        b = im.getbbox()
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3])
        )
    cw, ch = box[2] - box[0], box[3] - box[1]
    scale = CHEST_PX / max(cw, ch)
    tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))
    out_dir = OUT_IMG / "objects"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, im in cells.items():
        im.crop(box).resize((tw, th), Image.LANCZOS).save(out_dir / f"{name}.png", optimize=True)
        print(f"obj   {name:26} bbox={box} -> {tw}x{th}")


# --- ダンジョンの階段 -----------------------------------------------------
# dungeon_transitions_v2 の1行目が「上り階段 / 下り階段 / はしご」。
# フロアの絵に焼き込まれているのと同じ絵で、こちらは背景が透明。
#
# 出力は 1マス(64px)ちょうど。焼き込みは 2x2マスぶんあって、宝箱・どうぐ・
# 人物だけが 64px グリッドに乗っている状態だった。階段だけ倍の大きさだと
# 「どのマスが階段なのか」がぱっと見で分からない。
STAIRS_SHEET = "dungeon_transitions_v2"
STAIRS_CELLS = [("stairs_up", "r01_c01"), ("stairs_down", "r01_c02")]
STAIRS_PX = 64  # = TILE。1マスにぴったり収める


def build_stairs():
    out_dir = OUT_IMG / "objects"
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, cell in STAIRS_CELLS:
        im = Image.open(SRC / "sprites_256" / STAIRS_SHEET / f"{cell}.png").convert("RGBA")
        box = im.getbbox()
        if box is None:
            raise SystemExit(f"[ERROR] {STAIRS_SHEET}/{cell} が空です")
        cropped = im.crop(box)
        cw, ch = cropped.size
        # 長いほうを64pxに合わせる。上り階段は横長・下り階段はほぼ正方形なので、
        # max で合わせておけば どちらも1マスからはみ出さない。
        scale = STAIRS_PX / max(cw, ch)
        tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))
        cropped.resize((tw, th), Image.LANCZOS).save(out_dir / f"{name}.png", optimize=True)
        print(f"obj   {name:26} bbox={box} -> {tw}x{th}")


# --- どうぐのアイコン -----------------------------------------------------
# 素材は 1枚 = 216x216 の独立キャンバス(item_icons_216/manifest.json)。
# 中身は「余白12px・中央そろえ」で描かれているので、切り抜かずに
# キャンバスごと縮める。切り抜いてから合わせると、素材ごとに絵の大きさが
# バラバラになる(小さい種と大きい杖が同じ寸法で並んでしまう)。
#
# 縮め方は NEAREST。この素材は 216px の格子に乗った拡大ドット絵ではなく
# 216px で描かれた絵なので、LANCZOS だと輪郭がにじんでドット絵に見えなくなる
# (実際に見比べて NEAREST を選んだ)。
ITEM_ICON_SRC = SRC / "item_icons_216" / "png"

# 素材集の外から来たアイコン。せいすい は最初の25枚を発注したあとに
# 足したどうぐで、あとから単体で描いてもらった (216x216 で寸法は同じ)。
# 素材集そのものには書き込めないので、置き場だけ別にして扱いは同じにする。
ITEM_ICON_EXTRA = [GRASSLAND_SRC / "26_seisui.png"]

# 出力の大きさ。使う所はどれも小さい:
#   ダンジョンの床  … 1マス64pxの中に置く
#   ふくろ          … 一覧のタイル
#   戦闘のどうぐ欄  … 行の頭
# 48pxあれば床置き(64pxマス)で等倍のまま出せて、UI側は縮小だけで済む。
ITEM_ICON_PX = 48

# お金のアイコン。objects_furniture_items の4行2列が「お金」(素材集のREADME)。
GOLD_CELL = ("objects_furniture_items", "r04_c02")
GOLD_ICON_PX = 48


def icon_slug(stem):
    """'04_sekaiju_no_shizuku' -> 'sekaijunoshizuku' (items.json の id と同じつづり)。"""
    return stem.split("_", 1)[1].replace("_", "")


def build_item_icons():
    """
    どうぐアイコンを縮めて出し、items.json の icon 欄を埋める。

    素材と items.json の対応は **名前で** 取る。ファイル名の連番順に
    上から当てていくと、items.json に1行足された日に全部がずれる
    (実際 せいすい は絵を発注したあとに足された)。
    絵の無いどうぐは icon: null のままにして、UI側で代わりの見た目を出す。
    """
    items = json.loads(ITEMS_JSON.read_text(encoding="utf-8"))
    by_id = {it["id"]: it for it in items}
    OUT_ITEM_IMG.mkdir(parents=True, exist_ok=True)

    pngs = sorted(ITEM_ICON_SRC.glob("*.png"))
    if not pngs:
        raise SystemExit(f"[ERROR] どうぐアイコンが見つかりません: {ITEM_ICON_SRC}")
    for extra in ITEM_ICON_EXTRA:
        if not extra.exists():
            raise SystemExit(f"[ERROR] 追加のどうぐアイコンが見つかりません: {extra}")
        pngs.append(extra)

    matched = 0
    for path in pngs:
        item_id = f"item_{icon_slug(path.stem)}"
        item = by_id.get(item_id)
        if item is None:
            raise SystemExit(
                f"[ERROR] {path.name} に対応する どうぐが items.json にありません "
                f"(推定id: {item_id})。素材名かどうぐidのどちらかが変わっています。"
            )
        im = Image.open(path).convert("RGBA")
        im.resize((ITEM_ICON_PX, ITEM_ICON_PX), Image.NEAREST).save(
            OUT_ITEM_IMG / f"{item_id}.png", optimize=True
        )
        item["icon"] = f"/assets/items/{item_id}.png"
        matched += 1
        print(f"item  {item_id:26} <- {path.name}  {im.size} -> {ITEM_ICON_PX}px")

    # 絵の無いどうぐ。null のままにして「絵が来ていない」ことを明示する。
    # (2026-08-31 の せいすい 到着で 26/26 そろったが、今後どうぐを足したときに
    #  また出る。UI側 (components/Common/ItemIcon.jsx) の代わりの見た目は残す。)
    missing = [it["name"] for it in items if not it.get("icon")]
    for it in items:
        if not it.get("icon"):
            it["icon"] = None

    ITEMS_JSON.write_text(
        json.dumps(items, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"item  items.json の icon を {matched}/{len(items)} 件 更新")
    if missing:
        print(f"item  絵の無いどうぐ ({len(missing)}件): {'、'.join(missing)}")


def build_gold_icon():
    """お金のアイコン。四角に収まるよう、外接矩形で切ってから縮める。"""
    sheet, cell = GOLD_CELL
    im = Image.open(SRC / "sprites_256" / sheet / f"{cell}.png").convert("RGBA")
    box = im.getbbox()
    if box is None:
        raise SystemExit(f"[ERROR] {sheet}/{cell} が空です")
    cropped = im.crop(box)
    cw, ch = cropped.size
    scale = GOLD_ICON_PX / max(cw, ch)
    tw, th = max(1, round(cw * scale)), max(1, round(ch * scale))
    canvas = Image.new("RGBA", (GOLD_ICON_PX, GOLD_ICON_PX), (0, 0, 0, 0))
    canvas.paste(
        cropped.resize((tw, th), Image.NEAREST),
        ((GOLD_ICON_PX - tw) // 2, (GOLD_ICON_PX - th) // 2),
    )
    OUT_UI_IMG.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT_UI_IMG / "gold.png", optimize=True)
    print(f"ui    gold.png                   <- {sheet}/{cell}  bbox={box} -> {tw}x{th}")


def build_title():
    """表紙の絵。

    incoming/title/ に2案 届いている。

      title_wide_1920.png    … 上半分が空。**表紙に使うのはこちら**。
                               題と「はじめから／つづきから」を空に置けば、
                               モンスターにも地面にも一切かからない。
      title_closeup_1920.png … 寄りの構図。上まで山と人物で埋まっていて
                               題を置く場所が無い。README や紹介画像のために
                               リポジトリへは残してあるが、ゲームには入れない。

    ドット絵の質感を残したいので、縮小も加工もせずそのまま写す
    (1920x1080。表紙は1枚しか読まないので大きさは許容範囲)。
    """
    src = INCOMING / "title" / "title_wide_1920.png"
    if not src.exists():
        raise SystemExit(f"[ERROR] 表紙の絵がありません: {src}")
    OUT_UI_IMG.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, OUT_UI_IMG / "title.png")
    with Image.open(src) as im:
        w, h = im.size
    print(f"ui    title.png                  <- {src.name}  {w}x{h}")



# --- エリアマップの丸アイコン -------------------------------------------
#
# ダンジョン選択が「12枚のカード一覧」から「5つのエリアを横に辿る地図」に
# なった。地図に置くのは丸いアイコン1個ずつ。
#
# 新しく絵を描き起こすのではなく、**戦闘背景をそのまま丸く抜く**。
# 同じ絵が戦闘でも出るので、地図のアイコンと実際に立つ場所が一致する。
#
# 切り出す枠は地形ごとに手で決めてある(下の AREA_CROPS)。背景は
# 1024x768 の横長で、真ん中は「モンスターが立つための空き地」として
# わざと平らに描かれている。中央をそのまま抜くと、どの地形も
# 「のっぺりした床」にしか見えない。地形が一目で分かる特徴
# (草原の木、洞窟の水晶、神殿の扉、雪山の峰、火口の溶岩)が
# 入る位置を選んである。
#
#   値は元画像(1024x768)の (left, top, size) で、正方形を切る。
AREA_CROPS = {
    # 左端の大木と、その下の草地。空・山・草の三層が入る。
    "grassland": (0, 40, 480),
    # 天井から下がる鍾乳石と、床ぎわの青い水晶。中央の平らな土は避ける。
    "cave": (60, 0, 400),
    # 正面の飾り扉と両脇の柱。神殿だと分かるのはここだけ。
    "ancient_ruins": (270, 20, 480),
    # 尖った峰と、その手前の雪原。左端の針葉樹も少し入れる。
    "snow_mountain": (100, 140, 480),
    # 右手の溶岩の滝と、手前の割れた床を流れる赤い筋。
    "lava_cavern": (300, 60, 400),
}

# 書き出す大きさ。地図では 60〜110px で出すので、2倍見当あれば足りる。
AREA_ICON_PX = 192

# 縁のなめらかさ。この倍率でマスクを描いてから縮めることで、
# 丸のふちのギザギザを消す(ドット絵のままでは丸が階段になる)。
AREA_MASK_SS = 4


def build_area_icons():
    """戦闘背景を丸く抜いて、エリア地図のアイコンにする。"""
    from PIL import ImageDraw

    OUT_AREA_IMG.mkdir(parents=True, exist_ok=True)
    px = AREA_ICON_PX
    mask = Image.new("L", (px * AREA_MASK_SS, px * AREA_MASK_SS), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, mask.size[0] - 1, mask.size[1] - 1), fill=255)
    mask = mask.resize((px, px), Image.LANCZOS)

    for name, (left, top, size) in AREA_CROPS.items():
        src = BATTLE_BG_IMG / f"{name}.png"
        if not src.exists():
            raise SystemExit(f"[ERROR] 戦闘背景がありません: {src}")
        im = Image.open(src).convert("RGB")
        w, h = im.size
        if left + size > w or top + size > h:
            raise SystemExit(f"[ERROR] {name}: 切り出し枠が絵({w}x{h})からはみ出している")
        crop = im.crop((left, top, left + size, top + size)).resize((px, px), Image.LANCZOS)
        out = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        out.paste(crop, (0, 0))
        out.putalpha(mask)
        out.save(OUT_AREA_IMG / f"{name}.png", optimize=True)
        print(f"area  {name + '.png':26} <- battle_bg  crop=({left},{top},{size}) -> {px}x{px}")


def main():
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    OUT_DATA.mkdir(parents=True, exist_ok=True)

    for src, name in MAP_IMAGES:
        shutil.copyfile(src, OUT_IMG / name)
        print(f"img   {name:26} <- {src.name}")

    for src, name in MAP_LAYOUTS:
        data = json.loads(src.read_text(encoding="utf-8"))
        drop = STRIP_COLLISIONS.get(name)
        if drop:
            before = len(data.get("collisions", []))
            data["collisions"] = [c for c in data.get("collisions", []) if c.get("name") not in drop]
            print(f"strip {name:26} collisions {before} -> {len(data['collisions'])}  ({', '.join(drop)})")
        (OUT_DATA / name).write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        print(f"json  {name:26} <- {src.name}")

    for out_name, sheet, row in CHARACTERS:
        box, size = build_character(out_name, sheet, row)
        print(f"char  {out_name:26} row{row} of {sheet}  bbox={box} -> {size}")

    build_residents()
    build_chests()
    build_stairs()
    build_props()
    build_effects()
    erase_baked_figures()
    # 絵からの導出。納品JSONではなく、書き出したあとのレイアウトを作り直す。
    derive_lava_blocks()
    build_item_icons()
    build_gold_icon()
    build_title()
    build_area_icons()
    print(
        f"\n出力: {OUT_IMG}  /  {OUT_DATA}  /  {OUT_ITEM_IMG}  /  {OUT_UI_IMG}"
        f"  /  {OUT_FX_IMG}"
    )


if __name__ == "__main__":
    main()
