// PriestScreen.jsx
// ダンジョンから帰ってきたときに必ず通る、教会の司祭の画面。
//
// 設計の意図(博史さんの案):
//   「教会には役割がないので、ダンジョンから帰るたびに司祭が全回復させて、
//     やくそうを1つくれる」
// これまでは App が黙って healParty() を呼ぶだけで、プレイヤーからは
// 何が起きたのか見えなかった。それを目に見える1ステップに置き換える。
//
// 美術素材が入ったので、司祭は女僧侶のドット絵、背景は教会の内装を使う。

import './townUI.css';
import ItemIcon from '../Common/ItemIcon.jsx';

/**
 * どうぐを渡した/渡せなかった の1行。
 * 文だけだと「何をもらったのか」が字を読むまで分からないので、絵を先に置く。
 * 渡せなかったとき(ふくろが満杯)は絵を暗くして、手に入っていないことを示す。
 */
function GiftLine({ itemId, ok, message }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: ok ? '#8fd0ff' : '#e08a4d' }}>
      {itemId
        ? <ItemIcon itemId={itemId} size={22} className={ok ? '' : 'mrg-itemicon--lost'} />
        : <span style={{ width: 22 }} />}
      <span style={{ minWidth: 0 }}>{message}</span>
    </div>
  );
}

const RESULT_LINES = {
  win: 'ダンジョンを ぶじに 踏破しましたね。',
  lose: 'よく 戻ってこられました…。もう だいじょうぶですよ。',
  fled: 'にげるのも りっぱな 判断です。',
};

/**
 * 回復そのものは App の戦闘終了ハンドラで1回だけ実行し、その結果(report)を
 * ここへ渡す。画面側で実行すると StrictMode の二重描画でやくそうが2つになる。
 */
export default function PriestScreen({ result, report, drops = [], onDone }) {
  const healed = report?.healed ?? [];
  const revived = report?.revived ?? [];
  const gift = report?.gift;

  return (
    <div className="facility" style={{ '--facility-bg': "url('/assets/interiors/church.png')" }}>
      <div className="facility-card">
        <div className="facility-head">
          <img className="facility-npc" src="/assets/npc/priestess.png" alt="教会の司祭" />
          <div style={{ textAlign: 'left' }}>
            <div className="facility-title">教会の 司祭</div>
            <div style={{ fontSize: 13, color: '#ddd', lineHeight: 1.7, marginTop: 6 }}>
              「おかえりなさい。{RESULT_LINES[result] || 'おつかれさまでした。'}
              <br />
              さあ、みなさんの 傷を いやしましょう。」
            </div>
          </div>
        </div>

        <div style={{ textAlign: 'left', fontSize: 12, background: 'rgba(6,8,16,0.7)', border: '1px solid rgba(201,177,131,0.35)', borderRadius: 3, padding: 12 }}>
          {revived.length > 0 && (
            <div style={{ color: '#ffd24d', marginBottom: 4 }}>
              ◆ {revived.join('、')} が いきを ふきかえした！
            </div>
          )}
          {healed.length > 0 && (
            <div style={{ color: '#7ee08a', marginBottom: 4 }}>
              ◆ {healed.join('、')} の HP・MPが 全回復した！
            </div>
          )}
          {revived.length === 0 && healed.length === 0 && (
            <div style={{ color: '#888', marginBottom: 4 }}>◆ みんな 元気そのものだった。</div>
          )}
          <GiftLine
            itemId={gift?.itemId}
            ok={!!gift?.ok}
            message={gift?.message || 'やくそう を うけとれなかった。'}
          />
          {drops.length > 0 && (
            <div style={{ marginTop: 6, borderTop: '1px solid #2a2f42', paddingTop: 6 }}>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 2 }}>ダンジョンで 見つけた どうぐ</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {drops.map((d, i) => (
                  <GiftLine key={i} itemId={d.itemId} ok={d.ok} message={d.message} />
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onDone}
          style={{
            marginTop: 18,
            padding: '8px 24px',
            background: 'linear-gradient(180deg, #5d6d3c, #3a4626)',
            color: '#f2efe4',
            border: '1px solid #a9c07a',
            borderRadius: 3,
            fontFamily: 'inherit',
          }}
        >
          お礼を いって まちへ もどる
        </button>
      </div>
    </div>
  );
}
