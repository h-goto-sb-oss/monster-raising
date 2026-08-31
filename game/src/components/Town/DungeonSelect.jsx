// DungeonSelect.jsx
// ダンジョン入口。まちの南の道を出ると、ここに着く。
// dungeons.json を読み込み、クリア済みダンジョンに応じて次を解放表示する。
//
// v0.5 から、選んだ先は連戦リストではなく「歩けるフロア」になった。
// ここは12本のうちどれへ旅立つかを選ぶだけの画面。町のマップに12個の
// 入口を置く案もあったが、解放の連鎖・推奨レベル・手持ちの警告といった
// 「行く前に読みたい情報」が絵の中だと出しどころが無いので、一覧のまま残した。
//
// レイアウト方針:
//   12本を縦に積むと、スマホ横(844x390)ではページごとスクロールしてしまう。
//   戦闘画面と同じく「ルートはビューポート固定、あふれる部分だけ内側でスクロール」
//   にして、ページのスクロールバーは出さない (townUI.css の .dsel 一式)。
//   カードの背景には、そのダンジョンで実際に使われる戦闘背景を敷いている。
//   雪山なのか火口なのかが、名前を読む前に絵で分かる。

import { useEffect } from 'react';
import dungeons from '../../data/dungeons.json';
import { useGameStore } from '../../state/gameStore.js';
import './townUI.css';

/** 戦闘背景をそのままサムネイルに使う。BattleScreen と同じパス規則。 */
const thumbUrl = (background) => `/assets/battle_bg/${background || 'grassland'}.png`;

export default function DungeonSelect({ onStartDungeon, onBack }) {
  const { clearedDungeons, party } = useGameStore();

  // 一覧のあいだページを固定する(内側のグリッドだけがスクロールする)
  useEffect(() => {
    document.documentElement.classList.add('mrg-dungeon-lock');
    return () => document.documentElement.classList.remove('mrg-dungeon-lock');
  }, []);

  function isUnlocked(dungeon, index) {
    if (!dungeon.locked) return true;
    const prev = dungeons[index - 1];
    return prev ? clearedDungeons.includes(prev.id) : true;
  }

  const clearedCount = dungeons.filter((d) => clearedDungeons.includes(d.id)).length;
  // 「次に挑むべき1本」= 解放済みで まだクリアしていない先頭
  const nextIndex = dungeons.findIndex((d, i) => isUnlocked(d, i) && !clearedDungeons.includes(d.id));
  const noParty = party.length === 0;

  return (
    <div className="dsel">
      <div className="dsel-head">
        <span className="dsel-title">ダンジョン入口</span>
        <span className="dsel-sub">
          踏破 {clearedCount} / {dungeons.length}
        </span>
        {noParty && (
          <span className="dsel-warn">
            手持ちがいません。モンスター牧場でパーティーを編成してください。
          </span>
        )}
      </div>

      <div className="dsel-grid">
        {dungeons.map((d, i) => {
          const unlocked = isUnlocked(d, i);
          const cleared = clearedDungeons.includes(d.id);
          const canEnter = unlocked && !noParty;
          const cls = [
            'dsel-card',
            !unlocked ? 'dsel-card--locked' : '',
            cleared ? 'dsel-card--cleared' : '',
          ].filter(Boolean).join(' ');

          return (
            <button
              key={d.id}
              className={cls}
              disabled={!canEnter}
              onClick={() => canEnter && onStartDungeon(d)}
              title={unlocked ? `${d.name}\n${d.description}` : 'まだ解放されていません'}
              style={{ backgroundImage: unlocked ? `url('${thumbUrl(d.background)}')` : 'none' }}
            >
              <span className="dsel-no">{i + 1}</span>
              {cleared && <span className="dsel-badge dsel-badge--cleared">踏破</span>}
              {!cleared && !unlocked && <span className="dsel-badge dsel-badge--locked">🔒</span>}
              {!cleared && unlocked && i === nextIndex && (
                <span className="dsel-badge dsel-badge--next">NEW</span>
              )}

              <span className="dsel-name">{unlocked ? d.name : '？？？'}</span>
              <span className="dsel-meta">
                {unlocked ? (
                  <>
                    <span>推奨 <b>Lv{d.recommendedLevel}</b></span>
                    <span>全{d.floors || 1}階</span>
                  </>
                ) : (
                  <span>前を 踏破すると ひらかれる</span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="dsel-foot">
        <span className="dsel-desc">
          {nextIndex >= 0 ? dungeons[nextIndex].description : 'すべてのダンジョンを 踏破した！'}
        </span>
        <button className="dsel-back" onClick={onBack}>
          まちへ もどる
        </button>
      </div>
    </div>
  );
}
