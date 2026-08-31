// BattleScreen.jsx
// BattleEngine + Phaser(BattleScene) + メニューコンポーネント群を組み合わせ、
// 実際に遊べる戦闘画面にする。
//
// レイアウト (v2):
//   旧版は「キャンバス → ステータス → ログ → 高さ160px固定のコマンド欄」を
//   縦に積んでいたため、合計で500px近い縦幅が必要だった。
//   スマホ横画面(高さ390px前後)には入らない。
//
//   新版は家庭用JRPGと同じ「キャンバスが画面全部、UIはその上に重なる」方式:
//     - BattleScene がビューポート全体を占め、背景画とモンスターを描く
//     - てきのHPバー/名前/状態タグはキャンバス内に直接描く(てき用パネルは廃止)
//     - ターゲット選択はキャンバスのスプライトを直接クリック
//   縦に積むものが無いので、画面が低くなってもUIがはみ出さない。
//
// レイアウト (v3):
//   v2 は左下に「ログ + なかまの状態帯」を積んでいて、その塊が
//   なかまのモンスターの下半分を隠していた(スマホ横では画面の4割)。
//   v3 は **ログを画面の上へ移した**。下に残るのは状態帯1枚だけになり、
//   モンスターの立ち位置をその真上まで上げられる。
//
//   さらに「帯の高さ」と「コマンド欄の幅」を DOM から実測して
//   BattleScene へ渡す(下の useUiInsets)。CSSの clamp() と同じ式を
//   キャンバス側で書き写すのをやめたので、文字を大きくしても
//   モンスターの隠れ方が変わらない。

import { useEffect, useMemo, useRef, useState } from 'react';
import Phaser from 'phaser';
import { BattleEngine, PHASE } from '../../engine/battle/BattleEngine.js';
import { BattleScene } from '../../scenes/BattleScene.js';
import skillsRaw from '../../data/skills.json';
import BattleMenu from './BattleMenu.jsx';
import AttackSubmenu from './AttackSubmenu.jsx';
import SkillList from './SkillList.jsx';
import ItemMenu from './ItemMenu.jsx';
import TacticsMenu from './TacticsMenu.jsx';
import { TACTICS } from '../../engine/battle/ai.js';
import PartyStatusBar from './PartyStatusBar.jsx';
import BattleResult from './BattleResult.jsx';
import { useGameStore } from '../../state/gameStore.js';
import { TARGET, targetsAllySide, needsTargetPick, targetsDownedAlly } from '../../engine/skills.js';
import { itemTargetKind, targetsDownedAlly as itemTargetsDowned } from '../../engine/items.js';
import './battleUI.css';

const skillsById = {};
skillsRaw.forEach((s) => {
  skillsById[s.id] = s;
});

/** 戦闘背景。dungeons.json の background フィールドで選ぶ。 */
const DEFAULT_BACKGROUND = 'grassland';
const backgroundUrlFor = (name) => `/assets/battle_bg/${name || DEFAULT_BACKGROUND}.png`;

// 経験値・レベルアップ・仲間化のログだけ色を変えて目立たせる
const LOG_COLORS = [
  { key: 'なかまになりたそうに', color: '#7ee08a' },
  { key: 'レベル', color: '#ffd24d' },
  { key: 'おぼえた', color: '#8fd0ff' },
  { key: 'かわった', color: '#8fd0ff' },
  { key: '経験値', color: '#c9a8e0' },
  // 状態異常・能力変化まわりは色を分けて、効いたかどうかを一目で分かるようにする
  { key: '状態に なった', color: '#e08a4d' },
  { key: 'なおった', color: '#7ee08a' },
  { key: '目を さました', color: '#7ee08a' },
  { key: 'ねむっている', color: '#5a8fd6' },
  { key: 'しびれて', color: '#d9c04a' },
  { key: 'こんらんして', color: '#e08a4d' },
  { key: 'ふうじられている', color: '#8f8f9c' },
  { key: 'どくで', color: '#a86ad6' },
  { key: '上がった', color: '#7ee08a' },
  { key: '下がった', color: '#e08a4d' },
];

const logColor = (text) => LOG_COLORS.find((c) => text.includes(c.key))?.color;

const STAGE = {
  MAIN: 'main',
  ATTACK_SUB: 'attackSub',
  TARGET_ENEMY_FOR_ATTACK: 'targetEnemyForAttack',
  SKILL_LIST: 'skillList',
  TARGET_FOR_SKILL: 'targetForSkill',
  ITEM_MENU: 'itemMenu',
  TARGET_FOR_ITEM: 'targetForItem',
  TACTICS: 'tactics',
};

