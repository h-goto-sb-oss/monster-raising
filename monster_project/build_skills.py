# -*- coding: utf-8 -*-
"""
build_skills.py

game/src/data/skills.json を生成する。

これまで skills.json は手書きで、10タイプ x (物理3 + 呪文3 + 支援1) = 70 個の
完全に同じ型だった。つまりどのタイプを育てても遊びが変わらなかった。

GAME_SPEC_V0_1.md 7章の「特技の種類は、物理、攻撃呪文、支援、ダンス、強化、弱体、
回復など」に合わせて、以下の種別へ広げる:

    物理 / 呪文 / ブレス / 回復 / 強化 / 弱体 / ダンス / 支援

そのうえで10タイプに別々の役割を持たせる:

    スライム : 支援と嫌がらせ。状態異常の種類が多く、回復も一通り持つ
    ドラゴン : ブレスと純粋な火力。全体攻撃が主軸
    けもの   : 連続攻撃と会心。自分を強化して殴る
    鳥翼     : すばやさと多段攻撃。命中率低下などの搦め手
    自然     : 回復と蘇生。パーティーの生命線
    むし     : どくと状態異常。吸収技も持つ
    水棲     : 全体水呪文とパーティー支援
    物質     : ぼうぎょ強化とカウンター。鈍足化
    不死     : 状態異常とHP吸収。蘇生も一つだけ持つ
    幻魔     : 攻撃呪文と弱体。かしこさを自分で上げられる

★★★ 重要 ★★★
数値(power/mpCost/learnLevel)は全て「仮データ」である。説明文の (仮技) 表記は
バランスが確定するまで外さないこと。

生成後は build_game_data.py を実行して monsters.json の learnset を更新すること。
"""

import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
OUT_PATH = PROJECT_ROOT.parent / "game" / "src" / "data" / "skills.json"

# 10タイプ -> id接頭辞
TYPE_KEYS = {
    "スライム": "slime",
    "ドラゴン": "dragon",
    "けもの": "beast",
    "鳥翼": "bird",
    "自然": "nature",
    "むし": "bug",
    "水棲": "aqua",
    "物質": "mineral",
    "不死": "undead",
    "幻魔": "phantom",
}

# 対象種別 (engine/skills.js の TARGET と一致させること)
E1, EA, A1, AA, SELF = "敵単体", "敵全体", "味方単体", "味方全体", "自分"

_current_tag = None


def S(sid, name, stype, lv, mp, desc, power=0, element=None, target=None,
      line=None, rank=1, **extra):
    """1つの技レコードを作る。tag と id接頭辞は _current_tag から補う。"""
    key = TYPE_KEYS[_current_tag]
    rec = {
        "id": f"{key}_{sid}",
        "type_tag": _current_tag,
        "name": name,
        "type": stype,
        "element": element,
        "line": f"{key}_{line}" if line else None,
        "rank": rank,
        "learnLevel": lv,
        "power": power,
        "mpCost": mp,
        "target": target or _default_target(stype),
        "description": desc if desc.endswith("(仮技)") else desc + "(仮技)",
    }
    rec.update(extra)
    return rec


def _default_target(stype):
    return {
        "物理": E1, "呪文": E1, "ブレス": EA, "回復": A1,
        "強化": SELF, "弱体": E1, "ダンス": EA, "支援": E1,
    }.get(stype, E1)


def buff(stat, stage, turns=5):
    return {"buff": {"stat": stat, "stage": stage, "turns": turns}}


def debuff(stat, stage, turns=4):
    return {"debuff": {"stat": stat, "stage": stage, "turns": turns}}


def ail(name, chance):
    return {"ailment": name, "ailmentChance": chance}


# ---------------------------------------------------------------------------
# タイプごとの技表
# ---------------------------------------------------------------------------

