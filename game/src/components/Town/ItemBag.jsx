// ItemBag.jsx
// 拠点の「どうぐぶくろ」。持ちものの確認と、拠点で使えるどうぐの使用を行う。
//
// ふくろはパーティー共有で 20スロット / 1スロット99コまで(engine/items.js)。
// たね類はここでしか使えず、対象個体の baseStats を永続的に上げる。
// 戦闘専用のどうぐも一覧には出すが、「戦闘中に使う」と分かるようにして押せなくする。
//
// v0.6 でどうぐの絵が入ったので、一覧を **文字の行から絵のタイルへ** 変えた。
// 20スロットぶんの持ちものを名前だけの行で並べると、探すのに毎回読まされる。
// 絵を主役にして、名前と個数を小さく添えるほうが目で拾える。
// 絵の無いどうぐ(せいすい)も ItemIcon が同じ大きさの代わりを出すので、
// タイルの並びは崩れない。
//
// 絵はタイルの背が高くなるぶん、縦に積むとすぐ画面からあふれる。
// そこで画面じたいを固定(position:fixed)にして、あふれるのは
// 「どうぐの一覧」と「右の欄」の中だけにした。
// ページのスクロールバーは出ない = 844x390(スマホ横)に収まる。

import { useState } from 'react';
import { useGameStore, formatGold } from '../../state/gameStore.js';
import { ITEM_CATEGORY_ORDER, usableInTown } from '../../engine/items.js';
import InstanceDetail from '../Common/InstanceDetail.jsx';
import ItemIcon from '../Common/ItemIcon.jsx';
import './townUI.css';

/** 一覧のタイル1枚ぶんの絵の大きさ。素材は48pxなので、ここまでは劣化しない。 */
const TILE_ICON = 38;

