// TacticsMenu.jsx
// 「さくせん」コマンドの最小実装。パーティー全体に1つのプリセットを設定するか、
// 「せいぎょする(手動)」で作戦を解除する。

import { getTacticsList } from '../../engine/battle/ai.js';

export default function TacticsMenu({ currentTactic, onSelect, onBack }) {
  const tactics = getTacticsList();
  return (
    <>
      <div className="jrpg-wintitle">
        <span>さくせん</span>
        <span className="jrpg-winsub">パーティー全体</span>
      </div>
      <div className="mrg-list">
        <button
          className={`jrpg-btn jrpg-btn--wide${currentTactic === null ? ' jrpg-btn--on' : ''}`}
          onClick={() => onSelect(null)}
        >
          せいぎょする（手動操作にもどす）
        </button>
        {tactics.map((t) => (
          <button
            key={t.id}
            className={`jrpg-btn jrpg-btn--wide${currentTactic === t.id ? ' jrpg-btn--on' : ''}`}
            title={t.description}
            onClick={() => onSelect(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <button className="jrpg-btn jrpg-btn--back mrg-btn--back" onClick={onBack}>
        もどる
      </button>
    </>
  );
}
