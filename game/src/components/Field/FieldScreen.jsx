// FieldScreen.jsx
// 歩けるマップの画面。MapScene(Phaser) と、その上に重ねる操作UIを持つ。
//
// レイアウトは BattleScreen と同じ「キャンバスが画面全部、UIはその上」。
// 縦に積むものが無いので 844x390(スマホ横) でもページのスクロールバーが出ない。
//
// 操作は2系統を必ず両方用意する:
//   キーボード … 矢印/WASD で移動、スペース/Enter/Z で決定 (MapScene が直接読む)
//   タッチ    … 左下の十字キーと右下の丸ボタン (このファイル)
// 十字キーは「押した場所からの向き」で判定するので、置いた親指を
// ずらすだけで進む向きを変えられる。マスを狙って踏む操作(扉・階段)は
// ドラッグ移動より十字キーのほうが確実なので、こちらを選んだ。
//
// v0.7 で「メニュー」(つよさ/どうぐ/とくぎ/さくせん)が乗った。
// メニューは主人公を歩かせないが、十字キーと決定ボタンは **使い続けたい**
// (スマホでキーボードは無い)。そこで controls プロップを足してある:
//   controls = { onPad(dir), onAction(), onCancel(), actionLabel, cancelLabel }
// これが渡っているあいだ、十字キーと決定ボタンの行き先が
// MapScene から controls へ切り替わる。押しっぱなしで連続入力しないよう、
// 向きは「押し始めの1回」だけ流す(メニューのカーソルが飛んでいかない)。

