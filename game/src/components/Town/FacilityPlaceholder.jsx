// FacilityPlaceholder.jsx
// あずけ所/教会用の汎用「準備中」パネル。(どうぐ屋は ItemShop.jsx で実装済み)
//
// v0.5 から、この画面へは「建物の中でNPCに話しかける」と入る。
// 閉じると町ではなく建物の中へ戻るので、ボタンの文言は呼び出し側が決める。
// 実際の機能は次フェーズ以降で実装する。
//
// 中身は準備中でも、その施設の人物と内装の絵は用意できたので、
// 「どこに来たのか」が伝わる画面にしておく。

import './townUI.css';

export default function FacilityPlaceholder({ title, note, npc, backdrop, onBack, backLabel }) {
  return (
    <div
      className="facility"
      style={backdrop ? { '--facility-bg': `url('${backdrop}')` } : undefined}
    >
      <div className="facility-card">
        <div className="facility-head">
          {npc && <img className="facility-npc" src={npc} alt={title} />}
          <div className="facility-title">{title}</div>
        </div>
        <div style={{ fontSize: 13, color: '#c3cadb', marginBottom: 20, lineHeight: 1.7 }}>
          {note || 'この施設はまだ準備中です。今後のフェーズで実装予定。'}
        </div>
        <button
          onClick={onBack}
          style={{
            padding: '8px 20px',
            background: 'linear-gradient(180deg, #3a4363, #222941)',
            color: '#f2efe4',
            border: '1px solid #7683a8',
            borderRadius: 3,
            fontFamily: 'inherit',
          }}
        >
          {backLabel || 'もどる'}
        </button>
      </div>
    </div>
  );
}
