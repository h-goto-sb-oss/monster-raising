// BattleEngine.js
// 戦闘の状態管理と1ターンの解決を担う。GAME_SPEC_V0_1.md 4章の方針:
//   - プレイヤーが全員の行動を決めてから実行する
//   - 行動順はすばやさ(+仮の技補正)順
//   - さくせん設定時はAIが自動で行動を選ぶ
//
// UI(React)からは:
//   const engine = new BattleEngine(playerEntries, enemyEntries, skillsById)
//   engine.setPlayerAction(instanceId, action)
//   if (engine.allActionsReady()) engine.resolveTurn()
//   engine.getState() でスナップショットを取得してレンダリングする
//
// v0.3 で追加したもの:
//   - 状態異常5種 (どく/まひ/ねむり/こんらん/ふうじ) と一時的な能力変化
//   - 全体技/複数回攻撃/HP吸収/ブレス/回復/強化/弱体/ダンス
//   - どうぐの各種効果 (全体攻撃・蘇生・状態異常回復・餌・キメラのつばさ)

import { createCombatant, createCombatantFromInstance } from '../stats.js';
import { calcPhysicalDamage, calcMagicDamage, calcBreathDamage, calcHeal } from './damage.js';
import { decideEnemyAction, decideTacticAction } from './ai.js';
import { enemyExpValue, gainExp } from '../growth.js';
import { rollRecruit, recruitMessage } from '../recruit.js';
import { skillTargetKind, TARGET } from '../skills.js';
import {
  AILMENT_IDS,
  CONFUSION_RAMPAGE_CHANCE,
  PARALYSIS_FAIL_CHANCE,
  applyMod,
  clearAllStates,
  cureAilments,
  effectiveStat,
  hasAilment,
  inflictAilment,
  tickStates,
  wakeOnHit,
} from './ailments.js';

export const PHASE = {
  SELECT: 'select',
  RESOLVING: 'resolving',
  ENDED: 'ended',
};

export const RESULT = {
  WIN: 'win',
  LOSE: 'lose',
  FLED: 'fled',
};

export class BattleEngine {
  /**
   * @param {object[]} playerEntries [{ instance, species }] プレイヤーの個体 (最大3)
   * @param {object[]} enemyEntries 敵 (最大3)。次のどちらの形でもよい:
   *   - { species, level } … dungeons.json のエンカウントから組み立てた通常の形
   *   - monsters.json のレコードそのもの … Lv1の敵として扱う(デバッグ・後方互換)
   * @param {object} skillsById skill.id -> skill のマップ
   */
  constructor(playerEntries, enemyEntries, skillsById) {
    this.skillsById = skillsById || {};
    this.playerParty = playerEntries.map((e) => createCombatantFromInstance(e.instance, e.species));
    this.enemyParty = enemyEntries.map((e) => {
      const species = e?.species ?? e;
      return createCombatant(species, false, e?.level ?? 1, this.skillsById);
    });
    this.turn = 1;
    this.log = [];
    this.phase = PHASE.SELECT;
    this.result = null;
    this.pendingActions = {}; // instanceId -> action
    // 倒した敵の { species, level }。経験値と仲間化の抽選に使う。
    // レベルを覚えておかないと、深いダンジョンの敵でも Lv1 相当の
    // 経験値しか入らないし、仲間になった個体も Lv1 で生まれてしまう。
    this.defeatedEnemies = [];
    this.rewards = null;
    this.recruitMultiplier = 1; // 餌アイテムで上がる。この戦闘のあいだだけ有効。
    this.abandonedDungeon = false; // キメラのつばさで帰ったか
    this.pushLog(`戦闘開始！ ${this.enemyParty.map((e) => e.name).join('、')} が現れた！`);
  }

  pushLog(text) {
    if (!text) return;
    this.log.push({ turn: this.turn, text });
  }

  pushLogs(texts) {
    (texts || []).forEach((t) => this.pushLog(t));
  }

