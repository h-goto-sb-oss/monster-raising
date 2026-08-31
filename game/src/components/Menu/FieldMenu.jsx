// FieldMenu.jsx
// フィールド(まち・ダンジョン)から開くメニュー。項目は4つだけ:
//
//   つよさ   … 1体のステータスと おぼえた とくぎ。
//              ページを めくると 家系図(親→祖父母→曽祖父母)。
//   どうぐ   … ふくろ。町の「どうぐ」と同じ画面(ItemBag)をそのまま出す。
//   とくぎ   … おぼえている とくぎ と、継承わくの「まだ覚えていない技」。
//   さくせん … 戦闘AIのプリセット。ここで決めたものが個体に残り、
//              次の戦闘の初期値になる (gameStore.setTactic)。
//
// 操作は十字キー・タッチ・キーボードの3つとも同じ理屈で動く:
//   上下     … いま光っている段の中を移動
//   右 / 決定 … ひとつ右の段へ / その行を実行
//   左 / もどる … ひとつ左の段へ。いちばん左でメニューを閉じる
// 十字キーと決定ボタンは FieldScreen のものをそのまま使う(controls プロップ)。
// メニュー用に別のボタンを画面へ増やすと、親指の置き場所が変わってしまう。

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useGameStore } from '../../state/gameStore.js';
import { getTacticsList } from '../../engine/battle/ai.js';
import { expToNextLevel, MAX_LEVEL } from '../../engine/growth.js';
import { ancestryState } from '../../engine/instance.js';
import { skillFacts } from '../../engine/skills.js';
import { ANCESTRY_DEPTH } from '../../engine/inherit.js';
import ItemBag from '../Town/ItemBag.jsx';
import './menuUI.css';

const SECTIONS = [
  { id: 'power', label: 'つよさ' },
  { id: 'items', label: 'どうぐ' },
  { id: 'skills', label: 'とくぎ' },
  { id: 'tactics', label: 'さくせん' },
];

const STAT_LABELS = [
  ['hp', 'HP'],
  ['mp', 'MP'],
  ['atk', 'こうげき'],
  ['def', 'ぼうぎょ'],
  ['int', 'かしこさ'],
  ['spd', 'すばやさ'],
];

/** 家系図の世代の呼び名。ANCESTRY_DEPTH ぶんだけ使う。 */
const GENERATION_LABELS = ['親', '祖父母', '曽祖父母', '高祖父母'];

const clampIdx = (i, n) => (n <= 0 ? 0 : Math.max(0, Math.min(n - 1, i)));

/* ---------------------------------------------------------------- 家系図 */

/**
 * 家系図の1件。ancestry のノードは配合したときの値のコピーなので、
 * 親が牧場から居なくなっていても、そのまま読める。
 */
function TreeNode({ node, depth, rosterById }) {
  const gen = GENERATION_LABELS[depth] || `${depth + 1}代前`;
  if (!node) {
    return (
      <li className="mnu-treenode">
        <div className="mnu-treecard mnu-treecard--unknown">
          <span className="mnu-treegen">{gen}</span>
          <span className="mnu-treename">記録なし</span>
        </div>
      </li>
    );
  }
  const species = rosterById[node.speciesId];
  return (
    <li className="mnu-treenode">
      <div className="mnu-treecard">
        {species && <img src={species.spriteUrl} alt="" />}
        <span className="mnu-treegen">{gen}</span>
        <span className="mnu-treename">{node.name}</span>
        <span className="mnu-treemeta">Lv{node.level}</span>
      </div>
      {node.parents && (
        <ul className="mnu-treekids">
          {node.parents.map((child, i) => (
            <TreeNode key={i} node={child} depth={depth + 1} rosterById={rosterById} />
          ))}
        </ul>
      )}
    </li>
  );
}

