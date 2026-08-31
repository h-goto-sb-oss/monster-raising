// stats.js
// モンスターマスタ(monsters.json)のレコードや個体(instance)から、
// 戦闘用インスタンス(combatant)を組み立てるための小さなヘルパー群。
//
// 敵は「種族レコード + レベル」(createCombatant)、
// プレイヤー側は個体のレベル/成長後ステータス/習得済み技を使う
// (createCombatantFromInstance)。
//
// v0.4 まで敵は Lv1 固定で種族の素ステータスをそのまま使っていた。
// そのため難易度を上げる手段が「★の高い種族を出す」しかなく、
// ダンジョンを12本つなげるとどこかで必ず破綻していた。
// 今は dungeons.json がエンカウントごとに敵のレベルを持ち、
// ステータスも覚えている技もそのレベルで解決する。

import { displayName } from './instance.js';
import { enemyStatsAtLevel, applySkillLearning, MAX_LEVEL } from './growth.js';

let instanceCounter = 0;

/**
 * monsters.json の1レコードから戦闘用combatantを生成する(敵用)。
 * @param {object} monster - monsters.json のレコード
 * @param {boolean} isPlayer - プレイヤー側かどうか
 * @param {number} [level=1] - 敵のレベル (dungeons.json のエンカウントが指定する)
 * @param {object} [skillsById] - 渡すと learnset をそのレベルまで解決して技を決める
 */
export function createCombatant(monster, isPlayer, level = 1, skillsById = null) {
  instanceCounter += 1;
  const lv = Math.max(1, Math.min(MAX_LEVEL, Math.round(level || 1)));
  const stats = enemyStatsAtLevel(monster, lv);

  // 技もレベルなり。深いダンジョンの敵は上位呪文まで撃ってくる。
  // skillsById が無ければ従来どおり monsters.json の skills(Lv1相当)を使う。
  let skills = monster.skills || [];
  if (skillsById) {
    const pseudo = { level: lv, learned: [], inherited: [] };
    applySkillLearning(pseudo, monster, skillsById);
    if (pseudo.learned.length > 0) skills = pseudo.learned;
  }

  return {
    instanceId: `${monster.id}__${instanceCounter}`,
    monsterId: monster.id,
    uid: null,
    name: monster.name,
    level: lv,
    type: monster.type,
    tier: monster.tier,
    star: monster.star,
    secondaryTypes: monster.secondaryTypes || [],
    spriteUrl: monster.spriteUrl,
    isPlayer,
    species: monster,
    instance: null,
    stats,
    maxHp: stats.hp,
    maxMp: stats.mp,
    hp: stats.hp,
    mp: stats.mp,
    skills,
    tactic: null, // さくせん未設定 = 手動操作
    // 状態異常と能力変化は戦闘中だけの状態。個体(instance)には保存しない。
    ailments: {},
    mods: {},
    alive: true,
    lastActionResult: null,
  };
}

/**
 * プレイヤーの個体から戦闘用combatantを生成する。
 * ステータスとレベルは個体のもの、使える技は learned のみ
 * (継承枠 inherited はまだ覚えていないので戦闘では使えない)。
 * @param {object} instance 個体
 * @param {object} species monsters.json のレコード
 */
export function createCombatantFromInstance(instance, species) {
  instanceCounter += 1;
  const stats = { ...instance.stats };
  return {
    instanceId: `${instance.uid}__${instanceCounter}`,
    monsterId: species.id,
    uid: instance.uid,
    name: displayName(instance, species),
    level: instance.level,
    type: species.type,
    tier: species.tier,
    star: species.star,
    secondaryTypes: species.secondaryTypes || [],
    spriteUrl: species.spriteUrl,
    isPlayer: true,
    species,
    instance,
    stats,
    maxHp: stats.hp,
    maxMp: stats.mp,
    hp: Math.max(0, Math.min(stats.hp, instance.hp ?? stats.hp)),
    mp: Math.max(0, Math.min(stats.mp, instance.mp ?? stats.mp)),
    skills: [...(instance.learned || [])],
    // さくせんは個体が覚えている(メニューで設定する)。null = 手動操作。
    // 戦闘中に変えたぶんは BattleEngine._finishBattle が個体へ書き戻す。
    tactic: instance.tactic ?? null,
    // 状態異常と能力変化は戦闘中だけの状態。個体(instance)には保存しない。
    ailments: {},
    mods: {},
    alive: true,
    lastActionResult: null,
  };
}

export function hpPercent(c) {
  if (c.maxHp <= 0) return 0;
  return Math.max(0, Math.min(1, c.hp / c.maxHp));
}

export function isAlive(c) {
  return c.hp > 0;
}
