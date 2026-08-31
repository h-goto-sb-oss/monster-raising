// BattleResult.jsx
// 戦闘が終わったあとの結果パネル。
//
// 以前はここが「ログの末尾10行」をそのまま並べていた。
// たおした / 経験値 / レベルアップ / 技をおぼえた / 仲間になりたそう が
// 一度にどっと出るので、いちばん嬉しい行が真ん中に埋もれていた。
//
// いまは BattleEngine が **意味ごとに区切ったページ** を渡してくる
// (engine/battle/BattleEngine.js の _finishBattle を参照)。
// ここはそれを1ページずつ出して、ボタンで送るだけ。
//
// 区切りを行数で決めていないのが肝心なところ。3行ずつ機械的に切ると
// 「レベル2に あがった！」と「つばさアタックを おぼえた！」が
// 別ページに離れる。あれは同じひと息で読ませたい。
//
// 周回するときに邪魔にならないこと:
//   - 行は 55ms ずつ遅らせて出すだけ。待たされる感じにならない範囲。
//   - まだ出そろっていないうちに押すと、**その場で全部出す**(演出の飛ばし)。
//   - 押しっぱなしにすると、少し待ってから連続で送る。
//   - Enter / Space / z でも送れる。
// どれを選んでも、最後のページで送ると戦闘を終える。

import { useCallback, useEffect, useRef, useState } from 'react';
import { RESULT } from '../../engine/battle/BattleEngine.js';

/** 1行を出す間隔(ms)。長い演出にしない。周回のじゃまになる。 */
const LINE_DELAY_MS = 55;
/** 押しっぱなしで連射が始まるまで(ms)。 */
const HOLD_DELAY_MS = 350;
/** 連射の間隔(ms)。 */
const HOLD_REPEAT_MS = 110;

// ページの種類ごとの色。ログ本体の色分け(BattleScreen.jsx)と合わせてある。
const KIND_COLOR = {
  outcome: null,
  exp: '#c9a8e0',
  growth: '#ffd24d',
  recruit: '#7ee08a',
};

const HEADING = {
  [RESULT.WIN]: '勝利した！',
  [RESULT.LOSE]: '全滅してしまった…',
  [RESULT.FLED]: 'にげだした。',
};

