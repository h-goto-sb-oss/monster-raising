// ItemIcon.jsx
// どうぐの絵。ふくろ・戦闘のどうぐ欄・宝箱のメッセージ・司祭のお礼、
// どうぐが出るところは全部これを通す。
//
// 絵は items.json の icon(monster_project/build_field_assets.py が
// 素材集の 216px アイコンを 48px に落として出している)。
//
// **絵が無いどうぐがある**。せいすい は絵を発注したあとに足したどうぐで、
// icon が null のまま。ここで落ちたり、絵の場所が空白のままガタつく実装に
// すると、あとで新しいどうぐを足すたびに同じ事故が起きる。
// だから絵が無いときは「同じ大きさの枠に、分類の色と頭文字」を出す。
// 場所の取り方が変わらないので、並びが崩れない。

import { ITEM_BY_ID } from '../../engine/items.js';

/** 分類の色。絵が無いときの代わりの見た目に使う。 */
export const ITEM_CATEGORY_COLORS = {
  HP回復: '#3ecf5f',
  蘇生: '#ffd24d',
  MP回復: '#4d9dff',
  状態異常回復: '#a86ad6',
  餌: '#e08a4d',
  恒久強化: '#7ee08a',
  戦闘用攻撃: '#e05a5a',
  移動: '#8fd0ff',
};

export default function ItemIcon({ item, itemId, size = 24, className = '' }) {
  const it = item || ITEM_BY_ID[itemId] || null;
  if (!it) return null;

  // size を null にすると寸法はCSS任せ(vh追従させたい戦闘画面で使う)。
  // 代わりの見た目に出す頭文字も、枠の大きさから決める(親の文字サイズに
  // ひきずられると、小さい枠に大きい字が入ってはみ出す)。
  const box = size == null
    ? undefined
    : { width: size, height: size, fontSize: Math.max(8, Math.round(size * 0.56)) };

  if (it.icon) {
    return (
      <img
        className={`mrg-itemicon ${className}`.trim()}
        src={it.icon}
        alt=""
        title={it.name}
        style={box}
      />
    );
  }

  const color = ITEM_CATEGORY_COLORS[it.category] || '#8b93ab';
  return (
    <span
      className={`mrg-itemicon mrg-itemicon--none ${className}`.trim()}
      title={it.name}
      style={{ ...box, color, borderColor: color, background: `${color}22` }}
      aria-hidden="true"
    >
      {it.name.slice(0, 1)}
    </span>
  );
}
