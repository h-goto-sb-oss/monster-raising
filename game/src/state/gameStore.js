// gameStore.js
// 最小限のグローバル状態: 所持モンスター・パーティー編成・ダンジョン進行・
// 所持アイテム・配合の発見済みリストを保持し、localStorageへ永続化する。
//
// 所持(owned)について:
//   v0.2 から「個体(instance)の配列」になった。種族IDの配列ではない。
//   同じ種族を2体持てるようになり、レベル/経験値/個体値/プラス値が乗る。
//   party は個体の uid の配列。
//
//   旧形式(種族IDの文字列配列)のセーブは互換性がないので **破棄** する。
//   所持が空になるので App が開始イベントへ回してくれる。
//   初期所持199体の配布は廃止した。物語は1体から始まる (要望1)。

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import monsters from '../data/monsters.json';
import skillsRaw from '../data/skills.json';
import { createInstance, displayName, looksLikeInstanceArray, MAX_PLUS } from '../engine/instance.js';
import { recalcStats, setLevel, MAX_LEVEL } from '../engine/growth.js';
import { createChildInstance } from '../engine/inherit.js';
import {
  ITEMS as items,
  ITEM_BY_ID,
  BAG_SLOT_LIMIT,
  BAG_STACK_LIMIT,
  addToInventory,
  removeFromInventory,
  sanitizeInventory,
  usedSlots,
  usableInTown,
  applyItemToInstance,
} from '../engine/items.js';

const STORAGE_KEYS = {
  party: 'mrg_party',
  clearedDungeons: 'mrg_cleared_dungeons',
  inventory: 'mrg_inventory',
  owned: 'mrg_owned',
  discovered: 'mrg_discovered',
  gold: 'mrg_gold',
};

const PARTY_LIMIT = 3;

// 所持金の上限。表示の桁を決めたいので置いてあるだけで、
// 普通に遊んでいて当たる値ではない。
const GOLD_LIMIT = 9999999;

/** 最初の所持金。ダンジョンの宝箱で稼ぐものなので、手ぶらで始める。 */
const STARTING_GOLD = 0;

// 最初から持っているどうぐ (仮データ)。20スロットの上限に余裕を残しておく。
const STARTING_ITEMS = {
  item_yakusou: 5,
  item_mahounomizu: 3,
  item_dokukeshisou: 2,
  item_hoshiniku: 1,
  item_kimeranotsubasa: 1,
  // 歩けるダンジョン(v0.5)でランダムエンカウントが入り、
  // せいすいに効く相手ができた。最初から持たせて存在を知らせる。
  item_seisui: 2,
};

const MONSTER_BY_ID = {};
monsters.forEach((m) => {
  MONSTER_BY_ID[m.id] = m;
});

const SKILLS_BY_ID = {};
skillsRaw.forEach((s) => {
  SKILLS_BY_ID[s.id] = s;
});

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // localStorageが使えない環境でも落ちないようにする
  }
}

function defaultInventory() {
  return sanitizeInventory(STARTING_ITEMS);
}

/** 1234567 -> "1,234,567"。桁が多いと数えられないので、必ず区切って出す。 */
export function formatGold(n) {
  return Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('ja-JP');
}

/**
 * 保存されたふくろを読む。items.json から消えたidや、0個のスロットは捨てる。
 * (アイテム表を差し替えても、古いセーブで幽霊スロットが残らないようにする)
 */
function initialInventory() {
  const stored = loadJson(STORAGE_KEYS.inventory, null);
  if (stored == null) return defaultInventory();
  return sanitizeInventory(stored);
}

/**
 * 保存された所持を読む。個体形式でなければ(=v0.1以前のセーブ)まるごと捨てる。
 * 捨てた場合は party も一緒に無効になるので、開始イベントからやり直しになる。
 */
function initialOwned() {
  const stored = loadJson(STORAGE_KEYS.owned, null);
  if (!looksLikeInstanceArray(stored)) {
    if (stored != null) {
      // eslint-disable-next-line no-console
      console.info('[gameStore] 旧形式のセーブを検出したため破棄しました (個体モデルへ移行)');
      try {
        localStorage.removeItem(STORAGE_KEYS.owned);
        localStorage.removeItem(STORAGE_KEYS.party);
      } catch (e) { /* noop */ }
    }
    return [];
  }
  return stored.filter((inst) => MONSTER_BY_ID[inst.speciesId]);
}

