// items.js
// どうぐの共通ロジック。
//   - ふくろの容量(スロット/スタック)の管理
//   - 戦闘で使える/拠点で使える の判定
//   - 拠点でのアイテム使用(個体への恒久強化など)
//
// 戦闘中の効果解決は BattleEngine 側にある。ふくろの中身(inventory)は
// { itemId: 個数 } の素直なマップで、1種類 = 1スロットとして数える。

import itemsData from '../data/items.json';
import { recalcStats } from './growth.js';
import { cureAilments } from './battle/ailments.js';

// --- 容量。バランス調整はここだけ触れば済むようにしておく -----------------
export const BAG_SLOT_LIMIT = 20; // ふくろのスロット数(パーティー共有)
export const BAG_STACK_LIMIT = 99; // 1スロットに重ねられる個数

export const ITEMS = itemsData;

export const ITEM_BY_ID = {};
itemsData.forEach((it) => {
  ITEM_BY_ID[it.id] = it;
});

// FIELD は「ダンジョンを歩いているあいだ」。戦闘中でも拠点でもない第3の場所で、
// 歩けるダンジョン(v0.5)ができて初めて意味を持つようになった。せいすいがここ。
export const USABLE_IN = { BATTLE: '戦闘', TOWN: '拠点', BOTH: '両方', FIELD: 'ダンジョン' };

export const ITEM_CATEGORY_ORDER = [
  'HP回復',
  '蘇生',
  'MP回復',
  '状態異常回復',
  '餌',
  '恒久強化',
  '戦闘用攻撃',
  '移動',
];

/** 恒久強化アイテムが上げるステータスの表示名。 */
export const STAT_LABELS = {
  hp: '最大HP',
  mp: '最大MP',
  atk: 'こうげき',
  def: 'ぼうぎょ',
  int: 'かしこさ',
  spd: 'すばやさ',
};

export function usableInBattle(item) {
  return item?.usableIn === USABLE_IN.BATTLE || item?.usableIn === USABLE_IN.BOTH;
}

export function usableInTown(item) {
  return item?.usableIn === USABLE_IN.TOWN || item?.usableIn === USABLE_IN.BOTH;
}

/**
 * ダンジョンを歩いているあいだに使えるか (フィールドの どうぐ 欄に出る)。
 *
 * ダンジョン脱出(キメラのつばさ)は usableIn が '戦闘' のままになっている。
 * 歩けるダンジョンが無かった頃の名残で、当時は戦闘中しか使いどころが
 * 無かったため。いまは「歩いていて引き返したい」ときこそ使いたいので、
 * 効果で拾ってフィールドにも出す。
 */
export function usableInField(item) {
  return item?.usableIn === USABLE_IN.FIELD || item?.effect === 'escape_dungeon';
}

/** 対象の選び方。'味方単体' なら誰に使うかクリックさせる、'なし' なら即発動。 */
export function itemTargetKind(item) {
  return item?.target ?? 'なし';
}

/** 蘇生アイテムは「生きている味方」ではなく「戦闘不能の味方」を選ばせる。 */
export function targetsDownedAlly(item) {
  return item?.effect === 'revive';
}

// --- ふくろ -------------------------------------------------------------

/** 未知のidや0個を落として、正規化したふくろを返す(セーブ読み込み時に使う)。 */
export function sanitizeInventory(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).forEach((id) => {
    if (!ITEM_BY_ID[id]) return; // items.json から消えたidは捨てる
    const n = Math.floor(Number(raw[id]) || 0);
    if (n > 0) out[id] = Math.min(BAG_STACK_LIMIT, n);
  });
  return out;
}

/** 使用中のスロット数 = 1個以上持っている種類の数。 */
export function usedSlots(inventory) {
  return Object.keys(inventory || {}).filter((id) => (inventory[id] || 0) > 0).length;
}

export function bagIsFull(inventory) {
  return usedSlots(inventory) >= BAG_SLOT_LIMIT;
}

/**
 * ふくろに入れる。入り切らないぶんは黙って捨てず、理由を返す。
 * @returns {{inventory:object, added:number, rejected:number, ok:boolean, message:string}}
 */