def slime():
    return [
        # --- 既存の3系統 (v0.2から引き継ぎ。idは変えない) ---
        S("phy_1", "たいあたり", "物理", 1, 2, "体当たりして相手にダメージを与える。", power=12, line="phy", rank=1),
        S("phy_2", "ボディプレス", "物理", 12, 5, "体全体でのしかかる。", power=20, line="phy", rank=2),
        S("phy_3", "メガボディプレス", "物理", 30, 9, "全体重を叩きつける、スライムの奥義。", power=30, line="phy", rank=3),
        S("mag_1", "アシッドスプラッシュ", "呪文", 4, 4, "酸を飛ばして毒状態を狙う。", power=14, element="毒", line="mag", rank=1, **ail("どく", 0.25)),
        S("mag_2", "アシッドレイン", "呪文", 18, 10, "酸の雨で敵を溶かす。", power=24, element="毒", line="mag", rank=2, **ail("どく", 0.35)),
        S("mag_3", "アシッドストーム", "呪文", 36, 18, "強酸の嵐で敵を包み込む。", power=35, element="毒", line="mag", rank=3, **ail("どく", 0.45)),
        S("sup_1", "ぶんれつ", "支援", 8, 5, "体を分裂させ、攻撃をかわしやすくなる。", target=SELF, **buff("spd", 1, 5)),
        # --- 追加分: 嫌がらせと支え役 ---
        S("deb_1", "ねばねば", "弱体", 6, 3, "粘液でまとわりつき、すばやさを下げる。", **debuff("spd", -1)),
        S("deb_2", "とけるいぶき", "弱体", 16, 10, "敵全体のぼうぎょを溶かして下げる。", target=EA, **debuff("def", -1)),
        S("ail_1", "しびれジェル", "弱体", 20, 7, "しびれる体液を浴びせ、まひを狙う。", **ail("まひ", 0.45)),
        S("ail_2", "まどわしのぬめり", "弱体", 26, 8, "うねる体表で目をまわさせ、こんらんを狙う。", **ail("こんらん", 0.4)),
        S("ail_3", "ふうじのぬめり", "弱体", 28, 9, "口をふさぎ、とくぎを封じる。", **ail("ふうじ", 0.4)),
        S("hea_1", "ぷるぷるヒール", "回復", 7, 4, "体液を分け与えて味方のHPを回復する。", power=15, line="hea", rank=1),
        S("hea_2", "ぷるぷるヒーラー", "回復", 22, 9, "たっぷりの体液で味方のHPを回復する。", power=40, line="hea", rank=2),
        S("hea_3", "ぷるぷるフルヒール", "回復", 38, 18, "スライムの粋を集めて味方を大きく回復する。", power=90, line="hea", rank=3),
        S("buf_1", "やわらかガード", "強化", 14, 8, "味方全体をやわらかい膜で包み、ぼうぎょを上げる。", target=AA, **buff("def", 1, 5)),
        S("brt_1", "スライムシャワー", "呪文", 24, 14, "溶解液を敵全体に降らせる。", power=18, element="毒", target=EA, **ail("どく", 0.2)),
        S("dan_1", "ぷるぷるダンス", "ダンス", 10, 0, "全身をふるわせて味方のぼうぎょを上げる。MPを使わない。", target=AA, failChance=0.2, **buff("def", 1, 5)),
    ]


def dragon():
    return [
        S("phy_1", "つのづき", "物理", 1, 3, "角で強く突き上げる。", power=20, line="phy", rank=1),
        S("phy_2", "ドラゴンクロー", "物理", 12, 7, "竜の爪で切り裂く。", power=34, line="phy", rank=2),
        S("phy_3", "ドラゴンインパクト", "物理", 30, 14, "竜の全力を込めた一撃。", power=50, line="phy", rank=3),
        # 名前どおりブレス種別へ。ステータスに依存せず敵全体を焼く枠にする
        S("mag_1", "ファイアブレス", "ブレス", 4, 8, "炎の息を敵全体に吐きかける。", power=26, element="炎", target=EA, line="mag", rank=1),
        S("mag_2", "ヘルフレイム", "ブレス", 18, 19, "地獄の業火で敵全体を焼き尽くす。", power=44, element="炎", target=EA, line="mag", rank=2),
        S("mag_3", "インフェルノブレス", "ブレス", 36, 36, "全てを灰にする竜の吐息。", power=65, element="炎", target=EA, line="mag", rank=3),
        S("sup_1", "いかく", "支援", 8, 4, "威圧して敵のこうげきを下げる。", **debuff("atk", -1)),
        S("brt2_1", "こごえるいぶき", "ブレス", 10, 9, "凍える息で敵全体をこごえさせる。", power=20, element="水", target=EA, line="brt2", rank=1, **ail("まひ", 0.15)),
        S("brt2_2", "こごえるふぶき", "ブレス", 26, 20, "吹雪の息で敵全体を凍りつかせる。", power=38, element="水", target=EA, line="brt2", rank=2, **ail("まひ", 0.2)),
        S("brt2_3", "しゃくねつのふぶき", "ブレス", 40, 34, "灼熱と極寒がまじり合う竜の息。", power=60, element="水", target=EA, line="brt2", rank=3, **ail("まひ", 0.25)),
        S("phy2_1", "じごくづき", "物理", 20, 10, "急所を突き、相手のとくぎを封じる。", power=40, line="phy2", rank=1, **ail("ふうじ", 0.5)),
        S("phy2_2", "りゅうせいづき", "物理", 32, 14, "流星のごとく2回突き刺す。", power=26, hits=2, line="phy2", rank=2),
        S("buf_1", "ちからため", "強化", 6, 4, "力をためて、こうげきを大きく上げる。", target=SELF, **buff("atk", 2, 3)),
        S("buf_2", "りゅうのかまえ", "強化", 18, 8, "竜の構えでぼうぎょを大きく上げる。", target=SELF, **buff("def", 2, 4)),
        S("deb_1", "りゅうのいかり", "弱体", 22, 12, "怒りの咆哮で敵全体のぼうぎょを下げる。", target=EA, **debuff("def", -1)),
        S("ail_1", "いかりのおたけび", "弱体", 30, 16, "大咆哮で敵全体をすくませ、まひを狙う。", target=EA, **ail("まひ", 0.3)),
        S("hea_1", "りゅうのけっしょう", "回復", 28, 12, "竜の血が自身の傷を癒やす。", power=50, target=SELF),
        S("dan_1", "ドラゴンダンス", "ダンス", 16, 0, "竜の舞でこうげきを上げる。MPを使わない。", target=SELF, failChance=0.25, **buff("atk", 2, 4)),
    ]


