#!/usr/bin/env python3
"""重複判定・10タイプ・仮名を統合したモンスター台帳を生成する。"""

from __future__ import annotations

import base64
import csv
import json
import re
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
CATALOG = ROOT.parent / "monster_catalog_330.html"
SPRITES = ROOT / "step1_normalized" / "sprites"
OUT = ROOT / "step2_dedup"

TYPES = ["スライム", "ドラゴン", "けもの", "鳥翼", "自然", "むし", "水棲", "物質", "不死", "幻魔"]

# 似ているだけで削除はしない。各クラスターで代表だけを採用し、他は除外候補または保留にする。
CLUSTERS = [
    ("D001", "葉角の子ジカ", "U1-16", ["U2-25"]),
    ("D002", "大耳の紫コウモリ", "U2-17", ["U3-06"]),
    ("D003", "泡を出す青スライム", "U6-01", ["U3-01", "U5-01"]),
    ("D004", "雲の体のクラゲ", "U1-05", ["U3-26"]),
    ("D005", "旅装キノコ", "U2-14", ["U3-23"]),
    ("D006", "青いチョウチンアンコウ", "U1-06", ["U2-30", "U6-18"]),
    ("D007", "青い海竜", "U4-21", ["U5-07", "U6-24"]),
    ("D008", "氷の白フクロウ", "U1-28", ["U2-27"]),
    ("D009", "火山を背負う溶岩ガメ", "U4-13", ["U5-24"]),
    ("D010", "炎をまとう黒い鳥", "U5-10", ["U3-16"]),
    ("D011", "泥をまとうカエル", "U1-19", ["U3-12"]),
    ("D012", "大口の食虫植物", "U1-26", ["U2-28", "U6-05"]),
    ("D013", "苔むした丸岩ゴーレム", "U2-03", ["U3-27", "U6-09"]),
    ("D014", "青い鬼火のガイコツ", "U1-08", ["U3-10"]),
    ("D015", "青い水カタツムリ", "U2-06", ["U3-07"]),
    ("D016", "王冠とローブのスライム王", "U4-01", ["U5-30", "U6-30"]),
    ("D017", "王冠と杖のリッチ王", "U4-23", ["U6-29"]),
    ("D018", "金青装飾の白い猛禽", "U4-02", ["U5-06"]),
]

HOLD = {
    "U1-18": "ランタン幽霊がU2-29と役割重複。輪郭差を再確認",
    "U2-01": "葉付きスライムがU1-01と近い。色違い運用なら採用可能",
    "U4-07": "海竜群と近いが、青赤配色と泡表現には独自性あり",
    "U6-02": "汎用的な緑翼竜。基本種として必要か検討",
    "U6-03": "汎用的な大ワシ。鳥翼タイプの基本種枠として検討",
    "U6-12": "汎用的な青オオカミ。基本種として必要か検討",
    "U6-17": "汎用的な赤傘キノコ。U2-14との差別化を検討",
    "U6-23": "汎用的な毒スライム。属性違い枠として検討",
    "U6-25": "顔のある巨木。既存樹人群との差別化を検討",
    "U6-27": "汎用的な緑羽妖精。役割または小物を追加すると強い",
    "G3-30": "方位磁針モチーフが上位群にも多い",
    "G4-11": "巨人・建築モチーフが上位内で過密",
    "G4-14": "時計・方位盤・巨像モチーフが過密",
    "G4-22": "巨像モチーフが上位内で過密。遊園地部分は独自",
    "G4-25": "巨像モチーフが上位内で過密。星空球部分は独自",
    "G4-27": "方位磁針モチーフが複数階級に存在",
    "G4-29": "建築巨人モチーフが上位内で過密",
    "G5-02": "王・皇帝系の人数調整候補",
    "G5-05": "王・皇帝系の人数調整候補",
    "G5-08": "王・皇帝系の人数調整候補",
    "G5-09": "王・皇帝系の人数調整候補",
    "G5-13": "王・皇帝系の人数調整候補。生きた玉座は独自",
    "G5-18": "王・女王系の人数調整候補。地平線モチーフは独自",
    "G5-27": "王系の人数調整候補。夢劇場モチーフは独自",
    "G5-29": "皇帝系の人数調整候補。操り人形モチーフは独自",
}

