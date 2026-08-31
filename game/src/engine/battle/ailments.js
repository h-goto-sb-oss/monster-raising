// ailments.js
// 状態異常(どく/まひ/ねむり/こんらん/ふうじ)と、
// 一時的な能力変化(強化/弱体)をまとめて扱う。
//
// どちらも「combatantに乗る・ターン数で自然に切れる・戦闘終了で消える」
// という同じ形なので1ファイルにまとめている。
//
// combatant 側の持ち方 (どちらもプレーンなオブジェクト = そのままJSON化できる):
//   c.ailments = { どく: { turns: 4 } }
//   c.mods     = { atk: { stage: 1, turns: 5 } }   stage は -3〜+3
//
// 個体(instance)には保存しない。戦闘が終わればまっさらに戻る。

export const AILMENT_IDS = ['どく', 'まひ', 'ねむり', 'こんらん', 'ふうじ'];

export const AILMENTS = {
  どく: {
    id: 'どく',
    short: '毒',
    color: '#a86ad6',
    note: 'ターン終了ごとにダメージを受ける',
    turns: [4, 6],
  },
  まひ: {
    id: 'まひ',
    short: '麻',
    color: '#d9c04a',
    note: 'ときどき行動できない',
    turns: [3, 5],
  },
  ねむり: {
    id: 'ねむり',
    short: '眠',
    color: '#5a8fd6',
    note: '目を覚ますまで行動できない。攻撃を受けると起きる',
    turns: [2, 4],
  },
  こんらん: {
    id: 'こんらん',
    short: '乱',
    color: '#e08a4d',
    note: 'ときどき味方をふくむ誰かをむやみに攻撃する',
    turns: [3, 5],
  },
  ふうじ: {
    id: 'ふうじ',
    short: '封',
    color: '#8f8f9c',
    note: 'とくぎが使えない。通常こうげきはできる',
    turns: [3, 5],
  },
};

/** どく1回あたりのダメージ = 最大HPのこの割合 (仮データ)。 */
export const POISON_HP_RATIO = 0.07;

/** まひ / こんらん が実際に発動する確率 (仮データ)。 */
export const PARALYSIS_FAIL_CHANCE = 0.4;
export const CONFUSION_RAMPAGE_CHANCE = 0.5;

/** ねむり中に攻撃を受けたとき目を覚ます確率 (仮データ)。 */
export const WAKE_ON_HIT_CHANCE = 1.0;

function randTurns(range, rng) {
  const [min, max] = range;
  return min + Math.floor(rng() * (max - min + 1));
}

export function ensureStateSlots(c) {
  if (!c.ailments) c.ailments = {};
  if (!c.mods) c.mods = {};
  return c;
}

export function hasAilment(c, id) {
  return !!(c?.ailments && c.ailments[id]);
}

export function ailmentList(c) {
  if (!c?.ailments) return [];
  return AILMENT_IDS.filter((id) => c.ailments[id]).map((id) => ({
    ...AILMENTS[id],
    turns: c.ailments[id].turns,
  }));
}

/**
 * 状態異常をかける。すでに同じ状態なら「効かなかった」扱いにする。
 * @returns {{applied:boolean, message:string}}
 */
export function inflictAilment(c, id, opts = {}) {
  const def = AILMENTS[id];
  if (!def || !c) return { applied: false, message: '' };
  ensureStateSlots(c);
  if (c.hp <= 0) return { applied: false, message: '' };
  if (c.ailments[id]) {
    return { applied: false, message: `${c.name} は すでに ${id} 状態だ。` };
  }
  const rng = opts.rng || Math.random;
  const turns = opts.turns ?? randTurns(def.turns, rng);
  c.ailments[id] = { turns };
  return { applied: true, message: `${c.name} は ${id} 状態に なった！` };
}

export function clearAilment(c, id) {
  if (!c?.ailments || !c.ailments[id]) return false;
  delete c.ailments[id];
  return true;
}

/** 指定した状態異常(配列)を治す。'all' で全部。 @returns 治した状態異常のid配列 */
export function cureAilments(c, ids) {
  if (!c?.ailments) return [];
  const targets = !ids || ids === 'all' || ids.includes('all') ? AILMENT_IDS : ids;
  const cured = [];
  targets.forEach((id) => {
    if (c.ailments[id]) {
      delete c.ailments[id];
      cured.push(id);
    }
  });
  return cured;
}

export function clearAllStates(c) {
  if (!c) return;
  c.ailments = {};
  c.mods = {};
}