  getCombatant(instanceId) {
    return (
      this.playerParty.find((c) => c.instanceId === instanceId) ||
      this.enemyParty.find((c) => c.instanceId === instanceId) ||
      null
    );
  }

  alivePlayers() {
    return this.playerParty.filter((c) => c.hp > 0);
  }

  aliveEnemies() {
    return this.enemyParty.filter((c) => c.hp > 0);
  }

  /** そのcombatantから見た「味方」と「てき」。敵AIから呼んでも正しく返る。 */
  _sideOf(actor) {
    return actor.isPlayer
      ? { own: this.playerParty, foe: this.enemyParty }
      : { own: this.enemyParty, foe: this.playerParty };
  }

  /** マニュアル操作が必要なプレイヤーメンバー(さくせん未設定 かつ 生存) */
  membersNeedingManualAction() {
    return this.alivePlayers().filter((c) => !c.tactic);
  }

  setPlayerAction(instanceId, action) {
    if (this.phase !== PHASE.SELECT) return;
    this.pendingActions[instanceId] = action;
  }

  allActionsReady() {
    const needed = this.membersNeedingManualAction();
    return needed.every((c) => this.pendingActions[c.instanceId]);
  }

  /**
   * パーティー全員でにげる。
   * にげるは1体ぶんの行動ではなくパーティー全体の行動なので、
   * 残りのメンバーに1体ずつ行動を選ばせずに、その場で判定へ進む。
   * 逃げ役だけが flee を持ち、他は何もしない枠(wait)で埋める。
   * 失敗した場合はそのターンを棒に振る(ふつうのRPGと同じ)。
   */
  requestPartyFlee(actorInstanceId) {
    if (this.phase !== PHASE.SELECT) return;
    this.membersNeedingManualAction().forEach((c) => {
      this.pendingActions[c.instanceId] = c.instanceId === actorInstanceId
        ? { command: 'flee' }
        : { command: 'wait' };
    });
  }

  /** 現在のさくせん未設定メンバー1名（UIが次に入力を求めるべき相手） */
  nextMemberNeedingAction() {
    return this.membersNeedingManualAction().find((c) => !this.pendingActions[c.instanceId]) || null;
  }

  // --- 対象の決定 -------------------------------------------------------

  /** 技/どうぐの対象リストを対象種別から解決する。 */
  _resolveTargets(actor, kind, targetId, opts = {}) {
    const { own, foe } = this._sideOf(actor);
    const aliveOwn = own.filter((c) => c.hp > 0);
    const aliveFoe = foe.filter((c) => c.hp > 0);
    const picked = targetId ? this.getCombatant(targetId) : null;

    switch (kind) {
      case TARGET.ENEMY_ALL:
        return aliveFoe;
      case TARGET.ALLY_ALL:
        return opts.includeDowned ? own : aliveOwn;
      case TARGET.SELF:
        return [actor];
      case TARGET.NONE:
        return [];
      case TARGET.ALLY_ONE: {
        if (opts.downedOnly) {
          const downed = own.filter((c) => c.hp <= 0);
          if (picked && picked.hp <= 0) return [picked];
          return downed.length > 0 ? [downed[0]] : [];
        }
        if (picked && picked.hp > 0) return [picked];
        return aliveOwn.length > 0 ? [aliveOwn[0]] : [];
      }
      case TARGET.ENEMY_ONE:
      default: {
        if (picked && picked.hp > 0) return [picked];
        return aliveFoe.length > 0 ? [aliveFoe[0]] : [];
      }
    }
  }

  // --- 状態異常による行動の妨害 ------------------------------------------