# 保留は今回の整理で必ず採用か除外候補へ確定する。
FINAL_STATUS_OVERRIDES = {
    "U1-18": ("除外候補", "U2-29のランタン幽霊を採用。こちらは役割重複"),
    "U2-01": ("除外候補", "葉付きの青緑スライムで既存作品を連想しやすい"),
    "U4-07": ("除外候補", "U4-21の海竜を採用。海竜の役割が重複"),
    "U6-02": ("除外候補", "汎用的な翼竜で、竜族内の個性が弱い"),
    "U6-03": ("除外候補", "汎用的な大ワシで、鳥翼族内の個性が弱い"),
    "U6-12": ("除外候補", "汎用的な青オオカミで、けもの族内の個性が弱い"),
    "U6-17": ("除外候補", "赤傘キノコはU2-14の旅キノコを優先"),
    "U6-23": ("除外候補", "ドラクエ系のスライムを連想しやすい"),
    "U6-25": ("除外候補", "巨木系の役割が重複。U5-14を優先"),
    "U6-27": ("除外候補", "妖精系の役割が重複。U5-23を優先"),
    "G3-30": ("採用", "機械方位盤の中位代表。下位G1-14と最上位G5-24は別の役割"),
    "G4-11": ("除外候補", "建築巨人系の密度調整。G4-22を優先"),
    "G4-25": ("除外候補", "巨像系の密度調整。G4-22を優先"),
    "G4-14": ("除外候補", "巨像系の密度調整。遊園地を背負うG4-22を優先"),
    "G4-22": ("採用", "遊園地を背負う独自性があり、巨像系の代表にする"),
    "G4-27": ("除外候補", "方位盤系は中位G3-30と最上位G5-24を優先"),
    "G4-29": ("除外候補", "城塞巨人系の密度調整。G4-22を優先"),
    "G5-02": ("除外候補", "黄金王系の中で一般的。個性の強い王を優先"),
    "G5-05": ("採用", "嵐の皇帝として王系の中でも属性と人格が独立"),
    "G5-08": ("採用", "剣を持つ覇王として戦闘系の頂点を担当"),
    "G5-09": ("採用", "氷宮と女帝の組み合わせが明確"),
    "G5-13": ("採用", "生きた玉座という物質・魔王融合の個性が強い"),
    "G5-18": ("採用", "天空と大地をまとう地平の女王として独立"),
    "G5-27": ("採用", "夢劇場という舞台型の最上位として独立"),
    "G5-29": ("採用", "宇宙操り人形の皇帝として独立"),
    # 青い笑顔の球体など、既存作品を強く連想するスライム型は除外する。
    "U1-01": ("除外候補", "ドラクエ系の青スライムを連想しやすい"),
    "U1-20": ("除外候補", "ドラクエ系の色違いスライムを連想しやすい"),
    "U2-20": ("除外候補", "ドラクエ系の青スライムを連想しやすい"),
    "U6-01": ("除外候補", "ドラクエ系の笑顔スライムを連想しやすい"),
    "U4-01": ("除外候補", "キングスライム系を強く連想しやすい"),
}

