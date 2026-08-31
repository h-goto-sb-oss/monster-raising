// ItemMenu.jsx
// 「どうぐ」コマンド。戦闘中に使えるどうぐだけを、分類ごとに並べる。
// 拠点専用のどうぐ(たね類)はここには出さない。
//
// 行の頭にどうぐの絵を出す。戦闘中は落ち着いて字を読んでいる余裕がないので、
// 絵で「回復か、攻撃か」が一瞬で分かるようにしておきたい。
// 寸法は画面の高さ追従(.mrg-itemicon--row)。絵の無いどうぐは
// ItemIcon が同じ大きさの代わりを出すので、行の高さは揃ったままになる。

import { ITEM_CATEGORY_ORDER, usableInBattle } from '../../engine/items.js';
import ItemIcon from '../Common/ItemIcon.jsx';

export default function ItemMenu({ items, slotsUsed, slotLimit, onSelect, onBack }) {
  const usable = items.filter((e) => usableInBattle(e.item));
  const hasAny = usable.some((e) => e.count > 0);

  return (
    <>
      <div className="jrpg-wintitle">
        <span>どうぐ</span>
        <span className="jrpg-winsub" style={{ color: slotsUsed >= slotLimit ? '#e08a4d' : undefined }}>
          ふくろ {slotsUsed}/{slotLimit}
        </span>
      </div>
      {!hasAny && <div className="mrg-note">戦闘で 使える どうぐが ない</div>}
      <div className="mrg-list">
        {ITEM_CATEGORY_ORDER.map((category) => {
          const inCategory = usable.filter((e) => e.item.category === category && e.count > 0);
          if (inCategory.length === 0) return null;
          return (
            <div key={category}>
              <div className="mrg-listhead">{category}</div>
              <div className="mrg-col">
                {inCategory.map((entry) => (
                  <button
                    key={entry.item.id}
                    className="jrpg-btn jrpg-btn--wide"
                    onClick={() => onSelect(entry.item)}
                    title={`${entry.item.description}（対象: ${entry.item.target}）`}
                  >
                    <span className="mrg-row">
                      <ItemIcon item={entry.item} size={null} className="mrg-itemicon--row" />
                      <span className="mrg-grow">{entry.item.name}</span>
                      <span className="mrg-count">×{entry.count}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <button className="jrpg-btn jrpg-btn--back mrg-btn--back" onClick={onBack}>
        もどる
      </button>
    </>
  );
}
