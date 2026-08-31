// App.jsx
// 最上位の画面ルーター。
//
// v0.5 で「歩けるマップ」になった。町も内装もダンジョンも同じ FieldScreen
// (フルブリードのPhaser + 重ねUI)で、マップの定義だけを差し替えている。
//
//   まち(歩く) ──扉のマスを踏む──> 内装(歩く) ──NPCに話しかける──> 各施設の画面
//        │                              └──扉のマスを踏む──> まちの扉の前
//        └──南の道(x=14..17, y=23)を踏む──> ダンジョン選択 ──> ダンジョン(歩く)
//
// ダンジョンは固定の連戦リストではなく、フロアを歩いてランダムに戦闘が起きる。
//   下り階段 -> 次の階へ。最下層の下り階段の先がボス。
//   1階に上り階段は無い。引き返すのは キメラのつばさ (歩いている途中でも使える)。
//   HP/MPは走行のあいだ持ち越し。全快するのは帰還後の司祭だけ。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameStoreProvider, useGameStore, formatGold } from './state/gameStore.js';
import FieldScreen from './components/Field/FieldScreen.jsx';
import ItemIcon from './components/Common/ItemIcon.jsx';
import FacilityPlaceholder from './components/Town/FacilityPlaceholder.jsx';
import ItemShop from './components/Town/ItemShop.jsx';
import MonsterRanch from './components/Town/MonsterRanch.jsx';
import FusionFacility from './components/Town/FusionFacility.jsx';
import DungeonSelect from './components/Town/DungeonSelect.jsx';
import ItemBag from './components/Town/ItemBag.jsx';
import PriestScreen from './components/Town/PriestScreen.jsx';
import FieldMenu from './components/Menu/FieldMenu.jsx';
import BattleScreen from './components/Battle/BattleScreen.jsx';
import StarterEvent from './components/Event/StarterEvent.jsx';
import DebugMenu from './components/Debug/DebugMenu.jsx';
import TitleScreen from './components/Title/TitleScreen.jsx';
import { RESULT } from './engine/battle/BattleEngine.js';
import { usableInField } from './engine/items.js';
import { areaOpenedBy } from './engine/areas.js';
import {
  buildTownMap, buildInteriorMap, buildDungeonFloorMap,
  buildBossRoomMap, bossRoomFor, bossRoomSpawn,
  interiorInfo, interiorSpawn, townSpawnForDoor,
  TOWN_SPAWN, TOWN_GATE_SPAWN, dungeonFloorSpawn,
} from './field/maps.js';
import {
  createRun, advanceStep, moveToFloor, resumeAfterBattle, applyHolyWater,
  bossEncounter, HOLY_WATER_STEPS,
  chestReward, isChestOpened, markChestOpened,
  isFloorItemTaken, markFloorItemTaken,
} from './engine/dungeonRun.js';

const SCREEN = {
  FIELD: 'field',
  SHOP: 'shop',
  STORAGE: 'storage',
  RANCH: 'ranch',
  CHURCH: 'church',
  FUSION: 'fusion',
  BAG: 'bag',
  DUNGEON_SELECT: 'dungeonSelect',
  BATTLE: 'battle',
  PRIEST: 'priest',
};

// 未実装のまま「準備中」パネルを出す施設。
// 配合施設・牧場・どうぐ屋は実装済みなので、ここには残っていない。
const FACILITY_TITLES = {
  storage: 'あずけ所',
  church: '教会',
};

// 各施設の人物と内装の絵。中身が準備中でも「どこに来たのか」は伝える。
const FACILITY_ART = {
  shop: { npc: '/assets/npc/shopkeeper.png', backdrop: '/assets/interiors/shop.png' },
  storage: { npc: '/assets/npc/storekeeper.png', backdrop: '/assets/interiors/house.png' },
  church: { npc: '/assets/npc/priestess.png', backdrop: '/assets/interiors/church.png' },
};