TYPE_KEYWORDS = {
    "スライム": ["スライム", "影だまり", "インク染み", "もちの生物", "しずく"],
    "ドラゴン": ["ドラゴン", "竜", "翼竜", "海竜", "天竜", "ヒドラ", "大蛇"],
    "むし": ["甲虫", "昆虫", "イモムシ", "ダンゴムシ", "ハチ", "蝶", "蛾", "クモ", "サソリ", "ムカデ"],
    "水棲": ["クラゲ", "アンコウ", "魚", "カタツムリ", "巻貝", "ヤドカリ", "カニ", "カエル", "カワウソ", "クジラ", "サンゴ", "海"],
    "鳥翼": ["カラス", "フクロウ", "小鳥", "鳥", "猛禽", "大ワシ", "フェニックス", "グリフォン", "羽根", "天使"],
    "自然": ["食虫植物", "植物", "花", "サボテン", "キノコ", "樹", "切り株", "カボチャ", "葉の", "森", "松ぼっくり", "綿毛", "クルミ", "雪の結晶", "露玉", "湯気", "香りの雲"],
    "けもの": ["モグラ", "子ジカ", "シカ", "キツネ", "ウサギ", "カメ", "カワウソ", "子犬", "獣", "ヒツジ", "ネズミ", "イノシシ", "オオカミ", "獅子", "ゾウ", "白狐"],
    "不死": ["ゾンビ", "ガイコツ", "ドクロ", "幽霊", "霊体", "死神", "リッチ", "鬼火", "虚無"],
    "物質": ["ゴーレム", "ミミック", "機械", "時計", "歯車", "巨像", "巨人", "騎士", "戦士", "人形", "城", "宮殿", "大聖堂", "列車", "炉", "箱", "道標", "標識", "タイル", "磁石", "ファスナー", "ぜんまい", "糸巻き", "ティーカップ", "懐中時計", "郵便", "紙飛行機", "長靴", "パレット", "方位", "サイコロ", "しおり", "ベル", "ハーモニカ", "消しゴム", "扇子", "安全ピン", "ほうき", "弁当", "砂時計", "紙舟", "ボトル", "巻尺", "ボタン", "信号機", "折り鶴", "ゴム印", "ビー玉", "塩入れ", "プレッツェル", "パンケーキ", "チーズ", "ポップコーン", "紙吹雪", "チョーク", "ヨーヨー", "傘", "レコード", "ミシン", "掃除機", "カメラ", "自動販売機", "工具", "風車", "回転木馬", "ケーキ", "オーブン", "ヤカン", "チェス", "ローラー", "鏡", "鐘", "船", "ピアノ", "ルーレット", "凧", "望遠鏡", "太鼓", "天球儀", "織る", "巻物柱", "方位盤", "劇場", "天球環", "門"],
}

TYPE_PRIORITY = ["スライム", "ドラゴン", "不死", "むし", "水棲", "鳥翼", "自然", "けもの", "物質"]

BASE_NAMES = [
    ("チョウチンアンコウ", "アングラー"), ("食虫植物", "トラッププラント"), ("カタツムリ", "スネイル"),
    ("ダンゴムシ", "ダンゴロ"), ("イモムシ", "キャタル"), ("ガーゴイル", "ガーゴ"), ("ゴブリン", "ゴブ"),
    ("フェニックス", "フェニクス"), ("グリフォン", "グリフ"), ("海竜", "マリドラ"), ("天竜", "セレスドラ"),
    ("翼竜", "ワイバン"), ("ヒドラ", "ヒドラ"), ("大蛇", "サーペント"), ("恐竜", "サウル"),
    ("ドラゴン", "ドラゴ"), ("スライム", "スライム"),
    ("ガイコツ", "スカル"), ("ドクロ", "スカル"), ("ゾンビ", "ゾン"), ("リッチ", "リッチ"), ("死神", "リーパー"),
    ("ゴーレム", "ゴレム"), ("コウモリ", "バット"), ("フクロウ", "オウル"), ("カラス", "クロウ"),
    ("大ワシ", "イーグル"), ("猛禽", "ラプタ"), ("小鳥", "ピピット"), ("鳥", "バード"),
    ("イノシシ", "ボア"), ("オオカミ", "ウルフ"), ("キツネ", "フォクス"), ("ウサギ", "ラビ"),
    ("ヒツジ", "ラム"), ("モグラ", "モール"), ("子ジカ", "フォーン"), ("神鹿", "セントスタッグ"),
    ("シカ", "スタッグ"), ("ネズミ", "マウス"), ("子犬", "パピー"), ("トカゲ", "リザ"), ("ヘビ", "スネーク"),
    ("クラゲ", "メデュラ"), ("カエル", "フロッグ"), ("カメ", "タートル"), ("カニ", "クラブ"),
    ("ヤドカリ", "ハーミット"), ("魚", "フィン"), ("クジラ", "ホエル"), ("巻貝", "シェル"),
    ("キノコ", "マッシュ"), ("サボテン", "カクタス"), ("カボチャ", "パンプ"), ("樹", "トレント"),
    ("甲虫", "ビートル"), ("ハチ", "ビー"), ("クモ", "スパイダ"), ("サソリ", "スコルピ"), ("蝶", "パピヨ"), ("蛾", "モス"),
    ("小悪魔", "インプ"), ("悪魔", "デモン"), ("妖精", "フェイ"), ("魔女", "ウィッチ"),
    ("魔王", "デモンロード"), ("女王", "クイーン"), ("皇帝", "エンペラー"), ("獣王", "ビーストキング"),
    ("王", "キング"), ("神", "ディヴァ"), ("騎士", "ナイト"), ("戦士", "ウォード"),
    ("守護者", "ガーディア"), ("支配者", "ドミナ"), ("観測神", "オラクル"), ("機械神", "デウスマキナ"),
    ("賢者", "セージ"), ("聖女", "セインティア"), ("暴君", "タイラント"), ("覇王", "カイザー"),
    ("女帝", "エンプレス"), ("巨像", "コロッサ"), ("巨人", "ギガント"), ("生物", "モン"),
    ("ロウソク", "キャンド"), ("精", "ピリカ"), ("霊体", "レイス"),
]

