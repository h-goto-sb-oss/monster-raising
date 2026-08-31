// fusion.js
// 配合レシピ表(data/fusionRecipes.json)の引き当てロジック。
//
// レシピ表は monster_project/build_fusion_recipes.py が生成する。
// 285x285=81,225通りを列挙する代わりに、
//   「結果は (血統の個体, 相手のタイプ, 階級の向き) だけで決まる」
// という性質を使って by_bloodline[血統id][向き].partners[相手タイプ] に畳んである。
// 詳しくは src/data/FUSION_DATA_README.md を参照。

import recipes from '../data/fusionRecipes.json';

export const TIER_ORDER = recipes.tier_order;
export const WILD_TIERS = recipes.wild_tiers;

const TIER_INDEX = {};
TIER_ORDER.forEach((t, i) => {
  TIER_INDEX[t] = i;
});

// 手設計レシピは血統idで先に絞れるようにしておく
const SPECIAL_BY_BLOODLINE = {};
recipes.special.forEach((r) => {
  if (!SPECIAL_BY_BLOODLINE[r.bloodline_id]) SPECIAL_BY_BLOODLINE[r.bloodline_id] = [];
  SPECIAL_BY_BLOODLINE[r.bloodline_id].push(r);
});

export function tierIndex(tier) {
  return TIER_INDEX[tier] ?? 0;
}

// 相手が血統と同格以上なら階級が1段上がり(up)、格下なら据え置き(same)。
export function fusionDirection(bloodline, partner) {
  return tierIndex(partner.tier) >= tierIndex(bloodline.tier) ? 'up' : 'same';
}

/**
 * 血統と相手からレシピを引く。
 * @returns {null | {
 *   recipeId, resultId, resultTier, resultType, typeRule, hidden, source,
 *   rationale, direction
 * }}
 */
export function resolveFusion(bloodline, partner) {
  if (!bloodline || !partner) return null;
  if (bloodline.id === partner.id) return null; // 同一個体は相手に選べない

  // 1) 手設計レシピが最優先。ただし現UIは相手1体のみ対応なので、
  //    複数固定(partner_ids が2件以上)の特殊配合はここでは成立しない。
  const specials = SPECIAL_BY_BLOODLINE[bloodline.id] || [];
  for (const r of specials) {
    if (r.partner_ids.length === 1 && r.partner_ids[0] === partner.id) {
      return {
        recipeId: r.recipe_id,
        resultId: r.result_id,
        resultTier: r.result_tier,
        resultType: r.result_type,
        typeRule: r.type_rule,
        hidden: r.hidden,
        source: r.source,
        rationale: r.rationale || '',
        direction: 'special',
      };
    }
  }

  // 2) 自動生成レシピ
  const dirs = recipes.by_bloodline[bloodline.id];
  if (!dirs) return null;
  const direction = fusionDirection(bloodline, partner);
  const bucket = dirs[direction];
  if (!bucket) return null;
  const entry = bucket.partners[partner.type];
  if (!entry) return null;

  const [resultId, resultType, ruleCode] = entry;
  return {
    recipeId: `G:${bloodline.id}:${direction}:${partner.type}`,
    resultId,
    resultTier: bucket.result_tier,
    resultType,
    typeRule: recipes.type_rules[ruleCode],
    hidden: bucket.hidden,
    source: '自動生成',
    rationale: '',
    direction,
  };
}

// 配合結果の名前を伏せるかどうか。★3〜★4は「発見済み」になるまで ？？？ 表示。
export function shouldHideResult(outcome, discoveredIds) {
  if (!outcome) return false;
  if (!outcome.hidden) return false;
  return !discoveredIds.includes(outcome.resultId);
}

export default { resolveFusion, fusionDirection, shouldHideResult, TIER_ORDER, WILD_TIERS };
