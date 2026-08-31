// saveSlots.js
// セーブ枠(スロット)。
//
// v0.7 まで、セーブは1本だけだった。gameStore.js が 'mrg_owned' のような
// 決め打ちのキーに書いていたので、遊び方を変えて試したいときは
// 前のデータを消すしかなかった。
//
// ここでキーに枠の番号をはさんで、3本まで別々に持てるようにする。
//
//   旧: mrg_owned         mrg_party         mrg_gold  …
//   新: mrg_slot1_owned   mrg_slot1_party   mrg_slot1_gold  …
//       mrg_slot2_owned   …
//
// ゲーム本体(gameStore)は「いまどの枠か」だけ受け取り、あとは今までどおり
// 書くだけでよい。枠をまたぐ処理は全部この1枚に閉じてある。
//
// 枠の中身の一覧(タイトル画面のカード)は、保存された値をそのまま読んで
// その場で組み立てる。要約を別に保存すると、本体と食い違ったときに
// 直しようがないため(「レベル25と出ているのに入ると20」が起きる)。

import monsters from '../data/monsters.json';
import dungeons from '../data/dungeons.json';
import { displayName } from '../engine/instance.js';

/**
 * 枠の数。
 * 3本にしたのは、スマホ横(高さ390px)の1画面にカードが収まる上限だから。
 * 増やすときはここだけ変えれば、タイトル画面の一覧もそれに追従する
 * (ただし4本以上ではカードが縦に溢れるので、レイアウトの見直しが要る)。
 */
export const SLOT_COUNT = 3;

/** 枠の番号の一覧。1始まり(画面に「1」「2」「3」と出るのと同じ)。 */
export const SLOT_IDS = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1);

/** 踏破の分母。カードの「n/12」に出す。 */
export const DUNGEON_TOTAL = Array.isArray(dungeons) ? dungeons.length : 0;

/**
 * 移行が済んだかどうかの目印。
 * 値は「移行を行った版」。将来もう一度キーの形を変えたくなったとき、
 * どこまで済んでいるか判別できるようにしてある。
 */
const MIGRATION_KEY = 'mrg_slots_version';
const MIGRATION_VERSION = '1';

/** v0.7 以前の、枠のない決め打ちキー。移行元としてだけ使う。 */
const LEGACY_KEYS = {
  party: 'mrg_party',
  clearedDungeons: 'mrg_cleared_dungeons',
  inventory: 'mrg_inventory',
  owned: 'mrg_owned',
  discovered: 'mrg_discovered',
  gold: 'mrg_gold',
};

/** 保存する項目。キーの後半部分だけを並べてある。 */
const FIELDS = ['party', 'clearedDungeons', 'inventory', 'owned', 'discovered', 'gold'];

const FIELD_SUFFIX = {
  party: 'party',
  clearedDungeons: 'cleared_dungeons',
  inventory: 'inventory',
  owned: 'owned',
  discovered: 'discovered',
  gold: 'gold',
};

/** 最後に遊んだ時刻を入れておく小さな箱。カードの日付はこれ。 */
const META_SUFFIX = 'meta';

const MONSTER_BY_ID = {};
monsters.forEach((m) => { MONSTER_BY_ID[m.id] = m; });

export function isValidSlot(slot) {
  return Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT;
}

/**
 * 1つの枠の localStorage キー一式。
 * gameStore はこれを受け取って、今までと同じように読み書きする。
 */
export function slotKeys(slot) {
  const n = isValidSlot(slot) ? slot : 1;
  const keys = {};
  FIELDS.forEach((f) => { keys[f] = `mrg_slot${n}_${FIELD_SUFFIX[f]}`; });
  return keys;
}

function metaKey(slot) {
  return `mrg_slot${slot}_${META_SUFFIX}`;
}

/** その枠に属する全キー(本体 + meta)。消すときに使う。 */
function allKeysOf(slot) {
  return [...Object.values(slotKeys(slot)), metaKey(slot)];
}

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    return null;
  }
}

