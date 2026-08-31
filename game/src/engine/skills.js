// skills.js
// 技の「対象の取り方」を1か所にまとめる。
// 戦闘エンジンとUI(誰をクリックさせるか)の両方が同じ答えを見る必要があるため、
// BattleEngine と BattleScreen のどちらにも置かず、独立させている。

export const TARGET = {
  ENEMY_ONE: '敵単体',
  ENEMY_ALL: '敵全体',
  ALLY_ONE: '味方単体',
  ALLY_ALL: '味方全体',
  SELF: '自分',
  NONE: 'なし',
};

const DEFAULT_TARGET_BY_TYPE = {
  物理: TARGET.ENEMY_ONE,
  呪文: TARGET.ENEMY_ONE,
  ブレス: TARGET.ENEMY_ALL,
  回復: TARGET.ALLY_ONE,
  強化: TARGET.SELF,
  弱体: TARGET.ENEMY_ONE,
  ダンス: TARGET.ENEMY_ALL,
  支援: TARGET.ENEMY_ONE,
};

/** その技が誰を狙うか。データに target があればそれ、無ければ種別の既定値。 */
export function skillTargetKind(skill) {
  if (!skill) return TARGET.ENEMY_ONE;
  return skill.target || DEFAULT_TARGET_BY_TYPE[skill.type] || TARGET.ENEMY_ONE;
}

/** 味方を狙う技か。 */
export function targetsAllySide(skill) {
  const kind = skillTargetKind(skill);
  return kind === TARGET.ALLY_ONE || kind === TARGET.ALLY_ALL || kind === TARGET.SELF;
}

/** UIで「対象を1体クリックしてもらう」必要があるか。全体技・自分・対象なしは不要。 */
export function needsTargetPick(skill) {
  const kind = skillTargetKind(skill);
  return kind === TARGET.ENEMY_ONE || kind === TARGET.ALLY_ONE;
}

/** 蘇生技は戦闘不能の味方を選ばせる。 */
export function targetsDownedAlly(skill) {
  return !!skill?.revive;
}

export default { TARGET, skillTargetKind, targetsAllySide, needsTargetPick, targetsDownedAlly };
