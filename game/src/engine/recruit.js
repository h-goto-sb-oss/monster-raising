// recruit.js
// 野生モンスターの仲間化判定 (要望2)。
// 倒した敵1体ごとに抽選する。上位以降は野生でほぼ手に入らないという
// GAME_SPEC_V0_1.md 1項の方針に合わせて、階級が上がるほど渋くする。
// 仲間になった個体はパーティーではなく牧場(owned)へ入る。

export const RECRUIT_RATES = {
  下位: 0.12,
  中位: 0.06,
  上位: 0.02,
  最上位: 0,
};

/**
 * 階級ごとの基礎確率。餌アイテム(ほしにく等)を使うと multiplier が乗る。
 * 最上位は 0 なので、餌を何個使っても野生では仲間にならない
 * (0 x 4 = 0)。「最上位は配合でしか手に入らない」という方針を守るため。
 */
export function recruitRate(tier, multiplier = 1) {
  const base = RECRUIT_RATES[tier] ?? 0;
  return Math.max(0, Math.min(1, base * (multiplier > 0 ? multiplier : 1)));
}

export function rollRecruit(species, rng = Math.random, multiplier = 1) {
  return rng() < recruitRate(species.tier, multiplier);
}

export function recruitMessage(species) {
  return `${species.name} が なかまになりたそうに こちらを見ている！`;
}

export default { rollRecruit, recruitRate, recruitMessage, RECRUIT_RATES };