PREFIXES = [
    (["世界", "現実", "次元", "異次元", "無限"], "アルカ"), (["宇宙", "星", "天球", "星雲"], "アストラ"),
    (["太陽", "陽気", "光", "聖"], "ソル"), (["月", "夜"], "ルナ"), (["黒穴", "深淵", "虚無", "影", "黒紫"], "ノクス"),
    (["氷", "雪", "白い"], "フロスト"), (["炎", "火", "溶岩", "火山", "赤い"], "フレア"),
    (["水", "泡", "海", "青い"], "アクア"), (["雷", "嵐"], "ボルト"), (["葉", "花", "苔", "森", "緑"], "リーフ"),
    (["金", "黄金", "王冠"], "ゴルド"), (["紫", "呪", "毒"], "ヴェノ"), (["時計", "歯車", "機械"], "クロノ"),
    (["音", "鐘", "楽器", "太鼓", "ピアノ"], "ソナ"), (["鏡"], "ミラ"), (["虹", "多色"], "プリズム"),
]

OBJECT_NAMES = {
    "ボタン甲虫": "ボタンビートル", "指ぬき帽子の小悪魔": "シンブルインプ", "折りたたみ傘の精": "カサコロリ",
    "ファスナーの虫": "ジッパグ", "ヨーヨーとコードの生物": "ヨヨロン", "ぜんまい人形": "ゼンマイドール",
    "糸巻きの精": "イトマキン", "ティーカップの生物": "カップルル", "懐中時計の子": "トキッコ",
    "郵便箱ミミック": "ポストン", "紙飛行機の精": "ペーパウィン", "長靴の生物": "ブーツン",
    "絵の具パレットの精": "パレットン", "方位磁針の生物": "コンパッサ", "サイコロの子": "ダイスン",
    "赤いしおりの精": "シオリン", "ハンドベルの生物": "ベルル", "ハーモニカの生物": "ハモニカン",
    "消しゴムの生物": "ケシゴムン", "扇子の精": "センスイ", "磁石の機械生物": "マグネッチ",
    "安全ピンの生物": "ピンコ", "ほうきの精": "ホウキッド", "弁当箱ミミック": "ベントン",
    "砂時計の精": "スナドキン", "模様タイルの生物": "タイロック", "紙舟の精": "フネポン",
    "ソープボトルの生物": "ソプル", "巻尺の生物": "メジャリン", "ボタン集合体": "ボタンボール",
    "小さな影だまり": "カゲプル", "反響する音のリボン": "エコリボン", "虹色のかけら": "ニジカケラ",
    "太陽光の綿毛": "ヒダマリワタ", "オーロラの渦": "オロロール", "尾を引く小隕石": "コメットン",
    "雪の結晶の子": "ユキモン", "露玉の精": "ツユコロ", "紙吹雪の塊": "カミフブク",
    "チョーク粉の精": "チョクモク", "黒いインク染み": "インクル", "白い湯気の精": "ユゲポワ",
    "塩入れの生物": "シオフリコ", "ポップコーンの精": "ポンコーン", "白いもちの生物": "モチプル",
    "プレッツェルの生物": "プレッツン", "マント付きパンケーキ": "パンケープ", "チーズ片の生物": "チズチュウ",
    "クルミ殻の精": "クルミット", "巻貝の精": "マキガイラ", "サンゴ鐘の生物": "サンゴベル",
    "松ぼっくりの精": "マツコロン", "虹色のシャボン玉": "ニジアワワ", "白い羽根の生物": "ハネポン",
    "足跡の影": "アシカゲ", "信号機の生物": "シグナロン", "折り鶴の精": "オリヅルン",
    "ゴム印の生物": "ハンコロン", "虹色ビー玉の生物": "ビーダマンボ", "香りの雲": "カオリグモ",
}

