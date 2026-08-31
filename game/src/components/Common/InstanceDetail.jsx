// InstanceDetail.jsx
// 個体1体の中身を表示する共用パネル。牧場・ふくろ・配合結果・デバッグメニューで使う。
// レベル/経験値/プラス値/個体値/実ステータス、そして
// 「習得済み」と「継承枠(まだ覚えていない技)」を分けて見せるのが肝心なところ。
//
// 見た目はクラス(.idet-*)で当てる。以前はインラインの px 指定だったが、
// それだと index.css の文字サイズトークン(--fs-*)に追従できず、
// この欄だけ他の画面より2まわり小さいままになる。
// クラスの定義は index.css にある(この部品はどの画面からも呼ばれるので、
// 画面ごとのCSSに置くと読み込まれていない場面が出る)。

import { expToNextLevel, MAX_LEVEL } from '../../engine/growth.js';
import { displayName } from '../../engine/instance.js';

const STAT_LABELS = [
  ['hp', 'HP'],
  ['mp', 'MP'],
  ['atk', 'こうげき'],
  ['def', 'ぼうぎょ'],
  ['int', 'かしこさ'],
  ['spd', 'すばやさ'],
];

export default function InstanceDetail({ instance, species, skillsById, compact }) {
  if (!instance || !species) return null;
  const need = expToNextLevel(instance.level, species.star);
  const learned = (instance.learned || []).map((id) => skillsById[id]).filter(Boolean);
  const inherited = (instance.inherited || [])
    .map((e) => ({ ...e, skill: skillsById[e.skillId] }))
    .filter((e) => e.skill);

  return (
    <div className="idet">
      <div className="idet-head">
        <img src={species.spriteUrl} alt={species.name} />
        <div>
          <div className="idet-name">{displayName(instance, species)}</div>
          <div className="idet-meta">
            {species.type} / ★{species.star} / Lv {instance.level}
            {instance.level < MAX_LEVEL && `（つぎまで ${Math.max(0, need - instance.exp)}）`}
          </div>
        </div>
      </div>

      <div className="idet-stats">
        {STAT_LABELS.map(([k, label]) => (
          <div key={k} className="idet-stat">
            <b>{label}</b>
            <span>
              {instance.stats[k]}
              <i> (個体値{instance.iv?.[k] ?? '-'})</i>
            </span>
          </div>
        ))}
      </div>

      {!compact && (
        <>
          <div className="idet-sub">おぼえている とくぎ ({learned.length})</div>
          {learned.length === 0 && <div className="idet-none">なし</div>}
          {learned.map((s) => (
            <div key={s.id} className="idet-row">
              ・{s.name}（{s.type}{s.line ? `／ランク${s.rank}` : ''}／MP{s.mpCost}）
            </div>
          ))}

          <div className="idet-sub idet-sub--inherit">
            けいしょうわく・みしゅうとく ({inherited.length})
          </div>
          {inherited.length === 0 && <div className="idet-none">なし</div>}
          {inherited.map((e) => (
            <div key={e.skillId} className="idet-row idet-row--inherit">
              ・{e.skill.name}
              {e.skill.line ? `（ランク${e.skill.rank}）` : ''} … Lv {e.learnLevel} で おぼえる
            </div>
          ))}
        </>
      )}
    </div>
  );
}
