// StarterEvent.jsx
// 開始イベント (要望1)。物語は1体から始まる。
// 下位136体からランダムに3体を提示し、そこから1体だけ選ばせる。
// 完全ランダムではなく「引いた3体から選ぶ」形にしたのは博史さんの選択。
//
// レイアウトは他の画面と同じ「ビューポート固定 + はみ出すのは中だけ」。
// 以前は縦に積むだけだったので、844x390(スマホ横)ではページのスクロールバーが
// 出ていた。ゲームの1画面目でスクロールバーが出るのは締まらない。

import { useMemo, useState } from 'react';
import { useGameStore } from '../../state/gameStore.js';
import './starterEvent.css';

const STAT_LABELS = [
  ['hp', 'HP'],
  ['mp', 'MP'],
  ['atk', 'こうげき'],
  ['def', 'ぼうぎょ'],
  ['int', 'かしこさ'],
  ['spd', 'すばやさ'],
];

function drawThree(roster) {
  const pool = roster.filter((m) => m.tier === '下位');
  const picked = [];
  const used = new Set();
  let guard = 0;
  while (picked.length < 3 && guard < 500) {
    guard += 1;
    const cand = pool[Math.floor(Math.random() * pool.length)];
    if (!cand || used.has(cand.id)) continue;
    used.add(cand.id);
    picked.push(cand);
  }
  return picked;
}

export default function StarterEvent({ onDone }) {
  const { roster, acquireSpecies, setParty } = useGameStore();
  const [choices] = useState(() => drawThree(roster));
  const [selectedId, setSelectedId] = useState(null);
  const [confirmed, setConfirmed] = useState(null);

  const selected = useMemo(() => choices.find((m) => m.id === selectedId) || null, [choices, selectedId]);

  function decide() {
    if (!selected) return;
    const inst = acquireSpecies(selected.id, { level: 1 });
    if (inst) setParty([inst.uid]);
    setConfirmed(selected);
  }

  if (confirmed) {
    return (
      <div className="stev">
        <h2 className="stev-title">たびだち</h2>
        <div className="stev-body jrpg-scroll">
          <div className="stev-card jrpg-win stev-card--done">
            <img className="stev-big" src={confirmed.spriteUrl} alt={confirmed.name} />
            <div className="stev-name">{confirmed.name}</div>
            <div className="stev-meta">{confirmed.type} / ★{confirmed.star} / Lv 1</div>
            <div className="stev-join">{confirmed.name} が なかまに なった！</div>
            <div className="stev-note">
              まずはこの1体と 旅に出よう。ダンジョンで 戦えば レベルが上がり、
              野生のモンスターが 仲間に なることもある。
            </div>
          </div>
        </div>
        <div className="stev-foot">
          <button className="jrpg-btn jrpg-btn--primary" onClick={onDone}>まちへ むかう</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stev">
      <h2 className="stev-title">はじまりの イベント</h2>
      <div className="stev-lead">3体のモンスターが あなたを 見ている。1体だけ 連れていける。</div>

      <div className="stev-body jrpg-scroll">
        <div className="stev-row">
          {choices.map((m) => {
            const on = m.id === selectedId;
            return (
              <button
                key={m.id}
                className={`stev-card jrpg-win${on ? ' stev-card--on' : ''}`}
                onClick={() => setSelectedId(m.id)}
              >
                <img className="stev-sprite" src={m.spriteUrl} alt={m.name} />
                <div className="stev-name">{m.name}</div>
                <div className="stev-meta">{m.type} / ★{m.star}</div>
                <div className="stev-stats">
                  {STAT_LABELS.map(([k, label]) => (
                    <div key={k} className="stev-stat">
                      <span>{label}</span>
                      <span>{m.stats[k]}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="stev-foot">
        <button
          className={`jrpg-btn${selected ? ' jrpg-btn--primary' : ''}`}
          disabled={!selected}
          onClick={decide}
        >
          {selected ? `${selected.name} を えらぶ` : '1体 えらんでください'}
        </button>
      </div>
    </div>
  );
}