NAME_OVERRIDES = {
    "U2-08": "ヴェノスカル", "U2-11": "ウィッチクロウ", "U2-17": "オオミミバット",
    "U2-18": "クリスタスネイル", "U2-20": "アワシズク", "U3-19": "シロツノラム",
    "U3-20": "スモークシェイド", "U3-21": "クリスタアクアン", "U3-24": "フロストラム",
    "U3-28": "ポットスライム", "U4-09": "フォレストクイーン", "U4-11": "コズミックアビス",
    "U4-14": "ウィスプキュウビ", "U4-18": "ロータスクイーン", "U4-21": "ゴルドマリドラ",
    "U4-24": "ギガトラップ", "U4-27": "ギアトレント", "U5-05": "マジックメデュラ",
    "U5-09": "ベロボックス", "U5-12": "ブックゴレム", "U5-14": "アイ・トレント",
    "U5-22": "マーシュトレント", "U5-23": "プリズムフェイ", "U5-25": "クラウドスパイク",
    "U5-27": "ツインマリドラ", "U5-28": "アストラスタッグ", "U6-01": "ニコスライム",
    "U6-08": "アイバット", "U6-12": "アズールウルフ", "U6-14": "ベロゴースト",
    "U6-15": "アーマータートル", "U6-17": "アカカサマッシュ", "U6-23": "ヴェノスライム",
    "U6-25": "フェイストレント", "U6-27": "グリーンフェイ", "G3-02": "ポットゴレム",
    "G3-10": "サインゴレム", "G3-14": "ディスクウォード", "G3-17": "スノードームゴレム",
    "G3-20": "ポストゴレム", "G3-21": "ケーキナイト", "G3-24": "ルークナイト",
    "G4-04": "テンペストシップ", "G4-05": "ボルトレイン", "G4-09": "メテオフォージ",
    "G4-11": "スカイスクレイパー", "G4-16": "パペットキング", "G4-17": "ルーレット魔王",
    "G4-20": "テンペストワイバン", "G5-01": "ホワイトキング", "G5-08": "クリムゾンカイザー",
    "G5-10": "ビーストキング", "G5-12": "マスカレイドキング", "G5-18": "ホライゾンクイーン",
    "G5-24": "インフィニティコンパス", "G5-27": "ドリームシアター", "G5-28": "オービットデウス",
    "G5-30": "セクスタガーディア",
}


def load_entries() -> list[dict]:
    html = CATALOG.read_text(encoding="utf-8")
    match = re.search(r"const entries=(.*?);\nconst storageKey", html, re.S)
    if not match:
        raise RuntimeError("catalog entries not found")
    return json.loads(match.group(1))