export default function BattleResult({ result, pages, partyFreeSlots = 0, onFinish }) {
  // ページが空(想定外)でも行き止まりにしない。最低1ページは出す。
  const safePages = pages && pages.length > 0 ? pages : [{ kind: 'outcome', lines: [] }];

  const [pageIndex, setPageIndex] = useState(0);
  const [revealed, setRevealed] = useState(1);

  // 仲間にするか見送るかの答え。キーはページ番号。
  //   { kept: boolean, line: string }
  // 決めるまで先へ進めないページなので、ここが空 = まだ選んでいない。
  const [decisions, setDecisions] = useState({});

  const rawPage = safePages[Math.min(pageIndex, safePages.length - 1)];
  const decision = decisions[Math.min(pageIndex, safePages.length - 1)];

  // 誘いのページは「選ぶ前=誘いの一行だけ」「選んだあと=行き先の一行を足す」。
  const page = decision ? { ...rawPage, lines: [...rawPage.lines, decision.line] } : rawPage;

  // まだ選んでいない誘いのページでは、送るボタンを出さない(選択が既定の行動)。
  const awaitingChoice = rawPage.kind === 'recruit' && !!rawPage.offer && !decision;

  const total = page.lines.length;
  const isLastPage = pageIndex >= safePages.length - 1;
  const fullyRevealed = revealed >= total;

  // 行を1つずつ出す。ページが変わるたびに 1 から数えなおす。
  useEffect(() => {
    if (revealed >= total) return undefined;
    const t = setTimeout(() => setRevealed((n) => n + 1), LINE_DELAY_MS);
    return () => clearTimeout(t);
  }, [revealed, total, pageIndex]);

  // onFinish は必ず1回だけ。連打で二重に呼ぶと報酬が二重に入る。
  const finishedRef = useRef(false);

  // 「なかまにする」を選んだ子。onFinish でまとめて渡し、そこで初めて所持に入る。
  const keptRef = useRef([]);
  // 返事は1ページにつき1回だけ。連打が再描画より速いことがあるので、
  // decisions(state)ではなくこちらで弾く。
  const decidedRef = useRef(new Set());

  /**
   * 誘いへの返事。keep=false なら見送る(どこにも増えない)。
   * 行き先は **ここで決めて文にする**。パーティーが満員なら牧場行きだと
   * はっきり書く。書かないと「仲間になった」とだけ出て、パーティーにも
   * いないので、プレイヤーはどこへ行ったのか分からなくなる。
   */
  const choose = useCallback((keep) => {
    const idx = Math.min(pageIndex, safePages.length - 1);
    const offer = safePages[idx]?.offer;
    if (!offer || decidedRef.current.has(idx)) return;
    decidedRef.current.add(idx);
    let line;
    if (!keep) {
      line = `${offer.name} を みおくった。`;
    } else {
      // この戦闘で先に加えた子のぶんだけ空きが減っている。
      const roomLeft = partyFreeSlots - keptRef.current.filter((k) => k.joinedParty).length;
      const joinedParty = roomLeft > 0;
      keptRef.current = [...keptRef.current, { ...offer, joinedParty }];
      line = joinedParty
        ? `${offer.name} が なかまに くわわった！`
        : `パーティーが いっぱいなので ${offer.name} は 牧場へ 送られた。`;
    }
    setDecisions((prev) => ({ ...prev, [idx]: { kept: keep, line } }));
    setRevealed(safePages[idx].lines.length + 1); // 返事の行はすぐ出す。待たせない。
  }, [pageIndex, safePages, partyFreeSlots]);

  // set系の更新関数の中で onFinish を呼ばないこと。React は更新関数を
  // 2回走らせることがある(開発時の StrictMode)ので、報酬が二重に入る。
  // 判断はここ(描画のたびに作り直される、素の値を見るクロージャ)で済ませる。
  const advance = useCallback(() => {
    if (finishedRef.current) return;
    // 誘いのページは返事をするまで送れない。ここで素通りできると
    // 連打で「気づかないうちに見送っていた」ことになる。
    if (awaitingChoice) return;
    if (revealed < total) {
      setRevealed(total); // まだ出そろっていない → その場で全部出す(演出の飛ばし)
      return;
    }
    if (pageIndex < safePages.length - 1) {
      setPageIndex(pageIndex + 1);
      setRevealed(1);
      return;
    }
    finishedRef.current = true;
    onFinish(keptRef.current);
  }, [revealed, total, pageIndex, safePages.length, onFinish, awaitingChoice]);

  // 押しっぱなしの連射。指を離す・画面外へ出るで止める。
  // 連射から呼ぶのは「いちばん新しい advance」でなければならないので、
  // タイマーには関数そのものではなく、この箱を渡す。
  // (関数を直接渡すと、押し始めた時点の古いページのまま送り続けてしまう)
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  const holdRef = useRef(null);
  const stopHold = useCallback(() => {
    if (holdRef.current) {
      clearTimeout(holdRef.current);
      clearInterval(holdRef.current);
      holdRef.current = null;
    }
  }, []);
  const startHold = useCallback(() => {
    stopHold();
    holdRef.current = setTimeout(() => {
      holdRef.current = setInterval(() => advanceRef.current(), HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  }, [stopHold]);
  useEffect(() => stopHold, [stopHold]);

  // 指を離した合図を、ボタンの上以外でも受け取る。
  // 誘いのページに入ると送るボタンは二択に差し替わって消えるので、
  // その瞬間に押していた指の pointerup はどこにも届かない。
  // 拾い損ねると連射のタイマーが生き残り、返事をした直後に
  // 勝手に最後まで送られてしまう。
  useEffect(() => {
    window.addEventListener('pointerup', stopHold);
    window.addEventListener('pointercancel', stopHold);
    return () => {
      window.removeEventListener('pointerup', stopHold);
      window.removeEventListener('pointercancel', stopHold);
    };
  }, [stopHold]);

  // 二択が出たら、その時点で連射も止める(押しっぱなしのまま来た場合)。
  useEffect(() => {
    if (awaitingChoice) stopHold();
  }, [awaitingChoice, stopHold]);

  // キーボードでも送れるように。押しっぱなしのキーリピートがそのまま連射になる。
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        // 誘いのページでは、送るキーがそのまま「なかまにする」になる。
        // ほとんどの人は連れて帰るので、既定の行動を一番押しやすい所に置く。
        if (awaitingChoice) choose(true);
        else advance();
      } else if (awaitingChoice && (e.key === 'x' || e.key === 'X' || e.key === 'Escape')) {
        e.preventDefault();
        choose(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, awaitingChoice, choose]);

  const shown = page.lines.slice(0, revealed);
  const color = KIND_COLOR[page.kind] || undefined;

  return (
    <div className="mrg-result-wrap">
      <div className="mrg-result jrpg-win">
        <h2>{HEADING[result] || '戦闘 しゅうりょう'}</h2>

        <div className="mrg-result-log" key={pageIndex}>
          {shown.map((text, i) => (
            <div className="mrg-result-line" key={i} style={{ color }}>
              {text}
            </div>
          ))}
        </div>

        {/* 誘いのページだけは、送るボタンの代わりに二択を出す。
            「なかまにする」は送るボタンと **同じ右端** に置いてある。
            連打で進めている指がそのまま当たる位置なので、周回の流れが切れない。
            見送るほうは左に離してあり、狙って押したときだけ当たる。 */}
        {awaitingChoice ? (
          <div className="mrg-result-foot mrg-result-foot--choice">
            <button
              className="jrpg-btn jrpg-btn--back mrg-result-let-go"
              onClick={() => choose(false)}
            >
              みおくる
            </button>
            <button
              className="jrpg-btn jrpg-btn--primary mrg-result-next"
              onClick={() => choose(true)}
            >
              なかまにする
            </button>
          </div>
        ) : (
          <div className="mrg-result-foot">
            {/* いま何ページ目か。残りがひと目で分かると、送るのをためらわない。 */}
            <div className="mrg-result-dots" aria-hidden="true">
              {safePages.map((p, i) => (
                <span
                  key={i}
                  className={`mrg-result-dot${i === pageIndex ? ' is-now' : ''}${i < pageIndex ? ' is-done' : ''}`}
                />
              ))}
            </div>
            <button
              className="jrpg-btn jrpg-btn--primary mrg-result-next"
              onPointerDown={startHold}
              onPointerUp={stopHold}
              onPointerLeave={stopHold}
              onPointerCancel={stopHold}
              onClick={advance}
            >
              {isLastPage && fullyRevealed ? 'つづける' : 'つぎへ ▼'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