  /**
   * 行動の直前チェック。状態異常で行動が変わる/消える場合はここで処理する。
   * @returns {object|null} 実際に行う行動。null なら行動できなかった。
   */
  _applyPreActionStates(actor, action) {
    if (hasAilment(actor, 'ねむり')) {
      this.pushLog(`${actor.name} は ぐうぐう ねむっている…`);
      return null;
    }
    if (hasAilment(actor, 'まひ') && Math.random() < PARALYSIS_FAIL_CHANCE) {
      this.pushLog(`${actor.name} は しびれて うごけない！`);
      return null;
    }
    if (hasAilment(actor, 'こんらん') && Math.random() < CONFUSION_RAMPAGE_CHANCE) {
      // 味方も対象に含めて、めちゃくちゃに殴る
      const all = [...this.playerParty, ...this.enemyParty].filter((c) => c.hp > 0 && c !== actor);
      if (all.length === 0) return null;
      const victim = all[Math.floor(Math.random() * all.length)];
      this.pushLog(`${actor.name} は こんらんして いる！`);
      return { command: 'attack', targetId: victim.instanceId, confused: true };
    }
    if (hasAilment(actor, 'ふうじ') && action?.command === 'skill') {
      this.pushLog(`${actor.name} は とくぎを ふうじられている！`);
      return null;
    }
    return action;
  }

  // --- 行動の解決 -------------------------------------------------------

  _resolveAction(actor, rawAction) {
    if (!actor || actor.hp <= 0 || !rawAction) return;

    // にげるは「パーティー全体で1回」の行動なので、逃げ役以外は空の枠が入る。
    // 状態異常の判定より前に抜ける(眠っている仲間のぶんまでログを出さない)。
    if (rawAction.command === 'wait') return;

    const action = this._applyPreActionStates(actor, rawAction);
    if (!action) return;

    if (action.command === 'defend') {
      actor.defending = true;
      this.pushLog(`${actor.name} は ぼうぎょ している！`);
      return;
    }

    if (action.command === 'flee') {
      const playerSpd = avgSpd(this.playerParty.filter((c) => c.hp > 0));
      const enemySpd = avgSpd(this.enemyParty.filter((c) => c.hp > 0));
      const chance = Math.max(0.1, Math.min(0.9, 0.5 + (playerSpd - enemySpd) * 0.01));
      const success = Math.random() < chance;
      if (success) {
        this.pushLog(`${actor.name} たちは うまく にげだした！`);
        this.result = RESULT.FLED;
        this.phase = PHASE.ENDED;
      } else {
        this.pushLog(`${actor.name} は にげようとしたが、うまくいかなかった！`);
      }
      return;
    }

    if (action.command === 'item') {
      this._resolveItem(actor, action.item, action.targetId);
      return;
    }

    if (action.command === 'attack') {
      const targets = this._resolveTargets(actor, TARGET.ENEMY_ONE, action.targetId);
      // こんらん中は味方も殴るので、対象は事前に確定させたものを優先する
      const target = action.confused ? this.getCombatant(action.targetId) : targets[0];
      if (!target || target.hp <= 0) return;
      const result = calcPhysicalDamage(actor, target, { power: 20, defending: !!target.defending });
      this._applyDamage(actor, target, result, 'こうげき');
      return;
    }

    if (action.command === 'skill') {
      this._resolveSkill(actor, action.skillId, action.targetId);
    }
  }