def beast():
    return [
        S("phy_1", "かみつき", "物理", 1, 2, "鋭い牙でかみつく。", power=18, line="phy", rank=1),
        S("phy_2", "れんぞくひっかき", "物理", 12, 5, "爪で立て続けにひっかく。", power=31, line="phy", rank=2),
        S("phy_3", "ワイルドファング", "物理", 30, 9, "獣の本能を解き放つ連撃。", power=45, line="phy", rank=3),
        S("mag_1", "かみなりのきば", "呪文", 4, 4, "雷をまとった牙でかみつく。", power=16, element="雷", line="mag", rank=1, **ail("まひ", 0.15)),
        S("mag_2", "いかずちのきば", "呪文", 18, 10, "雷撃を牙に集めて撃ち込む。", power=27, element="雷", line="mag", rank=2, **ail("まひ", 0.2)),
        S("mag_3", "らいめいのきば", "呪文", 36, 18, "雷鳴とともに敵を噛み砕く。", power=40, element="雷", line="mag", rank=3, **ail("まひ", 0.25)),
        S("sup_1", "ほえる", "支援", 8, 3, "大きく吠えて敵全体のこうげきを下げる。", target=EA, **debuff("atk", -1)),
        S("phy2_1", "みだれづめ", "物理", 9, 5, "爪で2回ひっかく。", power=12, hits=2, line="phy2", rank=1),
        S("phy2_2", "らんげき", "物理", 24, 10, "爪と牙で3回おそいかかる。", power=12, hits=3, line="phy2", rank=2),
        S("phy2_3", "しっぷうらんぶ", "物理", 38, 16, "目にも留まらぬ4連撃。", power=13, hits=4, line="phy2", rank=3),
        S("dra_1", "くらいつき", "物理", 18, 8, "食らいついて相手のHPを吸い取る。", power=24, drain=0.4),
        S("ail_1", "ましょうのきば", "物理", 28, 11, "魔性の牙が相手をしびれさせる。", power=30, **ail("まひ", 0.35)),
        S("buf_1", "とうしをみなぎらせる", "強化", 7, 4, "闘志をみなぎらせてこうげきを上げる。", target=SELF, **buff("atk", 2, 4)),
        S("buf_2", "いくさのとおぼえ", "強化", 21, 10, "遠吠えで味方全体のこうげきを上げる。", target=AA, **buff("atk", 1, 5)),
        S("deb_1", "いかくのうなり", "弱体", 15, 8, "低いうなり声で敵全体のこうげきを下げる。", target=EA, **debuff("atk", -1)),
        S("hea_1", "やせいのかん", "回復", 20, 8, "野生の勘で傷をなめて癒やす。", power=35, target=SELF),
        S("brt_1", "ほのおのいぶき", "ブレス", 26, 12, "熱い息を敵全体に吹きかける。", power=22, element="炎", target=EA),
        S("dan_1", "けもののまい", "ダンス", 12, 0, "獣の舞ですばやさを大きく上げる。MPを使わない。", target=SELF, failChance=0.25, **buff("spd", 2, 4)),
    ]