const TARGET_STAGES = [STAGE.TARGET_ENEMY_FOR_ATTACK, STAGE.TARGET_FOR_SKILL, STAGE.TARGET_FOR_ITEM];

export default function BattleScreen({ playerEntries, enemyEntries, onFinish, background, headerLabel }) {
  const {
    inventory, items, consumeItem, bagUsedSlots, bagSlotLimit, party, partyLimit,
  } = useGameStore();

  // 野生を仲間にしたとき、そのままパーティーへ入れられるか。
  // 空きが無ければ牧場行きだと結果画面に書かせる (BattleResult.jsx)。
  const partyFreeSlots = Math.max(0, partyLimit - party.length);

  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = new BattleEngine(playerEntries, enemyEntries, skillsById);
  }
  const engine = engineRef.current;

  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const [stage, setStage] = useState(STAGE.MAIN);
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [selectedItem, setSelectedItem] = useState(null);

  const phaserContainerRef = useRef(null);
  const phaserGameRef = useRef(null);
  const sceneRef = useRef(null);
  const logBoxRef = useRef(null);
  const partyBoxRef = useRef(null);
  const cmdBoxRef = useRef(null);

  // 戦闘中はページ自体をスクロールさせない(必ず1画面に収める)
  useEffect(() => {
    document.documentElement.classList.add('mrg-battle-lock');
    return () => document.documentElement.classList.remove('mrg-battle-lock');
  }, []);

  /**
   * 重ねたUIが画面のどこまでを占めているかを実測して、キャンバスへ渡す。
   *
   * 以前はCSSの clamp() と同じ式を BattleScene.js にも書き写していたが、
   * 文字の大きさや余白を変えるたびに2か所を合わせる必要があり、
   * 実際「なかまが状態帯の裏に隠れる」ずれが出ていた。
   * ここで DOM の実寸を測ってしまえば、CSSを触るだけで正しく追従する。
   *   bottom … なかまの状態帯が下から食っている高さ
   *   right  … コマンド欄が右から食っている幅
   */
  useEffect(() => {
    const measure = () => {
      // 画面が変わるとログの見えている行数も変わる。最新行を下端に
      // 貼りつけ直さないと、いちばん上の行が途中で切れて見える
      // (行の高さの整数倍でない位置にスクロールが残るため)。
      if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
      const scene = sceneRef.current;
      if (!scene) return;
      const h = window.innerHeight;
      const w = window.innerWidth;
      const party = partyBoxRef.current?.getBoundingClientRect();
      const cmd = cmdBoxRef.current?.getBoundingClientRect();
      scene.setUiInsets({
        bottom: party ? Math.max(0, h - party.top) : 0,
        right: cmd ? Math.max(0, w - cmd.left) : 0,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (partyBoxRef.current) ro.observe(partyBoxRef.current);
    if (cmdBoxRef.current) ro.observe(cmdBoxRef.current);
    if (logBoxRef.current) ro.observe(logBoxRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  });

  useEffect(() => {
    if (!phaserContainerRef.current || phaserGameRef.current) return;
    const scene = new BattleScene();
    sceneRef.current = scene;
    phaserGameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: phaserContainerRef.current,
      backgroundColor: '#0b0e18',
      // ドット絵をぼかさない(NEAREST補間)
      pixelArt: true,
      // フルブリード表示。親要素(=ビューポート全体)の実サイズをそのまま
      // キャンバスの論理サイズにするので、レターボックスが出ない。
      scale: {
        mode: Phaser.Scale.RESIZE,
        width: '100%',
        height: '100%',
      },
      scene: [scene],
    });
    phaserGameRef.current.scene.start('BattleScene', {
      getBattleState: () => engine.getState(),
      backgroundUrl: backgroundUrlFor(background),
    });

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || !rect.width || !rect.height) return;
      phaserGameRef.current?.scale.resize(rect.width, rect.height);
    });
    ro.observe(phaserContainerRef.current);

    return () => {
      ro.disconnect();
      phaserGameRef.current?.destroy(true);
      phaserGameRef.current = null;
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 検証用の取っ手。DEVビルドでのみ生やし、デバッグメニューから
  // 状態異常を直接かけられるようにする。本番ビルドでは丸ごと消える。
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__mrgBattle = { engine, rerender, scene: sceneRef.current };
    return () => {
      delete window.__mrgBattle;
    };
  });

  const state = engine.getState();
  const currentActor = state.phase === PHASE.SELECT ? engine.nextMemberNeedingAction() : null;

  function resetToMain() {
    setStage(STAGE.MAIN);
    setSelectedSkill(null);
    setSelectedItem(null);
  }

  /** 対象選択をやめて、ひとつ前のメニューに戻る。 */
  function cancelTargeting() {
    if (stage === STAGE.TARGET_ENEMY_FOR_ATTACK) setStage(STAGE.ATTACK_SUB);
    else if (stage === STAGE.TARGET_FOR_SKILL) {
      setSelectedSkill(null);
      setStage(STAGE.SKILL_LIST);
    } else if (stage === STAGE.TARGET_FOR_ITEM) {
      setSelectedItem(null);
      setStage(STAGE.ITEM_MENU);
    } else resetToMain();
  }

  /**
   * ターンを解決して、そのターンに起きた演出をキャンバスへ流す。
   *
   * 順番が肝心: **先に engine.resolveTurn() を最後まで走らせてから**、
   * 溜まった記録を絵にする。演出はターンの結果を待たせない
   * (絵が読めていなくても、シーンがまだ出来ていなくても、
   *  戦闘の進行はここまでで既に終わっている)。
   */
  function resolveTurnWithFx() {
    engine.resolveTurn();
    const fx = engine.takeFx();
    try {
      sceneRef.current?.playFx(fx);
    } catch {
      // 演出でこけても戦闘は続ける。ここが戦闘を壊す道になってはいけない。
    }
  }

  function submitAction(action) {
    engine.setPlayerAction(currentActor.instanceId, action);
    resetToMain();
    if (engine.allActionsReady()) {
      resolveTurnWithFx();
    }
    rerender();
  }

  function handleMainSelect(cmdId) {
    if (cmdId === 'attack') {
      // さくせんを設定している子は、こうげき/とくぎ/ぼうぎょ を選ばせずに
      // さくせんAIに任せる。中身が決まるのは resolveTurn の直前なので、
      // ここでは「さくせんで動く」という枠だけを積む。
      // (コマンド欄そのものは出したままにしてある。以前はさくせんを
      //  設定するとコマンドが出なくなり、どうぐ・にげる・さくせんの変更が
      //  まとめて封じられていた)
      if (currentActor.tactic) submitAction({ command: 'tactic' });
      else setStage(STAGE.ATTACK_SUB);
    }
    else if (cmdId === 'item') setStage(STAGE.ITEM_MENU);
    else if (cmdId === 'tactics') setStage(STAGE.TACTICS);
    else if (cmdId === 'flee') {
      // にげるはパーティー全体の行動。残りの仲間に1体ずつ行動を
      // 選ばせず、そのまま逃走判定へ進む。
      engine.requestPartyFlee(currentActor.instanceId);
      resetToMain();
      resolveTurnWithFx();
      rerender();
    }
  }

  function handleAttackSub(optId) {
    if (optId === 'normal') setStage(STAGE.TARGET_ENEMY_FOR_ATTACK);
    else if (optId === 'skill') setStage(STAGE.SKILL_LIST);
    else if (optId === 'defend') submitAction({ command: 'defend' });
  }

  function handleTargetForAttack(targetId) {
    submitAction({ command: 'attack', targetId });
  }

  function handleSkillSelect(skill) {
    // 全体技・自分だけに効く技は対象を聞かずにそのまま実行する
    if (!needsTargetPick(skill)) {
      submitAction({ command: 'skill', skillId: skill.id, targetId: null });
      return;
    }
    setSelectedSkill(skill);
    setStage(STAGE.TARGET_FOR_SKILL);
  }

  function handleTargetForSkill(targetId) {
    submitAction({ command: 'skill', skillId: selectedSkill.id, targetId });
  }

  function handleItemSelect(item) {
    const kind = itemTargetKind(item);
    if (kind !== TARGET.ALLY_ONE && kind !== TARGET.ENEMY_ONE) {
      // 味方全体 / 敵全体 / 対象なし は選ばせる相手がいない
      consumeItem(item.id);
      submitAction({ command: 'item', item, targetId: null });
      return;
    }
    setSelectedItem(item);
    setStage(STAGE.TARGET_FOR_ITEM);
  }

  function handleTargetForItem(targetId) {
    consumeItem(selectedItem.id);
    submitAction({ command: 'item', item: selectedItem, targetId });
  }

  /**
   * さくせんを変える。パーティー全体に効く(TacticsMenu の見出しどおり)。
   *
   * 変えたあとは コマンド選択の頭へ戻すだけで、ターンは進めない。
   * 「さくせんを変えて、そのターンはどうぐで回復する」ができないと、
   * 作戦変更が事実上できないのと同じになる。
   *
   * 積みかけの行動は捨てる。さくせんを変える前に押した「たたかう」は
   * 古いさくせんで動くので、変えたつもりの1ターンだけ前の作戦で
   * 殴ることになってしまう。
   */
  function handleTacticsSelect(tacticId) {
    engine.playerParty.forEach((c) => {
      c.tactic = tacticId;
    });
    engine.clearPendingActions();
    resetToMain();
    rerender();
  }

  const itemEntries = useMemo(
    () => items.map((it) => ({ item: it, count: inventory[it.id] || 0 })),
    [items, inventory]
  );

  const targetableEnemyIds = useMemo(() => {
    if (stage === STAGE.TARGET_ENEMY_FOR_ATTACK) {
      return state.enemyParty.filter((c) => c.hp > 0).map((c) => c.instanceId);
    }
    if (stage === STAGE.TARGET_FOR_SKILL && selectedSkill && !targetsAllySide(selectedSkill)) {
      return state.enemyParty.filter((c) => c.hp > 0).map((c) => c.instanceId);
    }
    if (stage === STAGE.TARGET_FOR_ITEM && itemTargetKind(selectedItem) === TARGET.ENEMY_ONE) {
      return state.enemyParty.filter((c) => c.hp > 0).map((c) => c.instanceId);
    }
    return [];
  }, [stage, state.enemyParty, selectedSkill, selectedItem]);

  const targetableAllyIds = useMemo(() => {
    // 蘇生は「倒れている味方」、それ以外は「生きている味方」を選ばせる
    if (stage === STAGE.TARGET_FOR_ITEM && itemTargetKind(selectedItem) === TARGET.ALLY_ONE) {
      const downed = itemTargetsDowned(selectedItem);
      return state.playerParty
        .filter((c) => (downed ? c.hp <= 0 : c.hp > 0))
        .map((c) => c.instanceId);
    }
    if (stage === STAGE.TARGET_FOR_SKILL && selectedSkill && targetsAllySide(selectedSkill)) {
      const downed = targetsDownedAlly(selectedSkill);
      return state.playerParty
        .filter((c) => (downed ? c.hp <= 0 : c.hp > 0))
        .map((c) => c.instanceId);
    }
    return [];
  }, [stage, state.playerParty, selectedSkill, selectedItem]);

  const targetableIds = useMemo(
    () => [...targetableEnemyIds, ...targetableAllyIds],
    [targetableEnemyIds, targetableAllyIds]
  );

  function handleSelectTarget(instanceId) {
    if (stage === STAGE.TARGET_ENEMY_FOR_ATTACK) handleTargetForAttack(instanceId);
    else if (stage === STAGE.TARGET_FOR_SKILL) handleTargetForSkill(instanceId);
    else if (stage === STAGE.TARGET_FOR_ITEM) handleTargetForItem(instanceId);
  }

  const battleOver = state.phase === PHASE.ENDED;

  // キャンバスへ最新状態を流し込む。クリック(ターゲット選択)のハンドラも
  // 毎描画で差し替える(stageに依存したクロージャなので古いままだと誤動作する)。
  useEffect(() => {
    const scene = sceneRef.current;
    if (scene) {
      scene.onTargetPick = handleSelectTarget;
      scene.updateFromState(state, {
        targetableIds: battleOver ? [] : targetableIds,
        activeActorId: currentActor?.instanceId,
      });
    }
    // 勝利時は経験値・レベルアップ・仲間化のログが増えるので、必ず最新行を見せる
    if (logBoxRef.current) logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
  });

  const targeting = TARGET_STAGES.includes(stage) && !battleOver && currentActor;

  /** 対象選択中に画面上部へ出す案内。 */
  function targetPrompt() {
    if (stage === STAGE.TARGET_ENEMY_FOR_ATTACK) return 'こうげきする てき を えらぶ';
    if (stage === STAGE.TARGET_FOR_SKILL) {
      const who = targetsDownedAlly(selectedSkill)
        ? '戦闘不能の なかま'
        : targetsAllySide(selectedSkill)
          ? 'なかま'
          : 'てき';
      return `${selectedSkill?.name} の 対象（${who}）を えらぶ`;
    }
    if (stage === STAGE.TARGET_FOR_ITEM) {
      const who = itemTargetsDowned(selectedItem)
        ? '戦闘不能の なかま'
        : itemTargetKind(selectedItem) === TARGET.ENEMY_ONE
          ? 'てき'
          : 'なかま';
      return `${selectedItem?.name} を つかう ${who} を えらぶ`;
    }
    return '';
  }

  return (
    <div className="mrg-battle">
      {/* キャンバスが画面全部。UIはこの上に重なる。 */}
      <div className="mrg-canvas" ref={phaserContainerRef} />

      <div className="mrg-topbar">
        <span className="mrg-chip">{headerLabel || '戦闘'}</span>
        <span className="mrg-chip mrg-chip--turn">ターン {state.turn}</span>
      </div>

      {/* 画面の上: 戦闘ログ。下に置くと なかまのモンスターに かぶるので上へ。
          高さは行数から逆算してあり(battleUI.css)、いちばん上の行が
          途中で切れることはない。 */}
      <div className="mrg-topleft">
        <div className="mrg-log jrpg-win jrpg-win--sheer jrpg-scroll" ref={logBoxRef}>
          {state.log.slice(-12).map((entry, i) => (
            <div key={i} style={{ color: logColor(entry.text) }}>
              {entry.text}
            </div>
          ))}
        </div>
        {targeting && <div className="mrg-prompt">{targetPrompt()}</div>}
      </div>

      {/* 画面の下: なかまの状態帯。ここの高さぶんだけ、キャンバス側は
          モンスターの立ち位置を上げる(uiInsets)。 */}
      <div className="mrg-partywrap" ref={partyBoxRef}>
        <PartyStatusBar
          playerParty={state.playerParty}
          activeActorId={currentActor?.instanceId}
          targetableIds={battleOver ? [] : targetableIds}
          onSelectTarget={handleSelectTarget}
        />
      </div>

      {!battleOver && (
        <div className="mrg-cmd jrpg-win" ref={cmdBoxRef}>
          <div className="mrg-cmd-body">
            {currentActor && stage === STAGE.MAIN && (
              <BattleMenu
                actorName={currentActor.name}
                tacticLabel={TACTICS[currentActor.tactic]?.label || null}
                onSelect={handleMainSelect}
              />
            )}
            {currentActor && stage === STAGE.ATTACK_SUB && (
              <AttackSubmenu onSelect={handleAttackSub} onBack={resetToMain} />
            )}
            {currentActor && stage === STAGE.SKILL_LIST && (
              <SkillList
                actor={currentActor}
                skillsById={skillsById}
                onSelect={handleSkillSelect}
                onBack={() => setStage(STAGE.ATTACK_SUB)}
              />
            )}
            {currentActor && stage === STAGE.ITEM_MENU && (
              <ItemMenu
                items={itemEntries}
                slotsUsed={bagUsedSlots}
                slotLimit={bagSlotLimit}
                onSelect={handleItemSelect}
                onBack={resetToMain}
              />
            )}
            {currentActor && stage === STAGE.TACTICS && (
              <TacticsMenu currentTactic={currentActor.tactic} onSelect={handleTacticsSelect} onBack={resetToMain} />
            )}
            {targeting && (
              <>
                <div className="mrg-hint">{targetPrompt()}</div>
                <div className="mrg-note" style={{ marginTop: 2 }}>
                  キャンバスの モンスターを クリック
                </div>
                <button className="jrpg-btn jrpg-btn--back mrg-btn--back" onClick={cancelTargeting}>
                  やめる
                </button>
              </>
            )}
            {/* 生きている全員のコマンドが揃うと submitAction がその場で
                ターンを進めるので、ふつうはここへ来ない。
                想定外で入力先を見失ったときに、行き止まりにしないための逃げ道。 */}
            {!currentActor && (
              <>
                <div className="mrg-note" style={{ marginBottom: 6 }}>
                  全員の こうどうが きまりました。
                </div>
                <button
                  className="jrpg-btn jrpg-btn--primary"
                  style={{ width: '100%' }}
                  onClick={() => {
                    resolveTurnWithFx();
                    rerender();
                  }}
                >
                  つぎのターンへ
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* 結果は「意味ごとに区切ったページ」を1枚ずつ送って読ませる。
          ページ割りは BattleEngine が作る(_finishBattle)。 */}
      {battleOver && (
        <BattleResult
          result={state.result}
          pages={state.resultPages}
          partyFreeSlots={partyFreeSlots}
          onFinish={(keptRecruits) => onFinish(state.result, {
            ...engine.getRewards(),
            // 誘いを受けた子だけが所持に入る。見送った子はどこにも残らない。
            recruits: keptRecruits || [],
          })}
        />
      )}
    </div>
  );
}
