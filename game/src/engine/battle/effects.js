// effects.js
// 「どの行動で どのエフェクトを出すか」を決める **1枚の表**。
//
// エフェクトの絵は8種類しかないのに、技は182個ある。技ごとに絵を割り当てる
// 表を作ると、技が1つ増えるたびに表に足すのを忘れて「その技だけ何も出ない」に
// なる。だからここでは **技そのものではなく、技が既に持っている属性(element)と
// 種別(type)から決める**。182個すべてが下の規則のどれかに必ず当たるし、
// 新しい技が足されても自動でどれかに当たる。
//
// 決める順番(上から順に、最初に当たったところで決まる):
//   1. ふつうの「こうげき」            -> 打撃
//   2. 物理技                          -> 名前が「ぶつける系」なら 打撃、それ以外は 斬撃
//   3. element がある                  -> ELEMENT_FX の表(炎・氷・雷・毒 …)
//   4. 弱体技で 状態異常を付ける       -> AILMENT_FX の表(まひ -> 雷 など)
//   5. type                            -> TYPE_FX の表(回復・強化・弱体 …)
//   6. どれにも当たらない              -> 斬撃(FALLBACK)
//
// 物理を element より先に見ているのは、物理技には element が付いていないから
// (データ上 44個すべて null)。逆に呪文・ブレスはほぼ全部 element を持つ。
//
// 絵の実体は monster_project/build_field_assets.py が
// public/assets/effects/ へ写す。1枚 1152x192 = 192px の6コマ。

/** 1コマの大きさ(px)と、1枚に入っているコマ数。素材の寸法そのもの。 */
export const FX_FRAME = { size: 192, count: 6 };

/**
 * コマ送りの速さ(1秒あたりのコマ数)。
 *
 * 6コマしかないので、ここを落とすと「起→展開→ピーク→減衰」が
 * ぱらぱら漫画に見える。20コマ/秒 = 全体で 300ms。
 * 殴った手ごたえとして読める速さの下限あたり。
 */
export const FX_FRAME_RATE = 20;

/**
 * 同じターンに複数のエフェクトが出るとき、次のを出すまでの間(ms)。
 * 全部同時に出すと画面が真っ白になって何が起きたか分からない。
 * かといって1つ終わるまで待つ(300ms)と、3人x3体で3秒近く待たされる。
 */
export const FX_STAGGER_MS = 110;

/** モンスターの表示高さに対するエフェクトの大きさ。1.0 = 同じ高さ。 */
export const FX_SCALE = 1.45;

/** エフェクト名 -> 絵の場所。BattleScene が preload でここを読む。 */
export const FX_SHEETS = {
  zangeki: '/assets/effects/fx_zangeki.png',
  dageki: '/assets/effects/fx_dageki.png',
  honoo: '/assets/effects/fx_honoo.png',
  koori: '/assets/effects/fx_koori.png',
  kaminari: '/assets/effects/fx_kaminari.png',
  kaifuku: '/assets/effects/fx_kaifuku.png',
  doku: '/assets/effects/fx_doku.png',
  kyouka: '/assets/effects/fx_kyouka.png',
};

export const FX_KEYS = Object.keys(FX_SHEETS);

/** どれにも当たらなかったときの絵。「何も出ない」を作らないための受け皿。 */
const FALLBACK = 'zangeki';

/**
 * 属性 -> エフェクト。skills.json に実在する8属性を全部並べてある。
 * 光・星は今のデータには無いが、素材の追加待ちで名前だけ決まっているので
 * 先に置いておく(足された日に だんまりにならないように)。
 */
const ELEMENT_FX = {
  炎: 'honoo',
  氷: 'koori',
  水: 'koori',      // 「こごえるいぶき」「しゃくねつのふぶき」…冷気寄りの技が多い
  雷: 'kaminari',
  毒: 'doku',
  闇: 'doku',       // 紫の瘴気。闇の絵が来たら差し替える
  風: 'zangeki',    // 「かまいたち」「ウィンドカッター」= 切り裂く風
  自然: 'zangeki',  // 「リーフストーム」「グリーンゲイル」= 飛び散る葉
  無: 'kaminari',   // 「マジックボルト」「カオスノヴァ」= 無属性の魔力の炸裂
  光: 'kyouka',
  星: 'kaminari',
};

/**
 * 状態異常 -> エフェクト。弱体技のように「属性は無いが 効果で何をするかは
 * はっきりしている」技を拾う。
 */
const AILMENT_FX = {
  どく: 'doku',
  まひ: 'kaminari',
  ねむり: 'kyouka',
  こんらん: 'kyouka',
  ふうじ: 'doku',
};

/** 種別 -> エフェクト。上のどれにも当たらなかった技の受け皿。 */
const TYPE_FX = {
  物理: 'zangeki',
  呪文: 'kaminari',
  ブレス: 'honoo',
  回復: 'kaifuku',
  強化: 'kyouka',
  支援: 'kyouka',
  弱体: 'doku',
  ダンス: 'kyouka',
};

/**
 * 物理技のうち「斬る」ではなく「ぶつける」もの。
 * 技名の一部で引く。ドラゴンクロー(爪)は斬撃、ボディプレス(体当たり)は打撃。
 * ここに載らない物理技は全部 斬撃 になるので、書き漏らしても
 * 「エフェクトが出ない」ではなく「斬撃が出る」で済む。
 */
const BLUNT_PARTS = [
  'たいあたり', 'プレス', 'づき', 'アタック', 'ハンマー', 'スラップ',
  'インパクト', 'クラッシュ', 'スマッシュ', 'ブロー', 'ブレイカー', 'はどう',
];

/** ふつうの「こうげき」(技を使わない打撃)。 */
export const BASIC_ATTACK_FX = 'dageki';

/**
 * この技に出すエフェクト。
 * @param {object|null} skill skills.json の1件。null なら ふつうのこうげき。
 * @returns {string} FX_SHEETS のキー
 */
export function effectForSkill(skill) {
  if (!skill) return BASIC_ATTACK_FX;

  if (skill.type === '物理') {
    const name = skill.name || '';
    return BLUNT_PARTS.some((part) => name.includes(part)) ? 'dageki' : 'zangeki';
  }

  const byElement = ELEMENT_FX[skill.element];
  if (byElement) return byElement;

  // 蘇生は回復と同じ絵。type が '回復' でない蘇生技があっても拾える。
  if (skill.revive || skill.heal) return 'kaifuku';

  if (skill.ailment && AILMENT_FX[skill.ailment]) return AILMENT_FX[skill.ailment];

  return TYPE_FX[skill.type] || FALLBACK;
}

/**
 * どうぐに出すエフェクト。技ほど種類が無いので効果idで直に引く。
 * 表に無い効果(えさ・キメラのつばさなど)は null = 何も出さない。
 */
const ITEM_FX = {
  heal_hp: 'kaifuku',
  heal_mp: 'kaifuku',
  heal_hp_full_all: 'kaifuku',
  revive: 'kaifuku',
  cure_ailment: 'kaifuku',
  damage_all: 'honoo',
  damage_type: 'kyouka',
};

export function effectForItem(item) {
  if (!item) return null;
  return ITEM_FX[item.effect] || null;
}
