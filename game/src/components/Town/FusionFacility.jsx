// FusionFacility.jsx
// 拠点の配合施設。GAME_SPEC_V0_1.md 3章の流れをそのまま画面にしたもの。
//   1. 血統を選ぶ
//   2. 相手を選ぶ
//   3. 結果を表示する (★3〜★4は未発見なら「？？？」)
//   4. 「このモンスターでよいか」を確認する
//   5. 確定すると親2体は消え、結果が所持と発見済みに加わる
//
// v0.2 から選ぶのは「種族」ではなく「個体」。同じ種族を2体持てるので、
// 血統と相手に同種を指定することもできる (uid が違えばよい)。
//
// 生まれる子は要望3・4・5・6を満たす:
//   - レベル1で種族のrank1技を1つだけ習得。親の技は継承枠(未習得)に入る
//   - 進化呪文はrank1へ正規化して継承する
//   - 初期ステータスに親の現在ステータスの数%が乗る
//   - 名前の後ろに +N が付く (親の合計+1)
//
// NOTE: 人物(配合の専門家)・建物・演出の美術素材はまだ無いため、
//       色ブロック+ラベルのプレースホルダーで作っている。
// NOTE: 横画面でも破綻しないよう、一覧側だけをスクロールさせる。

import { useMemo, useState } from 'react';
import { useGameStore } from '../../state/gameStore.js';
import { resolveFusion, shouldHideResult } from '../../engine/fusion.js';
import { childPlus, inheritRate } from '../../engine/inherit.js';
import MonsterFilterBar, { EMPTY_FILTER, applyInstanceFilter } from './MonsterFilter.jsx';
import InstanceDetail from '../Common/InstanceDetail.jsx';
import './townUI.css';

const STEP = {
  BLOODLINE: 'bloodline',
  PARTNER: 'partner',
  CONFIRM: 'confirm',
  RESULT: 'result',
};

const PANEL = { border: '1px solid #444', borderRadius: 8, background: '#181c28', padding: 12 };
// ボタンは index.css の .jrpg-btn を使う(全画面で見た目をそろえるため)。

function MonsterTile({ view, selected, onClick }) {
  const { instance, species, name } = view;
  return (
    <button
      onClick={onClick}
      style={{
        border: selected ? '2px solid #ffd24d' : '1px solid #444',
        borderRadius: 6,
        padding: 6,
        background: selected ? '#2b2a1c' : '#1c2030',
        width: 118,
        color: '#fff',
        cursor: 'pointer',
        textAlign: 'center',
      }}
    >
      <img
        src={species.spriteUrl}
        alt={name}
        style={{ width: 40, height: 40, objectFit: 'contain', imageRendering: 'pixelated', display: 'block', margin: '0 auto' }}
      />
      <div style={{ fontSize: 11, marginTop: 2 }}>{name}</div>
      <div style={{ fontSize: 10, color: '#999' }}>
        Lv{instance.level} / {species.type} / ★{species.star}
      </div>
    </button>
  );
}

