// BattleMenu.jsx
// 固定の最上位コマンドメニュー。順番は仕様通り必ず たたかう/どうぐ/さくせん/にげる。
// 枠(ウィンドウ)は BattleScreen 側の .mrg-cmd が受け持つので、ここは中身だけ。
//
// さくせんを設定していても **4つとも出したまま**にする。
// 以前は さくせんを設定した子にコマンド欄を出さない作りで、いったん
// 「ガンガンいこうぜ」にすると回復もさくせんの変更もできなくなっていた。
// いま変わるのは たたかう の中身だけ:
//   さくせん未設定 … こうげき/とくぎ/ぼうぎょ を選ぶ
//   さくせん設定中 … さくせんが選ぶ行動を そのまま出す(選ばせない)
// どちらなのかが押す前に分かるよう、たたかう の下に さくせん名を出す。

const COMMANDS = [
  { id: 'attack', label: 'たたかう' },
  { id: 'item', label: 'どうぐ' },
  { id: 'tactics', label: 'さくせん' },
  { id: 'flee', label: 'にげる' },
];

export default function BattleMenu({ actorName, tacticLabel, onSelect, disabled }) {
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
      {tacticLabel && (
        <div className="mrg-note mrg-note--tactic">
          さくせん「{tacticLabel}」— たたかう で おまかせ
        </div>
      )}
    </>
  );
}