  _resolveSkill(actor, skillId, targetId) {
    const skill = this.skillsById[skillId];
    if (!skill) return;
    if (actor.mp < skill.mpCost) {
      this.pushLog(`${actor.name} は MPが たりない！`);
      return;
    }
    actor.mp -= skill.mpCost;

    const kind = skillTargetKind(skill);
    const downedOnly = !!skill.revive;
    const targets = this._resolveTargets(actor, kind, targetId, {
      downedOnly,
      includeDowned: downedOnly,
    });

    this.pushLog(`${actor.name} は ${skill.name} を つかった！`);

    // --- ダンス: たまに空振りする、気まぐれな枠 ---
    if (skill.type === 'ダンス') {
      if (skill.danceKind === 'random') {
        this._resolveWildDance(actor, skill);
        return;
      }
      if (Math.random() < (skill.failChance ?? 0.2)) {
        this.pushLog('しかし おどりは からぶりに おわった！');
        return;
      }
    }

    // --- 回復・蘇生 ---
    if (skill.type === '回復' || skill.heal || skill.revive) {
      if (targets.length === 0) {
        this.pushLog('しかし 対象が いなかった！');
        return;
      }
      targets.forEach((t) => {
        if (skill.revive) {
          if (t.hp > 0) {
            this.pushLog(`${t.name} は 戦闘不能では ない。`);
            return;
          }
          t.hp = Math.max(1, Math.floor(t.maxHp * (skill.reviveRatio ?? 0.5)));
          this.pushLog(`${t.name} は いきを ふきかえした！（HP ${t.hp}）`);
          return;
        }
        if (t.hp <= 0) return;
        if (t.hp >= t.maxHp) {
          this.pushLog(`${t.name} の HPは 満タンだ。`);
          return;
        }
        const amount = calcHeal(skill.power ?? 0);
        const before = t.hp;
        t.hp = Math.min(t.maxHp, t.hp + amount);
        this.pushLog(`${t.name} の HPが ${t.hp - before} 回復した。`);
      });
      if (skill.cures) {
        targets.forEach((t) => {
          const cured = cureAilments(t, skill.cures);
          if (cured.length > 0) this.pushLog(`${t.name} の ${cured.join('と')} が なおった！`);
        });
      }
      return;
    }

    // --- 強化 / 弱体 / 支援(能力変化つき) ---
    const isSupportOnly =
      skill.type === '強化' || skill.type === '弱体' || skill.type === '支援' || skill.type === 'ダンス';
    if (isSupportOnly && !(skill.power > 0)) {
      if (targets.length === 0) {
        this.pushLog('しかし 対象が いなかった！');
        return;
      }
      this._applyModsAndAilments(actor, skill, targets);
      return;
    }

    // --- 攻撃系 ---
    if (targets.length === 0) return;
    const hits = Math.max(1, skill.hits ?? 1);
    let totalDrain = 0;

    targets.forEach((target) => {
      if (target.hp <= 0) return;
      for (let i = 0; i < hits; i += 1) {
        if (target.hp <= 0) break;
        let result;
        if (skill.type === 'ブレス') {
          result = calcBreathDamage(actor, target, skill, { defending: !!target.defending });
        } else if (skill.type === '呪文') {
          result = calcMagicDamage(actor, target, skill, { defending: !!target.defending });
        } else {
          result = calcPhysicalDamage(actor, target, {
            power: skill.power,
            defending: !!target.defending,
          });
        }
        const label = hits > 1 ? `${skill.name}(${i + 1}回目)` : skill.name;
        this._applyDamage(actor, target, result, label);
        if (skill.drain && !result.dodged) totalDrain += result.amount * skill.drain;
      }
      // 攻撃技に状態異常/能力変化が乗っている場合はここで判定
      this._applyModsAndAilments(actor, skill, [target], { onlyIfAlive: true });
    });

    if (totalDrain > 0 && actor.hp > 0) {
      const gain = Math.max(1, Math.floor(totalDrain));
      const before = actor.hp;
      actor.hp = Math.min(actor.maxHp, actor.hp + gain);
      this.pushLog(`${actor.name} は HPを ${actor.hp - before} 吸収した！`);
    }
  }