function FamilyTree({ instance, species, name, rosterById }) {
  const state = ancestryState(instance);
  return (
    <div className="mnu-tree">
      <div className="mnu-treeself">
        {species && <img src={species.spriteUrl} alt="" />}
        <b>{name}</b>
        <span className="mnu-treemeta">Lv{instance.level}</span>
      </div>

      {state === 'tree' && (
        <ul className="mnu-treekids">
          {instance.ancestry.map((node, i) => (
            <TreeNode key={i} node={node} depth={0} rosterById={rosterById} />
          ))}
        </ul>
      )}

      {state === 'wild' && (
        <div className="mnu-notice">
          この子には <b>親の記録が ありません</b>。
          野生で なかまに なったか、はじまりの1体です。
          配合で 生まれた子には、ここに 家系図が 出ます。
        </div>
      )}

      {state === 'lost' && (
        <div className="mnu-notice">
          配合で 生まれた記録は ありますが、<b>家系図が 残っていません</b>。
          家系図を つける前の 配合で 生まれた子です。
          親は 配合のときに 牧場から いなくなるので、あとから たどることは できません。
          これから 行う 配合には、家系図が {ANCESTRY_DEPTH}代前まで 残ります。
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ 詳細ページ */

function PowerDetail({ view, page, skillsById, rosterById }) {
  if (!view) return <div className="mnu-empty">モンスターを えらんでください。</div>;
  const { instance, species, name } = view;
  if (page === 'tree') {
    return <FamilyTree instance={instance} species={species} name={name} rosterById={rosterById} />;
  }
  const need = expToNextLevel(instance.level, species.star);
  const learned = (instance.learned || []).map((id) => skillsById[id]).filter(Boolean);
  return (
    <>
      <div className="mnu-idhead">
        <img src={species.spriteUrl} alt="" />
        <div style={{ minWidth: 0 }}>
          <div className="mnu-idname">{name}</div>
          <div className="mnu-idmeta">
            {species.type} / ★{species.star} / Lv {instance.level}
            {instance.level < MAX_LEVEL && `（つぎまで ${Math.max(0, need - instance.exp)}）`}
          </div>
        </div>
      </div>
      <div className="mnu-stats">
        {STAT_LABELS.map(([k, label]) => (
          <div key={k} className="mnu-stat">
            <b>{label}</b>
            <span>
              {instance.stats[k]} <i>個体値{instance.iv?.[k] ?? '-'}</i>
            </span>
          </div>
        ))}
      </div>
      <div className="mnu-sub">おぼえている とくぎ（{learned.length}）</div>
      {learned.length === 0 && <div className="mnu-empty">まだ ありません。</div>}
      {learned.map((s) => (
        // 説明文は「とくぎ」の段に出す。つよさは ひと目で見渡す場所なので、
        // ここは名前と要点だけにして行数を増やさない。
        <div key={s.id} className="mnu-line" title={s.description}>
          <span>・{s.name}</span>
          <span>{s.element ? `${s.type}・${s.element}` : s.type}／MP{s.mpCost}</span>
        </div>
      ))}
    </>
  );
}

/**
 * とくぎ1つぶんの札。
 *   1行目 … 名前（ランク） と 右肩の但し書き(継承わくなら「Lv n で おぼえる」)
 *   2行目 … 要点の札 (種別・属性 / 威力 / MP / 対象)
 *   3行目 … skills.json の説明文
 *
 * 説明文は182本すべてに入っているのに、これまでは title 属性(マウスを
 * 乗せたときの吹き出し)にしか出しておらず、**スマホでは読む手段が無かった**
 * (「とくぎの内容は作成されてないかな？」— 博史さん)。指で遊ぶ画面なので、
 * 隠さず並べて出す。
 */
function SkillCard({ skill, note, inherit }) {
  return (
    <div className={`mnu-skill${inherit ? ' mnu-skill--inherit' : ''}`}>
      <div className="mnu-skillhead">
        <span className="mnu-skillname">
          {skill.name}{skill.line ? `（ランク${skill.rank}）` : ''}
        </span>
        {note && <span className="mnu-skillnote">{note}</span>}
      </div>
      <div className="mnu-skillfacts">
        {skillFacts(skill).map((f) => <i key={f}>{f}</i>)}
      </div>
      <div className="mnu-skilldesc">{skill.description}</div>
    </div>
  );
}

function SkillDetail({ view, skillsById }) {
  if (!view) return <div className="mnu-empty">モンスターを えらんでください。</div>;
  const { instance, name } = view;
  const learned = (instance.learned || []).map((id) => skillsById[id]).filter(Boolean);
  const inherited = (instance.inherited || [])
    .map((e) => ({ ...e, skill: skillsById[e.skillId] }))
    .filter((e) => e.skill)
    .sort((a, b) => a.learnLevel - b.learnLevel);
  return (
    <>
      <div className="mnu-idname" style={{ fontSize: 'var(--fs-sm)' }}>{name}</div>
      <div className="mnu-sub">おぼえている とくぎ（{learned.length}）</div>
      {learned.length === 0 && <div className="mnu-empty">まだ ありません。</div>}
      {learned.map((s) => (
        <SkillCard key={s.id} skill={s} />
      ))}

      <div className="mnu-sub mnu-sub--inherit">
        けいしょうわく・みしゅうとく（{inherited.length}）
      </div>
      {inherited.length === 0 && (
        <div className="mnu-empty">
          ありません。配合で 生まれた子には、親から受けついだ 習得予約が 入ります。
        </div>
      )}
      {inherited.map((e) => (
        <SkillCard
          key={e.skillId}
          skill={e.skill}
          note={`Lv ${e.learnLevel} で おぼえる`}
          inherit
        />
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ 本体 */

const FieldMenu = forwardRef(function FieldMenu({ onClose }, ref) {
  const {
    ownedView, party, rosterById, skillsById, setTactic, setTacticForParty,
  } = useGameStore();

  const [section, setSection] = useState(null);   // null | power | items | skills | tactics
  const [zone, setZone] = useState('root');       // root | list | detail
  const [rootIdx, setRootIdx] = useState(0);
  const [listIdx, setListIdx] = useState(0);
  const [detailIdx, setDetailIdx] = useState(0);
  const [page, setPage] = useState('stats');      // つよさのページ: stats | tree

  const tactics = useMemo(() => getTacticsList(), []);

  // 手持ち(★)を先に並べる。まず見たいのはパーティーの3体なので。
  const monsters = useMemo(() => {
    const inParty = ownedView.filter((v) => party.includes(v.instance.uid));
    const rest = ownedView.filter((v) => !party.includes(v.instance.uid));
    return [...inParty, ...rest];
  }, [ownedView, party]);

  /**
   * まん中の段に並べる行。
   *   つよさ   … [ページ切替, モンスター…]
   *   とくぎ   … [モンスター…]
   *   さくせん … [パーティー全員, モンスター…]
   * 先頭の特別な行があるぶんだけ、モンスターの添字がずれる。
   */
  const listOffset = section === 'power' || section === 'tactics' ? 1 : 0;
  const listLength = monsters.length + listOffset;

  /** いま詳細に出しているモンスター。カーソルを動かすだけで切り替わる。 */
  const isSpecialRow = listIdx < listOffset;
  // 「けっとうを 見る」の行にカーソルが乗っているあいだは、
  // 直前に見ていた個体を出しつづける。素直に listIdx から引くと
  // 一覧の先頭の子に飛んでしまい、見ていた子のけっとうが見られない。
  const lastMonIdx = useRef(0);
  if (!isSpecialRow) lastMonIdx.current = clampIdx(listIdx - listOffset, monsters.length);
  const monIdx = isSpecialRow
    ? clampIdx(lastMonIdx.current, monsters.length)
    : clampIdx(listIdx - listOffset, monsters.length);
  const view = monsters[monIdx] || null;

  // さくせんだけ、いちばん右の段も選べる(作戦の一覧)。
  const detailSelectable = section === 'tactics';
  const detailLength = tactics.length + 1; // 先頭が「せいぎょする」

  const applyTactic = useCallback((tacticId) => {
    if (isSpecialRow) setTacticForParty(tacticId);
    else if (view) setTactic(view.instance.uid, tacticId);
  }, [isSpecialRow, view, setTactic, setTacticForParty]);

  const zoneLength = zone === 'root' ? SECTIONS.length + 1
    : zone === 'list' ? listLength
      : detailLength;

  const move = useCallback((dir) => {
    if (dir === 'up' || dir === 'down') {
      const step = dir === 'down' ? 1 : -1;
      const set = zone === 'root' ? setRootIdx : zone === 'list' ? setListIdx : setDetailIdx;
      set((i) => clampIdx(i + step, zoneLength));
      return;
    }
    if (dir === 'right') {
      if (zone === 'root' && section) setZone('list');
      else if (zone === 'list' && detailSelectable) setZone('detail');
      return;
    }
    if (dir === 'left') {
      if (zone === 'detail') setZone('list');
      else if (zone === 'list') setZone('root');
    }
  }, [zone, zoneLength, section, detailSelectable]);

  const openSection = useCallback((id) => {
    setSection(id);
    setZone(id === 'items' ? 'root' : 'list');
    setListIdx(0);
    setDetailIdx(0);
    setPage('stats');
  }, []);

  const activate = useCallback(() => {
    if (zone === 'root') {
      if (rootIdx >= SECTIONS.length) { onClose(); return; }
      openSection(SECTIONS[rootIdx].id);
      return;
    }
    if (zone === 'list') {
      // 先頭の特別な行だけ「押して効く」。モンスターの行は
      // カーソルを合わせた時点で右の段に出ているので、押す必要がない。
      if (section === 'power' && isSpecialRow) {
        setPage((p) => (p === 'stats' ? 'tree' : 'stats'));
        return;
      }
      if (detailSelectable) setZone('detail');
      return;
    }
    if (zone === 'detail' && section === 'tactics') {
      applyTactic(detailIdx === 0 ? null : tactics[detailIdx - 1]?.id ?? null);
    }
  }, [zone, rootIdx, section, isSpecialRow, detailSelectable, detailIdx, tactics, applyTactic, onClose, openSection]);

  const cancel = useCallback(() => {
    if (zone === 'detail') { setZone('list'); return; }
    if (section) { setSection(null); setZone('root'); return; }
    onClose();
  }, [zone, section, onClose]);

  // FieldScreen の十字キー / 決定ボタン / もどるボタンから叩かれる口。
  useImperativeHandle(ref, () => ({ pad: move, action: activate, cancel }), [move, activate, cancel]);

  // キーボード。矢印はメニュー、決定はスペース/Enter/Z、取り消しは Esc/X。
  // MapScene も同じキーを見ているが、メニュー中は入力がロックされているので
  // 主人公は動かない (FieldScreen の locked)。
  useEffect(() => {
    const onKey = (e) => {
      const dir = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
      if (dir) { e.preventDefault(); move(dir); return; }
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        activate();
        return;
      }
      if (e.key === 'Escape' || e.key === 'x' || e.key === 'X') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, activate, cancel]);

  // どうぐは町の「どうぐ」とまったく同じ画面をそのまま出す。
  // 同じ機能の画面を2つ持つと、必ず片方だけ直し忘れる。
  if (section === 'items') {
    return <ItemBag onBack={() => { setSection(null); setZone('root'); }} />;
  }

  const rowClass = (z, i, extra = '') => [
    'jrpg-btn',
    'jrpg-btn--wide',
    extra,
    zone === z && (zone === 'root' ? rootIdx : zone === 'list' ? listIdx : detailIdx) === i
      ? 'jrpg-btn--cursor'
      : '',
  ].filter(Boolean).join(' ');

  const currentTactic = isSpecialRow ? undefined : view?.instance.tactic ?? null;

  return (
    <div className="mnu jrpg-win">
      {/* --- さくいん --- */}
      <div className={`mnu-col mnu-col--index${zone === 'root' ? ' mnu-col--focus' : ''}`}>
        <div className="mnu-head">メニュー</div>
        <div className="mnu-scroll jrpg-scroll">
          {SECTIONS.map((s, i) => (
            <button
              key={s.id}
              className={rowClass('root', i, section === s.id ? 'jrpg-btn--on' : '')}
              onClick={() => { setRootIdx(i); setZone('root'); openSection(s.id); }}
            >
              {s.label}
            </button>
          ))}
          <button
            className={rowClass('root', SECTIONS.length, 'jrpg-btn--back')}
            onClick={onClose}
          >
            とじる
          </button>
        </div>
      </div>

      {/* --- 一覧 --- */}
      {section && (
        <div className={`mnu-col mnu-col--list${zone === 'list' ? ' mnu-col--focus' : ''}`}>
          <div className="mnu-head">
            {section === 'tactics' ? 'だれの さくせん' : 'モンスター'}
          </div>
          <div className="mnu-scroll jrpg-scroll">
            {section === 'power' && (
              <button
                className={rowClass('list', 0, 'jrpg-btn--on')}
                // ページを入れ替えるだけ。listIdx は動かさない。
                // 0 に戻すと monIdx も 0 になり、いま見ていた個体を見失って
                // 一覧の先頭の子のけっとうが出てしまう。
                onClick={() => { setZone('list'); setPage((p) => (p === 'stats' ? 'tree' : 'stats')); }}
              >
                {page === 'stats' ? 'けっとうを 見る' : 'ステータスへ'}
              </button>
            )}
            {section === 'tactics' && (
              <button
                className={rowClass('list', 0)}
                onClick={() => { setListIdx(0); setZone('list'); }}
              >
                パーティー全員
              </button>
            )}
            {monsters.map((v, i) => (
              <button
                key={v.instance.uid}
                className={rowClass(
                  'list',
                  i + listOffset,
                  `mnu-mon${party.includes(v.instance.uid) ? ' mnu-mon--party' : ''}${v.instance.hp <= 0 ? ' mnu-mon--down' : ''}`,
                )}
                onClick={() => { setListIdx(i + listOffset); setZone('list'); }}
              >
                <img src={v.species.spriteUrl} alt="" />
                <span className="mnu-monname">{v.name}</span>
                <span className="mnu-monlv">Lv{v.instance.level}</span>
              </button>
            ))}
            {monsters.length === 0 && <div className="mnu-empty">モンスターが いません。</div>}
          </div>
        </div>
      )}

      {/* --- 詳細 --- */}
      {section && (
        <div className={`mnu-col mnu-col--detail${zone === 'detail' ? ' mnu-col--focus' : ''}`}>
          <div className="mnu-head">
            {section === 'power' && (page === 'stats' ? 'つよさ' : `けっとう（${ANCESTRY_DEPTH}代前まで）`)}
            {section === 'skills' && 'とくぎ'}
            {section === 'tactics' && (isSpecialRow ? 'さくせん（全員）' : `さくせん（${view?.name ?? ''}）`)}
          </div>

          {section === 'power' && (
            <div className="mnu-detail jrpg-scroll">
              <PowerDetail view={view} page={page} skillsById={skillsById} rosterById={rosterById} />
            </div>
          )}

          {section === 'skills' && (
            <div className="mnu-detail jrpg-scroll">
              <SkillDetail view={view} skillsById={skillsById} />
            </div>
          )}

          {section === 'tactics' && (
            <div className="mnu-scroll jrpg-scroll">
              <button
                className={rowClass('detail', 0, currentTactic === null ? 'jrpg-btn--on' : '')}
                onClick={() => { setDetailIdx(0); setZone('detail'); applyTactic(null); }}
              >
                せいぎょする（手動）
              </button>
              {tactics.map((t, i) => (
                <button
                  key={t.id}
                  className={rowClass('detail', i + 1, currentTactic === t.id ? 'jrpg-btn--on' : '')}
                  title={t.description}
                  onClick={() => { setDetailIdx(i + 1); setZone('detail'); applyTactic(t.id); }}
                >
                  {t.label}
                </button>
              ))}
              <div className="mnu-empty" style={{ marginTop: 4 }}>
                ここで きめた さくせんは その子が おぼえていて、つぎの戦闘の
                はじめの ふるまいに なります。
              </div>
            </div>
          )}
        </div>
      )}

      {!section && (
        <div className="mnu-col mnu-col--detail">
          <div className="mnu-head">えらんでください</div>
          <div className="mnu-detail">
            <div className="mnu-empty">
              つよさ … ステータスと おぼえた とくぎ。ページを めくると 家系図。<br />
              どうぐ … ふくろの 中身。<br />
              とくぎ … おぼえた とくぎの 説明と、けいしょうわくの 習得予約。<br />
              さくせん … 戦闘での ふるまい。<br />
              <span className="mnu-keys">
                十字キー: 上下でえらぶ／右ですすむ／左でもどる　決定: しらべる・Z・Enter
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default FieldMenu;
