// PartyStatusBar.jsx
// なかまの状態を、画面下に重ねる「細い帯」で表示する。
//
// 旧版はカード型で、なかま欄とてき欄を左右に並べていた。
// 新レイアウトでは:
//   - てきの名前とHPバーは BattleScene がキャンバスに直接描くので、ここには出さない
//     (敵用のパネルが縦幅を食っていたのをやめた)。
//   - なかまは1人1行の細い行にして、名前 / Lv / HP / MP / 状態タグ を1行に詰める。
//     行の高さは vh 基準の clamp なので、スマホ横(高さ390px)でも3人ぶん収まる。
//
// 行そのものもターゲットとして押せる。キャンバスのスプライトを押すのが本筋だが、
// 戦闘不能のなかま(スプライトが薄い)を蘇生対象に選ぶときはこちらの方が確実。

import { ailmentList, modList } from '../../engine/battle/ailments.js';

function Gauge({ label, value, max, color }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0;
  return (
    <div className="mrg-pgauge">
      <span>{label}</span>
      <div className="mrg-bar">
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="mrg-pnum">
        {value}/{max}
      </span>
    </div>
  );
}

/** 状態異常・能力変化のちいさなタグ。行の右端に置く(高さは増やさない)。 */
export function StateTags({ combatant }) {
  const ailments = ailmentList(combatant);
  const mods = modList(combatant);
  if (ailments.length === 0 && mods.length === 0) return null;
  return (
    <div className="mrg-tags">
      {ailments.map((a) => (
        <span
          key={a.id}
          className="mrg-tag"
          title={`${a.id}（あと${a.turns}ターン）: ${a.note}`}
          style={{ background: a.color, color: '#101018' }}
        >
          {a.short}
        </span>
      ))}
      {mods.map((m) => (
        <span
          key={m.stat}
          className="mrg-tag"
          title={`${m.label} ${m.stage > 0 ? '+' : ''}${m.stage}段階（あと${m.turns}ターン）`}
          style={{
            background: m.stage > 0 ? '#2f5d38' : '#5d3a2f',
            color: m.stage > 0 ? '#8fe0a0' : '#e0a08f',
          }}
        >
          {m.label.slice(0, 2)}
          {m.stage > 0 ? '↑' : '↓'}
        </span>
      ))}
    </div>
  );
}

export default function PartyStatusBar({ playerParty, activeActorId, targetableIds, onSelectTarget }) {
  return (
    <div className="mrg-party jrpg-win jrpg-win--sheer">
      {playerParty.map((c) => {
        const dead = c.hp <= 0;
        const targetable = !!targetableIds?.includes(c.instanceId);
        const active = c.instanceId === activeActorId;
        const cls = [
          'mrg-prow',
          active ? 'mrg-prow--active' : '',
          targetable ? 'mrg-prow--targetable' : '',
          dead && !targetable ? 'mrg-prow--down' : '',
        ].filter(Boolean).join(' ');
        return (
          <div
            key={c.instanceId}
            className={cls}
            onClick={() => targetable && onSelectTarget?.(c.instanceId)}
            title={dead ? `${c.name}（戦闘不能）` : c.name}
          >
            <img src={c.spriteUrl} alt="" />
            <span className="mrg-pname">{c.name}</span>
            <span className="mrg-plv">Lv{c.level}</span>
            {dead ? (
              <span className="mrg-pgauge" style={{ color: '#e08a4d' }}>
                せんとうふのう
              </span>
            ) : (
              <>
                <Gauge label="HP" value={c.hp} max={c.maxHp} color="#3ecf5f" />
                <Gauge label="MP" value={c.mp} max={c.maxMp} color="#4d9dff" />
              </>
            )}
            <StateTags combatant={c} />
          </div>
        );
      })}
    </div>
  );
}