def normalize_tier(entry: dict) -> str:
    tier = entry["tier"]
    if "最上位" in tier: return "最上位"
    if "上位" in tier: return "上位"
    if "中位" in tier: return "中位"
    if "下位" in tier: return "下位"
    # U6は見た目の密度で暫定分類。能力には使わない。
    n = int(entry["id"].split("-")[1])
    return "下位" if n in {1, 8, 10, 14, 17, 18, 20, 23, 27} else ("中位" if n <= 20 else "上位")


def classify(description: str) -> tuple[str, list[str]]:
    matches = []
    for type_name, words in TYPE_KEYWORDS.items():
        if any(word in description for word in words):
            matches.append(type_name)
    primary = next((t for t in TYPE_PRIORITY if t in matches), "幻魔")
    # 生物が鎧や機械部品を持っていても主身体のタイプを維持し、物質は副タイプにする。
    tags = [t for t in matches if t != primary]
    return primary, tags


def working_name(description: str, monster_id: str) -> str:
    if monster_id in NAME_OVERRIDES:
        return NAME_OVERRIDES[monster_id]
    if description in OBJECT_NAMES:
        return OBJECT_NAMES[description]
    prefix = ""
    for words, value in PREFIXES:
        if any(word in description for word in words):
            prefix = value
            break
    base = ""
    for word, value in BASE_NAMES:
        if word in description:
            base = value
            break
    if not base:
        # 主モチーフを短く残し、説明文そのものにはしない。
        core = re.sub(r"(を|に|と|で|から|ごと|そのものの|ような|持つ|まとった|宿す|操る|囲まれた|背負う|背負った|浮かべる|現れた|生きた|巨大な|巨大|大型|小さな|小型)", "", description)
        core = core.replace("の", "").replace("白い", "").replace("青い", "").replace("黒い", "")
        base = core[:8]
    return (prefix + base)[:18]


def short_kana_name(description: str, monster_id: str) -> str:
    """正式名候補用。かな・カタカナ・長音だけ、最大8文字にする。"""
    raw = working_name(description, monster_id)
    kana = "".join(re.findall(r"[ぁ-ゖァ-ヺー]", raw))
    if not kana:
        kana = "モン" + "".join(re.findall(r"[ぁ-ゖァ-ヺー]", description))
    return kana[:8] or "モンスター"


def build_status(entries: list[dict]) -> dict[str, dict]:
    result = {entry["id"]: {"status": "採用", "cluster_id": "", "dedup_reason": "独自性を確認"} for entry in entries}
    for cid, label, keep, dropped in CLUSTERS:
        result[keep] = {"status": "採用", "cluster_id": cid, "dedup_reason": f"{label}の代表案"}
        for monster_id in dropped:
            result[monster_id] = {"status": "除外候補", "cluster_id": cid, "dedup_reason": f"{keep}と意匠・役割が近い"}
    for monster_id, reason in HOLD.items():
        if result[monster_id]["status"] == "採用":
            result[monster_id] = {"status": "保留", "cluster_id": "", "dedup_reason": reason}
    for monster_id, (status, reason) in FINAL_STATUS_OVERRIDES.items():
        result[monster_id] = {"status": status, "cluster_id": result[monster_id]["cluster_id"], "dedup_reason": reason}
    return result


