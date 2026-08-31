// growth.js
// レベル・経験値・ステータス成長。GAME_SPEC_V0_1.md 5〜7項の実装。
//
// 設計の核心 (博史さんの要望6):
//   プラス値は「固定加算」ではなく「成長率への倍率」。しかも得意ステータスほど
//   倍率が大きくなるので、+1したからといって全ステータスが均等に伸びることはない。
//   物質系(def得意)を+99まで重ねれば伸びるのは主にdef、鳥翼系ならspd。
//
//   伸び[s]      = 種族成長率[s] x 個体補正[s] x プラス補正[s]
//   個体補正[s]  = 0.85 + iv[s]/100                 // 0.85〜1.15
//   プラス補正[s] = 1 + (plus/99) x 0.35 x 得意度[s]  // 得意ステで最大1.35倍
//
//   得意度[s] は monsters.json の affinity (タイプ係数を最大値で正規化したもの)。
//   成長量そのものを正規化に使うと HP が桁で大きく全種族 HP=1.0 になってしまい
//   「得意ステ」にならないため、build_game_data.py 側で別立てにしている。

export const MAX_LEVEL = 99;
export const STAT_KEYS = ['hp', 'mp', 'atk', 'def', 'int', 'spd'];

// ★が高いほどレベルを上げにくい (仕様書5項)
const STAR_EXP_FACTOR = { 1: 1.0, 2: 1.35, 3: 1.8, 4: 2.4 };

// 敵1体が持つ経験値の階級倍率 (仮データ)
const TIER_EXP_FACTOR = { 下位: 1.0, 中位: 1.6, 上位: 2.4, 最上位: 3.5 };

// 1体が同時に覚えていられる技の数 (仕様書7項)
export const MAX_LEARNED_SKILLS = 10;

/**
 * レベル曲線と経験値曲線の指数。この2つは必ずセットで考えること。
 *
 * 1レベル上げるのに必要な経験値は レベル^LEVEL_CURVE_POWER で増える。
 * 敵1体がくれる経験値は「敵のレベルでのステータス」x レベル^EXP_LEVEL_POWER。
 * 敵のステータス自体がレベルにほぼ比例するので、敵1体の経験値はだいたい
 * レベル^(1 + EXP_LEVEL_POWER) = レベル^2.1 で増え、必要経験値の レベル^2.0 と
 * つり合う。結果として「1レベル上げるのに倒す敵の数」がゲームを通してほぼ一定になる。
 *
 * 旧値は 2.4 / (レベル非依存) だった。必要経験値だけが爆発的に増える一方で
 * 敵の経験値が伸びず、後半はいくら潜ってもレベルが上がらなかった。
 *
 * この2つは monster_project/build_dungeons.py にも同じ値が書いてある。
 * 変更するときは両方を直し、build_dungeons.py を再実行して
 * ダンジョン12本の推奨レベルを引き直すこと(あちらの検証がここまで見ている)。
 */
export const LEVEL_CURVE_POWER = 2.0;
export const EXP_LEVEL_POWER = 1.1;

/**
 * 敵の個体値。敵に個体差は持たせないので中央値(15)固定。
 * ivFactor がちょうど 1.00 になるので、敵のステータスは
 * 「種族基礎 + (Lv-1) x 種族成長率」というきれいな式になる。
 */
export const ENEMY_IV = { hp: 15, mp: 15, atk: 15, def: 15, int: 15, spd: 15 };

/** 現在レベルから次のレベルへ上がるのに必要な経験値。 */
export function expToNextLevel(level, star) {
  if (level >= MAX_LEVEL) return Infinity;
  const factor = STAR_EXP_FACTOR[star] ?? 1.0;
  return Math.round(6 * Math.pow(level, LEVEL_CURVE_POWER) * factor);
}

/**
 * 指定レベルでの敵のステータス。
 * プレイヤーと同じ statsAtLevel を通す。敵専用の第2の計算式は作らない
 * (作ると必ず食い違い、「同じレベルなのに強さが違う」バグの温床になる)。
 */
export function enemyStatsAtLevel(species, level) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.round(level || 1)));
  return statsAtLevel({ iv: ENEMY_IV, plus: 0, level: lv }, species, lv);
}

/**
 * 敵1体を倒したときに得られる経験値。
 * 素の種族ステータスではなく「そのレベルでのステータス」を使うので、
 * 同じ種族でも深いダンジョンに出てくる個体ほど経験値が多い。
 */
export function enemyExpValue(species, level = 1) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.round(level || 1)));
  const s = enemyStatsAtLevel(species, lv);
  const raw = s.hp / 4 + s.mp / 2 + s.atk + s.def + s.int + s.spd;
  const factor = TIER_EXP_FACTOR[species.tier] ?? 1.0;
  return Math.max(1, Math.round(raw * factor * Math.pow(lv, EXP_LEVEL_POWER)));
}

/** 個体値による成長補正 (0.85〜1.15)。 */
export function ivFactor(iv, key) {
  return 0.85 + (iv?.[key] ?? 0) / 100;
}

/** プラス値による成長補正。得意ステータスほど大きい。 */
export function plusFactor(plus, affinity, key) {
  const aff = affinity?.[key] ?? 1;
  return 1 + (Math.min(99, plus || 0) / 99) * 0.35 * aff;
}

/** 1レベルあたりの実際の伸び (小数のまま返す)。 */
export function perLevelGain(instance, species, key) {
  const growth = species.growth?.[key] ?? 0;
  return growth * ivFactor(instance.iv, key) * plusFactor(instance.plus, species.affinity, key);
}

