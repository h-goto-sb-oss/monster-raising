// inherit.js
// 配合による「特技の継承」と「能力の継承」。
//
// 博史さんの要望の核心 (3・4):
//   継承は「生まれたときから覚えている」ではなく **習得予約** にする。
//   生まれたてはレベル1で種族のrank1技を1つ覚えているだけ。
//   親から受け継いだ技は inherited(継承枠)に入り、レベルが learnLevel に
//   届いてはじめて learned へ移る (growth.js の applySkillLearning)。
//
//   さらに進化呪文は **rank1 に正規化** して渡す。
//   メラゾーマ(rank3)を覚えた親からはメラ(rank1)が継承され、
//   子は自分でもう一度育て直すことになる。

import { createInstance, displayName, MAX_PLUS } from './instance.js';
import { STAT_KEYS } from './growth.js';

export const MAX_INHERIT_SLOTS = 4;

/**
 * 家系図に残す世代の深さ。3 = 親・祖父母・曽祖父母まで。
 *
 * なぜ上限が要るか:
 *   世代ごとに人数が倍になる(親2, 祖父母4, 曽祖父母8, …)。
 *   しかも childPlus は「親A + 親B + 1」なので7世代で +99 に届く。
 *   つまり普通に遊んでいるだけで7世代は積み上がる。上限を付けないと
 *   2^8-2 = 254件の記録が **1体につき** 乗り、牧場の全個体ぶんが
 *   localStorage のセーブに毎回書き込まれることになる。
 *
 * なぜ 3 か:
 *   - 要望は「親と祖父母まで さかのぼる」。3ならその1つ先まで入る
 *     (2 だと要望ちょうどで、余裕がない)。
 *   - 1体あたり最大 2+4+8 = 14件。JSONにして1.5KB程度なので、
 *     100体飼っても150KB。localStorage の 5MB に対して十分小さい。
 *   - 表示の都合でもある。スマホ横(高さ390px)の系譜ページに読める大きさで
 *     並ぶのは3段まで。4段目は字が小さくなりすぎる。
 */
export const ANCESTRY_DEPTH = 3;

/**
 * 家系図の1件ぶんを作る。
 *
 * **uid ではなく、その場で中身を写し取る。**
 * 以前は子の parents に親の uid を入れていたが、配合すると親2体は
 * 牧場(owned)から取り除かれるので、その uid はどこも指さない番号になった。
 * つまり家系図は原理的に組み立てられなかった。
 * ここでは種族id・表示名・レベル・プラス値と、その親自身の家系図を
 * 値としてコピーする。親が居なくなっても子だけで完結して読める。
 *
 * @param {object} parent 親の個体
 * @param {object} speciesById 種族id -> monsters.json のレコード (表示名のため)
 * @param {number} depth 残りの世代数
 * @returns {{speciesId,name,level,plus,parents?}|null}
 */
export function ancestryNode(parent, speciesById, depth = ANCESTRY_DEPTH) {
  if (!parent || depth <= 0) return null;
  const species = speciesById?.[parent.speciesId] || null;
  const node = {
    speciesId: parent.speciesId,
    name: displayName(parent, species),
    level: parent.level ?? 1,
    plus: parent.plus ?? 0,
  };
  const older = trimAncestry(parent.ancestry, depth - 1);
  if (older) node.parents = older;
  return node;
}

/** すでにある家系図を、残りの世代数ぶんだけ切り取って写す。 */
export function trimAncestry(list, depth) {
  if (!Array.isArray(list) || depth <= 0) return null;
  const out = list.map((n) => {
    if (!n) return null;
    const node = {
      speciesId: n.speciesId,
      name: n.name,
      level: n.level ?? 1,
      plus: n.plus ?? 0,
    };
    const older = trimAncestry(n.parents, depth - 1);
    if (older) node.parents = older;
    return node;
  });
  return out.some(Boolean) ? out : null;
}

/** 系統技は必ず rank1 へ落とす。単発技(line=null)はそのまま。 */
export function normalizeToRank1(skillId, skillsById, rank1ByLine) {
  const skill = skillsById[skillId];
  if (!skill) return null;
  if (!skill.line) return skillId;
  return rank1ByLine[skill.line] ?? skillId;
}

/** line -> rank1 の技id を引くテーブルを作る。 */
export function buildRank1Index(skillsById) {
  const index = {};
  Object.values(skillsById).forEach((s) => {
    if (!s.line) return;
    const current = index[s.line];
    if (!current || (skillsById[current].rank ?? 1) > (s.rank ?? 1)) {
      index[s.line] = s.id;
    }
  });
  return index;
}