// 「準備中」ではなく、そういう作りだと伝えたい施設の但し書き。
const FACILITY_NOTES = {
  storage:
    'モンスターは 牧場が 何体でも 預かります（数の 制限は ありません）。'
    + 'そのため あずけ所には いまのところ 仕事が ありません。',
  church:
    '回復と蘇生は、ダンジョンから帰ってきたときに 司祭が 入口で 行います（教会まで足を運ぶ必要はありません）。'
    + 'この建物では、いずれ 別のサービスを 用意する予定です。',
};

/** まちの広場に立った状態。 */
const TOWN_PLACE = { kind: 'town', spawn: TOWN_SPAWN };

function AppInner() {
  const {
    rosterById, party, ownedByUid, owned, items, inventory,
    clearedDungeons,
    markDungeonCleared, applyBattleOutcome, priestBlessing, acquireItem, consumeItem,
    gold, addGold,
  } = useGameStore();

  const [screen, setScreen] = useState(SCREEN.FIELD);
  // いま歩いている場所。
  // {kind:'town'} | {kind:'interior', id} | {kind:'dungeon', floorIndex} | {kind:'bossRoom'}
  const [place, setPlace] = useState(TOWN_PLACE);
  const [battleKey, setBattleKey] = useState(0);
  const [pendingBattle, setPendingBattle] = useState(null); // { encounter, isBoss, dungeon, floorIndex }
  const [fieldMessage, setFieldMessage] = useState(null);
  const [showFieldItems, setShowFieldItems] = useState(false);
  // フィールドのメニュー(つよさ/どうぐ/とくぎ/さくせん)。
  // まちでもダンジョンでも同じものを開く。
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [flash, setFlash] = useState(false);
  // 司祭の処理結果。回復は「画面を出すとき」ではなくここで1回だけ実行する
  // (StrictMode の二重描画でやくそうが2つになるのを避ける)。
  const [priestVisit, setPriestVisit] = useState(null); // { result, report, drops }
  // 「たった今、新しい土地への道がひらけた」という **できごと**。
  // 開いているかどうか自体は clearedDungeons から導けるが(engine/areas.js)、
  // 開いた瞬間だけは状態からは分からない。次に地図を開いたときに祝って、
  // 見せたら捨てる。保存はしない。
  const [openedArea, setOpenedArea] = useState(null);
  // 所持が空 = 新規プレイ(旧セーブ破棄を含む)。まず開始イベントへ。
  const [inStarter, setInStarter] = useState(() => owned.length === 0);

  // ダンジョン1回ぶんの進行。歩数・エンカウント・せいすいの残りを持つ。
  // 戦闘のたびに FieldScreen は作り直されるので、状態はここ(ref)に置く。
  const runRef = useRef(null);
  // 拾いもののメッセージを閉じるまで待たせているエンカウント。
  // 「1歩で どうぐを拾い、同じ1歩で魔物が出る」が起きたとき、拾った知らせを
  // 戦闘で押し流さないための取り置き。
  const heldEncounterRef = useRef(null);
  // マップ上の現在地。施設や戦闘から戻るとき、ここへ復帰させる。
  const poseRef = useRef(null);
  // 施設の画面から戻る先(内装のどのマスに立っていたか)。
  const returnPlaceRef = useRef(TOWN_PLACE);
  const [, setFieldTick] = useState(0);
  const bumpField = useCallback(() => setFieldTick((t) => t + 1), []);

  const fieldMap = useMemo(() => {
    if (place.kind === 'interior') return buildInteriorMap(place.id);
    if (place.kind === 'bossRoom' && runRef.current) {
      // ボスの絵は戦闘で使うものと同じ。部屋の主として先に立たせておくので、
      // 「戦う前にどんな相手か見える」= 逃げるかどうかを決められる。
      const boss = bossEncounter(runRef.current.dungeon);
      const lead = boss?.enemies?.[0];
      const species = lead ? rosterById[lead.id] : null;
      return buildBossRoomMap(runRef.current.dungeon, species?.spriteUrl || null);
    }
    if (place.kind === 'dungeon' && runRef.current) {
      // 走行状態(run)をそのまま渡す。開けた宝箱・拾った床のどうぐ・
      // 落ちどうぐの配置を決める種は全部そこにある。階を行き来しても
      // 戦闘から戻っても同じ配置・同じ開閉状態で組み直される。
      return buildDungeonFloorMap(runRef.current.dungeon, place.floorIndex, runRef.current);
    }
    return buildTownMap();
  }, [place]);

  // 検証用の取っ手。DEVビルドでのみ生やす。
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    window.__mrgField = {
      get run() { return runRef.current; },
      get pose() { return poseRef.current; },
      place,
      screen,
      menuOpen,
      openMenu: () => setMenuOpen(true),
      closeMenu: () => setMenuOpen(false),
    };
    return () => { delete window.__mrgField; };
  });

  // メニューを開くキー。Esc / X。
  // 閉じるほうは FieldMenu 自身が受け持つ(開いているあいだは
  // メニューの中の「1つ戻る」にも同じキーを使うため)。
  useEffect(() => {
    if (screen !== SCREEN.FIELD || menuOpen || fieldMessage || showFieldItems) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        setMenuOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, menuOpen, fieldMessage, showFieldItems]);

  // ------------------------------------------------------------ 場所の移動

  function goTown(spawn = TOWN_SPAWN) {
    runRef.current = null;
    heldEncounterRef.current = null;
    setPlace({ kind: 'town', spawn });
    setFieldMessage(null);
    setShowFieldItems(false);
    setMenuOpen(false);
    setScreen(SCREEN.FIELD);
  }

  function openFacility(screenId) {
    returnPlaceRef.current = { ...place, spawn: poseRef.current || place.spawn };
    setFieldMessage(null);
    setMenuOpen(false);
    setScreen(screenId);
  }

  function backToField() {
    setPlace(returnPlaceRef.current);
    setScreen(SCREEN.FIELD);
  }

  // ------------------------------------------------------------ フィールド

  function handleFieldEvent(type, payload) {
    if (type === 'ready' || type === 'step') {
      poseRef.current = { x: payload.tile.x, y: payload.tile.y, facing: payload.facing };
    }
    if (type === 'step' && place.kind === 'dungeon' && runRef.current) {
      // 拾うのが先、エンカウントの判定はそのあと。逆にすると
      // 「踏んだ瞬間に戦闘が始まって、拾ったことにならない」が起きる。
      const picked = payload.floorItem
        ? handleFloorItem(payload.floorItem, payload.takeFloorItem)
        : false;
      const hit = advanceStep(runRef.current);
      bumpField();
      if (hit) {
        // 拾った知らせを出している最中なら、読み終わるまで魔物を待たせる。
        if (picked) heldEncounterRef.current = hit.encounter;
        else startEncounter(hit.encounter, false);
        return;
      }
    }
    if (type === 'trigger') handleTrigger(payload.trigger);
    if (type === 'interact') handleInteract(payload);
  }

  /** メッセージを閉じる。待たせていたエンカウントがあれば、ここで始める。 */
  function closeFieldMessage() {
    setFieldMessage(null);
    const held = heldEncounterRef.current;
    if (held) {
      heldEncounterRef.current = null;
      startEncounter(held, false);
    }
  }

  function handleTrigger(trigger) {
    const run = runRef.current;
    switch (trigger.type) {
      case 'door':
        setPlace({ kind: 'interior', id: trigger.interior, spawn: interiorSpawn(trigger.interior) });
        break;
      case 'exitInterior':
        setPlace({ kind: 'town', spawn: townSpawnForDoor(trigger.doorId) });
        break;
      case 'townGate':
        setScreen(SCREEN.DUNGEON_SELECT);
        break;
      case 'stairsDown': {
        if (!run) break;
        const next = run.floorIndex + 1;
        moveToFloor(run, next);
        setPlace({ kind: 'dungeon', floorIndex: next, spawn: dungeonFloorSpawn(run.dungeon, next, 'above') });
        break;
      }
      case 'stairsUp': {
        if (!run) break;
        const prev = Math.max(0, run.floorIndex - 1);
        moveToFloor(run, prev);
        setPlace({ kind: 'dungeon', floorIndex: prev, spawn: dungeonFloorSpawn(run.dungeon, prev, 'below') });
        break;
      }
      case 'chest':
        // 宝箱のマスは通れないので、踏むことはない(調べるほうで処理する)。
        break;
      case 'floorItem':
        // 踏んだ瞬間に handleFieldEvent の 'step' が拾いおわっている。
        break;
      case 'bossGate':
        setFieldMessage({
          text: '階段の 下から ただならぬ 気配が する。おりますか？',
          choices: [
            { label: 'おりる', primary: true, onSelect: () => { setFieldMessage(null); descendToBoss(); } },
            { label: 'やめる', cancel: true, onSelect: () => setFieldMessage(null) },
          ],
        });
        break;
      // ボス部屋で ボスに近づいた(MapScene が毎歩みている)。
      case 'bossFight':
        startBoss();
        break;
      default:
        break;
    }
  }

  function handleInteract(payload) {
    if (payload.chest) {
      handleChest(payload.chest, payload.openChest);
      return;
    }
    if (payload.look) {
      sayOnce(null, payload.look);
      return;
    }
    const npc = payload.npc;
    if (!npc || place.kind !== 'interior') return;
    const info = interiorInfo(place.id);
    if (!info) return;
    setFieldMessage({
      name: npc.name,
      text: info.line,
      choices: [
        { label: info.actionLabel, primary: true, onSelect: () => openFacility(info.screen) },
        { label: 'やめる', cancel: true, onSelect: () => setFieldMessage(null) },
      ],
    });
  }

  /** ひとこと出して閉じるだけのメッセージ。icon は任意(手に入れた物の絵)。 */
  function sayOnce(name, text, icon = null) {
    setFieldMessage({
      name,
      text,
      icon,
      choices: [{ label: 'とじる', primary: true, cancel: true, onSelect: closeFieldMessage }],
    });
  }

  /**
   * 床に落ちていた どうぐを踏んだ。
   *
   * 宝箱と役割を分けてある: 宝箱は「近づいて調べる」、床のどうぐは「踏むだけ」。
   * どちらもボタンで取れるようにすると、宝箱を開ける動作が特別でなくなる。
   *
   * ふくろが満杯なら **拾わない**。床に残しておけば、どうぐを整理してから
   * 取りに戻れる(宝箱を開けないのと同じ理屈)。
   * @returns {boolean} メッセージを出したか
   */
  function handleFloorItem(floorItem, takeFloorItem) {
    const run = runRef.current;
    if (!run || isFloorItemTaken(run, floorItem.id)) return false;
    const result = acquireItem(floorItem.itemId, 1);
    if (!result.ok) {
      // 拾えなかった。絵は床に残したまま。
      sayOnce(null, result.message || 'これいじょう 持てない。',
        <ItemIcon itemId={floorItem.itemId} size={null} className="mrg-itemicon--lost" />);
      return true;
    }
    markFloorItemTaken(run, floorItem.id);
    takeFloorItem?.();
    sayOnce(null, `足もとに 落ちていた！ ${result.message}`,
      <ItemIcon itemId={floorItem.itemId} size={null} />);
    return true;
  }

  /**
   * 宝箱を調べた。
   *
   * 中身は「大金 / 上位のどうぐ / からっぽ」の3本立て(engine/dungeonRun.js)。
   * 床に落ちている やくそう と同じ物を出しては、わざわざ開ける意味がない。
   *
   * どうぐがふくろに入らなかったときは **開けない**。開けてしまうと中身が
   * 消えるので、「持ちきれなかった」と言われたあと、整理して取りに戻れなくなる。
   * (ゴールドだけの宝箱は かさばらないので必ず開く)
   */
  function handleChest(chest, openChest) {
    const run = runRef.current;
    if (!run) return;
    if (isChestOpened(run, chest.id)) {
      sayOnce('たからばこ', 'からっぽだ。');
      return;
    }

    const reward = chestReward(run.dungeon, run.floorIndex, chest.id, run.seed);

    // はずれ。開けた事実だけ残す(もう一度開けても同じことを言う)。
    if (reward.empty) {
      markChestOpened(run, chest.id);
      openChest?.();
      sayOnce('たからばこ', '宝箱を あけた！ ……からっぽだった…');
      return;
    }

    // どうぐが入っているなら、先にふくろに入るか確かめる。
    const wanted = reward.items[0] || null;
    let itemResult = null;
    if (wanted) {
      itemResult = acquireItem(wanted.itemId, wanted.count);
      if (!itemResult.ok) {
        sayOnce('たからばこ', itemResult.message || 'これいじょう 持てない。',
          <ItemIcon itemId={wanted.itemId} size={null} className="mrg-itemicon--lost" />);
        return;
      }
    }

    const goldResult = reward.gold > 0 ? addGold(reward.gold) : null;

    markChestOpened(run, chest.id);
    openChest?.();
    const lines = [goldResult?.message, itemResult?.message].filter(Boolean);
    sayOnce(
      'たからばこ',
      `宝箱を あけた！ ${lines.join(' ')}`,
      wanted
        ? <ItemIcon itemId={wanted.itemId} size={null} />
        : <img className="mrg-itemicon" src="/assets/ui/gold.png" alt="" />,
    );
  }

  // ------------------------------------------------------------ ダンジョン

  function startDungeon(dungeon) {
    runRef.current = createRun(dungeon);
    heldEncounterRef.current = null;
    setPlace({ kind: 'dungeon', floorIndex: 0, spawn: dungeonFloorSpawn(dungeon, 0, 'above') });
    setFieldMessage(null);
    setShowFieldItems(false);
    setMenuOpen(false);
    setScreen(SCREEN.FIELD);
  }

  function leaveDungeon() {
    returnToTownViaPriest(RESULT.FLED);
  }

  function startEncounter(encounter, isBoss) {
    const run = runRef.current;
    if (!run) return;
    run.pose = poseRef.current;
    setPendingBattle({
      encounter, isBoss, dungeon: run.dungeon, floorIndex: run.floorIndex,
      inBossRoom: place.kind === 'bossRoom',
    });
    setBattleKey((k) => k + 1);
    setMenuOpen(false);
    // 画面を一瞬暗くしてから戦闘へ。いきなり切り替わると何が起きたか分からない。
    setFlash(true);
    window.setTimeout(() => {
      setFlash(false);
      setScreen(SCREEN.BATTLE);
    }, 300);
  }

  /**
   * 最下層の階段を おりる。
   *
   * biome ごとの「ボスの間」があればそこへ入る。部屋の入口に立たされ、
   * 奥のボスへ2マスまで近づくと戦闘が始まる(MapScene の bossTile 判定)。
   * 部屋には階段が無いので、入ったら「戦う」か「キメラのつばさで帰る」しかない。
   *
   * 専用の部屋を持たない biome は、今までどおり階段の先ですぐ戦闘に入る。
   */
  function descendToBoss() {
    const run = runRef.current;
    if (!run) return;
    if (!bossRoomFor(run.dungeon)) {
      startBoss();
      return;
    }
    setPlace({ kind: 'bossRoom', spawn: bossRoomSpawn(run.dungeon) });
    setScreen(SCREEN.FIELD);
  }

  function startBoss() {
    const run = runRef.current;
    if (!run) return;
    const boss = bossEncounter(run.dungeon);
    if (boss) startEncounter(boss, true);
  }

  /** ダンジョンから帰還した = 司祭の画面を挟む。回復はここで1回だけ実行する。 */
  function returnToTownViaPriest(result, drops = []) {
    runRef.current = null;
    heldEncounterRef.current = null;
    setPendingBattle(null);
    setFieldMessage(null);
    setShowFieldItems(false);
    setMenuOpen(false);
    setPriestVisit({ result, report: priestBlessing(), drops });
    setScreen(SCREEN.PRIEST);
  }

  /** 踏破報酬。ふくろが満杯なら acquireItem がその旨を返すので、そのまま見せる。 */
  function collectClearReward(dungeon) {
    return (dungeon.clearReward || []).map((r) => acquireItem(r.itemId, r.count));
  }

  function handleBattleFinish(result, rewards) {
    // 経験値・レベルアップ・野生の仲間化をここで確定させる
    applyBattleOutcome(rewards);

    const run = runRef.current;
    const info = pendingBattle;
    if (!run || !info) {
      returnToTownViaPriest(result);
      return;
    }

    // キメラのつばさで自分から切り上げた / 全滅した -> 拠点へ帰る
    if (rewards?.abandonedDungeon || result === RESULT.LOSE) {
      returnToTownViaPriest(result);
      return;
    }

    if (info.isBoss && result === RESULT.WIN) {
      // 踏破を書き込む前に見る。書いたあとでは「前から開いていた」と区別できない。
      const opened = areaOpenedBy(run.dungeon.id, clearedDungeons);
      markDungeonCleared(run.dungeon.id);
      if (opened) setOpenedArea(opened);
      const drops = collectClearReward(run.dungeon);
      returnToTownViaPriest(result, drops);
      return;
    }

    // 雑魚に勝った / にげた -> フロアの元いたマスへ戻る。
    //
    // HP/MPの持ち越しはここで起きている。すぐ上の applyBattleOutcome() が
    // 戦闘終了時点のHP/MPを個体(owned)へ書き戻すので、次のエンカウントで
    // BattleScreen が作り直されるとき、その減ったHP/MPから始まる。
    // ダンジョンの途中に回復ポイントは無く、全快するのは帰還後の司祭だけ。
    // だからこそ「どうぐを持っていくか」「ここで 引き返すか」が意味を持つ。
    resumeAfterBattle(run);
    setPendingBattle(null);
    if (info.inBossRoom) {
      // ボスから にげた。元いたマスへ戻すと、ボスの目の前(戦闘が始まる2マス以内)
      // に立たされて即また戦闘 = 逃げられない。入口へ下がらせる。
      setPlace({ kind: 'bossRoom', spawn: bossRoomSpawn(run.dungeon) });
    } else {
      setPlace({ kind: 'dungeon', floorIndex: run.floorIndex, spawn: run.pose || place.spawn });
    }
    setScreen(SCREEN.FIELD);
  }

  // --------------------------------------------------- ダンジョン内のどうぐ

  const fieldItems = useMemo(
    () => items.filter(usableInField).map((item) => ({ item, count: inventory[item.id] || 0 })),
    [items, inventory],
  );

  function useFieldItem(item) {
    const run = runRef.current;
    if (!run || (inventory[item.id] || 0) <= 0) return;

    // キメラのつばさ。歩いている途中で引き返すためのどうぐなので、
    // 戦闘中だけでなくここでも使えないと意味がない。
    if (item.effect === 'escape_dungeon') {
      consumeItem(item.id);
      setShowFieldItems(false);
      setFieldMessage(null);
      leaveDungeon();
      return;
    }

    if (item.effect !== 'encounter_down') return;
    const steps = applyHolyWater(run, item.amount || HOLY_WATER_STEPS);
    consumeItem(item.id);
    setShowFieldItems(false);
    bumpField();
    setFieldMessage({
      text: `${item.name}を ふりまいた！ ${steps}歩の あいだ 魔物が よってきにくくなる。`,
      choices: [{ label: 'とじる', primary: true, cancel: true, onSelect: () => setFieldMessage(null) }],
    });
  }

  // ------------------------------------------------------------------ 描画

  if (inStarter) {
    return (
      <StarterEvent
        onDone={() => {
          setInStarter(false);
          setPlace(TOWN_PLACE);
          setScreen(SCREEN.FIELD);
        }}
      />
    );
  }

  if (screen === SCREEN.BATTLE && pendingBattle) {
    const { encounter, isBoss, dungeon, floorIndex } = pendingBattle;
    const playerEntries = party
      .map((uid) => ownedByUid[uid])
      .filter(Boolean)
      .map((instance) => ({ instance, species: rosterById[instance.speciesId] }))
      .filter((e) => e.species);
    // 敵は「種族 + レベル」で渡す。レベルはエンカウントが1体ずつ持っている
    // (dungeons.json は monster_project/build_dungeons.py が生成する)。
    const enemyEntries = (encounter.enemies || [])
      .map((e) => ({ species: rosterById[e.id], level: e.level ?? encounter.level ?? 1 }))
      .filter((e) => e.species);
    const headerLabel = isBoss
      ? `${dungeon.name}　ボス`
      : `${dungeon.name}　地下${floorIndex + 1}階`;
    return (
      // 戦闘画面はキャンバスがビューポート全体を占め、UIはその上に重なる。
      // 外側で padding や見出しを積まない(縦幅を食わせない)のが要点。
      <BattleScreen
        key={battleKey}
        playerEntries={playerEntries}
        enemyEntries={enemyEntries}
        background={dungeon.background}
        headerLabel={headerLabel}
        onFinish={handleBattleFinish}
      />
    );
  }

  if (screen === SCREEN.PRIEST && priestVisit) {
    return (
      <PriestScreen
        result={priestVisit.result}
        report={priestVisit.report}
        drops={priestVisit.drops}
        onDone={() => {
          setPriestVisit(null);
          goTown(TOWN_GATE_SPAWN);
        }}
      />
    );
  }

  if (screen === SCREEN.RANCH) return <MonsterRanch onBack={backToField} />;
  if (screen === SCREEN.BAG) return <ItemBag onBack={backToField} />;
  if (screen === SCREEN.FUSION) return <FusionFacility onBack={backToField} />;
  if (screen === SCREEN.SHOP) return <ItemShop onBack={backToField} />;

  if (screen === SCREEN.DUNGEON_SELECT) {
    return (
      <DungeonSelect
        onStartDungeon={startDungeon}
        onBack={() => goTown(TOWN_GATE_SPAWN)}
        openedArea={openedArea}
        onOpenedAreaSeen={() => setOpenedArea(null)}
      />
    );
  }

  if (FACILITY_TITLES[screen]) {
    return (
      <FacilityPlaceholder
        title={FACILITY_TITLES[screen]}
        note={FACILITY_NOTES[screen]}
        npc={FACILITY_ART[screen]?.npc}
        backdrop={FACILITY_ART[screen]?.backdrop}
        backLabel="もどる"
        onBack={backToField}
      />
    );
  }

  // --- 歩けるマップ -------------------------------------------------------
  const run = runRef.current;
  const inDungeon = place.kind === 'dungeon' && !!run;

  // 上の帯のボタン。メニューは まちでもダンジョンでも開ける。
  // ダンジョンの「どうぐ」は歩きながら使える物だけの早見表で、
  // メニューの「どうぐ」(ふくろ全部)とは役割が違うので両方置いてある。
  const topButtons = [];
  if (place.kind === 'town') {
    topButtons.push({ label: 'どうぐ', onClick: () => openFacility(SCREEN.BAG) });
  } else if (inDungeon) {
    topButtons.push({ label: 'どうぐ', onClick: () => setShowFieldItems((v) => !v) });
  }
  topButtons.push({
    label: 'メニュー',
    // どうぐ欄を開いたままメニューを出すと、FieldScreen が
    // 「板が出ている」と判断して十字キーを隠してしまう。先に畳む。
    onClick: () => { setShowFieldItems(false); setMenuOpen(true); },
  });

  const itemPanel = showFieldItems && inDungeon ? (
    <div className="fld-panel jrpg-win jrpg-scroll">
      <h3>どうぐ（歩きながら つかえるもの）</h3>
      {fieldItems.length === 0 && (
        <div className="fld-panel-note">歩きながら つかえる どうぐは まだ 無い。</div>
      )}
      {fieldItems.map(({ item, count }) => (
        <button
          key={item.id}
          className="jrpg-btn fld-item"
          disabled={count <= 0}
          onClick={() => useFieldItem(item)}
        >
          <ItemIcon item={item} size={null} className="mrg-itemicon--row" />
          <span>{item.name}</span>
          <span className="fld-item-count">×{count}</span>
        </button>
      ))}
      <div className="fld-panel-note" style={{ marginTop: 6 }}>
        回復どうぐは 戦闘中に つかいます。
      </div>
      <div className="fld-msg-row">
        <button className="jrpg-btn jrpg-btn--back" onClick={() => setShowFieldItems(false)}>とじる</button>
      </div>
    </div>
  ) : null;

  // メニューを開いているあいだ、十字キーと決定ボタンの行き先を
  // MapScene から FieldMenu へ差し替える。ボタンを画面に増やさないため。
  const menuControls = menuOpen ? {
    onPad: (dir) => menuRef.current?.pad(dir),
    onAction: () => menuRef.current?.action(),
    onCancel: () => menuRef.current?.cancel(),
    actionLabel: 'けってい',
    cancelLabel: 'もどる',
  } : null;

  return (
    <FieldScreen
      map={fieldMap}
      spawn={place.spawn}
      onEvent={handleFieldEvent}
      title={inDungeon ? run.dungeon.name : fieldMap.label}
      subtitle={inDungeon ? `地下${place.floorIndex + 1}階 / 全${run.floors}階` : null}
      extraChip={(
        <>
          {/* 所持金。町にいるあいだ出しておく。ダンジョンでは画面の情報を
              増やしたくないので出さない(宝箱を開けたときに額は伝わる)。 */}
          {place.kind === 'town' && (
            <span className="fld-chip fld-chip--gold">
              <img src="/assets/ui/gold.png" alt="" />
              {formatGold(gold)} G
            </span>
          )}
          {inDungeon && run.holySteps > 0 && (
            <span className="fld-chip fld-chip--holy">せいすい 残り{run.holySteps}歩</span>
          )}
        </>
      )}
      topButtons={topButtons}
      message={fieldMessage}
      panel={itemPanel}
      overlay={menuOpen ? <FieldMenu ref={menuRef} onClose={() => setMenuOpen(false)} /> : null}
      controls={menuControls}
      flash={flash}
    />
  );
}

/**
 * いちばん外側。
 *
 * 起動するとまず表紙 (TitleScreen) が出て、遊ぶセーブ枠が決まってから
 * ゲーム本体を組み立てる。
 *
 * key={slot} が要点。枠を変えるということは、保存された値を読み直す
 * ということなので、GameStoreProvider を **作り直す** 必要がある
 * (localStorage を読むのは useState の初期化子で、mount のとき1回きり)。
 */
export default function App() {
  // null = まだ枠が決まっていない = 表紙。
  const [slot, setSlot] = useState(null);

  if (slot == null) return <TitleScreen onPlay={setSlot} />;

  return (
    <GameStoreProvider key={slot} slot={slot}>
      <AppInner />
      {/* 検証用。本番ビルドでは丸ごと消える。 */}
      {import.meta.env.DEV && <DebugMenu />}
    </GameStoreProvider>
  );
}
