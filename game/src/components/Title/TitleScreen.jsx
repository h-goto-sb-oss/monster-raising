// TitleScreen.jsx
// ゲームの表紙。起動するとまずここに来る。
//
//   タイトル ──「はじめから あそぶ」──> セーブ枠をえらぶ(新規) ──> 開始イベント
//        └──「つづきから あそぶ」──> セーブ枠をえらぶ(続き) ──> まち
//
// 枠の読み書きは state/saveSlots.js。この画面は要約を並べて、
// 消える操作(上書き・削除)の前に一度だけ聞き返す役だけを持つ。
//
// レイアウトは他の画面と同じ「ビューポート固定 + はみ出さない」。
// 844x390(スマホ横) でページのスクロールバーが出ないこと、
// 1280x720 で文字が大きすぎないことの両方を満たす必要がある。
// 枠の一覧を **横3列** にしてあるのはそのため(縦に積むと390pxでは溢れる)。

import { useCallback, useEffect, useState } from 'react';
import {
  readAllSlots, formatPlayedAt, clearSlot, migrateLegacySave,
} from '../../state/saveSlots.js';
import { formatGold } from '../../state/gameStore.js';
import './titleScreen.css';

/** 表紙に出す題。index.html の <title> と同じ名前。 */
const GAME_TITLE = 'モンスター育成';
const GAME_SUBTITLE = 'MONSTER RAISING';

const MODE = {
  MENU: 'menu',   // 表紙
  NEW: 'new',     // 「はじめから」— 枠をえらぶ(中身があれば上書き確認)
  LOAD: 'load',   // 「つづきから」— 枠をえらぶ
};

/**
 * @param {(slot:number)=>void} props.onPlay 枠が決まった。呼び出し側が
 *   GameStoreProvider を その枠で作り直す。
 */
export default function TitleScreen({ onPlay }) {
  const [mode, setMode] = useState(MODE.MENU);
  // 一覧は「開いたとき」に読む。枠を消したり作ったりしたら読み直す。
  const [slots, setSlots] = useState(() => {
    // 枠のない旧セーブがあれば、ここで枠1へ移す。1回だけ走る。
    migrateLegacySave();
    return readAllSlots();
  });
  // 聞き返し。{ kind:'overwrite'|'delete', slot }
  const [confirm, setConfirm] = useState(null);

  const refresh = useCallback(() => setSlots(readAllSlots()), []);

  // Esc で1つ戻る。聞き返しが出ているならそれを閉じる。
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (confirm) setConfirm(null);
      else if (mode !== MODE.MENU) setMode(MODE.MENU);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, confirm]);

  function chooseSlot(summary) {
    if (mode === MODE.LOAD) {
      if (summary.empty) return;
      onPlay(summary.slot);
      return;
    }
    // はじめから。中身のある枠に作ると、その冒険は戻せない。
    if (summary.empty) {
      onPlay(summary.slot);
      return;
    }
    setConfirm({ kind: 'overwrite', slot: summary.slot });
  }

  function runConfirm() {
    if (!confirm) return;
    const { kind, slot } = confirm;
    clearSlot(slot);
    setConfirm(null);
    if (kind === 'overwrite') {
      onPlay(slot);
      return;
    }
    refresh();
  }

  // --------------------------------------------------------------- 聞き返し

  const confirmPanel = confirm ? (
    <div className="ttl-modal">
      <div className="ttl-ask jrpg-win">
        <div className="jrpg-wintitle">
          {confirm.kind === 'overwrite' ? 'うわがき しますか？' : 'けしますか？'}
        </div>
        <p className="ttl-ask-text">
          セーブ{confirm.slot} の 冒険の記録を 消して
          {confirm.kind === 'overwrite' ? ' はじめから やり直します。' : ' からっぽに します。'}
          <br />
          <b>一度 消すと 元には もどせません。</b>
        </p>
        <div className="ttl-ask-row">
          <button className="jrpg-btn jrpg-btn--back" onClick={() => setConfirm(null)}>やめる</button>
          <button className="jrpg-btn ttl-btn-danger" onClick={runConfirm}>
            {confirm.kind === 'overwrite' ? '消して はじめる' : '消す'}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  // --------------------------------------------------------------- 枠の一覧

  if (mode !== MODE.MENU) {
    const picking = mode === MODE.NEW;
    return (
      <div className="ttl ttl--list">
        <div className="ttl-art" role="presentation" />
        <div className="ttl-scrim" />
        <div className="ttl-listwrap">
          <div className="ttl-listhead">
            <h2 className="ttl-listtitle">
              {picking ? 'どの セーブに はじめますか？' : 'つづきから あそぶ'}
            </h2>
            <button className="jrpg-btn jrpg-btn--back" onClick={() => setMode(MODE.MENU)}>もどる</button>
          </div>

          <div className="ttl-slots">
            {slots.map((s) => (
              <SlotCard
                key={s.slot}
                summary={s}
                picking={picking}
                disabled={!picking && s.empty}
                onChoose={() => chooseSlot(s)}
                onDelete={s.empty ? null : () => setConfirm({ kind: 'delete', slot: s.slot })}
              />
            ))}
          </div>
        </div>
        {confirmPanel}
      </div>
    );
  }

  // ----------------------------------------------------------------- 表紙

  return (
    <div className="ttl">
      <div className="ttl-art" role="presentation" />
      {/* 空の部分だけを ほんの少し落とす。絵を暗くしたいのではなく、
          白と金の文字が 明るい青空に溶けないようにするための下敷き。 */}
      <div className="ttl-veil" />

      <div className="ttl-head">
        <h1 className="ttl-name">{GAME_TITLE}</h1>
        <div className="ttl-sub">{GAME_SUBTITLE}</div>
      </div>

      <div className="ttl-menu">
        <button className="jrpg-btn ttl-btn" onClick={() => setMode(MODE.NEW)}>
          はじめから あそぶ
        </button>
        <button className="jrpg-btn ttl-btn" onClick={() => setMode(MODE.LOAD)}>
          つづきから あそぶ
        </button>
      </div>
    </div>
  );
}

