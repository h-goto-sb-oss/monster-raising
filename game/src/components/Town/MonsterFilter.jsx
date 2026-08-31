// MonsterFilter.jsx
// 牧場・配合施設で共用する、モンスター一覧の絞り込みバー。
// 所持数が199体以上になるため、名前検索 + ★段階 + タイプで絞れるようにする。
// NOTE: 美術素材は未着手のため、ここも色ブロック+ラベルのみで作っている。

import monsters from '../../data/monsters.json';
import { TIER_ORDER } from '../../engine/fusion.js';

const ALL = 'すべて';

const ALL_TYPES = Array.from(new Set(monsters.map((m) => m.type))).sort();

export const EMPTY_FILTER = { text: '', tier: ALL, type: ALL };

function matches(m, filter, text) {
  if (!m) return false;
  if (filter.tier !== ALL && m.tier !== filter.tier) return false;
  if (filter.type !== ALL && m.type !== filter.type) return false;
  if (text && !m.name.includes(text) && !m.id.includes(text)) return false;
  return true;
}

export function applyMonsterFilter(list, filter) {
  const text = (filter.text || '').trim();
  return list.filter((m) => matches(m, filter, text));
}

/**
 * 個体ビュー([{instance, species, name}])用の絞り込み。
 * 判定は種族レコードで行うので、同種を2体持っていても両方ヒットする。
 */
export function applyInstanceFilter(list, filter) {
  const text = (filter.text || '').trim();
  return list.filter((v) => matches(v.species, filter, text));
}

const selectStyle = {
  background: '#1c2030',
  color: '#fff',
  border: '1px solid #555',
  borderRadius: 4,
  fontSize: 12,
  padding: '4px 6px',
};

export default function MonsterFilterBar({ filter, onChange, count, total }) {
  function patch(part) {
    onChange({ ...filter, ...part });
  }

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
      <input
        value={filter.text}
        onChange={(e) => patch({ text: e.target.value })}
        placeholder="名前で検索"
        style={{ ...selectStyle, width: 140 }}
      />
      <select value={filter.tier} onChange={(e) => patch({ tier: e.target.value })} style={selectStyle}>
        <option value={ALL}>★すべて</option>
        {TIER_ORDER.map((t, i) => (
          <option key={t} value={t}>{`★${i + 1}`}</option>
        ))}
      </select>
      <select value={filter.type} onChange={(e) => patch({ type: e.target.value })} style={selectStyle}>
        <option value={ALL}>タイプすべて</option>
        {ALL_TYPES.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <span style={{ fontSize: 11, color: '#888' }}>
        {count}体 / 所持{total}体
      </span>
      {(filter.text || filter.tier !== ALL || filter.type !== ALL) && (
        <button
          onClick={() => onChange(EMPTY_FILTER)}
          style={{ ...selectStyle, cursor: 'pointer' }}
        >
          絞り込み解除
        </button>
      )}
    </div>
  );
}
