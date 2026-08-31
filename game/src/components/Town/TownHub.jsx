// TownHub.jsx
//
// ⚠ v0.5 で役目を終えた画面。もう App.jsx からは読み込まれていない。
//   町は「歩けるマップ」(components/Field/FieldScreen.jsx + scenes/MapScene.js)
//   に置き換わり、建物へはクリックではなく扉のマスを踏んで入る。
//   下の NOTE に書いてある「歩けるマップ化は別フェーズ」が、その別フェーズだった。
//   参考用に残してあるだけで、消しても動作に影響はない。
//
// 拠点ハブ画面。色ブロックのボタン一覧をやめ、実際のドット絵素材で
// 「クリックできる町の絵」にした。
//
// 割り当て:
//   主人公の家   -> どうぐぶくろ (持ちものは自分の家に置いてある、という見立て)
//   教会         -> 教会
//   道具屋       -> どうぐ屋
//   モンスター牧場 -> モンスター牧場
//   配合施設     -> 配合施設
//   下り階段     -> ダンジョン入口
//   預け屋(人物) -> あずけ所 (専用の建物素材が無いので人物を立たせている)
//
// NOTE: 素材集は「歩けるマップ」を作れるように用意されている。
//   - 人物は1人8コマ(正面/背面/左/右 × 逆足の2コマ)の歩行差分つき
//   - grid_v2/GRID_SPEC.md に64pxグリッドの当たり判定・占有マスの仕様
//   - dungeon/maps に3階層のダンジョンマップとイベントJSON
//   ここではまだ歩かせていない(絵を置いてクリックさせるだけ)。
//   歩けるマップ化は別フェーズの大きめの機能として残してある。

import { useEffect } from 'react';
import './townUI.css';

// left/top は町のなかの位置(%)。座標は「足元(下辺)の中央」を指す。
const SPOTS = [
  { id: 'church', label: '教会', img: '/assets/buildings/church.png', left: 15, top: 50, kind: 'building' },
  { id: 'bag', label: 'どうぐぶくろ', img: '/assets/buildings/house.png', left: 39, top: 46, kind: 'building' },
  { id: 'shop', label: 'どうぐ屋', img: '/assets/buildings/shop.png', left: 63, top: 50, kind: 'building' },
  { id: 'dungeon', label: 'ダンジョン入口', img: '/assets/props/dungeon_entrance.png', left: 87, top: 47, kind: 'npc' },
  { id: 'ranch', label: 'モンスター牧場', img: '/assets/buildings/ranch.png', left: 20, top: 93, kind: 'building' },
  { id: 'fusion', label: '配合施設', img: '/assets/buildings/fusion.png', left: 52, top: 94, kind: 'building' },
  { id: 'storage', label: 'あずけ所', img: '/assets/npc/storekeeper.png', left: 80, top: 92, kind: 'npc' },
];

// クリックできない飾り。建物の前に店主を立たせて町らしく見せる。
// 人物は建物の看板(ラベル)を隠さないよう、広場側へ少し下げて立たせている。
const DECO = [
  { img: '/assets/npc/priestess.png', left: 26, top: 64, size: 'npc' },
  { img: '/assets/npc/hero.png', left: 44, top: 60, size: 'npc' },
  { img: '/assets/npc/shopkeeper.png', left: 72, top: 63, size: 'npc' },
  { img: '/assets/npc/rancher.png', left: 33, top: 86, size: 'npc' },
  { img: '/assets/npc/fusionmaster.png', left: 68, top: 86, size: 'npc' },
  { img: '/assets/props/tree.png', left: 4, top: 76, size: 'tree' },
  { img: '/assets/props/pine.png', left: 96, top: 80, size: 'tree' },
  { img: '/assets/props/well.png', left: 12, top: 74, size: 'prop' },
  { img: '/assets/props/lamp.png', left: 40, top: 72, size: 'prop' },
  { img: '/assets/props/lamp.png', left: 60, top: 72, size: 'prop' },
];

const DECO_SIZE = {
  npc: 'clamp(34px, 12vh, 86px)',
  tree: 'clamp(60px, 22vh, 160px)',
  prop: 'clamp(30px, 10vh, 76px)',
};

export default function TownHub({ onNavigate }) {
  // 町も1画面に収める(戦闘画面と同じ考え方)。
  useEffect(() => {
    document.documentElement.classList.add('mrg-town-lock');
    return () => document.documentElement.classList.remove('mrg-town-lock');
  }, []);

  return (
    <div className="town">
      <div className="town-plaza" />

      <div className="town-topbar">
        <span className="town-title">まち（拠点）</span>
        <span className="town-hint">行きたい 建物を クリック</span>
      </div>

      {DECO.map((d, i) => (
        <img
          key={i}
          className="town-deco"
          src={d.img}
          alt=""
          style={{
            left: `${d.left}%`,
            top: `${d.top}%`,
            width: DECO_SIZE[d.size],
            height: DECO_SIZE[d.size],
            objectFit: 'contain',
          }}
        />
      ))}

      {SPOTS.map((s) => (
        <button
          key={s.id}
          className={`town-spot town-spot--${s.kind}`}
          style={{ left: `${s.left}%`, top: `${s.top}%` }}
          onClick={() => onNavigate(s.id)}
          title={s.label}
        >
          <img src={s.img} alt={s.label} />
          <span className="town-plate">{s.label}</span>
        </button>
      ))}
    </div>
  );
}