function initialParty(owned) {
  const stored = loadJson(STORAGE_KEYS.party, null);
  const uids = new Set(owned.map((i) => i.uid));
  const base = Array.isArray(stored) ? stored : [];
  return base.filter((uid) => typeof uid === 'string' && uids.has(uid)).slice(0, PARTY_LIMIT);
}

const GameStoreContext = createContext(null);

export function GameStoreProvider({ children }) {
  const [owned, setOwned] = useState(initialOwned);
  const [party, setPartyState] = useState(() => initialParty(owned));
  const [discovered, setDiscovered] = useState(() => loadJson(STORAGE_KEYS.discovered, []));
  const [clearedDungeons, setClearedDungeons] = useState(() => loadJson(STORAGE_KEYS.clearedDungeons, []));
  const [inventory, setInventory] = useState(initialInventory);
  // 所持金。v0.6 で宝箱が「大金」をくれるようになって初めて意味を持った。
  // 使い道(どうぐ屋の売り買い)はまだ無い — お金だけ先に流れるようにしてある。
  const [gold, setGoldState] = useState(() => {
    const stored = Number(loadJson(STORAGE_KEYS.gold, STARTING_GOLD));
    return Number.isFinite(stored) ? Math.max(0, Math.floor(stored)) : STARTING_GOLD;
  });
  const suppressSave = useRef(false);
  // 司祭のお礼など「今の中身」を見てから足したい処理があるので、参照も持っておく
  const inventoryRef = useRef(inventory);
  inventoryRef.current = inventory;
  const goldRef = useRef(gold);
  goldRef.current = gold;
  // setParty は「今この瞬間の所持」で検証したい。
  // acquireSpecies の直後(=setOwnedがまだ反映されていない同一イベント内)に
  // 新しい個体をパーティーへ入れるケースがあるため、state だけでは足りない。
  const ownedRef = useRef(owned);
  ownedRef.current = owned;

  useEffect(() => {
    if (suppressSave.current) return;
    saveJson(STORAGE_KEYS.owned, owned);
  }, [owned]);
  useEffect(() => {
    if (suppressSave.current) return;
    saveJson(STORAGE_KEYS.party, party);
  }, [party]);
  useEffect(() => saveJson(STORAGE_KEYS.discovered, discovered), [discovered]);
  useEffect(() => saveJson(STORAGE_KEYS.clearedDungeons, clearedDungeons), [clearedDungeons]);
  useEffect(() => saveJson(STORAGE_KEYS.inventory, inventory), [inventory]);
  useEffect(() => saveJson(STORAGE_KEYS.gold, gold), [gold]);

  // roster は図鑑・敵データ参照用の全モンスター。プレイヤーが使えるのは owned だけ。
  const roster = monsters;
  const rosterById = MONSTER_BY_ID;

  const ownedByUid = useMemo(() => {
    const map = {};
    owned.forEach((inst) => {
      map[inst.uid] = inst;
    });
    return map;
  }, [owned]);

  // 表示用: 個体に種族レコードと表示名を貼り付けたビュー
  const ownedView = useMemo(
    () =>
      owned.map((inst) => {
        const species = MONSTER_BY_ID[inst.speciesId];
        return { instance: inst, species, name: displayName(inst, species) };
      }),
    [owned],
  );

  const partyInstances = useMemo(
    () => party.map((uid) => ownedByUid[uid]).filter(Boolean),
    [party, ownedByUid],
  );

  function setParty(uids) {
    const valid = new Set(ownedRef.current.map((i) => i.uid));
    setPartyState(uids.filter((uid) => valid.has(uid)).slice(0, PARTY_LIMIT));
  }

  function markDungeonCleared(dungeonId) {
    setClearedDungeons((prev) => (prev.includes(dungeonId) ? prev : [...prev, dungeonId]));
  }

  function consumeItem(itemId, count = 1) {
    setInventory((prev) => {
      const current = prev[itemId] || 0;
      if (current <= 0) return prev;
      return removeFromInventory(prev, itemId, count);
    });
    inventoryRef.current = removeFromInventory(inventoryRef.current, itemId, count);
  }

  /**
   * どうぐを手に入れる。ふくろが満杯なら黙って捨てず、理由つきで断る。
   * itemId も返すのは、受け取った側がアイコンを出せるようにするため
   * (司祭のお礼・踏破報酬の一覧はメッセージしか受け取っていなかった)。
   * @returns {{ok:boolean, added:number, itemId:string, message:string}}
   */
  function acquireItem(itemId, count = 1) {
    const result = addToInventory(inventoryRef.current, itemId, count);
    if (result.added > 0) {
      inventoryRef.current = result.inventory;
      setInventory(result.inventory);
    }
    return {
      ok: result.ok, added: result.added, itemId, message: result.message,
    };
  }

  /**
   * ゴールドを増やす。いまの出どころは宝箱だけ。
   * ふくろと違って上限で断ることはない(お金は かさばらない)。
   * @returns {{ok:boolean, amount:number, total:number, message:string}}
   */
  function addGold(amount) {
    const add = Math.max(0, Math.floor(Number(amount) || 0));
    if (add === 0) return { ok: false, amount: 0, total: goldRef.current, message: '' };
    // 同じイベントの中で続けて呼ばれても足し落とさないよう、refで積む
    // (acquireItem と同じ理由。setState の反映を待てない)。
    const total = Math.min(GOLD_LIMIT, goldRef.current + add);
    goldRef.current = total;
    setGoldState(total);
    return { ok: true, amount: add, total, message: `${formatGold(add)} ゴールドを 手に入れた！` };
  }

  /** デバッグ: ふくろを空にする。 */
  function emptyBag() {
    inventoryRef.current = {};
    setInventory({});
  }

  /**
   * 拠点でどうぐを1体に使う。たねの効果は baseStats に入るので永続する。
   * @returns {{ok:boolean, message:string}}
   */
  function useItemInTown(itemId, uid) {
    const item = ITEM_BY_ID[itemId];
    if (!item) return { ok: false, message: '' };
    if ((inventoryRef.current[itemId] || 0) <= 0) {
      return { ok: false, message: `${item.name} を 持っていない。` };
    }
    if (!usableInTown(item)) {
      return { ok: false, message: `${item.name} は 戦闘中にしか 使えない。` };
    }

    // 味方全体に効くどうぐ(せかいじゅのしずく)は手持ちパーティーが対象
    if (item.target === '味方全体') {
      const targetUids = new Set(party.length > 0 ? party : ownedRef.current.map((i) => i.uid));
      let changed = 0;
      const next = ownedRef.current.map((inst) => {
        if (!targetUids.has(inst.uid) || inst.hp <= 0) return inst;
        if (inst.hp === inst.stats.hp && inst.mp === inst.stats.mp) return inst;
        changed += 1;
        return { ...inst, hp: inst.stats.hp, mp: inst.stats.mp };
      });
      if (changed === 0) return { ok: false, message: '手持ち全員 元気いっぱいだ。' };
      ownedRef.current = next;
      setOwned(next);
      consumeItem(itemId);
      return { ok: true, message: `手持ち${changed}体の HPとMPが 全回復した！` };
    }

    const target = ownedRef.current.find((i) => i.uid === uid);
    if (!target) return { ok: false, message: '対象の モンスターを えらんでください。' };
    const species = MONSTER_BY_ID[target.speciesId];
    const clone = JSON.parse(JSON.stringify(target));
    const result = applyItemToInstance(clone, species, item);
    if (!result.ok) return result;

    const next = ownedRef.current.map((i) => (i.uid === uid ? clone : i));
    ownedRef.current = next;
    setOwned(next);
    consumeItem(itemId);
    return result;
  }

  // ------------------------------------------------------------- 個体の操作

  /** 種族から新しい個体を作って牧場に加える。 @returns 生成した個体 */
  function acquireSpecies(speciesId, opts = {}) {
    const species = MONSTER_BY_ID[speciesId];
    if (!species) return null;
    const inst = createInstance(species, { ...opts, skillsById: SKILLS_BY_ID });
    ownedRef.current = [...ownedRef.current, inst]; // 直後の setParty から見えるようにする
    setOwned((prev) => [...prev, inst]);
    setDiscovered((prev) => (prev.includes(speciesId) ? prev : [...prev, speciesId]));
    return inst;
  }

  /**
   * まとめて加える(デバッグ/野生仲間化用)。
   * 要素は種族idの文字列でも、{ id, level } でもよい。
   * 野生で仲間になった個体は「倒したときのレベル」で加わってほしいので後者を使う。
   */
  function acquireMany(entries, opts = {}) {
    const created = [];
    entries.forEach((entry) => {
      const id = typeof entry === 'string' ? entry : entry?.id;
      const species = MONSTER_BY_ID[id];
      if (!species) return;
      const level = (typeof entry === 'string' ? opts.level : entry.level ?? opts.level) ?? 1;
      created.push(createInstance(species, { ...opts, level, skillsById: SKILLS_BY_ID }));
    });
    if (created.length === 0) return [];
    ownedRef.current = [...ownedRef.current, ...created];
    setOwned((prev) => [...prev, ...created]);
    setDiscovered((prev) => {
      const set = new Set(prev);
      created.forEach((c) => set.add(c.speciesId));
      return Array.from(set);
    });
    return created;
  }

  /** 個体を差し替える(戦闘後の経験値反映など)。 */
  function replaceInstances(updated) {
    if (!updated || updated.length === 0) return;
    const byUid = {};
    updated.forEach((inst) => {
      byUid[inst.uid] = inst;
    });
    // 同一イベント内で続けて司祭の回復が走るので、ref も即座に更新する。
    // (ref を更新しないと、司祭が戦闘前のHP/経験値で上書きしてしまう)
    ownedRef.current = ownedRef.current.map((inst) => byUid[inst.uid] ?? inst);
    setOwned(ownedRef.current);
  }

  /** 個体1体に手を入れる。fn(clone, species) を呼んで差し替える。 */
  function mutateInstance(uid, fn) {
    setOwned((prev) =>
      prev.map((inst) => {
        if (inst.uid !== uid) return inst;
        const clone = JSON.parse(JSON.stringify(inst));
        const species = MONSTER_BY_ID[clone.speciesId];
        fn(clone, species);
        return clone;
      }),
    );
  }

  /**
   * さくせんを個体に覚えさせる。
   *
   * 戦闘中の「さくせん」はその戦闘のあいだしか効かなかった(combatant にしか
   * 乗っていなかった)ので、毎回選び直しになっていた。
   * メニューから設定したぶんは個体に持たせて、次の戦闘の初期値にする
   * (engine/stats.js の createCombatantFromInstance が読む)。
   * @param {string|null} tacticId null = せいぎょする(手動操作)
   */
  function setTactic(uid, tacticId) {
    const next = tacticId || null;
    ownedRef.current = ownedRef.current.map((inst) => (
      inst.uid === uid ? { ...inst, tactic: next } : inst
    ));
    setOwned(ownedRef.current);
  }

  /** さくせんを手持ち全員に。1体ずつ選ばせるほどの違いが要らないときのため。 */
  function setTacticForParty(tacticId) {
    const next = tacticId || null;
    const targets = new Set(party.length > 0 ? party : ownedRef.current.map((i) => i.uid));
    ownedRef.current = ownedRef.current.map((inst) => (
      targets.has(inst.uid) ? { ...inst, tactic: next } : inst
    ));
    setOwned(ownedRef.current);
  }

  /** デバッグ: レベルを直接指定する。 */
  function debugSetLevel(uid, level) {
    mutateInstance(uid, (inst, species) => {
      setLevel(inst, species, Math.max(1, Math.min(MAX_LEVEL, level)), SKILLS_BY_ID);
      inst.hp = inst.stats.hp;
      inst.mp = inst.stats.mp;
    });
  }

  /** デバッグ: プラス値を直接指定する (ステータスも再計算される)。 */
  function debugSetPlus(uid, plus) {
    mutateInstance(uid, (inst, species) => {
      inst.plus = Math.max(0, Math.min(MAX_PLUS, Math.round(plus)));
      inst.stats = null;
      inst.hp = null;
      inst.mp = null;
      recalcStats(inst, species);
      inst.hp = inst.stats.hp;
      inst.mp = inst.stats.mp;
    });
  }

  /**
   * ダンジョンから帰ってきたときの、教会の司祭のはたらき。
   * 「教会に役割がないので、帰還のたびに司祭が全回復し、やくそうを1つくれる」
   * という設計をそのまま実装したもの。
   *   - 全員のHP/MPを全回復
   *   - 戦闘不能のなかまを復活
   *   - やくそうを1つ渡す (ふくろが満杯なら渡せなかったと伝える)
   * @returns {{healed:string[], revived:string[], gift:{ok:boolean,message:string}}}
   */
  function priestBlessing() {
    const healed = [];
    const revived = [];
    const next = ownedRef.current.map((inst) => {
      const species = MONSTER_BY_ID[inst.speciesId];
      const name = displayName(inst, species);
      const full = inst.stats?.hp ?? inst.hp;
      const fullMp = inst.stats?.mp ?? inst.mp;
      if (inst.hp <= 0) {
        revived.push(name);
        return { ...inst, hp: full, mp: fullMp };
      }
      if (inst.hp < full || inst.mp < fullMp) {
        healed.push(name);
        return { ...inst, hp: full, mp: fullMp };
      }
      return inst;
    });
    ownedRef.current = next;
    setOwned(next);

    const gift = acquireItem('item_yakusou', 1);
    return { healed, revived, gift };
  }

  /** パーティー全員を全回復する(デバッグ用)。 */
  function healParty() {
    ownedRef.current = ownedRef.current.map((inst) => {
      if (inst.hp === inst.stats.hp && inst.mp === inst.stats.mp) return inst;
      return { ...inst, hp: inst.stats.hp, mp: inst.stats.mp };
    });
    setOwned(ownedRef.current);
  }

  /**
   * 戦闘結果を反映する。
   * @param {object} outcome { instances: 更新済み個体クローン[], recruits: 種族id[] }
   */
  function applyBattleOutcome(outcome) {
    if (!outcome) return;
    replaceInstances(outcome.instances);
    if (outcome.recruits && outcome.recruits.length > 0) {
      acquireMany(outcome.recruits);
    }
  }

  /**
   * 配合を確定する。
   * 親2体(個体)を牧場から取り除き、子の個体を加える。
   * 子は「レベル1・種族のrank1技を1つだけ習得・継承技は全て未習得」で生まれる。
   */
  function applyFusion({ bloodlineUid, partnerUid, resultId }) {
    const species = MONSTER_BY_ID[resultId];
    const parentA = ownedByUid[bloodlineUid];
    const parentB = ownedByUid[partnerUid];
    if (!species || !parentA || !parentB) return null;

    // MONSTER_BY_ID を渡すのは、家系図に親の **表示名** を焼き込むため。
    // 親はこの直後に牧場から消えるので、あとから名前を引くことはできない。
    const child = createChildInstance(parentA, parentB, species, SKILLS_BY_ID, MONSTER_BY_ID);
    ownedRef.current = [...ownedRef.current.filter((i) => i.uid !== bloodlineUid && i.uid !== partnerUid), child];
    setOwned((prev) => [...prev.filter((i) => i.uid !== bloodlineUid && i.uid !== partnerUid), child]);
    setPartyState((prev) => prev.filter((uid) => uid !== bloodlineUid && uid !== partnerUid));
    setDiscovered((prev) => (prev.includes(resultId) ? prev : [...prev, resultId]));
    return child;
  }

  /** デバッグ: セーブを初期化して開始イベントからやり直す。 */
  function resetSave() {
    suppressSave.current = true;
    try {
      Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
    } catch (e) { /* noop */ }
    window.location.reload();
  }

  const value = {
    roster,
    rosterById,
    skillsById: SKILLS_BY_ID,
    owned,
    ownedByUid,
    ownedView,
    partyInstances,
    discovered,
    party,
    setParty,
    partyLimit: PARTY_LIMIT,
    acquireSpecies,
    acquireMany,
    replaceInstances,
    applyBattleOutcome,
    applyFusion,
    setTactic,
    setTacticForParty,
    debugSetLevel,
    debugSetPlus,
    healParty,
    priestBlessing,
    resetSave,
    clearedDungeons,
    markDungeonCleared,
    inventory,
    items,
    consumeItem,
    acquireItem,
    gold,
    addGold,
    emptyBag,
    useItemInTown,
    bagSlotLimit: BAG_SLOT_LIMIT,
    bagStackLimit: BAG_STACK_LIMIT,
    bagUsedSlots: usedSlots(inventory),
    displayName,
  };

  return React.createElement(GameStoreContext.Provider, { value }, children);
}

export function useGameStore() {
  const ctx = useContext(GameStoreContext);
  if (!ctx) throw new Error('useGameStore must be used within GameStoreProvider');
  return ctx;
}