def make_html(rows: list[dict], out_path: Path) -> None:
    payload = []
    for row in rows:
        item = dict(row)
        item["image"] = "data:image/png;base64," + base64.b64encode((SPRITES / f"{row['id']}.png").read_bytes()).decode()
        payload.append(item)
    data = json.dumps(payload, ensure_ascii=False)
    html = f'''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>モンスター統合台帳 330</title><style>
*{{box-sizing:border-box}}body{{margin:0;background:#0e1320;color:#e8edf6;font-family:system-ui,sans-serif}}header{{position:sticky;top:0;z-index:3;background:#151c2dcc;padding:14px 18px;backdrop-filter:blur(12px);border-bottom:1px solid #34415c}}h1{{font-size:20px;margin:0 0 10px}}.controls{{display:flex;gap:8px;flex-wrap:wrap}}select,input,button{{background:#202b43;color:#fff;border:1px solid #455573;border-radius:7px;padding:8px}}main{{padding:14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px}}.card{{background:#171f32;border:1px solid #34415c;border-radius:12px;overflow:hidden}}.card[data-status="除外候補"]{{opacity:.53}}.card[data-status="保留"]{{border-color:#c89535}}.pic{{height:205px;display:grid;place-items:center;background:repeating-conic-gradient(#20283a 0 25%,#182033 0 50%) 0/22px 22px}}.pic img{{width:200px;height:200px;object-fit:contain;image-rendering:pixelated}}.body{{padding:10px}}.id{{color:#91a4c5;font-size:12px}}h2{{font-size:17px;margin:4px 0}}p{{font-size:13px;margin:5px 0;color:#bcc7da}}.tags{{display:flex;gap:5px;flex-wrap:wrap}}.tag{{font-size:11px;background:#283654;border-radius:999px;padding:3px 7px}}.採用{{background:#1d684f}}.保留{{background:#8a6420}}.除外候補{{background:#7b343d}}.summary{{font-size:13px;color:#bcd}}
</style></head><body><header><h1>モンスター統合台帳（重複判定・10タイプ・仮名）</h1><div class="controls"><input id="q" placeholder="ID・名前・説明を検索"><select id="status"><option value="">全状態</option><option>採用</option><option>保留</option><option>除外候補</option></select><select id="type"><option value="">全タイプ</option>{''.join(f'<option>{t}</option>' for t in TYPES)}</select><select id="tier"><option value="">全階級</option><option>下位</option><option>中位</option><option>上位</option><option>最上位</option></select><button id="csv">CSV保存</button><span class="summary" id="summary"></span></div></header><main id="grid"></main><script>
const rows={data};const q=document.querySelector('#q'),status=document.querySelector('#status'),type=document.querySelector('#type'),tier=document.querySelector('#tier'),grid=document.querySelector('#grid'),summary=document.querySelector('#summary');
function esc(s){{return String(s).replace(/[&<>"']/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}}[c]))}}
function render(){{const needle=q.value.trim().toLowerCase();const f=rows.filter(r=>(!status.value||r.status===status.value)&&(!type.value||r.type===type.value)&&(!tier.value||r.tier===tier.value)&&(!needle||[r.id,r.working_name,r.description,r.dedup_reason].join(' ').toLowerCase().includes(needle)));summary.textContent=`表示 ${{f.length}} / 330体`;grid.innerHTML=f.map(r=>`<article class="card" data-status="${{r.status}}"><div class="pic"><img src="${{r.image}}"></div><div class="body"><div class="id">${{r.id}} · ${{r.tier}}</div><h2>${{esc(r.working_name)}}</h2><p>${{esc(r.description)}}</p><div class="tags"><span class="tag ${{r.status}}">${{r.status}}</span><span class="tag">${{r.type}}</span>${{r.secondary_types.map(x=>`<span class="tag">副:${{x}}</span>`).join('')}}</div><p>${{esc(r.dedup_reason)}}</p></div></article>`).join('')}}
[q,status,type,tier].forEach(x=>x.addEventListener('input',render));document.querySelector('#csv').onclick=()=>{{const keys=Object.keys(rows[0]).filter(k=>k!=='image');const body=[keys.join(','),...rows.map(r=>keys.map(k=>'"'+String(Array.isArray(r[k])?r[k].join('|'):r[k]).replaceAll('"','""')+'"').join(','))].join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+body],{{type:'text/csv'}}));a.download='monster_master_330.csv';a.click()}};render();
</script></body></html>'''
    out_path.write_text(html, encoding="utf-8")