def bird():
    return [
        S("phy_1", "つばさアタック", "物理", 1, 3, "翼で強く打ちつける。", power=16, line="phy", rank=1),
        S("phy_2", "シャドウダイブ", "物理", 12, 7, "影から急降下して襲う。", power=27, line="phy", rank=2),
        S("phy_3", "スカイブレイカー", "物理", 30, 13, "上空から全力で急降下する。", power=40, line="phy", rank=3),
        S("mag_1", "かぜのは", "呪文", 4, 5, "風の刃を飛ばす。", power=18, element="風", line="mag", rank=1),
        S("mag_2", "ウィンドカッター", "呪文", 18, 12, "鋭い真空の刃で切り裂く。", power=31, element="風", line="mag", rank=2),
        S("mag_3", "テンペスト", "呪文", 36, 23, "暴風を巻き起こして敵を薙ぐ。", power=45, element="風", line="mag", rank=3),
        S("sup_1", "はやてがまえ", "支援", 8, 4, "身構えてすばやさを大きく上げる。", target=SELF, **buff("spd", 2, 5)),
        S("phy2_1", "ついばみ", "物理", 8, 4, "くちばしで2回ついばむ。", power=10, hits=2, line="phy2", rank=1),
        S("phy2_2", "みだれつばさ", "物理", 22, 9, "翼を乱れ打ちして3回攻撃する。", power=12, hits=3, line="phy2", rank=2),
        S("phy2_3", "せんぷうれんだ", "物理", 36, 15, "旋風のごとき4連打。", power=14, hits=4, line="phy2", rank=3),
        S("deb_1", "めつぶし", "弱体", 6, 4, "砂を巻き上げて相手のめいちゅうを下げる。", **debuff("acc", -2)),
        S("deb_2", "かぜよみ", "弱体", 20, 10, "風を読んで敵全体のすばやさを下げる。", target=EA, **debuff("spd", -1)),
        S("buf_1", "かぜのかご", "強化", 14, 9, "追い風で味方全体のすばやさを上げる。", target=AA, **buff("spd", 1, 5)),
        S("ail_1", "しびれのかぜ", "弱体", 28, 13, "しびれる風を敵全体に送る。", target=EA, **ail("まひ", 0.3)),
        S("hea_1", "はねやすめ", "回復", 18, 7, "羽を休めて自分のHPを回復する。", power=40, target=SELF),
        S("brt_1", "かまいたち", "呪文", 30, 18, "かまいたちが敵全体を切り刻む。", power=30, element="風", target=EA),
        S("dan_1", "かぜのまい", "ダンス", 11, 0, "風の舞で味方全体のすばやさを上げる。MPを使わない。", target=AA, failChance=0.2, **buff("spd", 1, 5)),
        S("dan_2", "とりのきまぐれ", "ダンス", 25, 0, "何が起きるか分からない気まぐれな舞。MPを使わない。", target=EA, danceKind="random"),
    ]


def nature():
    return [
        S("phy_1", "つるむち", "物理", 1, 3, "つるをしならせて叩く。", power=14, line="phy", rank=1),
        S("phy_2", "ウッドハンマー", "物理", 12, 7, "太い幹を振り下ろす。", power=24, line="phy", rank=2),
        S("phy_3", "エンシェントルート", "物理", 30, 13, "古木の根で敵を打ち砕く。", power=35, line="phy", rank=3),
        S("mag_1", "リーフストーム", "呪文", 4, 6, "無数の葉を吹き荒れさせる。", power=20, element="自然", line="mag", rank=1),
        S("mag_2", "グリーンゲイル", "呪文", 18, 14, "緑の疾風で敵を切り刻む。", power=34, element="自然", line="mag", rank=2),
        S("mag_3", "ガイアバースト", "呪文", 36, 27, "大地の力を爆発させる。", power=50, element="自然", line="mag", rank=3),
        S("sup_1", "いやしのはな", "回復", 8, 6, "癒やしの花粉で味方のHPを回復する。", power=18),
        S("hea_1", "めばえのいやし", "回復", 5, 4, "芽吹きの力で味方のHPを回復する。", power=20, line="hea", rank=1),
        S("hea_2", "いのちのめぐみ", "回復", 18, 9, "命の恵みで味方のHPを大きく回復する。", power=55, line="hea", rank=2),
        S("hea_3", "だいちのめぐみ", "回復", 34, 18, "大地の恵みが味方の傷をほぼ癒やす。", power=130, line="hea", rank=3),
        S("hel_1", "もりのいぶき", "回復", 22, 16, "森の息吹が味方全体のHPを回復する。", power=25, target=AA, line="hel", rank=1),
        S("hel_2", "せかいじゅのかご", "回復", 40, 30, "世界樹の加護が味方全体を大きく癒やす。", power=60, target=AA, line="hel", rank=2),
        S("rev_1", "よみがえりのしずく", "回復", 36, 25, "命の雫で戦闘不能の味方をよみがえらせる。", target=A1, revive=True, reviveRatio=0.5),
        S("buf_1", "きのちから", "強化", 10, 6, "木の力を借りて味方のぼうぎょを上げる。", target=A1, **buff("def", 1, 5)),
        S("buf_2", "だいちのかご", "強化", 26, 14, "大地の加護で味方全体のぼうぎょを上げる。", target=AA, **buff("def", 1, 5)),
        S("ail_1", "ねむりのほうし", "弱体", 12, 7, "眠りを誘う胞子をまく。", **ail("ねむり", 0.5)),
        S("ail_2", "やすらぎのかぜ", "弱体", 30, 15, "安らぎの風で敵全体を眠りに誘う。", target=EA, **ail("ねむり", 0.3)),
        S("deb_1", "やどりぎ", "弱体", 16, 8, "寄生した木が敵のこうげきを下げ、毒でむしばむ。", **debuff("atk", -1), **ail("どく", 0.35)),
        S("dan_1", "めぐみのまい", "ダンス", 24, 0, "恵みの舞で味方全体のHPを回復する。MPを使わない。", power=30, target=AA, heal=True, failChance=0.25),
    ]