/** 攻撃を受けたときの覚醒判定。ねむりは殴られると解ける。 */
export function wakeOnHit(c, rng = Math.random) {
  if (!hasAilment(c, 'ねむり')) return null;
  if (rng() >= WAKE_ON_HIT_CHANCE) return null;
  clearAilment(c, 'ねむり');
  return `${c.name} は 目を さました！`;
}

// --- 一時的な能力変化 (強化 / 弱体) ------------------------------------

export const MOD_STATS = {
  atk: 'こうげき',
  def: 'ぼうぎょ',
  int: 'かしこさ',
  spd: 'すばやさ',
  acc: 'めいちゅう',
};

export const MOD_STEP = 0.22; // 1段階あたり±22% (仮データ)
export const MOD_MAX_STAGE = 3;

/**
 * 能力変化を1段階ぶん重ねる。上限/下限に達していたら「効かなかった」。
 * @returns {{applied:boolean, message:string}}
 */
export function applyMod(c, stat, stage, turns) {
  if (!c || !MOD_STATS[stat] || !stage) return { applied: false, message: '' };
  ensureStateSlots(c);
  if (c.hp <= 0) return { applied: false, message: '' };
  const current = c.mods[stat]?.stage ?? 0;
  const next = Math.max(-MOD_MAX_STAGE, Math.min(MOD_MAX_STAGE, current + stage));
  const label = MOD_STATS[stat];
  if (next === current) {
    return {
      applied: false,
      message: `${c.name} の ${label} は もう ${stage > 0 ? '上がらない' : '下がらない'}！`,
    };
  }
  c.mods[stat] = { stage: next, turns: Math.max(c.mods[stat]?.turns ?? 0, turns ?? 5) };
  const dir = stage > 0 ? '上がった' : '下がった';
  const bigly = Math.abs(stage) >= 2 ? 'ぐんと ' : '';
  return { applied: true, message: `${c.name} の ${label} が ${bigly}${dir}！` };
}

/** 現在の能力変化倍率。stage 0 なら 1.0。 */
export function modMultiplier(c, stat) {
  const stage = c?.mods?.[stat]?.stage ?? 0;
  if (!stage) return 1;
  return Math.max(0.25, 1 + stage * MOD_STEP);
}

/** 能力変化込みのステータス値。ダメージ計算はこちらを見る。 */
export function effectiveStat(c, key) {
  const base = c?.stats?.[key] ?? 0;
  if (!MOD_STATS[key]) return base;
  return Math.max(1, Math.round(base * modMultiplier(c, key)));
}

/** 表示用: 変化中のステータスの一覧。 */
export function modList(c) {
  if (!c?.mods) return [];
  return Object.entries(c.mods)
    .filter(([, v]) => v && v.stage)
    .map(([stat, v]) => ({ stat, label: MOD_STATS[stat] ?? stat, stage: v.stage, turns: v.turns }));
}

// --- ターン終了時の処理 -------------------------------------------------

/**
 * ターン終了時の状態処理。どくのダメージと、残りターン数の減算をまとめて行う。
 * ダメージの適用自体は呼び出し側(BattleEngine)がやる。
 * @returns {{poisonDamage:number, logs:string[]}}
 */
export function tickStates(c) {
  const logs = [];
  let poisonDamage = 0;
  if (!c) return { poisonDamage, logs };
  ensureStateSlots(c);

  if (c.hp > 0 && c.ailments['どく']) {
    poisonDamage = Math.max(1, Math.floor(c.maxHp * POISON_HP_RATIO));
  }

  AILMENT_IDS.forEach((id) => {
    const st = c.ailments[id];
    if (!st) return;
    st.turns -= 1;
    if (st.turns <= 0) {
      delete c.ailments[id];
      logs.push(`${c.name} の ${id} が なおった！`);
    }
  });

  Object.keys(c.mods).forEach((stat) => {
    const m = c.mods[stat];
    if (!m) return;
    m.turns -= 1;
    if (m.turns <= 0) {
      delete c.mods[stat];
      logs.push(`${c.name} の ${MOD_STATS[stat] ?? stat} が もとに もどった。`);
    }
  });

  return { poisonDamage, logs };
}

export default {
  AILMENTS,
  AILMENT_IDS,
  inflictAilment,
  cureAilments,
  clearAilment,
  clearAllStates,
  hasAilment,
  ailmentList,
  applyMod,
  modMultiplier,
  effectiveStat,
  modList,
  tickStates,
  wakeOnHit,
};