  /** 技に付いている buff / debuff / ailment を対象へ適用する。 */
  _applyModsAndAilments(actor, skill, targets, opts = {}) {
    targets.forEach((t) => {
      if (opts.onlyIfAlive && t.hp <= 0) return;
      if (skill.buff) {
        const { applied, message } = applyMod(t, skill.buff.stat, skill.buff.stage, skill.buff.turns);
        this.pushLog(message);
        void applied;
      }
      if (skill.debuff) {
        const { message } = applyMod(t, skill.debuff.stat, skill.debuff.stage, skill.debuff.turns);
        this.pushLog(message);
      }
      if (skill.ailment) {
        const chance = skill.ailmentChance ?? 0.3;
        if (Math.random() < chance) {
          const { message } = inflictAilment(t, skill.ailment);
          this.pushLog(message);
        } else if (!(skill.power > 0)) {
          this.pushLog(`しかし ${t.name} には 効かなかった！`);
        }
      }
      if (!skill.buff && !skill.debuff && !skill.ailment && !(skill.power > 0)) {
        // データに効果が無い技(旧「(仮技)」の名残)は空振り扱いにして、嘘をつかない
        this.pushLog('しかし 何も おこらなかった…');
      }
    });
  }

  /** MP0の気まぐれダンス。何が起きるか分からない枠。 */
  _resolveWildDance(actor, skill) {
    const { own, foe } = this._sideOf(actor);
    const aliveFoe = foe.filter((c) => c.hp > 0);
    const aliveOwn = own.filter((c) => c.hp > 0);
    const roll = Math.random();

    if (roll < 0.25 && aliveFoe.length > 0) {
      const target = aliveFoe[Math.floor(Math.random() * aliveFoe.length)];
      const result = calcPhysicalDamage(actor, target, { power: (skill.power || 20) * 2 });
      this.pushLog('おどりは はげしい つむじ風に なった！');
      this._applyDamage(actor, target, result, skill.name);
      return;
    }
    if (roll < 0.5) {
      aliveOwn.forEach((t) => this.pushLog(applyMod(t, 'atk', 1, 4).message));
      this.pushLog('おどりに つられて みんなが たかぶった！');
      return;
    }
    if (roll < 0.7 && aliveFoe.length > 0) {
      const target = aliveFoe[Math.floor(Math.random() * aliveFoe.length)];
      const id = AILMENT_IDS[Math.floor(Math.random() * AILMENT_IDS.length)];
      this.pushLog('おどりは 見る者の 心を みだした！');
      this.pushLog(inflictAilment(target, id).message);
      return;
    }
    if (roll < 0.85) {
      const heal = calcHeal(20);
      const before = actor.hp;
      actor.hp = Math.min(actor.maxHp, actor.hp + heal);
      this.pushLog(`おどりで 気分が よくなった！ ${actor.name} の HPが ${actor.hp - before} 回復した。`);
      return;
    }
    this.pushLog(`${actor.name} は おどりすぎて 目を まわした！`);
    this.pushLog(inflictAilment(actor, 'こんらん', { turns: 2 }).message);
  }

  // --- どうぐ -----------------------------------------------------------