// 選択済みの血統・相手を並べて見せる小さなカード
function SlotCard({ label, view, onReselect }) {
  return (
    <div style={{ ...PANEL, width: 150, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#ffd24d', marginBottom: 4 }}>{label}</div>
      {view ? (
        <>
          <img
            src={view.species.spriteUrl}
            alt={view.name}
            style={{ width: 44, height: 44, objectFit: 'contain', imageRendering: 'pixelated', display: 'block', margin: '0 auto' }}
          />
          <div style={{ fontSize: 12 }}>{view.name}</div>
          <div style={{ fontSize: 10, color: '#999' }}>
            Lv{view.instance.level} / {view.species.type} / ★{view.species.star}
          </div>
          {onReselect && (
            <button className="jrpg-btn jrpg-btn--back" onClick={onReselect} style={{ marginTop: 6 }}>
              選び直す
            </button>
          )}
        </>
      ) : (
        <div style={{ fontSize: 12, color: '#666', padding: '20px 0' }}>未選択</div>
      )}
    </div>
  );
}

// 配合結果カード。未発見の★3〜★4は名前もスプライトも伏せる。
function ResultCard({ outcome, resultMonster, masked, plus }) {
  if (!outcome) {
    return (
      <div style={{ ...PANEL, width: 200, textAlign: 'center', borderColor: '#8a5a5a' }}>
        <div style={{ fontSize: 12, color: '#ff9c9c', padding: '24px 4px' }}>
          この組み合わせの
          <br />
          配合レシピはありません
        </div>
      </div>
    );
  }

  const star = resultMonster ? resultMonster.star : null;
  const suffix = plus > 0 ? `+${plus}` : '';

  return (
    <div style={{ ...PANEL, width: 200, textAlign: 'center', borderColor: '#a184b8' }}>
      <div style={{ fontSize: 11, color: '#c9a8e0', marginBottom: 4 }}>配合結果</div>
      {masked ? (
        <>
          <div
            style={{
              width: 52,
              height: 52,
              margin: '0 auto',
              background: '#2a2438',
              border: '1px dashed #7a6a8c',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              color: '#8f7fa5',
            }}
          >
            ?
          </div>
          <div style={{ fontSize: 16, marginTop: 6, letterSpacing: 2 }}>？？？{suffix}</div>
          <div style={{ fontSize: 10, color: '#999' }}>
            {outcome.resultType} / ★{star}
          </div>
          <div style={{ fontSize: 10, color: '#8f7fa5', marginTop: 4 }}>まだ見ぬ姿。作ってのお楽しみ。</div>
        </>
      ) : (
        <>
          <img
            src={resultMonster.spriteUrl}
            alt={resultMonster.name}
            style={{ width: 52, height: 52, objectFit: 'contain', imageRendering: 'pixelated', display: 'block', margin: '0 auto' }}
          />
          <div style={{ fontSize: 14, marginTop: 4 }}>{resultMonster.name}{suffix}</div>
          <div style={{ fontSize: 10, color: '#999' }}>
            {resultMonster.type} / ★{resultMonster.star}
          </div>
        </>
      )}
      <div style={{ fontSize: 9, color: '#666', marginTop: 6 }}>
        {outcome.source} / {outcome.typeRule}
      </div>
    </div>
  );
}

export default function FusionFacility({ onBack }) {
  const { ownedView, ownedByUid, discovered, party, applyFusion, skillsById, rosterById } = useGameStore();

  const [step, setStep] = useState(STEP.BLOODLINE);
  const [bloodlineUid, setBloodlineUid] = useState(null);
  const [partnerUid, setPartnerUid] = useState(null);
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [lastChild, setLastChild] = useState(null); // { instance, species, wasNew }

  const bloodlineView = ownedView.find((v) => v.instance.uid === bloodlineUid) || null;
  const partnerView = ownedView.find((v) => v.instance.uid === partnerUid) || null;

  const outcome = useMemo(
    () => resolveFusion(bloodlineView?.species, partnerView?.species),
    [bloodlineView, partnerView],
  );
  const resultMonster = outcome ? rosterById[outcome.resultId] : null;
  const masked = shouldHideResult(outcome, discovered);
  const nextPlus = bloodlineView && partnerView ? childPlus(bloodlineView.instance, partnerView.instance) : 0;
  const rate = bloodlineView && partnerView ? inheritRate(bloodlineView.instance, partnerView.instance) : 0;

  const selectable = useMemo(() => {
    const base = step === STEP.PARTNER
      ? ownedView.filter((v) => v.instance.uid !== bloodlineUid)
      : ownedView;
    return applyInstanceFilter(base, filter);
  }, [ownedView, step, bloodlineUid, filter]);

  function pick(uid) {
    if (step === STEP.BLOODLINE) {
      setBloodlineUid(uid);
      setPartnerUid(null);
      setStep(STEP.PARTNER);
    } else if (step === STEP.PARTNER) {
      setPartnerUid(uid);
      setStep(STEP.CONFIRM);
    }
  }

  function reselectBloodline() {
    setBloodlineUid(null);
    setPartnerUid(null);
    setStep(STEP.BLOODLINE);
  }

  function reselectPartner() {
    setPartnerUid(null);
    setStep(STEP.PARTNER);
  }

  function confirmFusion() {
    if (!outcome || !resultMonster) return;
    // 「発見」は牧場にまだ居ない種族を作れたときだけ。
    const wasNew = !ownedView.some((v) => v.species.id === outcome.resultId);
    const child = applyFusion({ bloodlineUid, partnerUid, resultId: outcome.resultId });
    if (!child) return;
    setLastChild({ instance: child, species: resultMonster, wasNew });
    setBloodlineUid(null);
    setPartnerUid(null);
    setStep(STEP.RESULT);
  }

  const partyLost = [bloodlineUid, partnerUid]
    .filter((uid) => uid && party.includes(uid))
    .map((uid) => ownedByUid[uid]);
  const alreadyOwned = outcome && ownedView.some((v) => v.species.id === outcome.resultId);

  // ---------------------------------------------------------------- 結果画面
  if (step === STEP.RESULT && lastChild) {
    return (
      <div className="town-screen jrpg-scroll">
        <div className="town-screen-inner">
        <h2 className="town-screentitle">配合施設</h2>
        <div style={{ ...PANEL, padding: 20, borderColor: '#a184b8', display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <div style={{ textAlign: 'center', minWidth: 180 }}>
            <div style={{ fontSize: 13, color: '#ffd24d', marginBottom: 8 }}>
              {lastChild.wasNew ? '新種を発見した！' : '配合できた！'}
            </div>
            <img
              src={lastChild.species.spriteUrl}
              alt={lastChild.species.name}
              style={{ width: 72, height: 72, objectFit: 'contain', imageRendering: 'pixelated', display: 'block', margin: '0 auto' }}
            />
            <div style={{ fontSize: 18, marginTop: 6 }}>
              {lastChild.species.name}
              {lastChild.instance.plus > 0 && (
                <span style={{ color: '#ffd24d' }}>+{lastChild.instance.plus}</span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#999' }}>
              {lastChild.species.type} / ★{lastChild.species.star} / Lv {lastChild.instance.level}
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 250 }}>
            <InstanceDetail
              instance={lastChild.instance}
              species={lastChild.species}
              skillsById={skillsById}
            />
            <div style={{ fontSize: 10, color: '#8a7a5a', marginTop: 8, lineHeight: 1.6 }}>
              継承した技は まだ覚えていない。育てて レベルが届いたときに 開花する。
              <br />
              進化する呪文は いちばん下の段階に戻って 受け継がれる。
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="jrpg-btn jrpg-btn--primary" onClick={() => { setLastChild(null); setStep(STEP.BLOODLINE); }}>
            続けて配合する
          </button>
          <button className="jrpg-btn jrpg-btn--back" onClick={onBack}>もどる</button>
        </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- 選択画面
  const stepLabel = {
    [STEP.BLOODLINE]: '1. 血統となるモンスターを選ぶ',
    [STEP.PARTNER]: '2. 相手となるモンスターを選ぶ',
    [STEP.CONFIRM]: '3. このモンスターでよいか',
  }[step];

  return (
    <div className="town-screen jrpg-scroll">
      <div className="town-screen-inner">
      <h2 className="town-screentitle" style={{ marginBottom: 2 }}>
        {/* 配合マスターのドット絵。見出しに置いて「誰の施設か」を出す。 */}
        <img className="npc-badge" src="/assets/npc/fusionmaster.png" alt="" />
        配合施設
      </h2>
      <div className="town-screennote">
        血統と相手を選ぶと、専門家が新しいモンスターを作ってくれます。親の2体はいなくなります。
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
        <SlotCard label="血統" view={bloodlineView} onReselect={bloodlineView ? reselectBloodline : null} />
        <div style={{ alignSelf: 'center', fontSize: 20, color: '#777' }}>＋</div>
        <SlotCard label="相手" view={partnerView} onReselect={partnerView ? reselectPartner : null} />
        <div style={{ alignSelf: 'center', fontSize: 20, color: '#777' }}>＝</div>
        {step === STEP.CONFIRM ? (
          <ResultCard outcome={outcome} resultMonster={resultMonster} masked={masked} plus={nextPlus} />
        ) : (
          <div style={{ ...PANEL, width: 200, textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: '#666', padding: '30px 4px' }}>2体そろうと結果が出ます</div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 13, color: '#ffd24d', marginBottom: 8 }}>{stepLabel}</div>

      {step === STEP.CONFIRM && (
        <div style={{ ...PANEL, marginBottom: 12 }}>
          {outcome ? (
            <>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                {masked
                  ? '「？？？」を配合しますか？'
                  : `「${resultMonster.name}${nextPlus > 0 ? `+${nextPlus}` : ''}」を配合しますか？`}
              </div>
              <div style={{ fontSize: 11, color: '#8fd0ff', marginBottom: 6 }}>
                子はレベル1から。プラス値 +{nextPlus}／親の能力の {Math.round(rate * 100)}% を初期ステータスに受け継ぎます。
                親の技は「継承枠」に入り、育ててレベルが届くと覚えます。
              </div>
              {partyLost.length > 0 && (
                <div style={{ fontSize: 11, color: '#ff9c9c', marginBottom: 6 }}>
                  ※ 手持ちパーティーの
                  {partyLost.map((inst) => rosterById[inst.speciesId].name).join('・')}
                  がいなくなるため、パーティーから外れます
                </div>
              )}
              {alreadyOwned && (
                <div style={{ fontSize: 11, color: '#d0a94d', marginBottom: 6 }}>
                  ※ この種族はすでに牧場にいます（同じ種族を2体持てるので、別個体として増えます）
                </div>
              )}
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="jrpg-btn jrpg-btn--primary" onClick={confirmFusion}>はい、これでよい</button>
                <button className="jrpg-btn" onClick={reselectPartner}>相手を選び直す</button>
                <button className="jrpg-btn" onClick={reselectBloodline}>最初から</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, color: '#ff9c9c', marginBottom: 8 }}>
                この血統と相手の組み合わせには、まだ配合レシピが登録されていません。
                別の相手を選んでください。
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="jrpg-btn" onClick={reselectPartner}>相手を選び直す</button>
                <button className="jrpg-btn" onClick={reselectBloodline}>最初から</button>
              </div>
            </>
          )}
        </div>
      )}

      {(step === STEP.BLOODLINE || step === STEP.PARTNER) && (
        <>
          <MonsterFilterBar
            filter={filter}
            onChange={setFilter}
            count={selectable.length}
            total={ownedView.length}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', maxHeight: 300, overflowY: 'auto' }}>
            {selectable.length === 0 && (
              <div style={{ fontSize: 12, color: '#666' }}>該当するモンスターがいません</div>
            )}
            {selectable.map((v) => (
              <MonsterTile
                key={v.instance.uid}
                view={v}
                selected={v.instance.uid === bloodlineUid || v.instance.uid === partnerUid}
                onClick={() => pick(v.instance.uid)}
              />
            ))}
          </div>
        </>
      )}

      <button className="jrpg-btn jrpg-btn--back" onClick={onBack} style={{ marginTop: 16 }}>
        もどる
      </button>
      </div>
    </div>
  );
}