def bug():
    return [
        S("phy_1", "はりさし", "物理", 1, 2, "鋭い針で突き刺す。", power=15, line="phy", rank=1),
        S("phy_2", "ダブルニードル", "物理", 12, 5, "二本の針で続けざまに刺す。", power=26, line="phy", rank=2),
        S("phy_3", "デスニードル", "物理", 30, 9, "急所を狙う必殺の一刺し。", power=38, line="phy", rank=3),
        S("mag_1", "どくのこな", "呪文", 4, 4, "毒の粉をまき散らす。", power=10, element="毒", line="mag", rank=1, **ail("どく", 0.35)),
        S("mag_2", "ベノムミスト", "呪文", 18, 10, "猛毒の霧で敵をむしばむ。", power=17, element="毒", line="mag", rank=2, **ail("どく", 0.45)),
        S("mag_3", "デッドリーポイズン", "呪文", 36, 18, "致死の毒を一気に浴びせる。", power=25, element="毒", line="mag", rank=3, **ail("どく", 0.6)),
        S("sup_1", "ねばりいと", "支援", 8, 3, "粘る糸で敵のすばやさを下げる。", **debuff("spd", -1)),
        S("ail_1", "まひのりんぷん", "弱体", 10, 6, "しびれる鱗粉をまき散らす。", **ail("まひ", 0.45)),
        S("ail_2", "ねむりのりんぷん", "弱体", 16, 7, "眠気を誘う鱗粉をまき散らす。", **ail("ねむり", 0.45)),
        S("ail_3", "こんらんのりんぷん", "弱体", 22, 8, "目をまわさせる鱗粉をまき散らす。", **ail("こんらん", 0.45)),
        S("deb_1", "いとしばり", "弱体", 18, 10, "糸で敵全体をしばり、すばやさを下げる。", target=EA, **debuff("spd", -1)),
        S("deb_2", "きばのどく", "弱体", 26, 10, "牙の毒が敵のこうげきを大きく下げる。", **debuff("atk", -2, 3)),
        S("dra_1", "きゅうけつ", "物理", 12, 6, "相手の体液を吸ってHPを回復する。", power=20, drain=0.5, line="dra", rank=1),
        S("dra_2", "だいきゅうけつ", "物理", 30, 12, "たっぷり吸い上げてHPを大きく回復する。", power=34, drain=0.5, line="dra", rank=2),
        S("brt_1", "どくのきり", "呪文", 24, 14, "毒の霧が敵全体をむしばむ。", power=16, element="毒", target=EA, **ail("どく", 0.4)),
        S("hea_1", "だっぴ", "回復", 14, 8, "脱皮して傷と状態異常をまとめて治す。", power=30, target=SELF, cures=["all"]),
        S("buf_1", "かたいこうかく", "強化", 8, 5, "甲殻を硬くしてぼうぎょを大きく上げる。", target=SELF, **buff("def", 2, 4)),
        S("dan_1", "むしのざわめき", "ダンス", 20, 0, "不気味なざわめきで敵全体をこんらんさせる。MPを使わない。", target=EA, failChance=0.25, **ail("こんらん", 0.35)),
    ]


