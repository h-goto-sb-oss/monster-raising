// DungeonSelect.jsx
// ダンジョン入口。まちの南の道を出ると、ここに着く。
//
// v0.8 で「12枚のカードを縦に並べた一覧」をやめた。
// 11枚が「？？？ 🔒」で埋まった表は、冒険の入口ではなく作業表に見える。
//
// いまは2段階:
//   1. たびの地図 … 5つの土地を横に並べた道。指で右へ辿る。
//   2. その土地のダンジョン … 選んだ土地の数本だけをカードで出す。
// 土地は dungeons.json の background でまとまっている (engine/areas.js)。
// 本数がそろっていないのは、そのまま。旅は等間隔ではない。
//
// 解放は今までどおり clearedDungeons から導く。新しい保存は増やしていない。
// 「新しい土地が開いた」瞬間だけは状態から分からないので、踏破した側
// (App.jsx) が openedArea として渡してくる。受け取ったらお祝いを出す。
//
// レイアウト方針:
//   戦闘画面と同じく「ルートはビューポート固定、あふれる部分だけ内側で
//   スクロール」。スマホ横(844x390)でページのスクロールバーは出さない。

import { useEffect, useMemo, useRef, useState } from 'react';
import dungeons from '../../data/dungeons.json';
import { useGameStore } from '../../state/gameStore.js';
import {
  AREAS,
  isAreaUnlocked,
  isDungeonUnlocked,
  areaProgress,
} from '../../engine/areas.js';
import './townUI.css';

/** 戦闘背景をそのままカードのサムネイルに使う。BattleScreen と同じパス規則。 */
const thumbUrl = (background) => `/assets/battle_bg/${background || 'grassland'}.png`;

/** お祝いの幕が自分で引っこむまで(ms)。触ればすぐ消える。 */
const FANFARE_MS = 2800;