import { useCallback, useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { MapScene } from '../../scenes/MapScene.js';
import './fieldUI.css';

/** 十字キーの中心からこの割合より内側は「入力なし」にする。 */
const PAD_DEADZONE = 0.22;

export default function FieldScreen({
  map,
  spawn,
  onEvent,
  title,
  subtitle,
  extraChip,
  topButtons = [],
  // { name, text, icon, choices:[{label, primary, onSelect}] }
  // icon は任意のReactノード。宝箱や床の拾いもので「何が手に入ったか」を
  // 文より先に見せるために使う。
  message = null,
  panel = null,        // 任意のReactノード(どうぐ欄など)。出ているあいだ操作系は隠す
  // メニューのように「十字キーを使い続ける」重ねもの。操作系は隠さない。
  overlay = null,
  // 十字キー/決定ボタンの行き先を差し替える(メニューを開いているとき)。
  controls = null,
  flash = false,
}) {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const sceneRef = useRef(null);
  const eventRef = useRef(onEvent);
  eventRef.current = onEvent;
  const controlsRef = useRef(controls);
  controlsRef.current = controls;

  const [padDir, setPadDir] = useState(null);
  const padRef = useRef(null);
  const pointerIdRef = useRef(null);

  // 直前の向き。setPadDir の更新関数の中で見てしまうと、
  // 「レンダリング中に別のコンポーネント(メニュー)のstateを更新した」に
  // なってしまうので、ref で持つ。
  const lastDirRef = useRef(null);

  // マップ画面のあいだはページ自体をスクロールさせない
  useEffect(() => {
    document.documentElement.classList.add('mrg-field-lock');
    return () => document.documentElement.classList.remove('mrg-field-lock');
  }, []);

  // Phaser は1回だけ作る。マップの差し替えはシーンの再スタートで行う
  // (作り直すと読み込んだ画像テクスチャを毎回捨てることになる)。
  useEffect(() => {
    if (!containerRef.current || gameRef.current) return undefined;
    const scene = new MapScene();
    sceneRef.current = scene;
    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      backgroundColor: '#0b0e18',
      pixelArt: true,
      roundPixels: true,
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      scene: [scene],
    });
    // 検証用の取っ手。本番ビルドでは丸ごと消える。
    // シーンの取っ手(window.__mrgScene)は create() が走ってからでないと
    // 生えないが、その create() 自体がゲームループの中で起きる。
    // ループが止まる環境(タブが裏など)から手で回すには、ここが要る。
    if (import.meta.env.DEV) window.__mrgGame = gameRef.current;

    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || !rect.width || !rect.height) return;
      gameRef.current?.scale.resize(rect.width, rect.height);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, []);

  // マップ/出現位置が変わったらシーンを入れ直す。
  const mapId = map?.id;
  const spawnKey = spawn ? `${spawn.x},${spawn.y},${spawn.facing}` : '';
  useEffect(() => {
    const game = gameRef.current;
    if (!game || !map || !spawn) return;
    game.scene.start('MapScene', {
      map,
      spawn,
      onEvent: (type, payload) => eventRef.current?.(type, payload),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, spawnKey]);

  // メッセージ・どうぐ欄・メニューを開いているあいだは歩かせない。
  // メニュー(controls)のときは十字キーと決定ボタンを残す — 行き先だけ変える。
  const locked = !!message || !!panel || !!controls;
  const padToMenu = !!controls;
  const hideControls = !!message || !!panel;
  useEffect(() => {
    sceneRef.current?.setInputLocked(locked);
    if (locked) {
      setPadDir(null);
      lastDirRef.current = null;
      pointerIdRef.current = null;
    }
  }, [locked]);

  const applyDir = useCallback((dir) => {
    const sink = controlsRef.current;
    if (sink) {
      // メニューは「押し始めの1回」だけ流す。押しっぱなしでカーソルが
      // 飛んでいくと、選びたい項目に止められない。
      if (dir && dir !== lastDirRef.current) sink.onPad?.(dir);
    } else {
      sceneRef.current?.setPad(dir);
    }
    lastDirRef.current = dir;
    setPadDir(dir);
  }, []);

  /** ポインタの位置から向きを出す。押しっぱなしのままずらしても切り替わる。 */
  const dirFromPointer = useCallback((e) => {
    const el = padRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    if (Math.hypot(dx, dy) < PAD_DEADZONE) return null;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }, []);

  function onPadDown(e) {
    if (hideControls) return;
    e.preventDefault();
    pointerIdRef.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    applyDir(dirFromPointer(e));
  }

  function onPadMove(e) {
    if (pointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    applyDir(dirFromPointer(e));
  }

  function onPadUp(e) {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    applyDir(null);
  }

  function pressAction() {
    if (controlsRef.current) controlsRef.current.onAction?.();
    else sceneRef.current?.pressAction();
  }

  // メッセージが出ているあいだはキーボードでも選べるようにする
  useEffect(() => {
    if (!message) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        const cancel = message.choices?.find((c) => c.cancel);
        cancel?.onSelect?.();
        return;
      }
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        const primary = message.choices?.find((c) => c.primary) || message.choices?.[0];
        primary?.onSelect?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [message]);

  const padKey = (dir, glyph) => (
    <div className={`fld-pad-key${padDir === dir ? ' fld-pad-key--on' : ''}`}>{glyph}</div>
  );

  return (
    <div className="fld">
      <div className="fld-canvas" ref={containerRef} />

      <div className="fld-topbar">
        <span className="fld-chip">{title}</span>
        {subtitle && <span className="fld-chip fld-chip--sub">{subtitle}</span>}
        {extraChip}
        {topButtons.length > 0 && (
          <span className="fld-topbar-right">
            {topButtons.map((b) => (
              <button key={b.label} className="jrpg-btn fld-tbtn" onClick={b.onClick}>
                {b.label}
              </button>
            ))}
          </span>
        )}
      </div>

      {!hideControls && (
        <div
          className="fld-pad"
          ref={padRef}
          onPointerDown={onPadDown}
          onPointerMove={onPadMove}
          onPointerUp={onPadUp}
          onPointerCancel={onPadUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="fld-pad-key fld-pad-key--blank" />
          {padKey('up', '▲')}
          <div className="fld-pad-key fld-pad-key--blank" />
          {padKey('left', '◀')}
          <div className="fld-pad-hub" />
          {padKey('right', '▶')}
          <div className="fld-pad-key fld-pad-key--blank" />
          {padKey('down', '▼')}
          <div className="fld-pad-key fld-pad-key--blank" />
        </div>
      )}

      {!hideControls && (
        <div className="fld-actions">
          <button className="fld-abtn" onPointerDown={(e) => { e.preventDefault(); pressAction(); }}>
            {controls?.actionLabel || 'しらべる'}
          </button>
          {padToMenu && (
            <button
              className="fld-abtn fld-abtn--small"
              onPointerDown={(e) => { e.preventDefault(); controlsRef.current?.onCancel?.(); }}
            >
              {controls?.cancelLabel || 'もどる'}
            </button>
          )}
        </div>
      )}

      {panel}
      {overlay}

      {message && (
        <div className="fld-msg jrpg-win">
          {message.name && <div className="fld-msg-name">{message.name}</div>}
          <div className="fld-msg-body">
            {message.icon && <span className="fld-msg-icon">{message.icon}</span>}
            <span>{message.text}</span>
          </div>
          <div className="fld-msg-row">
            {(message.choices || []).map((c) => (
              <button
                key={c.label}
                className={`jrpg-btn${c.primary ? ' jrpg-btn--primary' : ''}`}
                onClick={c.onSelect}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {flash && <div className="fld-flash" />}
    </div>
  );
}
