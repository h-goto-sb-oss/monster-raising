// DebugMenu.jsx
// 開発中の検証用メニュー。import.meta.env.DEV のときだけ表示され、
// 本番ビルド(npm run build)には出ない。
// 育成・継承・プラス値は「育ててみないと分からない」ので、
// ここでレベルとプラス値を直接いじって確認できるようにしておく。

import { useMemo, useState } from 'react';
import { useGameStore } from '../../state/gameStore.js';
import { displayName } from '../../engine/instance.js';
import { statsAtLevel } from '../../engine/growth.js';
import { AILMENT_IDS } from '../../engine/battle/ailments.js';
import InstanceDetail from '../Common/InstanceDetail.jsx';

const PANEL = { border: '1px solid #555', borderRadius: 8, background: '#12141c', padding: 12 };
const BTN = {
  padding: '5px 10px',
  background: '#2a2f42',
  color: '#fff',
  border: '1px solid #555',
  borderRadius: 4,
  fontSize: 11,
  cursor: 'pointer',
};
const INPUT = {
  background: '#1c2030',
  color: '#fff',
  border: '1px solid #555',
  borderRadius: 4,
  fontSize: 11,
  padding: '4px 6px',
};

const STAT_LABELS = [
  ['hp', 'HP'],
  ['mp', 'MP'],
  ['atk', 'こうげき'],
  ['def', 'ぼうぎょ'],
  ['int', 'かしこさ'],
  ['spd', 'すばやさ'],
];