/**
 * 指定レベルでの実ステータス。
 * baseStats (= 種族基礎 + 配合で親から受け継いだ分) に、
 * レベル1からの累積成長を足す。レベルから一意に決まるので再計算しても壊れない。
 */
export function statsAtLevel(instance, species, level) {
  const lv = Math.max(1, Math.min(MAX_LEVEL, level ?? instance.level));
  const out = {};
  STAT_KEYS.forEach((key) => {
    const base = instance.baseStats?.[key] ?? species.stats[key];
    out[key] = base + Math.floor((lv - 1) * perLevelGain(instance, species, key));
  });
  return out;
}

/** instance.stats を現在レベルに合わせて再計算する (破壊的)。 */
export function recalcStats(instance, species) {
  const before = instance.stats || {};
  const next = statsAtLevel(instance, species, instance.level);
  // HP/MPの現在値は、最大値の増加分だけ一緒に増やす(レベルアップで全快はしない)
  const hpGain = next.hp - (before.hp ?? next.hp);
  const mpGain = next.mp - (before.mp ?? next.mp);
  instance.stats = next;
  instance.hp = Math.max(0, Math.min(next.hp, (instance.hp ?? next.hp) + Math.max(0, hpGain)));
  instance.mp = Math.max(0, Math.min(next.mp, (instance.mp ?? next.mp) + Math.max(0, mpGain)));
  return instance;
}

/**
 * そのレベルで習得すべき技を反映する (破壊的)。
 * - 種族の learnset から learnLevel 以下のものを覚える
 * - 継承枠(inherited)も learnLevel に達したら learned へ移す = 「習得予約」の解禁
 * - 同系統(line)の上位を覚えたら下位を上書きする (仕様書7項)
 * @returns {string[]} 覚えた技の名前ログ
 */
export function applySkillLearning(instance, species, skillsById) {
  const logs = [];
  const learn = (skillId) => {
    const skill = skillsById[skillId];
    if (!skill) return;
    if (instance.learned.includes(skillId)) return;

    // 同系統の下位呪文は上書きして消す
    if (skill.line) {
      const replaced = instance.learned.filter((id) => {
        const s = skillsById[id];
        return s && s.line === skill.line && (s.rank ?? 1) < (skill.rank ?? 1);
      });
      if (replaced.length > 0) {
        instance.learned = instance.learned.filter((id) => !replaced.includes(id));
        const oldName = skillsById[replaced[0]].name;
        logs.push(`${oldName} は ${skill.name} に かわった！`);
      } else if (instance.learned.some((id) => {
        const s = skillsById[id];
        return s && s.line === skill.line && (s.rank ?? 1) > (skill.rank ?? 1);
      })) {
        // 既に上位を覚えているので下位は覚えない
        return;
      }
    }

    if (instance.learned.length >= MAX_LEARNED_SKILLS) return;
    instance.learned.push(skillId);
    if (logs.length === 0 || !logs[logs.length - 1].includes(skill.name)) {
      logs.push(`${skill.name} を おぼえた！`);
    }
  };

  (species.learnset || [])
    .filter((e) => e.level <= instance.level)
    .sort((a, b) => a.level - b.level)
    .forEach((e) => learn(e.skillId));

  const due = (instance.inherited || []).filter((e) => e.learnLevel <= instance.level);
  if (due.length > 0) {
    instance.inherited = instance.inherited.filter((e) => e.learnLevel > instance.level);
    due.sort((a, b) => a.learnLevel - b.learnLevel).forEach((e) => learn(e.skillId));
  }

  return logs;
}

/**
 * 経験値を与えてレベルアップまで解決する (破壊的)。
 * @returns {{levelsGained:number, logs:string[]}}
 */
export function gainExp(instance, species, amount, skillsById, displayName) {
  const name = displayName || species.name;
  const logs = [];
  if (!(amount > 0)) return { levelsGained: 0, logs };
  if (instance.level >= MAX_LEVEL) {
    logs.push(`${name} は これいじょう 強くなれない。`);
    return { levelsGained: 0, logs };
  }

  instance.exp = (instance.exp || 0) + amount;
  logs.push(`${name} は ${amount} の経験値を かくとくした！`);

  let gained = 0;
  let guard = 0;
  while (instance.level < MAX_LEVEL && guard < 200) {
    const need = expToNextLevel(instance.level, species.star);
    if (instance.exp < need) break;
    instance.exp -= need;
    instance.level += 1;
    gained += 1;
    guard += 1;
  }

  if (gained > 0) {
    recalcStats(instance, species);
    logs.push(`${name} は レベル ${instance.level} に あがった！`);
    applySkillLearning(instance, species, skillsById).forEach((l) => logs.push(`${name} は ${l}`));
  }
  if (instance.level >= MAX_LEVEL) instance.exp = 0;

  return { levelsGained: gained, logs };
}

/** デバッグ用: 経験値を無視して指定レベルへ直行させる (破壊的)。 */
export function setLevel(instance, species, level, skillsById) {
  instance.level = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
  instance.exp = 0;
  recalcStats(instance, species);
  const logs = applySkillLearning(instance, species, skillsById);
  return logs;
}

export default {
  MAX_LEVEL,
  STAT_KEYS,
  expToNextLevel,
  enemyExpValue,
  enemyStatsAtLevel,
  ENEMY_IV,
  statsAtLevel,
  recalcStats,
  applySkillLearning,
  gainExp,
  setLevel,
};
