// dungeonRun.js
// 「歩けるダンジョン」1回ぶんの進行状態と、エンカウント抽選。
//
// v0.4 まで、ダンジョンは dungeons.json の encounters[] を頭から順に
// 自動再生するだけだった。v0.5 からはフロアを実際に歩き、
// **歩数**でランダムエンカウントが起きる。ボスだけは最下層の
// 下り階段の先に固定で置いてある。
//
// 敵のプール自体は今までどおり dungeons.json が真実。
// isBoss でない encounters[] を「この階層に出る敵の組み合わせ」の
// 一覧として使い、そこから毎回1組を引く。
// (組み合わせと敵レベルは monster_project/build_dungeons.py が
//  勝率シミュレーションまでして決めているので、勝手に混ぜない)
//
// 歩数のしきい値も build_dungeons.py が決めている(dungeon.encounterSteps)。
// 「このダンジョンは雑魚N戦ぶんの強さで設計した」を
// 「踏破に必要な歩数 ÷ N」に翻訳した値。ここではその値を中心にばらつかせる。

/** encounterSteps が無い古いデータ用の保険。 */
const DEFAULT_ENCOUNTER_STEPS = 14;

/** しきい値のばらつき。平均は encounterSteps ちょうどになる。 */
const JITTER_LO = 0.55;
const JITTER_HI = 1.45;

/** どんなに運が悪くても、これより短い間隔では出さない(戦闘直後の連戦よけ)。 */
const HARD_MIN_STEPS = 4;

/** せいすいの効果。しきい値をこの倍率で伸ばす = 遭遇率がおよそ 1/2.5。 */
export const HOLY_WATER_MULTIPLIER = 2.5;

/** せいすいの持続歩数 (items.json の amount を使うが、無ければこれ)。 */
export const HOLY_WATER_STEPS = 100;

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

/** 雑魚エンカウントの候補 (ボスを除いた encounters[])。 */
export function mobEncounters(dungeon) {
  return (dungeon.encounters || []).filter((e) => !e.isBoss);
}

export function bossEncounter(dungeon) {
  return (dungeon.encounters || []).find((e) => e.isBoss) || null;
}

/** 次の戦闘までの歩数を引く。せいすいが効いていれば間隔が伸びる。 */
export function rollStepsToEncounter(dungeon, holySteps = 0) {
  const base = dungeon.encounterSteps || DEFAULT_ENCOUNTER_STEPS;
  const mult = holySteps > 0 ? HOLY_WATER_MULTIPLIER : 1;
  const span = base * mult;
  const floor = Math.max(HARD_MIN_STEPS, Math.round(span * 0.35));
  return Math.max(floor, Math.round(span * rand(JITTER_LO, JITTER_HI)));
}

/** ダンジョンに入ったときの走行状態。 */
export function createRun(dungeon) {
  return {
    dungeon,
    floors: dungeon.floors || 1,
    floorIndex: 0,
    // 直近の立ち位置。戦闘から戻ったときにここへ復帰する。
    pose: null,
    steps: 0,          // このダンジョンで歩いた合計
    fights: 0,         // 起きた雑魚戦の数
    stepsToNext: rollStepsToEncounter(dungeon, 0),
    holySteps: 0,      // せいすいの残り歩数
    // この潜りの種。宝箱の中身をこれと宝箱idから決める。
    // 種を潜るたびに引き直すのは、宝箱idだけで決めると
    // 「あの部屋の宝箱はいつも からっぽ」を覚えられてしまうから。
    // (置き場所のほうは毎回同じ。動く宝箱は「さっき開けたのに」になる)
    seed: (Math.random() * 0xffffffff) >>> 0,
    // 開けた宝箱。**1回の潜りのあいだ**だけ覚えている。
    // 階を行き来しても戦闘をはさんでも開いたままだが、いったん町へ帰って
    // 入り直すと元に戻る。ダンジョンは「1回ぶんの挑戦」が単位で、
    // 永続の宝箱にすると2回目以降は空箱を見に行くだけの場所になってしまう。
    openedChests: {},
    // 拾った床のどうぐ。宝箱とまったく同じ扱い(潜りのあいだだけ覚える)。
    pickedItems: {},
    // 検証用の記録。フロアごとの歩数と戦闘数。
    floorLog: [{ floor: 0, steps: 0, fights: 0 }],
  };
}

// ------------------------------------------------------------------ 宝箱

export function isChestOpened(run, chestId) {
  return !!(run && run.openedChests && run.openedChests[chestId]);
}

export function markChestOpened(run, chestId) {
  if (!run) return;
  if (!run.openedChests) run.openedChests = {};
  run.openedChests[chestId] = true;
}

// -------------------------------------------------------------- 床のどうぐ

export function isFloorItemTaken(run, itemKey) {
  return !!(run && run.pickedItems && run.pickedItems[itemKey]);
}

export function markFloorItemTaken(run, itemKey) {
  if (!run) return;
  if (!run.pickedItems) run.pickedItems = {};
  run.pickedItems[itemKey] = true;
}

/** 文字列 -> 32bit整数 (FNV-1a)。宝箱ごとに同じ中身を出すために使う。 */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 宝箱の表が無い古いデータ用の保険。 */
const FALLBACK_CHEST = {
  mix: { empty: 0.18, gold: 0.34, item: 0.33, both: 0.15 },
  gold: { base: 30, perFloor: 0.35, spread: 0.3 },
  items: [{ itemId: 'item_jouyakusou', count: 1, weight: 1 }],
};