function readJson(key, fallback) {
  const raw = readRaw(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeRaw(key, raw) {
  try {
    localStorage.setItem(key, raw);
  } catch (e) { /* localStorage が使えない環境でも落とさない */ }
}

function removeKey(key) {
  try {
    localStorage.removeItem(key);
  } catch (e) { /* noop */ }
}

// ------------------------------------------------------------------ 移行

/**
 * 枠のない旧セーブ(mrg_owned など)を 枠1へ移す。
 *
 * 遊んでいる途中の人がこの版を開いたとき、進行が消えないようにするための処理。
 * **1回だけ** 走る(目印を立てる)。旧キーは消さずに残す — 万一この移行に
 * 不具合があっても、元データが手元に残っていれば拾い直せる。
 *
 * 枠1にすでに中身があるときは何もしない(上書きしてしまうため)。
 */
export function migrateLegacySave() {
  if (readRaw(MIGRATION_KEY) === MIGRATION_VERSION) return false;

  const legacyOwned = readRaw(LEGACY_KEYS.owned);
  const hasLegacy = legacyOwned != null;
  const slot1Occupied = readRaw(slotKeys(1).owned) != null;

  let moved = false;
  if (hasLegacy && !slot1Occupied) {
    const keys = slotKeys(1);
    FIELDS.forEach((f) => {
      const raw = readRaw(LEGACY_KEYS[f]);
      if (raw != null) writeRaw(keys[f], raw);
    });
    // 「最後に遊んだ日」は分からないので、移行した時刻を入れる。
    writeRaw(metaKey(1), JSON.stringify({ updatedAt: Date.now(), migrated: true }));
    moved = true;
    // eslint-disable-next-line no-console
    console.info('[saveSlots] 枠のない旧セーブを セーブ1へ移しました');
  }

  writeRaw(MIGRATION_KEY, MIGRATION_VERSION);
  return moved;
}

// -------------------------------------------------------------- 書き込み

/** 「いま遊んだ」印を押す。gameStore が保存のたびに呼ぶ。 */
export function touchSlot(slot) {
  if (!isValidSlot(slot)) return;
  writeRaw(metaKey(slot), JSON.stringify({ updatedAt: Date.now() }));
}

/** 枠を空にする。「はじめから」で上書きするときと、消すときの両方で使う。 */
export function clearSlot(slot) {
  if (!isValidSlot(slot)) return;
  allKeysOf(slot).forEach(removeKey);
}

// ---------------------------------------------------------------- 読み出し

/**
 * 枠1つぶんの要約。タイトル画面のカードはこれだけを見る。
 *
 * @returns {{
 *   slot:number, empty:boolean, updatedAt:number|null,
 *   party:{uid:string,name:string,level:number,spriteUrl:string|null}[],
 *   ownedCount:number, maxLevel:number, cleared:number, total:number, gold:number
 * }}
 */
export function readSlotSummary(slot) {
  const base = {
    slot,
    empty: true,
    updatedAt: null,
    party: [],
    ownedCount: 0,
    maxLevel: 0,
    cleared: 0,
    total: DUNGEON_TOTAL,
    gold: 0,
  };
  if (!isValidSlot(slot)) return base;

  const keys = slotKeys(slot);
  const owned = readJson(keys.owned, null);
  // 中身の判定は owned で行う。ここが無い/空なら、他に何が残っていても
  // 「まだ始めていない枠」として扱う(開始イベントからやり直しになる)。
  if (!Array.isArray(owned) || owned.length === 0) return base;

  const byUid = {};
  owned.forEach((inst) => { if (inst && inst.uid) byUid[inst.uid] = inst; });

  const partyUids = readJson(keys.party, []);
  const partyList = (Array.isArray(partyUids) ? partyUids : [])
    .map((uid) => byUid[uid])
    .filter(Boolean);
  // 編成が空のセーブ(開始イベントの途中で閉じたなど)でも、
  // カードが真っ白にならないように 手持ちの頭から埋める。
  const shown = partyList.length > 0 ? partyList : owned.slice(0, 3);

  const meta = readJson(metaKey(slot), null);
  const clearedList = readJson(keys.clearedDungeons, []);
  const gold = Number(readJson(keys.gold, 0));

  return {
    slot,
    empty: false,
    updatedAt: meta && Number.isFinite(meta.updatedAt) ? meta.updatedAt : null,
    party: shown.map((inst) => {
      const species = MONSTER_BY_ID[inst.speciesId];
      return {
        uid: inst.uid,
        name: displayName(inst, species),
        level: Number(inst.level) || 1,
        spriteUrl: species?.spriteUrl || null,
      };
    }),
    ownedCount: owned.length,
    maxLevel: owned.reduce((mx, inst) => Math.max(mx, Number(inst?.level) || 1), 0),
    cleared: Array.isArray(clearedList) ? clearedList.length : 0,
    total: DUNGEON_TOTAL,
    gold: Number.isFinite(gold) ? Math.max(0, Math.floor(gold)) : 0,
  };
}

/** 全部の枠の要約。タイトル画面が一覧を出すときに1回だけ呼ぶ。 */
export function readAllSlots() {
  return SLOT_IDS.map(readSlotSummary);
}

/** 「2026/09/01 14:03」。年をまたいで遊ぶので年から出す。 */
export function formatPlayedAt(ts) {
  if (!ts) return '記録なし';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '記録なし';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