def aqua():
    return [
        S("phy_1", "テールスラップ", "物理", 1, 3, "尾で強く打ちつける。", power=16, line="phy", rank=1),
        S("phy_2", "アクアインパクト", "物理", 12, 7, "水圧を乗せた体当たり。", power=27, line="phy", rank=2),
        S("phy_3", "タイダルクラッシュ", "物理", 30, 14, "大波もろとも叩きつける。", power=40, line="phy", rank=3),
        S("mag_1", "アクアジェット", "呪文", 4, 7, "高圧の水流を撃ち出す。", power=22, element="水", line="mag", rank=1),
        S("mag_2", "バブルストリーム", "呪文", 18, 17, "泡の激流で押し流す。", power=37, element="水", line="mag", rank=2),
        S("mag_3", "メイルシュトローム", "呪文", 36, 32, "大渦を呼び起こして飲み込む。", power=55, element="水", line="mag", rank=3),
        S("sup_1", "うるおいのまい", "回復", 8, 6, "潤いの舞で味方のHPを回復する。", power=16),
        S("mag2_1", "しおふき", "呪文", 14, 12, "潮を吹き上げて敵全体を打つ。", power=20, element="水", target=EA, line="mag2", rank=1),
        S("mag2_2", "だいかいしょう", "呪文", 28, 22, "大海嘯が敵全体を飲み込む。", power=34, element="水", target=EA, line="mag2", rank=2),
        S("mag2_3", "オーシャンレイド", "呪文", 42, 38, "大海の怒りを敵全体に叩きつける。", power=50, element="水", target=EA, line="mag2", rank=3),
        S("hea_1", "みずのいやし", "回復", 6, 5, "清らかな水で味方のHPを回復する。", power=22),
        S("hea_2", "うみのめぐみ", "回復", 24, 18, "海の恵みで味方全体のHPを回復する。", power=30, target=AA),
        S("buf_1", "みずのころも", "強化", 16, 10, "水の衣で味方全体のぼうぎょを上げる。", target=AA, **buff("def", 1, 5)),
        S("buf_2", "ながれにのる", "強化", 30, 14, "流れに乗って味方全体のすばやさを上げる。", target=AA, **buff("spd", 1, 5)),
        S("deb_1", "うずしお", "弱体", 20, 11, "渦潮で敵全体のすばやさを下げる。", target=EA, **debuff("spd", -1)),
        S("ail_1", "しびれるみず", "弱体", 12, 6, "しびれる水を浴びせてまひを狙う。", **ail("まひ", 0.4)),
        S("ail_2", "ふかいのうた", "弱体", 34, 16, "深海の歌が敵全体を眠りに誘う。", target=EA, **ail("ねむり", 0.3)),
        S("dan_1", "なみのまい", "ダンス", 26, 0, "波の舞で味方全体のHPを回復する。MPを使わない。", power=25, target=AA, heal=True, failChance=0.25),
    ]


def mineral():
    return [
        S("phy_1", "ロックスマッシュ", "物理", 1, 4, "硬い体を叩きつけて砕く。", power=22, line="phy", rank=1),
        S("phy_2", "アイアンプレス", "物理", 12, 10, "鉄塊のごとくのしかかる。", power=37, line="phy", rank=2),
        S("phy_3", "クラッシュインパクト", "物理", 30, 18, "全質量を乗せた破砕の一撃。", power=55, line="phy", rank=3),
        S("mag_1", "メタルシャワー", "呪文", 4, 6, "金属片を撒き散らす。", power=20, element="無", line="mag", rank=1),
        S("mag_2", "メタルスコール", "呪文", 18, 14, "金属の驟雨を降らせる。", power=34, element="無", line="mag", rank=2),
        S("mag_3", "ミスリルレイン", "呪文", 36, 27, "輝く金属の雨で貫く。", power=50, element="無", line="mag", rank=3),
        S("sup_1", "こうか", "支援", 8, 4, "体を硬化させてぼうぎょを上げる。", target=SELF, **buff("def", 1, 5)),
        S("buf_1", "てっぺき", "強化", 6, 5, "鉄壁の構えでぼうぎょを大きく上げる。", target=SELF, line="buf", rank=1, **buff("def", 2, 4)),
        S("buf_2", "ダイヤのかまえ", "強化", 20, 10, "ダイヤのごとき硬さでぼうぎょを極限まで上げる。", target=SELF, line="buf", rank=2, **buff("def", 3, 5)),
        S("buf_3", "アダマスウォール", "強化", 36, 22, "不壊の壁が味方全体のぼうぎょを上げる。", target=AA, line="buf", rank=3, **buff("def", 2, 5)),
        S("phy2_1", "カウンターブロー", "物理", 16, 9, "受けた力をそのまま返す反撃。", power=34, line="phy2", rank=1),
        S("phy2_2", "リベンジプレス", "物理", 32, 16, "溜め込んだ衝撃をまとめて叩き返す。", power=52, line="phy2", rank=2),
        S("deb_1", "じゅうりょくのおもし", "弱体", 18, 12, "重さで敵全体のすばやさを大きく下げる。", target=EA, **debuff("spd", -2)),
        S("deb_2", "きんぞくのきしみ", "弱体", 26, 13, "耳ざわりな軋みで敵全体のこうげきを下げる。", target=EA, **debuff("atk", -1)),
        S("ail_1", "じばのしびれ", "弱体", 14, 8, "磁場を発生させて相手をまひさせる。", **ail("まひ", 0.5)),
        S("hea_1", "じこしゅうふく", "回復", 22, 10, "体を組み直して自分のHPを回復する。", power=45, target=SELF),
        S("brt_1", "ストーンブレス", "ブレス", 28, 14, "砕けた石の礫を敵全体に吹きつける。", power=26, element="無", target=EA),
        S("dan_1", "いわのまい", "ダンス", 24, 0, "重々しい舞で味方全体のぼうぎょを上げる。MPを使わない。", target=AA, failChance=0.25, **buff("def", 1, 5)),
    ]