  _resolveItem(actor, item, targetId) {
    if (!item) return;
    const kind = item.target || 'なし';
    const downedOnly = item.effect === 'revive';
    const targets = this._resolveTargets(actor, kind, targetId, {
      downedOnly,
      includeDowned: downedOnly,
    });

    if (item.effect === 'heal_hp') {
      targets.forEach((t) => {
        if (t.hp <= 0) return;
        if (t.hp >= t.maxHp) {
          this.pushLog(`${actor.name} は ${item.name} を つかった！ しかし ${t.name} の HPは 満タンだった。`);
          return;
        }
        const amount = calcHeal(item.amount);
        const before = t.hp;
        t.hp = Math.min(t.maxHp, t.hp + amount);
        this.pushLog(`${actor.name} は ${t.name} に ${item.name} を つかった！ HPが ${t.hp - before} 回復した。`);
      });
      return;
    }

    if (item.effect === 'heal_mp') {
      targets.forEach((t) => {
        if (t.hp <= 0) return;
        const amount = calcHeal(item.amount);
        const before = t.mp;
        t.mp = Math.min(t.maxMp, t.mp + amount);
        this.pushLog(`${actor.name} は ${t.name} に ${item.name} を つかった！ MPが ${t.mp - before} 回復した。`);
      });
      return;
    }

    if (item.effect === 'heal_hp_full_all') {
      this.pushLog(`${actor.name} は ${item.name} を つかった！`);
      // 状態異常までは治さない(それは ばんのうやく の役目)。
      this.playerParty.forEach((t) => {
        if (t.hp <= 0) return;
        t.hp = t.maxHp;
        t.mp = t.maxMp;
      });
      this.pushLog('パーティー全員の HP・MPが 全回復した！');
      return;
    }

    if (item.effect === 'revive') {
      const target = targets[0];
      if (!target) {
        this.pushLog(`${actor.name} は ${item.name} を つかったが、たおれている なかまが いない！`);
        return;
      }
      target.hp = Math.max(1, Math.floor(target.maxHp * (item.amount ?? 0.5)));
      this.pushLog(`${actor.name} は ${item.name} を つかった！ ${target.name} は いきを ふきかえした！（HP ${target.hp}）`);
      return;
    }

    if (item.effect === 'cure_ailment') {
      targets.forEach((t) => {
        const cured = cureAilments(t, item.cures);
        if (cured.length > 0) {
          this.pushLog(`${actor.name} は ${t.name} に ${item.name} を つかった！ ${cured.join('と')} が なおった！`);
        } else {
          this.pushLog(`${actor.name} は ${t.name} に ${item.name} を つかった！ しかし 何も おこらなかった。`);
        }
      });
      return;
    }

    if (item.effect === 'recruit_boost') {
      this.recruitMultiplier = Math.max(this.recruitMultiplier, item.amount ?? 1);
      this.pushLog(`${actor.name} は ${item.name} を まいた！ てきが よだれを たらしている…（仲間になる確率 ${this.recruitMultiplier}倍）`);
      return;
    }

    if (item.effect === 'damage_all') {
      this.pushLog(`${actor.name} は ${item.name} を つかった！`);
      const victims = this.enemyParty.filter((c) => c.hp > 0);
      victims.forEach((t) => {
        const amount = calcHeal(item.amount); // ばらつきの計算式は回復と同じでよい
        this._applyDamage(actor, t, { amount, dodged: false, crit: false }, item.name);
      });
      return;
    }

    if (item.effect === 'damage_type') {
      const target = targets[0];
      if (!target) return;
      const isTarget =
        target.type === item.vsType || (target.secondaryTypes || []).includes(item.vsType);
      const amount = isTarget ? item.amount : item.weakAmount ?? 1;
      this.pushLog(`${actor.name} は ${item.name} を つかった！`);
      if (isTarget) this.pushLog(`${item.vsType}タイプの ${target.name} には ききめが ばつぐんだ！`);
      else this.pushLog(`しかし ${target.name} には ほとんど 効かなかった…`);
      this._applyDamage(actor, target, { amount, dodged: false, crit: false }, item.name);
      return;
    }

    if (item.effect === 'escape_dungeon') {
      this.pushLog(`${actor.name} は ${item.name} を つかった！ 空へ まいあがり、拠点へ もどった！`);
      this.result = RESULT.FLED;
      this.abandonedDungeon = true;
      this.phase = PHASE.ENDED;
    }
  }

  // --- ダメージ適用 -----------------------------------------------------

  _applyDamage(actor, target, result, moveName) {
    if (result.dodged) {
      this.pushLog(`${actor.name} の ${moveName}！ しかし ${target.name} に かわされた！`);
      return;
    }
    target.hp = Math.max(0, target.hp - result.amount);
    const critText = result.crit ? '会心の一撃！ ' : '';
    this.pushLog(`${actor.name} の ${moveName}！ ${critText}${target.name} に ${result.amount} のダメージ！`);
    if (target.hp > 0) {
      this.pushLog(wakeOnHit(target)); // ねむりは殴られると解ける
    }
    if (target.hp <= 0) {
      this.pushLog(`${target.name} を たおした！`);
      clearAllStates(target);
      if (!target.isPlayer && target.species) {
        this.defeatedEnemies.push({ species: target.species, level: target.level });
      }
    }
  }