export default function DebugMenu() {
  const store = useGameStore();
  const {
    roster, rosterById, skillsById, owned, ownedView, items,
    acquireMany, debugSetLevel, debugSetPlus, healParty, resetSave,
    acquireItem, emptyBag, bagUsedSlots, bagSlotLimit, gold, addGold,
  } = store;

  const [open, setOpen] = useState(false);
  const [itemLog, setItemLog] = useState('');
  const [ailmentTarget, setAilmentTarget] = useState('');
  const [giveItemId, setGiveItemId] = useState('');
  const [selectedUid, setSelectedUid] = useState(null);
  const [plusInput, setPlusInput] = useState('50');
  const [levelInput, setLevelInput] = useState('99');
  const [compareSpecies, setCompareSpecies] = useState('');
  const [comparePlus, setComparePlus] = useState('99');
  const [compareLevel, setCompareLevel] = useState('99');

  const selected = useMemo(
    () => ownedView.find((v) => v.instance.uid === selectedUid) || null,
    [ownedView, selectedUid],
  );

  function bulkAcquire() {
    const ids = roster.filter((m) => m.tier === '下位' || m.tier === '中位').map((m) => m.id);
    acquireMany(ids, { level: 1 });
  }

  /** 全種類のどうぐを5個ずつ。ふくろの上限を超える分は断られるのが正しい挙動。 */
  function giveAllItems() {
    const messages = [];
    items.forEach((it) => {
      const r = acquireItem(it.id, 5);
      if (!r.ok) messages.push(r.message);
    });
    setItemLog(messages.length > 0 ? messages[messages.length - 1] : '全種類を 5コずつ 入手した。');
  }

  /** ふくろを満杯にして、上限メッセージを確認するためのボタン。 */
  function fillBag() {
    let last = '';
    items.forEach((it) => {
      const r = acquireItem(it.id, 99);
      if (!r.ok) last = r.message;
    });
    setItemLog(last || 'ふくろを 埋めた。');
  }

  const battle = typeof window !== 'undefined' ? window.__mrgBattle : null;
  const combatants = battle
    ? [...battle.engine.playerParty, ...battle.engine.enemyParty].filter((c) => c.hp > 0)
    : [];

  function inflict(ailmentId) {
    if (!battle) return;
    const id = ailmentTarget || combatants[0]?.instanceId;
    if (!id) return;
    battle.engine.debugInflict(id, ailmentId, 4);
    battle.rerender();
  }

  // プラス値の効き方を数値で見るための机上計算。
  // 同じ個体値・同じレベルで plus だけを変えて比べる。
  const comparison = useMemo(() => {
    const species = rosterById[compareSpecies];
    if (!species) return null;
    const level = Math.max(1, Math.min(99, Number(compareLevel) || 99));
    const plus = Math.max(0, Math.min(99, Number(comparePlus) || 0));
    const iv = { hp: 15, mp: 15, atk: 15, def: 15, int: 15, spd: 15 };
    const mk = (p) => ({ iv, plus: p, level, baseStats: species.stats });
    const a = statsAtLevel(mk(0), species, level);
    const b = statsAtLevel(mk(plus), species, level);
    return { species, level, plus, a, b };
  }, [compareSpecies, comparePlus, compareLevel, rosterById]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="開発用デバッグメニュー (DEVビルドのみ)"
        style={{
          // 戦闘画面の右下はコマンド欄が占めるので、たたんだ状態は右上に置く。
          // フィールドの上の帯(どうぐ/メニュー)より下にずらして重ならないようにする。
          position: 'fixed',
          right: 8,
          top: 62,
          zIndex: 50,
          padding: '4px 8px',
          background: '#22252f',
          color: '#666',
          border: '1px solid #3a3f4a',
          borderRadius: 4,
          fontSize: 10,
          cursor: 'pointer',
        }}
      >
        debug
      </button>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        right: 8,
        bottom: 8,
        zIndex: 50,
        width: 380,
        maxHeight: '92vh',
        overflowY: 'auto',
        ...PANEL,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 12, color: '#e0b06a' }}>デバッグメニュー（DEVのみ）</div>
        <button style={BTN} onClick={() => setOpen(false)}>とじる</button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button style={BTN} onClick={bulkAcquire}>下位+中位を一括入手</button>
        <button style={BTN} onClick={healParty}>全回復</button>
        <button style={{ ...BTN, background: '#5c2a2a' }} onClick={resetSave}>セーブ初期化</button>
      </div>

      <div style={{ ...PANEL, marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: '#e0b06a', marginBottom: 6 }}>
          どうぐ（ふくろ {bagUsedSlots}/{bagSlotLimit} スロット）
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
          <button style={BTN} onClick={giveAllItems}>全種類を5コずつ</button>
          <button style={BTN} onClick={fillBag}>ふくろを満杯にする</button>
          <button style={BTN} onClick={() => { emptyBag(); setItemLog('ふくろを 空にした。'); }}>
            ふくろを空にする
          </button>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={giveItemId}
            onChange={(e) => setGiveItemId(e.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 0 }}
          >
            <option value="">どうぐを選ぶ…</option>
            {items.map((it) => (
              <option key={it.id} value={it.id}>{`${it.name}（${it.category}）`}</option>
            ))}
          </select>
          <button
            style={BTN}
            onClick={() => {
              if (!giveItemId) return;
              setItemLog(acquireItem(giveItemId, 5).message);
            }}
          >
            5コ入手
          </button>
        </div>
        {itemLog && <div style={{ fontSize: 10, color: '#e08a4d', marginTop: 6 }}>{itemLog}</div>}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}>
          <span style={{ fontSize: 11, color: '#ffd24d' }}>{gold.toLocaleString('ja-JP')} G</span>
          <button style={BTN} onClick={() => addGold(1000)}>+1000G</button>
        </div>
      </div>

      {battle && (
        <div style={{ ...PANEL, marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#e0b06a', marginBottom: 6 }}>戦闘中: 状態異常をかける</div>
          <select
            value={ailmentTarget}
            onChange={(e) => setAilmentTarget(e.target.value)}
            style={{ ...INPUT, width: '100%', marginBottom: 6 }}
          >
            <option value="">対象を選ぶ…（未選択なら先頭）</option>
            {combatants.map((c) => (
              <option key={c.instanceId} value={c.instanceId}>
                {c.isPlayer ? '【味方】' : '【てき】'} {c.name}
              </option>
            ))}
          </select>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {AILMENT_IDS.map((id) => (
              <button key={id} style={BTN} onClick={() => inflict(id)}>
                {id}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>所持 {owned.length} 体</div>

      <select
        value={selectedUid || ''}
        onChange={(e) => setSelectedUid(e.target.value)}
        style={{ ...INPUT, width: '100%', marginBottom: 8 }}
      >
        <option value="">個体を選ぶ…</option>
        {ownedView.map((v) => (
          <option key={v.instance.uid} value={v.instance.uid}>
            {displayName(v.instance, v.species)} (Lv{v.instance.level} / {v.species.type} / ★{v.species.star})
          </option>
        ))}
      </select>

      {selected && (
        <div style={{ ...PANEL, marginBottom: 10 }}>
          <InstanceDetail instance={selected.instance} species={selected.species} skillsById={skillsById} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            <button style={BTN} onClick={() => debugSetLevel(selected.instance.uid, 99)}>Lv99にする</button>
            <input value={levelInput} onChange={(e) => setLevelInput(e.target.value)} style={{ ...INPUT, width: 48 }} />
            <button style={BTN} onClick={() => debugSetLevel(selected.instance.uid, Number(levelInput) || 1)}>
              このLvにする
            </button>
            <button style={BTN} onClick={() => debugSetLevel(selected.instance.uid, selected.instance.level + 1)}>
              Lv+1
            </button>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#888' }}>プラス値</span>
            <input value={plusInput} onChange={(e) => setPlusInput(e.target.value)} style={{ ...INPUT, width: 48 }} />
            <button style={BTN} onClick={() => debugSetPlus(selected.instance.uid, Number(plusInput) || 0)}>
              設定する
            </button>
          </div>
        </div>
      )}

      <div style={{ ...PANEL }}>
        <div style={{ fontSize: 11, color: '#e0b06a', marginBottom: 6 }}>
          プラス値の効きかた（同レベル・同個体値で比較）
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <select
            value={compareSpecies}
            onChange={(e) => setCompareSpecies(e.target.value)}
            style={{ ...INPUT, width: 150 }}
          >
            <option value="">種族を選ぶ…</option>
            {roster.map((m) => (
              <option key={m.id} value={m.id}>{`${m.name} (${m.type})`}</option>
            ))}
          </select>
          <input value={compareLevel} onChange={(e) => setCompareLevel(e.target.value)} style={{ ...INPUT, width: 44 }} title="レベル" />
          <input value={comparePlus} onChange={(e) => setComparePlus(e.target.value)} style={{ ...INPUT, width: 44 }} title="プラス値" />
        </div>
        {comparison && (
          <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: '#888' }}>
                <th style={{ textAlign: 'left' }}>Lv{comparison.level}</th>
                <th style={{ textAlign: 'right' }}>+0</th>
                <th style={{ textAlign: 'right' }}>+{comparison.plus}</th>
                <th style={{ textAlign: 'right' }}>差</th>
                <th style={{ textAlign: 'right' }}>得意度</th>
              </tr>
            </thead>
            <tbody>
              {STAT_LABELS.map(([k, label]) => {
                const diff = comparison.b[k] - comparison.a[k];
                const pct = comparison.a[k] > 0 ? ((diff / comparison.a[k]) * 100).toFixed(1) : '0';
                return (
                  <tr key={k}>
                    <td style={{ color: '#aaa' }}>{label}</td>
                    <td style={{ textAlign: 'right' }}>{comparison.a[k]}</td>
                    <td style={{ textAlign: 'right' }}>{comparison.b[k]}</td>
                    <td style={{ textAlign: 'right', color: diff > 0 ? '#7ee08a' : '#666' }}>
                      +{diff}（{pct}%）
                    </td>
                    <td style={{ textAlign: 'right', color: '#888' }}>
                      {comparison.species.affinity?.[k] ?? '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