/** 枠1つのカード。中身が無ければ「データが ありません」だけを出す。 */
function SlotCard({ summary, picking, disabled, onChoose, onDelete }) {
  const {
    slot, empty, party, ownedCount, maxLevel, cleared, total, gold, updatedAt,
  } = summary;

  return (
    <div className={`ttl-card jrpg-win${empty ? ' ttl-card--empty' : ''}`}>
      <div className="ttl-card-head">
        <span className="ttl-card-no">セーブ {slot}</span>
        {onDelete && (
          <button
            className="ttl-del"
            title={`セーブ${slot} を 消す`}
            onClick={onDelete}
          >
            けす
          </button>
        )}
      </div>

      {empty ? (
        <div className="ttl-card-empty">データが<br />ありません</div>
      ) : (
        <>
          <div className="ttl-card-party">
            {party.map((p) => (
              <img key={p.uid} src={p.spriteUrl || ''} alt={p.name} title={`${p.name} Lv${p.level}`} />
            ))}
          </div>
          <div className="ttl-card-stats">
            <span><i>さいこう</i>Lv {maxLevel}</span>
            <span><i>とうは</i>{cleared}/{total}</span>
            <span><i>てもち</i>{ownedCount}体</span>
            <span><i>G</i>{formatGold(gold)}</span>
          </div>
          <div className="ttl-card-when">{formatPlayedAt(updatedAt)}</div>
        </>
      )}

      <button
        className={`jrpg-btn ttl-card-go${empty ? '' : ' jrpg-btn--primary'}`}
        disabled={disabled}
        onClick={onChoose}
      >
        {/* 「つづきから」で空の枠は選べない。押せないボタンに
            「ここに はじめる」と書いてあると、押せない理由が伝わらない。 */}
        {empty
          ? (picking ? 'ここに はじめる' : 'つづきが ない')
          : (picking ? 'うわがきして はじめる' : 'えらぶ')}
      </button>
    </div>
  );
}