export default function DungeonSelect({ onStartDungeon, onBack, openedArea, onOpenedAreaSeen }) {
  const { clearedDungeons, party } = useGameStore();

  // null なら地図。エリアIDが入っていれば、その土地のダンジョン一覧。
  const [openAreaId, setOpenAreaId] = useState(null);
  const [fanfare, setFanfare] = useState(null);

  const scrollRef = useRef(null);
  const nodeRefs = useRef({});

  // この画面のあいだページを固定する(内側の帯だけがスクロールする)
  useEffect(() => {
    document.documentElement.classList.add('mrg-dungeon-lock');
    return () => document.documentElement.classList.remove('mrg-dungeon-lock');
  }, []);

  const unlocked = useMemo(
    () => AREAS.map((a) => isAreaUnlocked(a, clearedDungeons)),
    [clearedDungeons]
  );
  const progress = useMemo(
    () => AREAS.map((a) => areaProgress(a, clearedDungeons)),
    [clearedDungeons]
  );

  const clearedCount = clearedDungeons.filter((id) => dungeons.some((d) => d.id === id)).length;
  const noParty = party.length === 0;

  // 「次に行くべき土地」= 開いていて、まだ全部踏破していない いちばん左
  const nextAreaIndex = AREAS.findIndex((a, i) => unlocked[i] && !progress[i].done);

  /** 地図のその丸を、帯の真ん中まで寄せる。 */
  function scrollToArea(areaId, behavior = 'smooth') {
    const el = nodeRefs.current[areaId];
    if (!el || !scrollRef.current) return;
    const box = scrollRef.current;
    const left = el.offsetLeft - (box.clientWidth - el.offsetWidth) / 2;
    box.scrollTo({ left: Math.max(0, left), behavior });
  }

  // 開いたときは「次に行くべき土地」を正面に置く。
  // いちばん左に固定すると、進んだ人ほど毎回スクロールさせられる。
  useEffect(() => {
    if (openAreaId) return;
    const target = AREAS[nextAreaIndex >= 0 ? nextAreaIndex : 0];
    if (target) scrollToArea(target.id, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAreaId]);

  // 新しい土地が開いた。知らせは受け取ったらすぐ親から消してもらう
  // (地図を出しなおすたびに何度も祝わないため)。
  useEffect(() => {
    if (!openedArea) return;
    setOpenAreaId(null);
    setFanfare(openedArea);
    onOpenedAreaSeen?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedArea]);

  // 幕を出したら、その土地を正面へ寄せて、少し待って引っこめる。
  // 引っこめるタイマーはこちら側に置く。上の効果に相乗りさせると、
  // onOpenedAreaSeen で openedArea が null に戻った拍子に
  // 後始末が走って、タイマーごと消えてしまう。
  useEffect(() => {
    if (!fanfare) return undefined;
    scrollToArea(fanfare.id, 'smooth');
    const t = setTimeout(() => setFanfare(null), FANFARE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fanfare]);

  /** 地図の左右送り。親指1本でも辿れるように、矢印ボタンも置く。 */
  function nudge(dir) {
    const box = scrollRef.current;
    if (!box) return;
    box.scrollBy({ left: dir * box.clientWidth * 0.6, behavior: 'smooth' });
  }

  const openArea = openAreaId ? AREAS.find((a) => a.id === openAreaId) : null;

  // ---------------------------------------------------------- その土地の一覧
  if (openArea) {
    const areaIndex = AREAS.indexOf(openArea);
    const prog = progress[areaIndex];

    return (
      <div className="dsel">
        <div className="dsel-head">
          <button className="dsel-back dsel-back--inline" onClick={() => setOpenAreaId(null)}>
            ◀ 地図
          </button>
          <span className="dsel-title">{openArea.name}</span>
          <span className="dsel-sub">
            踏破 {prog.cleared} / {prog.total}
          </span>
          {noParty && (
            <span className="dsel-warn">
              手持ちがいません。モンスター牧場でパーティーを編成してください。
            </span>
          )}
        </div>

        <div className="dsel-grid">
          {openArea.dungeons.map((d) => {
            const isOpen = isDungeonUnlocked(d.index, clearedDungeons);
            const cleared = clearedDungeons.includes(d.id);
            const canEnter = isOpen && !noParty;
            const cls = [
              'dsel-card',
              !isOpen ? 'dsel-card--locked' : '',
              cleared ? 'dsel-card--cleared' : '',
            ].filter(Boolean).join(' ');

            return (
              <button
                key={d.id}
                className={cls}
                disabled={!canEnter}
                onClick={() => canEnter && onStartDungeon(d)}
                title={isOpen ? `${d.name}\n${d.description}` : 'まだ ひらかれていない'}
                style={{ backgroundImage: isOpen ? `url('${thumbUrl(d.background)}')` : 'none' }}
              >
                <span className="dsel-no">{d.index + 1}</span>
                {cleared && <span className="dsel-badge dsel-badge--cleared">踏破</span>}
                {!cleared && !isOpen && <span className="dsel-badge dsel-badge--locked">🔒</span>}
                {!cleared && isOpen && <span className="dsel-badge dsel-badge--next">NEW</span>}

                <span className="dsel-name">{isOpen ? d.name : '？？？'}</span>
                <span className="dsel-meta">
                  {isOpen ? (
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
          <span className="dsel-desc">{openArea.note}</span>
          <button className="dsel-back" onClick={onBack}>
            まちへ もどる
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ たびの地図
  return (
    <div className="dsel dsel--map">
      <div className="dsel-head">
        <span className="dsel-title">たびの地図</span>
        <span className="dsel-sub">
          踏破 {clearedCount} / {dungeons.length}
        </span>
        {noParty && (
          <span className="dsel-warn">
            手持ちがいません。モンスター牧場でパーティーを編成してください。
          </span>
        )}
      </div>

      <div className="dmap">
        <button className="dmap-nudge dmap-nudge--left" onClick={() => nudge(-1)} aria-label="地図を左へ">
          ◀
        </button>

        {/* 横に流れるのはこの帯だけ。ページ自体はスクロールしない。 */}
        <div className="dmap-road" ref={scrollRef}>
          {AREAS.map((area, i) => {
            const isOpen = unlocked[i];
            const prog = progress[i];
            const isNext = i === nextAreaIndex;
            const cls = [
              'dmap-node',
              isOpen ? '' : 'dmap-node--locked',
              prog.done ? 'dmap-node--done' : '',
              isNext ? 'dmap-node--next' : '',
              fanfare?.id === area.id ? 'dmap-node--opened' : '',
            ].filter(Boolean).join(' ');

            return (
              <div className="dmap-stop" key={area.id} ref={(el) => { nodeRefs.current[area.id] = el; }}>
                <button
                  className={cls}
                  disabled={!isOpen}
                  onClick={() => isOpen && setOpenAreaId(area.id)}
                  title={isOpen ? `${area.name}\n${area.note}` : 'まだ 道が つながっていない'}
                >
                  <span
                    className="dmap-icon"
                    style={{ backgroundImage: `url('${area.icon}')` }}
                    aria-hidden="true"
                  />
                  {!isOpen && <span className="dmap-lock">🔒</span>}
                  {prog.done && <span className="dmap-flag">踏破</span>}
                  {isNext && isOpen && !prog.done && <span className="dmap-here">▼ いま ここ</span>}
                  <span className="dmap-name">{isOpen ? area.name : '？？？'}</span>
                  <span className="dmap-count">
                    {isOpen ? `${prog.cleared} / ${prog.total} 踏破` : '道が とざされている'}
                  </span>
                </button>
              </div>
            );
          })}

          {/* 道はここで終わりではない、と見せるための行き止まりでない末尾。 */}
          <div className="dmap-stop dmap-stop--beyond">
            <div className="dmap-beyond">
              <span className="dmap-beyond-dots">・・・</span>
              <span className="dmap-beyond-text">道は まだ 続いている</span>
            </div>
          </div>
        </div>

        <button className="dmap-nudge dmap-nudge--right" onClick={() => nudge(1)} aria-label="地図を右へ">
          ▶
        </button>

        {/* あたらしい土地が開いた瞬間。触るか、少し待つと消える。 */}
        {fanfare && (
          <div className="dmap-fanfare" onClick={() => setFanfare(null)}>
            <div className="dmap-fanfare-box">
              <span
                className="dmap-fanfare-icon"
                style={{ backgroundImage: `url('${fanfare.icon}')` }}
                aria-hidden="true"
              />
              <span className="dmap-fanfare-lead">あたらしい 道が ひらけた！</span>
              <span className="dmap-fanfare-name">{fanfare.name}</span>
              <span className="dmap-fanfare-note">{fanfare.note}</span>
            </div>
          </div>
        )}
      </div>

      <div className="dsel-foot">
        <span className="dsel-desc">
          {nextAreaIndex >= 0
            ? AREAS[nextAreaIndex].note
            : 'すべての 土地を 踏破した！'}
        </span>
        <button className="dsel-back" onClick={onBack}>
          まちへ もどる
        </button>
      </div>
    </div>
  );
}