function shuffled(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * 親2体から子の継承枠(習得予約)を抽選する。
 * @returns {{skillId:string, learnLevel:number, from:'inherit'}[]}
 */
export function rollInheritedSkills(parentA, parentB, childSpecies, skillsById) {
  const rank1ByLine = buildRank1Index(skillsById);

  // 1) 親の「覚えている技」+「まだ覚えていない継承枠」を候補プールにする
  const raw = [];
  [parentA, parentB].forEach((p) => {
    if (!p) return;
    (p.learned || []).forEach((id) => raw.push(id));
    (p.inherited || []).forEach((e) => raw.push(e.skillId));
  });

  // 2) 系統技は rank1 へ正規化 (要望4)
  const normalized = [];
  const seen = new Set();
  raw.forEach((id) => {
    const norm = normalizeToRank1(id, skillsById, rank1ByLine);
    if (!norm || seen.has(norm)) return;
    seen.add(norm);
    normalized.push(norm);
  });

  // 3) 子が自然に覚える技は継承しても意味がないので除外
  const natural = new Set((childSpecies.learnset || []).map((e) => e.skillId));
  const naturalLines = new Set(
    (childSpecies.learnset || [])
      .map((e) => skillsById[e.skillId]?.line)
      .filter(Boolean),
  );
  const pool = normalized.filter((id) => {
    if (natural.has(id)) return false;
    const line = skillsById[id]?.line;
    if (line && naturalLines.has(line)) return false; // 同系統を自力で覚えるなら不要
    return true;
  });

  // 4) 最大4系統を抽選し、習得レベルを決める。
  //    元技の learnLevel に「よその系統を覚える分の重さ」を足してずらす。
  //
  //    系統技は rank1 だけでなく上位ランクも一緒に予約する。
  //    そうしないと継承した呪文が rank1 のまま一生育たず、
  //    要望4の「下位呪文から育て直す」が「格下げされて終わり」になってしまう。
  //    子の種族の learnset には無い系統なので、この予約が唯一の成長経路になる。
  const chainByLine = {};
  Object.values(skillsById).forEach((s) => {
    if (!s.line) return;
    (chainByLine[s.line] ||= []).push(s);
  });
  Object.values(chainByLine).forEach((list) => list.sort((a, b) => (a.rank ?? 1) - (b.rank ?? 1)));

  const picked = shuffled(pool).slice(0, MAX_INHERIT_SLOTS);
  const entries = [];
  picked.forEach((skillId, i) => {
    const skill = skillsById[skillId];
    const delay = 5 + i * 3;
    const chain = skill?.line ? chainByLine[skill.line] : [skill];
    (chain || [skill]).forEach((s) => {
      if (!s) return;
      const base = s.learnLevel ?? 1;
      entries.push({
        skillId: s.id,
        learnLevel: Math.max(2, Math.min(60, base + delay)),
        from: 'inherit',
      });
    });
  });

  return entries.sort((a, b) => a.learnLevel - b.learnLevel);
}

/** 継承率: 親を育ててから配合するほど子の初期値が良くなる (8%〜18%)。 */
export function inheritRate(parentA, parentB) {
  const avgPlus = ((parentA?.plus ?? 0) + (parentB?.plus ?? 0)) / 2;
  return 0.08 + (Math.min(MAX_PLUS, avgPlus) / 99) * 0.10;
}

/** 子の初期ステータス = 種族基礎 + 親2体の現在ステータス平均 x 継承率 */
export function inheritBaseStats(parentA, parentB, childSpecies) {
  const rate = inheritRate(parentA, parentB);
  const out = {};
  STAT_KEYS.forEach((k) => {
    const a = parentA?.stats?.[k] ?? 0;
    const b = parentB?.stats?.[k] ?? 0;
    out[k] = childSpecies.stats[k] + Math.floor(((a + b) / 2) * rate);
  });
  return out;
}

/** 子のプラス値 = min(99, 親A + 親B + 1)。0x0→1, 1x1→3, 3x3→7 … 7世代で99。 */
export function childPlus(parentA, parentB) {
  return Math.min(MAX_PLUS, (parentA?.plus ?? 0) + (parentB?.plus ?? 0) + 1);
}

/**
 * 配合で生まれる子の個体を作る。
 * 生まれたてはレベル1で、種族が最初に覚える技を1つだけ持つ。
 * 継承した技は全て未習得のまま inherited に入る。
 *
 * @param {object} speciesById 種族id -> monsters.json のレコード。
 *   家系図に親の表示名を焼き込むために要る(省略すると名前が種族idになる)。
 */
export function createChildInstance(parentA, parentB, childSpecies, skillsById, speciesById = null) {
  const inherited = rollInheritedSkills(parentA, parentB, childSpecies, skillsById);

  // レベル1で覚えている技は「種族のrank1技を1つだけ」(要望3)
  const firstSkill = [...(childSpecies.learnset || [])]
    .sort((a, b) => a.level - b.level)
    .find((e) => e.level <= 1);

  return createInstance(childSpecies, {
    level: 1,
    plus: childPlus(parentA, parentB),
    baseStats: inheritBaseStats(parentA, parentB, childSpecies),
    inherited,
    learnedOverride: firstSkill ? [firstSkill.skillId] : [],
    // uid は「この配合で誰と誰を使ったか」の記録として残すだけ。
    // 親は牧場から消えるので、この uid を引いても何も出てこない。
    // 家系図に使うのは下の ancestry のほう(値のコピー)。
    parents: [parentA?.uid ?? null, parentB?.uid ?? null],
    ancestry: [
      ancestryNode(parentA, speciesById, ANCESTRY_DEPTH),
      ancestryNode(parentB, speciesById, ANCESTRY_DEPTH),
    ],
    skillsById,
  });
}

export default {
  createChildInstance,
  rollInheritedSkills,
  inheritBaseStats,
  inheritRate,
  childPlus,
  normalizeToRank1,
  ancestryNode,
  trimAncestry,
  ANCESTRY_DEPTH,
};
