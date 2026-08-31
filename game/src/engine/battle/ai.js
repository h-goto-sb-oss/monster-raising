// ai.js
// 敵の行動決定AI、および「さくせん」を設定したプレイヤー側モンスターの自動行動。
// GAME_SPEC_V0_1.md 4章:「作戦を設定すると、細かい指示を出さなくてもAIが行動を選ぶ」

import { skillTargetKind, targetsAllySide, needsTargetPick, TARGET } from '../skills.js';

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function aliveOf(list) {
  return list.filter((c) => c.hp > 0);
}

function strongestTarget(targets) {
  return targets.reduce((best, c) => (c.stats.atk > best.stats.atk ? c : best), targets[0]);
}

function weakestHpTarget(targets) {
  return targets.reduce((best, c) => (c.hp < best.hp ? c : best), targets[0]);
}

function usableSkills(actor, skillsById) {
  return (actor.skills || [])
    .map((id) => skillsById[id])
    .filter((s) => s && s.mpCost <= actor.mp);
}

/** 味方のHPを回復できる技 (回復タイプ、または回復量つきの支援)。蘇生技は除く。 */
function healSkillFor(actor, skillsById) {
  return usableSkills(actor, skillsById).find(
    (s) => !s.revive && (s.type === '回復' || (s.type === '支援' && (s.power ?? 0) > 0)) && (s.power ?? 0) > 0,
  );
}

/**
 * 技の対象種別に合わせて対象を選ぶ。
 * 回復技で敵を狙う、といった噛み合わない指示を出さないための共通処理。
 * @returns {string|null} targetId (全体技・自分対象なら null)
 */
function pickTargetForSkill(actor, skill, ownParty, foeParty) {
  if (!needsTargetPick(skill)) return null;
  const pool = targetsAllySide(skill) ? ownParty : foeParty;
  if (skill.revive) {
    const downed = pool.filter((c) => c.hp <= 0);
    return downed.length > 0 ? pickRandom(downed).instanceId : null;
  }
  const alive = aliveOf(pool);
  if (alive.length === 0) return null;
  // 回復技は一番HPが減っている味方へ
  if (targetsAllySide(skill) && (skill.power ?? 0) > 0 && skill.type === '回復') {
    return weakestHpTarget(alive).instanceId;
  }
  return pickRandom(alive).instanceId;
}

/** その技を今つかう意味があるか(全員満タンなのに回復する等を避ける)。 */
function skillMakesSense(actor, skill, ownParty, foeParty) {
  if (skill.revive) return ownParty.some((c) => c.hp <= 0);
  if (skill.type === '回復' && (skill.power ?? 0) > 0) {
    return aliveOf(ownParty).some((c) => c.hp < c.maxHp * 0.8);
  }
  if (needsTargetPick(skill)) {
    const pool = targetsAllySide(skill) ? ownParty : foeParty;
    return aliveOf(pool).length > 0;
  }
  if (skillTargetKind(skill) === TARGET.ENEMY_ALL) return aliveOf(foeParty).length > 0;
  return true;
}

/**
 * 敵AI: 有効な行動(通常攻撃 or MPが足りる技)からランダムに選ぶ。
 * 技は対象種別を見て、味方技なら味方、敵技なら敵へ向ける。
 */
export function decideEnemyAction(actor, enemyParty, playerParty, skillsById) {
  const targets = aliveOf(playerParty);
  if (targets.length === 0) {
    return { actorId: actor.instanceId, command: 'attack', targetId: null };
  }
  const skills = usableSkills(actor, skillsById).filter((s) =>
    skillMakesSense(actor, s, enemyParty, playerParty),
  );
  if (skills.length > 0 && Math.random() < 0.5) {
    const skill = pickRandom(skills);
    return {
      actorId: actor.instanceId,
      command: 'skill',
      skillId: skill.id,
      targetId: pickTargetForSkill(actor, skill, enemyParty, playerParty),
    };
  }
  return { actorId: actor.instanceId, command: 'attack', targetId: pickRandom(targets).instanceId };
}

// --- さくせんプリセット ------------------------------------------------

export const TACTICS = {
  GANGAN: {
    id: 'GANGAN',
    label: 'ガンガンいこうぜ',
    description: '常に一番こうげき力が高い敵を通常攻撃で狙う。',
    decide(actor, ownParty, enemyParty, skillsById) {
      const targets = aliveOf(enemyParty);
      if (targets.length === 0) return null;
      const target = strongestTarget(targets);
      return { actorId: actor.instanceId, command: 'attack', targetId: target.instanceId };
    },
  },
  MP_SAVE: {
    id: 'MP_SAVE',
    label: 'MPを節約',
    description: '技よりも通常攻撃を優先する。',
    decide(actor, ownParty, enemyParty) {
      const targets = aliveOf(enemyParty);
      if (targets.length === 0) return null;
      const target = pickRandom(targets);
      return { actorId: actor.instanceId, command: 'attack', targetId: target.instanceId };
    },
  },
  HEAL_FOCUS: {
    id: 'HEAL_FOCUS',
    label: '回復重視',
    description: '味方にHP40%未満がいれば回復技を優先し、いなければ通常攻撃。',
    decide(actor, ownParty, enemyParty, skillsById) {
      const injured = aliveOf(ownParty).filter((c) => c.hp / c.maxHp < 0.4);
      if (injured.length > 0) {
        const healSkill = healSkillFor(actor, skillsById);
        if (healSkill) {
          const target = weakestHpTarget(injured);
          return { actorId: actor.instanceId, command: 'skill', skillId: healSkill.id, targetId: target.instanceId };
        }
      }
      const targets = aliveOf(enemyParty);
      if (targets.length === 0) return null;
      const target = pickRandom(targets);
      return { actorId: actor.instanceId, command: 'attack', targetId: target.instanceId };
    },
  },
};

export function getTacticsList() {
  return Object.values(TACTICS);
}

/**
 * さくせん設定済みのプレイヤーcombatantの行動を決める。
 */
export function decideTacticAction(actor, ownParty, enemyParty, skillsById) {
  const tactic = TACTICS[actor.tactic];
  if (!tactic) return null;
  return tactic.decide(actor, ownParty, enemyParty, skillsById);
}