def undead():
    return [
        S("phy_1", "のろいのつめ", "物理", 1, 4, "呪いのこもった爪で裂く。", power=17, line="phy", rank=1),
        S("phy_2", "デスクロー", "物理", 12, 10, "死を呼ぶ爪で切り裂く。", power=29, line="phy", rank=2),
        S("phy_3", "グレイブクロー", "物理", 30, 18, "墓場の底から伸びる爪。", power=42, line="phy", rank=3),
        S("mag_1", "ダークウェイブ", "呪文", 4, 8, "闇の波動を放つ。", power=24, element="闇", line="mag", rank=1),
        S("mag_2", "ダークバースト", "呪文", 18, 19, "闇を爆発させて飲み込む。", power=41, element="闇", line="mag", rank=2),
        S("mag_3", "アビスウェイブ", "呪文", 36, 36, "深淵の波動で魂ごと削る。", power=60, element="闇", line="mag", rank=3),
        S("sup_1", "しのくちづけ", "支援", 8, 6, "死の口づけで敵のこうげきを吸い取る。", **debuff("atk", -1)),
        S("ail_1", "のろいのめ", "弱体", 8, 6, "呪いの眼光がとくぎを封じる。", **ail("ふうじ", 0.5)),
        S("ail_2", "あんこくのこもりうた", "弱体", 20, 12, "暗黒の子守唄で敵全体を眠らせる。", target=EA, **ail("ねむり", 0.35)),
        S("ail_3", "しのささやき", "弱体", 26, 9, "死者のささやきが正気をうばう。", **ail("こんらん", 0.5)),
        S("ail_4", "えきびょうのかぜ", "弱体", 30, 14, "疫病の風が敵全体をむしばむ。", target=EA, **ail("どく", 0.5)),
        S("dra_1", "ライフドレイン", "呪文", 12, 8, "生命力を吸い取って自分のHPにする。", power=20, element="闇", drain=0.6, line="dra", rank=1),
        S("dra_2", "ソウルイーター", "呪文", 30, 16, "魂を喰らって大きくHPを吸い取る。", power=38, element="闇", drain=0.6, line="dra", rank=2),
        S("deb_1", "じゃくたいのじゅ", "弱体", 16, 8, "弱体の呪いで敵のぼうぎょを大きく下げる。", **debuff("def", -2)),
        S("deb_2", "おとろえのきり", "弱体", 24, 12, "衰えの霧が敵全体のこうげきを下げる。", target=EA, **debuff("atk", -1)),
        S("rev_1", "しをこえるちかい", "回復", 40, 28, "死を越える誓いで戦闘不能の味方をよみがえらせる。", target=A1, revive=True, reviveRatio=0.5),
        S("hea_1", "いのちすいとり", "回復", 22, 9, "残った生気をかき集めて自分を癒やす。", power=35, target=SELF),
        S("dan_1", "しれいのまい", "ダンス", 18, 0, "死霊が何を起こすか分からない舞。MPを使わない。", target=EA, danceKind="random"),
    ]