  // --- ターン処理 -------------------------------------------------------

  /**
   * 全員分の行動が揃ったら呼ぶ。敵AI/さくせんAIの行動も決定した上で、
   * すばやさ降順で全行動を解決する。
   */
  resolveTurn() {
    if (this.phase !== PHASE.SELECT) return;
    if (!this.allActionsReady()) return;

    this.phase = PHASE.RESOLVING;

    // 防御フラグをリセット(このターン新たに設定されるもの以外)
    [...this.playerParty, ...this.enemyParty].forEach((c) => {
      c.defending = false;
    });

    const actions = [];

    // プレイヤー: 手入力 + さくせんAI
    this.alivePlayers().forEach((c) => {
      if (c.tactic) {
        const action = decideTacticAction(c, this.playerParty, this.enemyParty, this.skillsById);
        if (action) actions.push({ actor: c, action });
      } else if (this.pendingActions[c.instanceId]) {
        actions.push({ actor: c, action: this.pendingActions[c.instanceId] });
      }
    });

    // 敵AI
    this.aliveEnemies().forEach((c) => {
      const action = decideEnemyAction(c, this.enemyParty, this.playerParty, this.skillsById);
      if (action) actions.push({ actor: c, action });
    });

    // すばやさ降順で解決 (能力変化ぶんも反映する)
    actions.sort((a, b) => effectiveStat(b.actor, 'spd') - effectiveStat(a.actor, 'spd'));

    for (const { actor, action } of actions) {
      if (this.phase === PHASE.ENDED) break; // 逃走成功などで戦闘終了済み
      if (actor.hp <= 0) continue; // 既に倒れている
      this._resolveAction(actor, action);
      if (this._checkBattleEnd()) break;
    }

    if (this.phase !== PHASE.ENDED) {
      this._endOfTurn();
      this._checkBattleEnd();
    }

    this.pendingActions = {};
    if (this.phase === PHASE.ENDED) {
      this._finishBattle();
    } else {
      this.turn += 1;
      this.phase = PHASE.SELECT;
    }
  }

  /** ターン終了時: どくのダメージ、状態異常と能力変化の残りターン処理。 */
  _endOfTurn() {
    const all = [...this.playerParty, ...this.enemyParty];
    all.forEach((c) => {
      if (!c.ailments && !c.mods) return;
      const { poisonDamage, logs } = tickStates(c);
      if (poisonDamage > 0 && c.hp > 0) {
        c.hp = Math.max(0, c.hp - poisonDamage);
        this.pushLog(`${c.name} は どくで ${poisonDamage} のダメージを うけた！`);
        if (c.hp <= 0) {
          this.pushLog(`${c.name} は たおれた！`);
          clearAllStates(c);
          if (!c.isPlayer && c.species) {
            this.defeatedEnemies.push({ species: c.species, level: c.level });
          }
        }
      }
      this.pushLogs(logs);
    });
  }

  _checkBattleEnd() {
    if (this.phase === PHASE.ENDED) return true;
    if (this.aliveEnemies().length === 0) {
      this.result = RESULT.WIN;
      this.phase = PHASE.ENDED;
      this.pushLog('てきを すべて たおした！ 勝利！');
      return true;
    }
    if (this.alivePlayers().length === 0) {
      this.result = RESULT.LOSE;
      this.phase = PHASE.ENDED;
      this.pushLog('パーティーは 全滅した…');
      return true;
    }
    return false;
  }