export default function ItemBag({ onBack }) {
  const {
    items, inventory, bagUsedSlots, bagSlotLimit, bagStackLimit,
    useItemInTown, ownedView, party, skillsById, gold,
  } = useGameStore();

  const [selectedItemId, setSelectedItemId] = useState(null);
  const [selectedUid, setSelectedUid] = useState(null);
  const [message, setMessage] = useState('');

  const owned = items.map((it) => ({ item: it, count: inventory[it.id] || 0 })).filter((e) => e.count > 0);
  const selectedItem = items.find((it) => it.id === selectedItemId) || null;
  const inspected = ownedView.find((v) => v.instance.uid === selectedUid) || null;
  const needsTarget = selectedItem && selectedItem.target === '味方単体';
  const bagFull = bagUsedSlots >= bagSlotLimit;

  function handleUse() {
    if (!selectedItem) return;
    const result = useItemInTown(selectedItem.id, selectedUid);
    setMessage(result.message);
    // 使い切ったら選択を外す
    if (result.ok && (inventory[selectedItem.id] || 0) <= 1) setSelectedItemId(null);
  }

  return (
    <div className="bag">
      <div className="bag-head">
        <h2 className="bag-title">どうぐぶくろ</h2>
        <span className={`bag-chip${bagFull ? ' bag-chip--full' : ''}`}>
          ふくろ {bagUsedSlots}/{bagSlotLimit} スロット{bagFull && '（いっぱい）'}
        </span>
        {/* 所持金。いまの出どころはダンジョンの宝箱だけで、使い道は
            どうぐ屋ができてから。持っているのが見えないと稼ぐ意味がない。 */}
        <span className="bag-chip bag-chip--gold">
          <img src="/assets/ui/gold.png" alt="" />
          {formatGold(gold)} G
        </span>
        <button className="bag-back" onClick={onBack}>もどる</button>
      </div>

      <div className="bag-note">
        パーティー共有のふくろです。{bagSlotLimit}スロットまで、1スロットに同じどうぐを{bagStackLimit}コまで。
        たね・きのみは ここで使うと そのモンスターの能力が 永久に上がります。
      </div>

      <div className="bag-main">
        <div className="bag-items">
          {owned.length === 0 && <div className="bag-empty">どうぐを 持っていません。</div>}
          {ITEM_CATEGORY_ORDER.map((category) => {
            const inCategory = owned.filter((e) => e.item.category === category);
            if (inCategory.length === 0) return null;
            return (
              <div key={category} className="bag-group">
                <div className="bag-grouphead">{category}</div>
                <div className="bag-grid">
                  {inCategory.map(({ item, count }) => {
                    const town = usableInTown(item);
                    const selected = item.id === selectedItemId;
                    return (
                      <button
                        key={item.id}
                        // 戦闘専用のどうぐは、ここでは押しても使えない。
                        // うすくして「今は出番ではない」を見た目でも伝える。
                        className={`bag-tile${selected ? ' bag-tile--on' : ''}${town ? '' : ' bag-tile--battle'}`}
                        onClick={() => {
                          setSelectedItemId(item.id);
                          setMessage('');
                        }}
                        title={`${item.name}：${item.description}`}
                      >
                        <ItemIcon item={item} size={TILE_ICON} />
                        <span className="bag-tilename">{item.name}</span>
                        {/* 個数は絵の角に重ねる。行に混ぜると名前が読みにくい。 */}
                        <span className="bag-tilecount">×{count}</span>
                        {!town && <span className="bag-tilebattle">戦</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="bag-side">
          {selectedItem ? (
            <div className="bag-card">
              <div className="bag-cardhead">
                <ItemIcon item={selectedItem} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div className="bag-cardname">{selectedItem.name}</div>
                  <div className="bag-carddesc">
                    {selectedItem.description}（対象: {selectedItem.target} ／ 使える場所: {selectedItem.usableIn}）
                  </div>
                </div>
              </div>
              {!usableInTown(selectedItem) ? (
                <div className="bag-warn">これは 戦闘中に つかう どうぐです。</div>
              ) : (
                <>
                  {needsTarget && (
                    <div className="bag-hint">つかう相手を えらんでください（下のカード）</div>
                  )}
                  <button className="bag-use" onClick={handleUse} disabled={needsTarget && !selectedUid}>
                    つかう
                  </button>
                </>
              )}
              {message && <div className="bag-result">{message}</div>}
            </div>
          ) : (
            <div className="bag-card bag-card--idle">どうぐを えらぶと ここに 出ます。</div>
          )}

          <div className="bag-sidescroll">
            <div className="bag-grouphead">
              モンスター（{party.length > 0 ? '★は手持ち' : '手持ちなし'}）
            </div>
            <div className="bag-mons">
              {ownedView.map((v) => {
                const inParty = party.includes(v.instance.uid);
                const down = v.instance.hp <= 0;
                const selected = v.instance.uid === selectedUid;
                return (
                  <button
                    key={v.instance.uid}
                    className={`bag-mon${selected ? ' bag-mon--on' : ''}${down ? ' bag-mon--down' : ''}`}
                    onClick={() => setSelectedUid(v.instance.uid)}
                  >
                    <img src={v.species.spriteUrl} alt={v.name} />
                    <div className="bag-monname">
                      {inParty ? '★' : ''}
                      {v.name}
                    </div>
                    <div className={down ? 'bag-mondown' : 'bag-monhp'}>
                      {down ? '戦闘不能' : `HP ${v.instance.hp}/${v.instance.stats.hp}`}
                    </div>
                    <div className="bag-monmp">MP {v.instance.mp}/{v.instance.stats.mp}</div>
                  </button>
                );
              })}
            </div>

            <div className="bag-grouphead" style={{ marginTop: 8 }}>個体の詳細</div>
            {inspected ? (
              <InstanceDetail instance={inspected.instance} species={inspected.species} skillsById={skillsById} />
            ) : (
              <div className="bag-empty">モンスターを えらぶと ここに 表示されます。</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
