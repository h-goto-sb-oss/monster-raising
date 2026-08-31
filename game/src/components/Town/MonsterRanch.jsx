// MonsterRanch.jsx
// 手持ち3体の入れ替えができる、実データ連動の機能。
// パーティー編成は gameStore を介して localStorage に永続化される。
//
// v0.2 から所持は「個体(instance)」単位。同じ種族を2体持てるので、
// カードは uid をキーにして、レベルとプラス値付きの表示名で区別する。
// カードを選ぶと右側に個体の詳細(ステータス・習得技・継承枠)が出る。

import { useState } from 'react';
import { useGameStore } from '../../state/gameStore.js';
import MonsterFilterBar, { EMPTY_FILTER, applyInstanceFilter } from './MonsterFilter.jsx';
import InstanceDetail from '../Common/InstanceDetail.jsx';
import './townUI.css';

function MonsterCard({ view, onAction, actionLabel, onInspect, selected }) {
  const { instance, species, name } = view;
  const pending = (instance.inherited || []).length;
  return (
    <div
      style={{
        border: selected ? '2px solid #ffd24d' : '1px solid #444',
        borderRadius: 6,
        padding: 8,
        background: selected ? '#2b2a1c' : '#1c2030',
        width: 150,
      }}
    >
      <div onClick={() => onInspect(instance.uid)} style={{ cursor: 'pointer' }}>
        <img
          src={species.spriteUrl}
          alt={name}
          style={{ width: 48, height: 48, objectFit: 'contain', imageRendering: 'pixelated', display: 'block', margin: '0 auto' }}
        />
        <div style={{ fontSize: 12, textAlign: 'center', marginTop: 4 }}>{name}</div>
        <div style={{ fontSize: 10, color: '#999', textAlign: 'center' }}>
          Lv {instance.level} / {species.type} / ★{species.star}
        </div>
        {pending > 0 && (
          <div style={{ fontSize: 9, color: '#e0b06a', textAlign: 'center' }}>継承枠 {pending}</div>
        )}
      </div>
      <button
        className="jrpg-btn"
        onClick={() => onAction(instance.uid)}
        style={{ marginTop: 6, width: '100%', justifyContent: 'center' }}
      >
        {actionLabel}
      </button>
    </div>
  );
}

export default function MonsterRanch({ onBack }) {
  const { ownedView, party, setParty, skillsById } = useGameStore();
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [inspectUid, setInspectUid] = useState(null);

  const partyViews = party
    .map((uid) => ownedView.find((v) => v.instance.uid === uid))
    .filter(Boolean);
  const rest = ownedView.filter((v) => !party.includes(v.instance.uid));
  const restViews = applyInstanceFilter(rest, filter);
  const inspected = ownedView.find((v) => v.instance.uid === inspectUid) || null;

  function removeFromParty(uid) {
    setParty(party.filter((pid) => pid !== uid));
  }

  function addToParty(uid) {
    if (party.length >= 3) return;
    setParty([...party, uid]);
  }

  return (
    <div className="town-screen jrpg-scroll">
      <div className="town-screen-inner">
      <h2 className="town-screentitle">
        {/* 牧場主のドット絵。見出しに置いて「誰の施設か」を出す。 */}
        <img className="npc-badge" src="/assets/npc/rancher.png" alt="" />
        モンスター牧場
      </h2>
      <div className="town-screennote">
        カードの絵をクリックすると個体の中身を見られます。ボタンで手持ち（最大3体）を入れ替えます。
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 13, marginBottom: 8, color: '#ffd24d' }}>手持ちパーティー ({partyViews.length}/3)</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', minHeight: 130 }}>
              {partyViews.map((v) => (
                <MonsterCard
                  key={v.instance.uid}
                  view={v}
                  onAction={removeFromParty}
                  actionLabel="外す"
                  onInspect={setInspectUid}
                  selected={v.instance.uid === inspectUid}
                />
              ))}
              {partyViews.length === 0 && <div style={{ fontSize: 12, color: '#666' }}>手持ちがいません</div>}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>牧場のモンスター</div>
            <MonsterFilterBar
              filter={filter}
              onChange={setFilter}
              count={restViews.length}
              total={ownedView.length}
            />
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxHeight: 360, overflowY: 'auto' }}>
              {restViews.length === 0 && (
                <div style={{ fontSize: 12, color: '#666' }}>該当するモンスターがいません</div>
              )}
              {restViews.map((v) => (
                <MonsterCard
                  key={v.instance.uid}
                  view={v}
                  onAction={addToParty}
                  actionLabel={party.length >= 3 ? '手持ち満員' : '加える'}
                  onInspect={setInspectUid}
                  selected={v.instance.uid === inspectUid}
                />
              ))}
            </div>
          </div>
        </div>

        <div style={{ width: 260, flexShrink: 0, border: '1px solid #444', borderRadius: 8, background: '#181c28', padding: 12, minHeight: 200 }}>
          <div style={{ fontSize: 12, color: '#ffd24d', marginBottom: 8 }}>個体の詳細</div>
          {inspected ? (
            <InstanceDetail instance={inspected.instance} species={inspected.species} skillsById={skillsById} />
          ) : (
            <div style={{ fontSize: 11, color: '#666' }}>カードの絵をクリックすると、ここに表示されます。</div>
          )}
        </div>
      </div>

      <button className="jrpg-btn jrpg-btn--back" onClick={onBack} style={{ marginTop: 20 }}>
        もどる
      </button>
      </div>
    </div>
  );
}