def phantom():
    return [
        S("phy_1", "まほうのつめ", "物理", 1, 3, "魔力をまとった爪で切り裂く。", power=15, line="phy", rank=1),
        S("phy_2", "アストラルクロー", "物理", 12, 7, "星幽の爪で実体ごと裂く。", power=26, line="phy", rank=2),
        S("phy_3", "カオスクロー", "物理", 30, 13, "混沌の爪で存在を歪める。", power=38, line="phy", rank=3),
        S("mag_1", "マジックボルト", "呪文", 4, 9, "純粋な魔力の弾を撃ち出す。", power=28, element="無", line="mag", rank=1),
        S("mag_2", "マジックブラスト", "呪文", 18, 21, "圧縮した魔力を炸裂させる。", power=48, element="無", line="mag", rank=2),
        S("mag_3", "カオスノヴァ", "呪文", 36, 40, "混沌そのものを叩きつける。", power=70, element="無", line="mag", rank=3),
        S("sup_1", "げんえいのまい", "支援", 8, 7, "幻影の舞で敵のめいちゅうを下げる。", **debuff("acc", -2)),
        S("mag2_1", "まりょくのはどう", "呪文", 16, 14, "魔力の波動が敵全体を打つ。", power=22, element="無", target=EA, line="mag2", rank=1),
        S("mag2_2", "げんまのはどう", "呪文", 30, 26, "幻魔の波動が敵全体をつらぬく。", power=38, element="無", target=EA, line="mag2", rank=2),
        S("mag2_3", "カオスウェイブ", "呪文", 44, 42, "混沌の波が敵全体を飲み込む。", power=55, element="無", target=EA, line="mag2", rank=3),
        S("deb_1", "ちからをうばう", "弱体", 10, 7, "敵のこうげきを大きくうばう。", **debuff("atk", -2)),
        S("deb_2", "まもりをうばう", "弱体", 14, 7, "敵のぼうぎょを大きくうばう。", **debuff("def", -2)),
        S("deb_3", "すべてをうばう", "弱体", 34, 20, "敵全体の力をうばい、とくぎまで封じる。", target=EA, **debuff("atk", -1), **ail("ふうじ", 0.3)),
        S("ail_1", "ねむりのじゅもん", "弱体", 8, 6, "眠りの呪文で相手を眠らせる。", **ail("ねむり", 0.5)),
        S("ail_2", "サイコこんらん", "弱体", 12, 8, "精神を乱してこんらんさせる。", **ail("こんらん", 0.5)),
        S("ail_3", "まふうじ", "弱体", 22, 10, "魔力を封じ、とくぎを使えなくする。", **ail("ふうじ", 0.55)),
        S("buf_1", "まりょくかいほう", "強化", 18, 8, "魔力を解放してかしこさを大きく上げる。", target=SELF, **buff("int", 2, 4)),
        S("hea_1", "いやしのまほう", "回復", 20, 10, "癒やしの魔法で味方のHPを回復する。", power=45),
        S("dan_1", "げんわくのまい", "ダンス", 26, 0, "幻惑の舞で敵全体をこんらんさせる。MPを使わない。", target=EA, failChance=0.3, **ail("こんらん", 0.4)),
    ]


BUILDERS = {
    "スライム": slime,
    "ドラゴン": dragon,
    "けもの": beast,
    "鳥翼": bird,
    "自然": nature,
    "むし": bug,
    "水棲": aqua,
    "物質": mineral,
    "不死": undead,
    "幻魔": phantom,
}


def main():
    global _current_tag
    all_skills = []
    for tag, builder in BUILDERS.items():
        _current_tag = tag
        all_skills.extend(builder())
    _current_tag = None

    # --- 検算 ---
    ids = [s["id"] for s in all_skills]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise SystemExit(f"[ERROR] 技idが重複しています: {sorted(dupes)}")

    for s in all_skills:
        if s["line"] and s["type"] not in ("物理", "呪文", "ブレス", "回復", "強化"):
            raise SystemExit(f"[ERROR] 系統技にできない種別: {s['id']} ({s['type']})")
        if s["type"] in ("物理", "呪文", "ブレス") and s["power"] <= 0 and not s.get("ailment"):
            raise SystemExit(f"[ERROR] 攻撃技なのに power が 0: {s['id']}")

    # 各タイプがLv1技をちょうど1つ持つこと (配合の子が必ず1つ技を持てるように)
    for tag in BUILDERS:
        lv1 = [s for s in all_skills if s["type_tag"] == tag and s["learnLevel"] <= 1]
        if len(lv1) != 1:
            raise SystemExit(f"[ERROR] {tag} のLv1技が {len(lv1)} 個ある (1個であるべき)")

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_skills, f, ensure_ascii=False, indent=2)

    by_type = {}
    for s in all_skills:
        by_type[s["type"]] = by_type.get(s["type"], 0) + 1

    print("=== build_skills.py 実行結果 ===")
    print(f"技の総数: {len(all_skills)}")
    for tag in BUILDERS:
        print(f"  {tag:<5}: {len([s for s in all_skills if s['type_tag'] == tag])}")
    print("種別ごと:", by_type)
    print(f"出力先: {OUT_PATH}")
    print("※ このあと build_game_data.py を実行して learnset を更新すること")


if __name__ == "__main__":
    main()
