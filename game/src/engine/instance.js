// instance.js
// 「個体」の生成と表示ヘルパー。
//
// v0.1 までは所持 = 種族IDの配列だったため、同じ種族を2体持てず、
// レベル・経験値・個体値・プラス値のどれも表現できなかった。
// ここで導入する個体(instance)がその土台になる。
//
// {
//   uid, speciesId, level, exp, plus,
//   iv:        {hp,mp,atk,def,int,spd}   個体値 0〜30。生成時にランダムで決まる
//   baseStats: {...}                     Lv1時点のステータス(種族基礎 + 配合の継承分)
//   stats:     {...}                     現在の実ステータス(レベルから算出)
//   hp, mp                               現在値
//   learned:   [skillId]                 習得済み
//   inherited: [{skillId, learnLevel}]   継承枠 = 習得予約。まだ使えない
//   parents:   [uidA, uidB] | null       配合の記録。**引いても親は居ない**
//   ancestry:  [node, node] | null       家系図。node = {speciesId,name,level,plus,parents?}
//   tactic:    さくせんid | null          null = 手動操作。メニューで設定して戦闘へ持ち越す
// }
//
// parents と ancestry が別々なのには理由がある。
// 配合すると親2体は牧場から取り除かれるので、uid を持っていても
// あとから引けない。だから家系図は「そのとき見えていた値のコピー」を
// ancestry に焼き込む (engine/inherit.js の ancestryNode)。

import { STAT_KEYS, statsAtLevel, applySkillLearning, setLevel } from './growth.js';

export const IV_MAX = 30;
export const MAX_PLUS = 99;

let uidCounter = 0;

export function newUid(speciesId) {
  uidCounter += 1;
  return `${speciesId}#${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function rollIv() {
  const iv = {};
  STAT_KEYS.forEach((k) => {
    iv[k] = Math.floor(Math.random() * (IV_MAX + 1));
  });
  return iv;
}

/** 表示名。プラス値が付いていれば「なまえ+3」になる (要望6)。 */
export function displayName(instance, species) {
  const base = species?.name ?? instance?.speciesId ?? '？？？';
  const plus = instance?.plus ?? 0;
  return plus > 0 ? `${base}+${plus}` : base;
}

/**
 * 野生・開始イベント・デバッグ入手用の素の個体を作る。
 * @param {object} species monsters.json のレコード
 * @param {object} [opts]
 *   { level, iv, plus, baseStats, inherited, learnedOverride, parents, ancestry, tactic }
 */
export function createInstance(species, opts = {}) {
  const level = Math.max(1, Math.min(99, opts.level ?? 1));
  const baseStats = {};
  STAT_KEYS.forEach((k) => {
    baseStats[k] = opts.baseStats?.[k] ?? species.stats[k];
  });

  const inst = {
    uid: newUid(species.id),
    speciesId: species.id,
    level,
    exp: 0,
    plus: Math.max(0, Math.min(MAX_PLUS, opts.plus ?? 0)),
    iv: opts.iv ?? rollIv(),
    baseStats,
    stats: null,
    hp: 0,
    mp: 0,
    learned: [],
    inherited: (opts.inherited || []).map((e) => ({ ...e })),
    parents: opts.parents ?? null,
    ancestry: opts.ancestry ?? null,
    // さくせん。メニュー(さくせん)で決めた指示を戦闘へ持ち越すために個体が持つ。
    // 野生や開始イベントで手に入れた個体は null = 手動操作。
    tactic: opts.tactic ?? null,
  };

  inst.stats = statsAtLevel(inst, species, level);
  inst.hp = inst.stats.hp;
  inst.mp = inst.stats.mp;

  if (opts.learnedOverride) {
    inst.learned = [...opts.learnedOverride];
  } else {
    applySkillLearning(inst, species, opts.skillsById || {});
  }

  return inst;
}

/** デバッグ用ラッパー。レベルを直接動かして技習得まで反映する。 */
export function forceLevel(instance, species, level, skillsById) {
  return setLevel(instance, species, level, skillsById);
}

/** 個体が「まだ覚えていない継承技」を持っているか。 */
export function hasPendingInheritance(instance) {
  return (instance.inherited || []).length > 0;
}

/**
 * 家系図として何を出せるか。「つよさ」の系譜ページが空の枠を出さないための判定。
 *   'tree' … 家系図がある
 *   'lost' … 配合で生まれた記録(parents)はあるが、家系図が残っていない。
 *            家系図を入れる前のセーブで生まれた子。親は牧場から消えているので、
 *            uid からさかのぼることはもうできない。
 *   'wild' … 配合で生まれていない。野生で仲間になった / 開始イベントの1体。
 * @returns {'tree'|'lost'|'wild'}
 */
export function ancestryState(instance) {
  if (Array.isArray(instance?.ancestry) && instance.ancestry.some(Boolean)) return 'tree';
  if (Array.isArray(instance?.parents) && instance.parents.some(Boolean)) return 'lost';
  return 'wild';
}

/** localStorageから読んだ値が新しい個体形式かどうか。旧形式(種族IDの配列)なら false。 */
export function looksLikeInstanceArray(value) {
  if (!Array.isArray(value)) return false;
  if (value.length === 0) return true;
  return value.every((v) => v && typeof v === 'object' && typeof v.uid === 'string' && typeof v.speciesId === 'string');
}

export default { createInstance, displayName, rollIv, newUid, looksLikeInstanceArray };