def make_dedup_review(rows: list[dict], out_path: Path) -> None:
    by_id = {row["id"]: row for row in rows}
    width, row_h = 920, 142
    canvas = Image.new("RGB", (width, row_h * len(CLUSTERS)), "#0f1524")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    for i, (cluster_id, _label, keep, dropped) in enumerate(CLUSTERS):
        y = i * row_h
        draw.rectangle((0, y, width - 1, y + row_h - 1), outline="#34415c")
        draw.text((10, y + 8), cluster_id, fill="#9ad6ff", font=font)
        ids = [keep] + dropped
        for j, monster_id in enumerate(ids):
            x = 80 + j * 205
            sprite = Image.open(SPRITES / f"{monster_id}.png").convert("RGBA")
            sprite.thumbnail((116, 108), Image.Resampling.NEAREST)
            canvas.paste(sprite, (x + (116 - sprite.width) // 2, y + 26 + (108 - sprite.height) // 2), sprite)
            state = "KEEP" if monster_id == keep else "DROP?"
            color = "#70e0a5" if state == "KEEP" else "#ff9a9a"
            draw.text((x, y + 8), f"{monster_id} {state}", fill=color, font=font)
    canvas.save(out_path, quality=94)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    entries = load_entries()
    statuses = build_status(entries)
    used_names: Counter[str] = Counter()
    rows = []
    for entry in entries:
        primary, secondary = classify(entry["description"])
        name = short_kana_name(entry["description"], entry["id"])
        used_names[name] += 1
        if used_names[name] > 1:
            suffixes = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン"
            suffix = suffixes[(used_names[name] - 2) % len(suffixes)]
            name = (name[:7] + suffix)[:8]
            while name in {r["working_name"] for r in rows}:
                suffix = suffixes[(used_names[name] + len(rows)) % len(suffixes)]
                name = (name[:7] + suffix)[:8]
        row = {
            "id": entry["id"], "sheet_id": entry["sheetId"], "source_sheet": entry["sheetName"],
            "row": entry["row"], "col": entry["col"], "tier": normalize_tier(entry),
            "working_name": name, "description": entry["description"], "type": primary,
            "secondary_types": secondary, **statuses[entry["id"]],
            "name_status": "仮名・要レビュー", "type_status": "暫定・要レビュー",
        }
        rows.append(row)
    (OUT / "monster_master_330.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    csv_rows = [{**r, "secondary_types": "|".join(r["secondary_types"])} for r in rows]
    with (OUT / "monster_master_330.csv").open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(csv_rows[0]))
        writer.writeheader(); writer.writerows(csv_rows)
    make_html(rows, OUT / "monster_master_330.html")
    make_dedup_review(rows, OUT / "dedup_review.jpg")
    status_counts = Counter(r["status"] for r in rows)
    type_counts = Counter(r["type"] for r in rows if r["status"] != "除外候補")
    summary = {"total": len(rows), "status_counts": status_counts, "active_type_counts": type_counts,
               "types": TYPES, "duplicate_clusters": len(CLUSTERS)}
    (OUT / "master_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    status_md = f'''# ステップ2〜4 状況\n\n- 全330体を比較。\n- 採用: {status_counts['採用']}体。\n- 保留: {status_counts['保留']}体。\n- 除外候補: {status_counts['除外候補']}体。\n- 明確な重複クラスター: {len(CLUSTERS)}組。\n- 元画像および固定切り抜き画像は未削除。\n- 全330体へ10タイプと重複しない仮名を付与。\n- 名前とタイプはレビュー可能な暫定値で、能力値には未接続。\n\n## 判定基準\n\n1. 説明モチーフが同一。\n2. シルエットと主要色が近い。\n3. ゲーム内の役割まで重複する。\n4. 同系統でも、輪郭・素材・役割のうち2点以上が異なれば残す。\n5. 判断が割れるものは削除せず保留にする。\n\n## 注意点\n\n- 採用＋保留は{status_counts['採用'] + status_counts['保留']}体。\n- 物質タイプは{type_counts['物質']}体で最多。今後の追加生成では、鳥翼・むし・水棲・スライムを優先する。\n'''
    (OUT / "STEP2_4_STATUS.md").write_text(status_md, encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
