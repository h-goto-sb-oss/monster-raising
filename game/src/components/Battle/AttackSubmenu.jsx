// AttackSubmenu.jsx
// 「たたかう」を選んだときのサブメニュー。順番は仕様通り こうげき/とくぎ/ぼうぎょ。

const OPTIONS = [
  { id: 'normal', label: 'こうげき' },
  { id: 'skill', label: 'とくぎ' },
  { id: 'defend', label: 'ぼうぎょ' },
];

export default function AttackSubmenu({ onSelect, onBack }) {
  return (
    <>
      <div className="jrpg-wintitle">
        <span>たたかう？</span>
      </div>
      <div className="mrg-col">
        {OPTIONS.map((opt) => (
          <button key={opt.id} className="jrpg-btn" onClick={() => onSelect(opt.id)}>
            {opt.label}
          </button>
        ))}
      </div>
      <button className="jrpg-btn jrpg-btn--back mrg-btn--back" onClick={onBack}>
        もどる
      </button>
    </>
  );
}
