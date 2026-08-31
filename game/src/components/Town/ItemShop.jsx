// ItemShop.jsx
// まちの どうぐ屋。買う / 売る。
//
// ここができるまで、ゴールドは「宝箱で増える数字」でしかなかった。
// 稼ぐ意味を作るのが目的なので、置くのは **消耗品だけ** にしてある。
// 何を置くか・いつ並ぶかの理由は engine/shop.js に書いた。
//
// 見た目は「どうぐぶくろ」(ItemBag.jsx)と同じ骨格を使っている。
// 同じ持ちものを扱う画面なのに並びが違うと、探す場所を2つ覚えることになる。
// 画面じたいは position:fixed で、あふれるのは一覧と右の欄の中だけ。
// ページのスクロールバーは出ない = 844x390(スマホ横)に収まる。

import { useMemo, useState } from 'react';
import { useGameStore, formatGold } from '../../state/gameStore.js';
import { sellPrice, stockedItemIds, nextUnlockAt } from '../../engine/shop.js';
import ItemIcon from '../Common/ItemIcon.jsx';
import './townUI.css';

const TILE_ICON = 38;

/** まとめ買い・まとめ売りの単位。1コずつ押させると やくそう10コが10回になる。 */
const QUANTITIES = [1, 5, 10];

export default function ItemShop({ onBack }) {
  const {
    items, inventory, bagUsedSlots, bagSlotLimit, bagStackLimit,
    gold, buyItem, sellItem, clearedDungeons,
  } = useGameStore();

  const [mode, setMode] = useState('buy'); // 'buy' | 'sell'
  const [selectedId, setSelectedId] = useState(null);
  const [qty, setQty] = useState(1);
  const [message, setMessage] = useState('');

  const clearedCount = clearedDungeons.length;
  // 並び順は shop.js の SHOP_STOCK 順。安いものから並ぶようにしてある。
  const stocked = useMemo(
    () => stockedItemIds(clearedCount).map((id) => items.find((it) => it.id === id)).filter(Boolean),
    [items, clearedCount],
  );

  // 売る側は「いま持っているもの」。売れないどうぐは無い(全部 price を持つ)。
  const sellable = useMemo(
    () => items.map((it) => ({ item: it, count: inventory[it.id] || 0 })).filter((e) => e.count > 0),
    [items, inventory],
  );

  const list = mode === 'buy'
    ? stocked.map((it) => ({ item: it, count: inventory[it.id] || 0 }))
    : sellable;

  const selected = list.find((e) => e.item.id === selectedId) || null;
  const bagFull = bagUsedSlots >= bagSlotLimit;
  const unlockAt = nextUnlockAt(clearedCount);

  const unitPrice = selected ? (mode === 'buy' ? selected.item.price : sellPrice(selected.item)) : 0;
  // 売るときは持っている数より多くは押せない。買うときは財布とふくろが決める。
  const maxQty = selected && mode === 'sell' ? selected.count : bagStackLimit;
  const effectiveQty = Math.max(1, Math.min(qty, maxQty));
  const total = unitPrice * effectiveQty;
  const cannotAfford = mode === 'buy' && total > gold;

  function switchMode(next) {
    setMode(next);
    setSelectedId(null);
    setMessage('');
    setQty(1);
  }

  function handleDeal() {
    if (!selected) return;
    const result = mode === 'buy'
      ? buyItem(selected.item.id, effectiveQty)
      : sellItem(selected.item.id, effectiveQty);
    setMessage(result.message);
    // 売り切って0コになったら選択を外す(空の欄を眺めることになるので)。
    if (mode === 'sell' && result.ok && result.sold >= selected.count) setSelectedId(null);
  }

  return (
    <div className="bag">
      <div className="bag-head">
        <h2 className="bag-title">どうぐ屋</h2>
        <span className="bag-chip bag-chip--gold">
          <img src="/assets/ui/gold.png" alt="" />
          {formatGold(gold)} G
        </span>
        <span className={`bag-chip${bagFull ? ' bag-chip--full' : ''}`}>
          ふくろ {bagUsedSlots}/{bagSlotLimit}{bagFull && '（いっぱい）'}
        </span>
        <button className="bag-back" onClick={onBack}>もどる</button>
      </div>

      {/* かう / うる の切り替え。同じ棚を見る目的が2つあるだけなので、
          画面を分けずにここで切り替える。 */}
      <div className="shop-tabs">
        <button
          className={`shop-tab${mode === 'buy' ? ' shop-tab--on' : ''}`}
          onClick={() => switchMode('buy')}
        >
          かう
        </button>
        <button
          className={`shop-tab${mode === 'sell' ? ' shop-tab--on' : ''}`}
          onClick={() => switchMode('sell')}
        >
          うる
        </button>
        <span className="shop-tabnote">
          {mode === 'buy'
            ? (unlockAt != null
              ? `ダンジョンを ${unlockAt}つ 踏破すると 品ぞろえが 増える（いま ${clearedCount}つ）`
              : '品ぞろえは これで ぜんぶ です。')
            : '売値は 買値の 半分です。'}
        </span>
      </div>

      <div className="bag-main">
        <div className="bag-items">
          {list.length === 0 && (
            <div className="bag-empty">
              {mode === 'buy' ? 'いまは 何も 置いていません。' : '売れる どうぐを 持っていません。'}
            </div>
          )}
          <div className="bag-grid">
            {list.map(({ item, count }) => {
              const price = mode === 'buy' ? item.price : sellPrice(item);
              const on = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  className={`bag-tile${on ? ' bag-tile--on' : ''}`}
                  onClick={() => { setSelectedId(item.id); setQty(1); setMessage(''); }}
                  title={`${item.name}：${item.description}`}
                >
                  <ItemIcon item={item} size={TILE_ICON} />
                  <span className="bag-tilename">{item.name}</span>
                  {/* 買う棚では値段、売る棚では持っている数を角に出す。
                      どちらも「押す前に知りたい一つ」がそれだから。 */}
                  <span className="bag-tilecount">
                    {mode === 'buy' ? `${formatGold(price)}G` : `×${count}`}
                  </span>
                  {mode === 'buy' && count > 0 && <span className="shop-have">{count}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="bag-side">
          {selected ? (
            <div className="bag-card">
              <div className="bag-cardhead">
                <ItemIcon item={selected.item} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div className="bag-cardname">{selected.item.name}</div>
                  <div className="bag-carddesc">{selected.item.description}</div>
                  <div className="bag-carddesc">
                    {mode === 'buy' ? '買値' : '売値'} {formatGold(unitPrice)}G ／ 持ち {selected.count}コ
                  </div>
                </div>
              </div>

              <div className="shop-qty">
                {QUANTITIES.map((n) => (
                  <button
                    key={n}
                    className={`shop-qtybtn${effectiveQty === n ? ' shop-qtybtn--on' : ''}`}
                    disabled={n > maxQty}
                    onClick={() => { setQty(n); setMessage(''); }}
                  >
                    {n}コ
                  </button>
                ))}
              </div>

              <button
                className="bag-use shop-deal"
                onClick={handleDeal}
                disabled={cannotAfford || (mode === 'buy' && bagFull && (inventory[selected.item.id] || 0) === 0)}
              >
                {mode === 'buy' ? 'かう' : 'うる'} {effectiveQty}コ（{mode === 'buy' ? '−' : '＋'}{formatGold(total)}G）
              </button>
              {cannotAfford && <div className="bag-warn">ゴールドが たりません。</div>}
              {message && <div className="bag-result">{message}</div>}
            </div>
          ) : (
            <div className="bag-card bag-card--idle">
              どうぐを えらぶと ここに 出ます。
            </div>
          )}

          <div className="bag-card">
            <div className="bag-carddesc">
              ふくろは {bagSlotLimit}スロット、1スロットに 同じどうぐを {bagStackLimit}コまで。
              たね・きのみは 売っていません（宝箱で 見つけてください）。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