/** 同じ宝箱から、用途ちがいの乱数を何本も取り出す。0〜1未満。 */
function roll(chestId, seed, salt) {
  return (hash32(`${chestId}#${seed}#${salt}`) % 100000) / 100000;
}

/** 重みつきの1件を引く。 */
function pickWeighted(list, r) {
  const total = list.reduce((sum, e) => sum + Math.max(0, e.weight || 1), 0);
  if (total <= 0) return list[0];
  let acc = r * total;
  for (let i = 0; i < list.length; i += 1) {
    acc -= Math.max(0, list[i].weight || 1);
    if (acc < 0) return list[i];
  }
  return list[list.length - 1];
}

/**
 * 宝箱の中身。
 *
 * 床に落ちている やくそう と同じ物を出しても、わざわざ近づいて開けた甲斐がない。
 * だから宝箱は「大金」「床には落ちていない上位のどうぐ」「ときどき からっぽ」の
 * 3本立てにしてある。品ぞろえも割合も dungeons.json の chest が持っていて、
 * その表を作るのは monster_project/build_dungeons.py。
 *
 * 何が出るかは 宝箱id と **その潜りの種(run.seed)** から決まる。
 * 宝箱idだけで決めると中身が永久に固定され、
 * 「あの部屋の宝箱はいつも からっぽ」を覚えられて はずれが はずれでなくなる。
 * 種は潜るたびに引き直すので、同じ宝箱でも次に来たときは中身が変わる。
 *
 * @returns {{empty:boolean, gold:number, items:{itemId,count}[]}}
 */
export function chestReward(dungeon, floorIndex, chestId, seed = 0) {
  const table = (dungeon && dungeon.chest) || FALLBACK_CHEST;
  const mix = table.mix || FALLBACK_CHEST.mix;

  // からっぽ / ゴールドだけ / どうぐだけ / 両方 を1本の乱数で振り分ける。
  const r = roll(chestId, seed, 'kind');
  const empty = mix.empty || 0;
  const gold = empty + (mix.gold || 0);   // ここまでが「ゴールドだけ」
  const item = gold + (mix.item || 0);    // ここまでが「どうぐだけ」。残りが「両方」
  if (r < empty) return { empty: true, gold: 0, items: [] };
  const wantGold = r < gold || r >= item;
  const wantItem = r >= gold;

  const out = { empty: false, gold: 0, items: [] };

  if (wantGold) {
    const g = table.gold || FALLBACK_CHEST.gold;
    const depth = 1 + (g.perFloor ?? 0) * floorIndex;
    const spread = g.spread ?? 0;
    // 幅のまん中が base になるように ±spread で振る。
    const jitter = 1 - spread + roll(chestId, seed, 'gold') * spread * 2;
    const amount = (g.base || 0) * depth * jitter;
    out.gold = Math.max(5, Math.round(amount / 5) * 5);
  }

  if (wantItem) {
    const pool = table.items && table.items.length > 0 ? table.items : FALLBACK_CHEST.items;
    const entry = pickWeighted(pool, roll(chestId, seed, 'item'));
    out.items.push({ itemId: entry.itemId, count: Math.max(1, entry.count || 1) });
  }

  return out;
}

/** 階を移る。歩数カウンタは持ち越す(フロアをまたいでも安全にはならない)。 */
export function moveToFloor(run, floorIndex) {
  run.floorIndex = floorIndex;
  run.floorLog.push({ floor: floorIndex, steps: 0, fights: 0 });
}

function currentFloorLog(run) {
  return run.floorLog[run.floorLog.length - 1];
}

/**
 * 1歩ぶん進める。
 * @returns {null | {encounter}} 戦闘が起きたらそのエンカウント定義
 */
export function advanceStep(run) {
  run.steps += 1;
  currentFloorLog(run).steps += 1;
  if (run.holySteps > 0) run.holySteps -= 1;

  run.stepsToNext -= 1;
  if (run.stepsToNext > 0) return null;

  const pool = mobEncounters(run.dungeon);
  run.stepsToNext = rollStepsToEncounter(run.dungeon, run.holySteps);
  if (pool.length === 0) return null;

  run.fights += 1;
  currentFloorLog(run).fights += 1;
  const encounter = pool[Math.floor(Math.random() * pool.length)];
  return { encounter };
}

/**
 * 戦闘から戻ったとき。
 * しきい値は advanceStep が既に引き直しているので、ここで引き直すと
 * 「2回引いて大きいほう」になってしまい、平均の間隔が伸びる。
 * ここは「戻った直後の1〜2歩でまた襲われる」のを防ぐ下限だけ置く。
 */
export const POST_BATTLE_GRACE = 3;

export function resumeAfterBattle(run) {
  run.stepsToNext = Math.max(run.stepsToNext, POST_BATTLE_GRACE);
}

/** せいすいを使う。 */
export function applyHolyWater(run, steps = HOLY_WATER_STEPS) {
  run.holySteps = Math.max(run.holySteps, steps);
  // 効果は「次のしきい値」から効く。今のカウンタも伸ばしてやらないと
  // 使った直後の1戦が防げず、効いていないように見える。
  run.stepsToNext = Math.max(run.stepsToNext, rollStepsToEncounter(run.dungeon, run.holySteps));
  return run.holySteps;
}
