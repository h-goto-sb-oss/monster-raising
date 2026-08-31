// BattleMenu.jsx
// 固定の最上位コマンドメニュー。順番は仕様通り必ず たたかう/どうぐ/さくせん/にげる。
// 枠(ウィンドウ)は BattleScreen 側の .mrg-cmd が受け持つので、ここは中身だけ。

const COMMANDS = [
  { id: 'attack', label: 'たたかう' },
  { id: 'item', label: 'どうぐ' },
  { id: 'tactics', label: 'さくせん' },
  { id: 'flee', label: 'にげる' },
];

export default function BattleMenu({ actorName, onSelect, disabled }) {
  return (
    <>
      <div className="jrpg-wintitle">
        <span>{actorName}</span>
        <span className="jrpg-winsub">コマンド？</span>
      </div>
      <div className="mrg-grid2">
        {COMMANDS.map((cmd) => (
          <button key={cmd.id} className="jrpg-btn" disabled={disabled} onClick={() => onSelect(cmd.id)}>
            {cmd.label}
          </button>
        ))}
      </div>
    </>
  );
}