  /**
   * 戦闘終了時の後始末。
   * - HP/MPの現在値を個体クローンへ書き戻す
   * - 勝利時は生存メンバーへ経験値を分配し、レベルアップと技習得を解決する
   * - 勝利時は倒した敵ごとに野生の仲間化を抽選する (要望2)
   * 結果は this.rewards に置き、UI側が gameStore へ反映する。
   */
  _finishBattle() {
    if (this.rewards) return;

    // 状態異常は戦闘のあいだだけ。個体には持ち帰らせない。
    [...this.playerParty, ...this.enemyParty].forEach((c) => clearAllStates(c));

    // 個体のクローンを作り、現在HP/MPを反映する
    const clones = [];
    this.playerParty.forEach((c) => {
      if (!c.instance) return;
      const clone = JSON.parse(JSON.stringify(c.instance));
      clone.hp = Math.max(0, c.hp);
      clone.mp = Math.max(0, c.mp);
      // 状態異常と違って、さくせんは持ち帰らせる。
      // 戦闘中に「ガンガンいこうぜ」へ変えたら、次の戦闘もそれで始まってほしい
      // (メニューの「さくせん」と同じ場所を書いている)。
      clone.tactic = c.tactic ?? null;
      clones.push({ combatant: c, clone });
    });

    const recruits = [];

    if (this.result === RESULT.WIN) {
      const totalExp = this.defeatedEnemies.reduce(
        (sum, e) => sum + enemyExpValue(e.species, e.level),
        0,
      );
      const survivors = clones.filter((e) => e.combatant.hp > 0);
      if (totalExp > 0 && survivors.length > 0) {
        const share = Math.max(1, Math.floor(totalExp / survivors.length));
        survivors.forEach(({ combatant, clone }) => {
          const { logs } = gainExp(clone, combatant.species, share, this.skillsById, combatant.name);
          logs.forEach((l) => this.pushLog(l));
          // レベルアップで最大HPが伸びた分を戦闘表示にも反映する
          combatant.stats = { ...clone.stats };
          combatant.maxHp = clone.stats.hp;
          combatant.maxMp = clone.stats.mp;
          combatant.hp = Math.min(clone.hp, combatant.maxHp);
          combatant.mp = Math.min(clone.mp, combatant.maxMp);
          combatant.level = clone.level;
          combatant.skills = [...clone.learned];
        });
      }

      if (this.recruitMultiplier > 1) {
        this.pushLog(`えさの においで てきが なつきやすく なっている！（${this.recruitMultiplier}倍）`);
      }
      // 仲間になった野生は「倒したときのレベル」で加わる。
      // 敵にレベルが付いた以上、Lv40の敵を仲間にしてLv1で生まれるのは筋が通らないし、
      // 深いダンジョンで仲間にする意味が無くなってしまう。
      this.defeatedEnemies.forEach((e) => {
        if (rollRecruit(e.species, Math.random, this.recruitMultiplier)) {
          recruits.push({ id: e.species.id, level: e.level });
          this.pushLog(recruitMessage(e.species));
        }
      });
    }

    this.rewards = {
      instances: clones.map((e) => e.clone),
      recruits,
      abandonedDungeon: this.abandonedDungeon,
      recruitMultiplier: this.recruitMultiplier,
    };
  }

  getRewards() {
    if (this.phase === PHASE.ENDED && !this.rewards) this._finishBattle();
    return this.rewards;
  }

  getState() {
    return {
      playerParty: this.playerParty,
      enemyParty: this.enemyParty,
      turn: this.turn,
      log: this.log,
      phase: this.phase,
      result: this.result,
      pendingActions: this.pendingActions,
      recruitMultiplier: this.recruitMultiplier,
    };
  }

  // --- デバッグ用 -------------------------------------------------------

  /** デバッグメニューから状態異常を直接かける。 */
  debugInflict(instanceId, ailmentId, turns) {
    const c = this.getCombatant(instanceId);
    if (!c) return;
    const { message } = inflictAilment(c, ailmentId, { turns });
    this.pushLog(`【デバッグ】${message || `${c.name} には かからなかった`}`);
  }
}

function avgSpd(list) {
  if (list.length === 0) return 0;
  return list.reduce((sum, c) => sum + effectiveStat(c, 'spd'), 0) / list.length;
}
