// damage.js
// 戦闘のダメージ計算。GAME_SPEC_V0_1.md 4章の方針:
//   - 通常攻撃はこうげき値を参照
//   - 呪文はかしこさを参照
//   - ぼうぎょは通常攻撃・呪文の両方に影響
//   - すばやさは回避率に少し影響
//   - まれに攻撃を回避 / まれに会心
// 数式自体は「仮データ」。バランス調整は別途行う前提。
//
// v0.3: 一時的な能力変化(強化/弱体)を effectiveStat 経由で参照する。
// stats を直接読むと「ちからため」も「いかく」も効かなくなるので、
// ダメージ計算がステータスを見るときは必ず effectiveStat を通すこと。

import { effectiveStat, modMultiplier } from './ailments.js';

const BASE_DODGE_CHANCE = 0.05; // 基本回避率5%
const SPD_DODGE_FACTOR = 0.001; // (defSpd - atkSpd) 1につき0.1%
const CRIT_CHANCE = 0.06; // 会心率 固定6%
const CRIT_MULTIPLIER = 1.5;
const VARIANCE_MIN = 0.9;
const VARIANCE_MAX = 1.1;

function randomVariance() {
  return VARIANCE_MIN + Math.random() * (VARIANCE_MAX - VARIANCE_MIN);
}

function rollDodge(attacker, defender) {
  const bonus = (effectiveStat(defender, 'spd') - effectiveStat(attacker, 'spd')) * SPD_DODGE_FACTOR;
  // めいちゅう低下(弱体)は そのぶん回避されやすくなる
  const accPenalty = (1 - modMultiplier(attacker, 'acc')) * 0.5;
  const chance = Math.max(0, Math.min(0.75, BASE_DODGE_CHANCE + bonus + accPenalty));
  return Math.random() < chance;
}

function rollCrit() {
  return Math.random() < CRIT_CHANCE;
}

/**
 * 通常攻撃 / 物理技のダメージ計算。
 * @param {object} attacker combatant
 * @param {object} defender combatant
 * @param {object} opts { power=基本攻撃力倍率(通常攻撃は1.0), defending=防御中か }
 */
export function calcPhysicalDamage(attacker, defender, opts = {}) {
  const power = opts.power ?? 20; // 通常攻撃相当のpower目安
  if (rollDodge(attacker, defender)) {
    return { amount: 0, dodged: true, crit: false };
  }
  const crit = rollCrit();
  let raw = (effectiveStat(attacker, 'atk') * (power / 20)) - effectiveStat(defender, 'def') * 0.5;
  raw = Math.max(1, raw) * randomVariance();
  if (crit) raw *= CRIT_MULTIPLIER;
  if (opts.defending) raw *= 0.5;
  return { amount: Math.max(1, Math.round(raw)), dodged: false, crit };
}

/**
 * 呪文/魔法技のダメージ計算。かしこさ基準、ぼうぎょで軽減。
 */
export function calcMagicDamage(attacker, defender, skill, opts = {}) {
  const power = skill?.power ?? 20;
  if (rollDodge(attacker, defender)) {
    return { amount: 0, dodged: true, crit: false };
  }
  const crit = rollCrit();
  let raw = (effectiveStat(attacker, 'int') * (power / 20)) - effectiveStat(defender, 'def') * 0.3;
  raw = Math.max(1, raw) * randomVariance();
  if (crit) raw *= CRIT_MULTIPLIER;
  if (opts.defending) raw *= 0.5;
  return { amount: Math.max(1, Math.round(raw)), dodged: false, crit };
}

/**
 * ブレスのダメージ。ステータスにあまり依存せず、技のpowerがほぼそのまま出る。
 * ぼうぎょでは軽減されない代わりに、ぼうぎょコマンド中なら半減する。
 * (ドラゴン系に「かしこさが低くても通る火力」を持たせるための枠)
 */
export function calcBreathDamage(attacker, defender, skill, opts = {}) {
  const power = skill?.power ?? 20;
  let raw = power * randomVariance();
  if (opts.defending) raw *= 0.5;
  return { amount: Math.max(1, Math.round(raw)), dodged: false, crit: false };
}

export function calcHeal(power) {
  return Math.max(1, Math.round(power * randomVariance()));
}

export const BATTLE_TUNING = {
  BASE_DODGE_CHANCE,
  SPD_DODGE_FACTOR,
  CRIT_CHANCE,
  CRIT_MULTIPLIER,
};