export function addToInventory(inventory, itemId, count = 1) {
  const item = ITEM_BY_ID[itemId];
  const inv = { ...(inventory || {}) };
  const want = Math.max(0, Math.floor(count));
  if (!item || want === 0) {
    return { inventory: inv, added: 0, rejected: want, ok: false, message: '' };
  }

  const current = inv[itemId] || 0;

  if (current === 0 && usedSlots(inv) >= BAG_SLOT_LIMIT) {
    return {
      inventory: inv,
      added: 0,
      rejected: want,
      ok: false,
      message: `ふくろが いっぱいで ${item.name} を 持ちきれなかった！（${BAG_SLOT_LIMIT}/${BAG_SLOT_LIMIT}スロット）`,
    };
  }

  const space = BAG_STACK_LIMIT - current;
  const added = Math.min(want, space);
  const rejected = want - added;
  if (added > 0) inv[itemId] = current + added;

  let message = '';
  if (added > 0 && rejected === 0) {
    message = `${item.name} を ${added}コ 手に入れた！`;
  } else if (added > 0) {
    message = `${item.name} を ${added}コ 手に入れた！（1スロットは ${BAG_STACK_LIMIT}コまで。${rejected}コ 持ちきれなかった）`;
  } else {
    message = `${item.name} は もう ${BAG_STACK_LIMIT}コ 持っている！ これいじょう 持てない。`;
  }

  return { inventory: inv, added, rejected, ok: added > 0, message };
}

export function removeFromInventory(inventory, itemId, count = 1) {
  const inv = { ...(inventory || {}) };
  const current = inv[itemId] || 0;
  const next = current - Math.max(0, Math.floor(count));
  if (next > 0) inv[itemId] = next;
  else delete inv[itemId]; // 0個になったらスロットを空ける
  return inv;
}

// --- 拠点での使用 -------------------------------------------------------

/**
 * 拠点でアイテムを1体に使う。instance を直接書き換える(呼び出し側がクローン済み前提)。
 * @returns {{ok:boolean, message:string}}
 */
export function applyItemToInstance(instance, species, item) {
  if (!instance || !species || !item) return { ok: false, message: '' };
  const name = species.name;

  if (item.effect === 'heal_hp') {
    if (instance.hp <= 0) {
      return { ok: false, message: `${name} は 戦闘不能だ。まずは よみがえらせないと。` };
    }
    if (instance.hp >= instance.stats.hp) {
      return { ok: false, message: `${name} の HPは 満タンだ。` };
    }
    const before = instance.hp;
    instance.hp = Math.min(instance.stats.hp, instance.hp + item.amount);
    return { ok: true, message: `${name} の HPが ${instance.hp - before} 回復した！` };
  }

  if (item.effect === 'heal_mp') {
    if (instance.hp <= 0) {
      return { ok: false, message: `${name} は 戦闘不能だ。まずは よみがえらせないと。` };
    }
    if (instance.mp >= instance.stats.mp) {
      return { ok: false, message: `${name} の MPは 満タンだ。` };
    }
    const before = instance.mp;
    instance.mp = Math.min(instance.stats.mp, instance.mp + item.amount);
    return { ok: true, message: `${name} の MPが ${instance.mp - before} 回復した！` };
  }

  if (item.effect === 'heal_hp_full_all') {
    // 単体に使われた場合のフォールバック(全体版は gameStore 側で処理する)
    instance.hp = instance.stats.hp;
    instance.mp = instance.stats.mp;
    return { ok: true, message: `${name} は 全回復した！` };
  }

  if (item.effect === 'revive') {
    if (instance.hp > 0) {
      return { ok: false, message: `${name} は 戦闘不能では ない。` };
    }
    instance.hp = Math.max(1, Math.floor(instance.stats.hp * (item.amount ?? 0.5)));
    return { ok: true, message: `${name} は いきを ふきかえした！（HP ${instance.hp}）` };
  }

  if (item.effect === 'cure_ailment') {
    // 状態異常は戦闘中だけの状態なので、拠点では効きようがない
    cureAilments(instance, item.cures);
    return { ok: false, message: '状態異常は 戦闘中にしか 起きない。ここでは 使えない。' };
  }

  if (item.effect === 'boost_stat') {
    const key = item.stat;
    if (!STAT_LABELS[key]) return { ok: false, message: '' };
    const beforeStat = instance.stats[key];
    instance.baseStats[key] = (instance.baseStats[key] ?? 0) + item.amount;
    recalcStats(instance, species);
    const gained = instance.stats[key] - beforeStat;
    return {
      ok: true,
      message: `${name} の ${STAT_LABELS[key]} が ${gained} 上がった！（${beforeStat} → ${instance.stats[key]}）`,
    };
  }

  return { ok: false, message: 'ここでは 使えない どうぐだ。' };
}

export default {
  ITEMS,
  ITEM_BY_ID,
  BAG_SLOT_LIMIT,
  BAG_STACK_LIMIT,
  usedSlots,
  bagIsFull,
  addToInventory,
  removeFromInventory,
  sanitizeInventory,
  usableInBattle,
  usableInTown,
  usableInField,
  itemTargetKind,
  applyItemToInstance,
};
