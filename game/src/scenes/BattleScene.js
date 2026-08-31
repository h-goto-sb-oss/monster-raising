// BattleScene.js
// 戦闘画面のキャンバス。ビューポート全体を占める「フルブリード」表示で、
// 背景画・モンスター・敵のHPバー・ターゲット選択のあたり判定までを受け持つ。
//
// レイアウト方針 (横画面・スマホ対応):
//   - Phaser.Scale.RESIZE で「親要素の実サイズ = キャンバスの論理サイズ」にする。
//     固定解像度を FIT で縮めると余白(レターボックス)が出るし、
//     UIをキャンバスの下に積むと縦が足りなくなる。ここでは画面全部を絵に使い、
//     ステータス/ログ/コマンドは React 側が **上に重ねる**。
//   - 背景は cover フィット(はみ出しは切る)。レターボックスは作らない。
//   - モンスターは高さ比で大きさを決めるので、どの画面サイズでも同じ見え方になる。
//   - 敵は上段・小さめ、味方は下段・大きめ。列の中央ほど手前(大きく低い位置)に
//     置いて、平らな2列ではなく奥行きに見えるようにする。
//
// React との連携:
//   scene.onTargetPick = (instanceId) => ...   スプライトのクリック
//   scene.updateFromState(state, { targetableIds, activeActorId })  毎描画で呼ぶ
//
// 素材メモ: モンスターのPNGは300x300で周囲に透明の余白がある。
// そのまま表示すると「枠の中で小さい」ので、読み込み後にアルファの外接矩形を
// 計算して trim フレームを作り、実画素いっぱいに表示している。

import Phaser from 'phaser';
import { ailmentList, modList } from '../engine/battle/ailments.js';

/** 背景画像の元サイズ。cover フィットの計算に使う。 */
const BG_NATIVE = { width: 1024, height: 768 };

/** 透明余白を切り落とした表示用フレーム名。 */
const TRIM_FRAME = '__trim';

/**
 * キャンバスに直接描く文字の書体。
 * index.css の --font-display と同じ並び(CSS変数はキャンバスから引けない)。
 * 敵の名前とレベル、とび出るダメージ数字はドット絵の一部として見せたいので、
 * 本文用ではなく見出し用のビットマップ体を使う。
 * Webフォントは読み込みが1テンポ遅れるので、create() で
 * document.fonts.ready を待って layout() をやり直す(文字幅が変わるため)。
 */
const CANVAS_FONT = '"DotGothic16", "Zen Kaku Gothic New", "Yu Gothic", "Meiryo", sans-serif';

/**
 * モンスターの表示高さ。「UIに食われていない縦の余地」に対する比率。
 * 画面の高さそのものではなく playfield の高さを基準にしているので、
 * 下の状態帯が厚くなっても、モンスターが帯へ食い込まずに縮む。
 */
const SIZE_RATIO = { enemy: 0.30, player: 0.335 };

/** モンスターの大きさの上限(画面の高さに対する比率)。広い画面で巨大化させない。 */
const SIZE_CAP = { enemy: 0.25, player: 0.28 };

/** てきの列を playfield のどこに立たせるか(0=上端, 1=下端)。 */
const ENEMY_BASE_RATIO = 0.62;

/**
 * テクスチャのアルファ外接矩形を求めて trim フレームを足す。
 * 既に作ってあれば何もしない。失敗したら null を返す(= 元フレームを使う)。
 */
function ensureTrimFrame(scene, key) {
  const tex = scene.textures.get(key);
  if (!tex) return null;
  if (tex.has(TRIM_FRAME)) return TRIM_FRAME;
  let data;
  let cw;
  let ch;
  try {
    const src = tex.getSourceImage();
    cw = src.width;
    ch = src.height;
    if (!cw || !ch) return null;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0);
    data = ctx.getImageData(0, 0, cw, ch).data;
  } catch {
    return null; // CORS等で読めない場合は素直にあきらめる
  }
  let minX = cw;
  let minY = ch;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < ch; y += 1) {
    for (let x = 0; x < cw; x += 1) {
      if (data[(y * cw + x) * 4 + 3] > 12) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  tex.add(TRIM_FRAME, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
  return TRIM_FRAME;
}

export class BattleScene extends Phaser.Scene {
  constructor() {
    super('BattleScene');
    this.spriteMap = {}; // instanceId -> 表示物一式
    this.getBattleState = null;
    this.backgroundKey = null;
    this.backgroundUrl = null;
    this.onTargetPick = null; // React 側が差し込むクリックハンドラ
    this.targetableIds = [];
    this.activeActorId = null;
    this.ready = false;
    // 重ねたUIが画面から食っている量。BattleScreen が DOM を実測して渡す。
    // 既定値は「まだ測っていない」= 何も食われていない。
    this.uiInsets = { bottom: 0, right: 0 };
  }

  init(data) {
    this.getBattleState = data.getBattleState;
    this.backgroundUrl = data.backgroundUrl || null;
  }

  /**
   * 重ねたUIの実寸を受け取る (BattleScreen.jsx が ResizeObserver で測る)。
   * ここを CSS と二重に書かないのが肝心なところ。書き写すと必ずずれて、
   * なかまのモンスターが状態帯の裏に隠れる。
   * @param {{bottom:number, right:number}} insets
   */
  setUiInsets(insets) {
    const bottom = Math.max(0, insets?.bottom ?? 0);
    const right = Math.max(0, insets?.right ?? 0);
    if (bottom === this.uiInsets.bottom && right === this.uiInsets.right) return;
    this.uiInsets = { bottom, right };
    this.layout();
  }

  preload() {
    if (this.backgroundUrl) {
      this.backgroundKey = `bg:${this.backgroundUrl}`;
      if (!this.textures.exists(this.backgroundKey)) {
        this.load.image(this.backgroundKey, this.backgroundUrl);
      }
    }
    const state = this.getBattleState ? this.getBattleState() : null;
    if (!state) return;
    [...state.playerParty, ...state.enemyParty].forEach((c) => {
      if (!this.textures.exists(c.monsterId)) {
        this.load.image(c.monsterId, c.spriteUrl);
      }
    });
  }

  create() {
    const state = this.getBattleState ? this.getBattleState() : null;

    // 背景。読み込みに失敗しても真っ黒にならないよう、下に単色を敷いておく。
    this.fallbackBg = this.add.rectangle(0, 0, 10, 10, 0x1b2436).setOrigin(0, 0).setDepth(-20);
    if (this.backgroundKey && this.textures.exists(this.backgroundKey)) {
      this.bgImage = this.add.image(0, 0, this.backgroundKey).setOrigin(0.5, 0.5).setDepth(-10);
    }
    // 上下にごく薄い暗幕を敷いて、重ねるUIの文字が背景に負けないようにする。
    this.vignette = this.add.graphics().setDepth(-5);

    if (state) {
      this.buildRow(state.enemyParty, false);
      this.buildRow(state.playerParty, true);
    }

    this.ready = true;
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });

    this.layout();
    if (state) this.updateFromState(state, {});

    // Webフォントが遅れて届くと文字幅が変わり、名前の中央そろえがずれる。
    // 届いたら1回だけ並べ直す。
    if (document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (this.ready && this.scene.isActive()) this.layout();
      }).catch(() => {});
    }
  }

  /** 1体ぶんの表示物(影/スプライト/HPバー/名前/状態タグ)をまとめて作る。 */
  buildRow(party, isPlayer) {
    party.forEach((c, index) => {
      const frame = this.textures.exists(c.monsterId) ? ensureTrimFrame(this, c.monsterId) : null;
      const shadow = this.add.ellipse(0, 0, 10, 4, 0x000000, 0.3).setDepth(isPlayer ? 8 : 4);
      // 選択できる相手の足元に出す光の輪。塗り+縁取りの両方を付けて、
      // 背景画(草地など)の上でも確実に見えるようにする。
      const ring = this.add.ellipse(0, 0, 10, 4, 0xffd24d, 0.3)
        .setStrokeStyle(3, 0xfff0b0, 1)
        .setDepth(isPlayer ? 9 : 5);
      ring.setVisible(false);

      let image;
      if (this.textures.exists(c.monsterId)) {
        image = frame
          ? this.add.image(0, 0, c.monsterId, frame)
          : this.add.image(0, 0, c.monsterId);
      } else {
        image = this.add.rectangle(0, 0, 64, 64, isPlayer ? 0x4477ff : 0xff5555);
      }
      image.setOrigin(0.5, 1); // 足元基準。行の「地面」をそろえるため。
      image.setDepth(isPlayer ? 10 : 6);
      image.setInteractive({ useHandCursor: false });
      image.on('pointerdown', () => {
        if (this.targetableIds.includes(c.instanceId)) this.onTargetPick?.(c.instanceId);
      });
      image.on('pointerover', () => {
        const entry = this.spriteMap[c.instanceId];
        if (entry) entry.hovered = true;
        this.refreshHighlight(c.instanceId);
      });
      image.on('pointerout', () => {
        const entry = this.spriteMap[c.instanceId];
        if (entry) entry.hovered = false;
        this.refreshHighlight(c.instanceId);
      });

      // 選択中のカーソル(下向きの三角)。対象選択中と行動中の味方に出す。
      // Phaser の triangle は頂点の外接矩形の中心が原点になるので、位置はそのまま渡す。
      const caret = this.add.triangle(0, 0, 0, 0, 20, 0, 10, 15, 0xffd24d)
        .setStrokeStyle(2, 0x2a1f00, 1)
        .setDepth(isPlayer ? 16 : 12)
        .setVisible(false);

      const nameText = this.add.text(0, 0, c.name, {
        fontFamily: CANVAS_FONT,
        fontSize: '13px',
        color: '#ffffff',
        stroke: '#0a0c14',
        strokeThickness: 4,
      }).setOrigin(0, 1).setDepth(isPlayer ? 12 : 8);
      // てきのレベル。なかまの状態帯(.mrg-plv)と同じ金色にして、見え方をそろえる。
      // 名前と2つで1行になるので、原点は左下にして中央そろえは layoutNameRow で計算する。
      const lvText = this.add.text(0, 0, `Lv${c.level}`, {
        fontFamily: CANVAS_FONT,
        fontSize: '13px',
        color: '#f2d16b',
        stroke: '#0a0c14',
        strokeThickness: 4,
      }).setOrigin(0, 1).setDepth(isPlayer ? 12 : 8);
      // 味方の名前とレベルはステータス帯に出ているので、キャンバスでは敵だけ表示する。
      nameText.setVisible(!isPlayer);
      lvText.setVisible(!isPlayer);

      // 敵のHPバーはキャンバス内に描く(敵用の別パネルを持たないため)。
      const hpBg = this.add.rectangle(0, 0, 10, 6, 0x0a0c14, 0.85).setOrigin(0, 0).setDepth(isPlayer ? 12 : 8);
      const hpFill = this.add.rectangle(0, 0, 10, 6, 0x3ecf5f).setOrigin(0, 0).setDepth(isPlayer ? 13 : 9);
      const hpFrame = this.add.rectangle(0, 0, 10, 6).setStrokeStyle(1, 0x000000, 0.8).setOrigin(0, 0).setDepth(isPlayer ? 14 : 10);
      [hpBg, hpFill, hpFrame].forEach((o) => o.setVisible(!isPlayer));

      this.spriteMap[c.instanceId] = {
        combatant: c,
        isPlayer,
        index,
        count: party.length,
        image,
        shadow,
        ring,
        caret,
        nameText,
        lvText,
        hpBg,
        hpFill,
        hpFrame,
        tagTexts: [],
        floaters: [],
        hovered: false,
        lastHp: c.hp,
        size: 64,
      };
    });
  }

  /** 画面サイズが決まった/変わったときに全部を配置し直す。 */
  layout() {
    if (!this.ready) return;
    const w = this.scale.width;
    const h = this.scale.height;
    if (!w || !h) return;

    this.fallbackBg.setSize(w, h);

    if (this.bgImage) {
      // cover フィット: 縦横比を保ったまま画面を覆い、はみ出た分は切る。
      const s = Math.max(w / BG_NATIVE.width, h / BG_NATIVE.height);
      this.bgImage.setDisplaySize(BG_NATIVE.width * s, BG_NATIVE.height * s);
      // 地面が見えるように、上下の切り落としは「やや上寄り」にする。
      this.bgImage.setPosition(w / 2, h / 2 - Math.max(0, (BG_NATIVE.height * s - h)) * 0.12);
    }

    // 上の見出し/ログ、下の状態帯。文字が乗る帯だけ薄く落として読みやすくする。
    this.vignette.clear();
    this.vignette.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.5, 0.5, 0, 0);
    this.vignette.fillRect(0, 0, w, Math.round(h * 0.3));
    this.vignette.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0, 0, 0.5, 0.5);
    this.vignette.fillRect(0, Math.round(h * 0.7), w, Math.round(h * 0.3));

    // モンスターを置ける範囲(playfield)。
    //   上端 … 上のログ窓の下。ログは画面の3割までに収まる(battleUI.css)
    //   下端 … なかまの状態帯の上。実測値 uiInsets.bottom を使う
    // 高さではなくこの範囲を基準に大きさを決めるので、帯が厚くなっても
    // モンスターが帯へ食い込まない。
    const fieldTop = Math.round(h * 0.2);
    const fieldBottom = h - this.uiInsets.bottom - Math.max(4, h * 0.015);
    const fieldH = Math.max(60, fieldBottom - fieldTop);

    const playerBase = fieldBottom;
    const enemyBase = fieldTop + fieldH * ENEMY_BASE_RATIO;

    this.placeRow(false, enemyBase, w, h, fieldH);
    this.placeRow(true, playerBase, w, h, fieldH);
  }

  placeRow(isPlayer, baseY, w, h, fieldH) {
    const entries = Object.values(this.spriteMap).filter((e) => e.isPlayer === isPlayer);
    if (entries.length === 0) return;
    const n = entries.length;
    const ratio = isPlayer ? SIZE_RATIO.player : SIZE_RATIO.enemy;
    const cap = isPlayer ? SIZE_CAP.player : SIZE_CAP.enemy;
    const spread = isPlayer ? 0.96 : 0.82;
    // 味方は画面下部にいるので、右下のコマンド欄のぶんだけ左に寄せる。
    // 敵はコマンド欄より上にいるので画面幅いっぱいに散らしてよい。
    const rowW = isPlayer ? Math.max(w * 0.45, w - this.uiInsets.right * 0.7) : w;

    entries.forEach((entry) => {
      const i = entry.index;
      // 端ほど「奥」に見せる: t = 0(中央) .. 1(端)
      const half = Math.max(1, (n - 1) / 2);
      const t = n === 1 ? 0 : Math.abs(i - (n - 1) / 2) / half;
      const depthScale = 1 - t * (isPlayer ? 0.05 : 0.09);

      const byHeight = Math.min(fieldH * ratio, h * cap) * depthScale;
      const byWidth = (rowW / (n + 0.7)) * 0.92;
      const size = Math.max(40, Math.min(byHeight, byWidth));
      entry.size = size;

      const evenX = (rowW * (i + 1)) / (n + 1);
      const x = rowW / 2 + (evenX - rowW / 2) * spread;
      // 端ほど「奥」= 上に、少し小さく。まん中がいちばん手前になる。
      // baseY より下へは絶対に出さない: 味方の baseY は状態帯の上端なので、
      // 下げると帯の裏に潜ってしまう(v3 でこれを直した)。
      const y = baseY - t * fieldH * (isPlayer ? 0.06 : 0.08);
      entry.baseX = x;
      entry.baseY = y;

      const img = entry.image;
      if (img.setDisplaySize) {
        // 元のアスペクト比を保ったまま「高さ」を size にそろえる。
        const srcW = img.frame ? img.frame.width : img.width;
        const srcH = img.frame ? img.frame.height : img.height;
        const aspect = srcH > 0 ? srcW / srcH : 1;
        img.setDisplaySize(size * aspect, size);
      }
      img.setPosition(x, y);

      const footW = size * 0.62;
      entry.shadow.setPosition(x, y).setSize(footW, footW * 0.26);
      entry.ring.setPosition(x, y).setSize(footW * 1.15, footW * 0.32);

      // カーソルは味方の頭上すぐ、敵は名前ラベルのさらに上に置く。
      entry.caretBaseY = y - size - (isPlayer ? 10 : 26);
      entry.caret.setPosition(x, entry.caretBaseY);

      // 敵の名前とレベル。ビットマップ体は小さいと読めないので下限を上げてある。
      const nameFont = Math.max(13, Math.round(h * 0.026));
      entry.nameText.setFontSize(`${nameFont}px`);
      entry.lvText.setFontSize(`${nameFont}px`);
      entry.nameBaseY = y - size - 4;
      this.layoutNameRow(entry);

      const barW = Math.max(38, size * 0.78);
      const barH = Math.max(5, Math.round(h * 0.011));
      entry.barW = barW;
      entry.barH = barH;
      const barX = x - barW / 2;
      // 足元の光の輪と重ならないよう、バーは少し下げる。
      const barY = y + Math.max(8, h * 0.022);
      entry.barX = barX;
      entry.barY = barY;
      entry.hpBg.setPosition(barX, barY).setSize(barW, barH);
      entry.hpFrame.setPosition(barX, barY).setSize(barW, barH);
      entry.hpFill.setPosition(barX, barY);
      entry.hpFill.height = barH;

      this.layoutTags(entry);
    });

    // 手前に描くものほど depth を大きく(重なったときの前後関係)
    entries
      .slice()
      .sort((a, b) => a.baseY - b.baseY)
      .forEach((entry, order) => {
        const base = (entry.isPlayer ? 10 : 6) + order * 0.01;
        entry.image.setDepth(base);
      });
  }

  /** カーソルの上下動と、光の輪の明滅。tween だと layout() の座標指定と喧嘩するので毎フレーム自前で動かす。 */
  update(time) {
    const bob = Math.sin(time / 220) * 5;
    const pulse = 0.55 + Math.sin(time / 260) * 0.25;
    Object.values(this.spriteMap).forEach((entry) => {
      if (entry.caret.visible && entry.caretBaseY != null) entry.caret.y = entry.caretBaseY + bob;
      if (entry.ring.visible) entry.ring.setAlpha(pulse);
    });
  }

  /** 「なまえ Lv12」を1行に並べ、スプライトの真上で中央そろえにする。 */
  layoutNameRow(entry) {
    if (!entry.nameText.visible || entry.nameBaseY == null) return;
    const gap = Math.max(3, Math.round(entry.nameText.height * 0.25));
    const total = entry.nameText.width + gap + entry.lvText.width;
    const left = entry.baseX - total / 2;
    entry.nameText.setPosition(left, entry.nameBaseY);
    entry.lvText.setPosition(left + entry.nameText.width + gap, entry.nameBaseY);
  }

  layoutTags(entry) {
    const tagY = entry.barY + entry.barH + 2;
    let tx = entry.baseX - entry.barW / 2;
    entry.tagTexts.forEach((t) => {
      if (!t.visible) return;
      t.setPosition(tx, tagY);
      tx += t.width + 2;
    });
  }

  /** 状態異常・能力変化の小さなタグ。プールを使い回して作り直さない。 */
  renderTags(entry, c) {
    const tags = [
      ...ailmentList(c).map((a) => ({ text: a.short, bg: a.color, fg: '#101018' })),
      ...modList(c).map((m) => ({
        text: `${m.label.slice(0, 2)}${m.stage > 0 ? '↑' : '↓'}`,
        bg: m.stage > 0 ? '#2f5d38' : '#5d3a2f',
        fg: m.stage > 0 ? '#8fe0a0' : '#e0a08f',
      })),
    ];
    const fontSize = Math.max(11, Math.round(this.scale.height * 0.019));
    tags.forEach((tag, i) => {
      let t = entry.tagTexts[i];
      if (!t) {
        t = this.add.text(0, 0, '', {
          fontFamily: CANVAS_FONT,
          fontSize: `${fontSize}px`,
          padding: { x: 3, y: 1 },
        }).setOrigin(0, 0).setDepth(entry.isPlayer ? 14 : 10);
        entry.tagTexts[i] = t;
      }
      t.setFontSize(`${fontSize}px`);
      t.setText(tag.text);
      t.setColor(tag.fg);
      t.setBackgroundColor(tag.bg);
      t.setVisible(true);
    });
    for (let i = tags.length; i < entry.tagTexts.length; i += 1) {
      entry.tagTexts[i].setVisible(false);
    }
    this.layoutTags(entry);
  }

  refreshHighlight(instanceId) {
    const entry = this.spriteMap[instanceId];
    if (!entry) return;
    const targetable = this.targetableIds.includes(instanceId);
    const active = this.activeActorId === instanceId;

    entry.ring.setVisible(targetable);
    entry.ring.setStrokeStyle(entry.hovered && targetable ? 3 : 2, targetable ? 0xffd24d : 0xffffff, 1);
    entry.caret.setVisible(targetable || active);
    entry.caret.setFillStyle(targetable ? 0xffd24d : 0x8fd0ff);
    if (entry.image.input) entry.image.input.cursor = targetable ? 'pointer' : 'default';

    const wantScale = entry.hovered && targetable ? 1.06 : 1;
    if (entry.appliedScale !== wantScale) {
      entry.appliedScale = wantScale;
      const srcW = entry.image.frame ? entry.image.frame.width : entry.image.width;
      const srcH = entry.image.frame ? entry.image.frame.height : entry.image.height;
      const aspect = srcH > 0 ? srcW / srcH : 1;
      entry.image.setDisplaySize(entry.size * aspect * wantScale, entry.size * wantScale);
    }
  }

  /** ダメージ/回復のとび出る数字。engineに触らず、HPの増減だけを見て出す。 */
  spawnFloater(entry, delta) {
    const heal = delta > 0;
    const t = this.add.text(entry.baseX, entry.baseY - entry.size * 0.55, `${heal ? '+' : ''}${delta}`, {
      fontFamily: CANVAS_FONT,
      fontSize: `${Math.max(18, Math.round(this.scale.height * 0.04))}px`,
      fontStyle: 'bold',
      color: heal ? '#7ee08a' : '#ff6b6b',
      stroke: '#0a0c14',
      strokeThickness: 5,
    }).setOrigin(0.5, 0.5).setDepth(40);
    this.tweens.add({
      targets: t,
      y: t.y - this.scale.height * 0.09,
      alpha: 0,
      duration: 850,
      ease: 'Cubic.easeOut',
      onComplete: () => t.destroy(),
    });
  }

  /** React側から最新のBattleEngineスナップショットを渡して見た目を更新する。 */
  updateFromState(state, opts = {}) {
    if (!state || !this.ready) return;
    this.targetableIds = opts.targetableIds || [];
    this.activeActorId = opts.activeActorId || null;

    [...state.playerParty, ...state.enemyParty].forEach((c) => {
      const entry = this.spriteMap[c.instanceId];
      if (!entry) return;
      entry.combatant = c;

      const pct = c.maxHp > 0 ? Math.max(0, Math.min(1, c.hp / c.maxHp)) : 0;
      entry.hpFill.width = (entry.barW || 40) * pct;
      entry.hpFill.setFillStyle(pct > 0.5 ? 0x3ecf5f : pct > 0.2 ? 0xe0c04d : 0xe05a5a);

      if (entry.lastHp !== c.hp) {
        const delta = c.hp - entry.lastHp;
        entry.lastHp = c.hp;
        if (delta !== 0) {
          this.spawnFloater(entry, delta);
          if (delta < 0) this.flashHit(c.instanceId);
        }
      }

      const down = c.hp <= 0;
      entry.image.setAlpha(down ? 0.22 : 1);
      entry.shadow.setAlpha(down ? 0.1 : 0.3);
      entry.nameText.setAlpha(down ? 0.35 : 1);
      entry.lvText.setAlpha(down ? 0.35 : 1);
      if (entry.lvText.text !== `Lv${c.level}`) {
        entry.lvText.setText(`Lv${c.level}`);
        this.layoutNameRow(entry);
      }

      this.renderTags(entry, c);
      this.refreshHighlight(c.instanceId);
    });
  }

  /** ダメージ発生時の簡易ヒットフラッシュ。 */
  flashHit(instanceId) {
    const entry = this.spriteMap[instanceId];
    if (!entry) return;
    this.tweens.add({
      targets: entry.image,
      alpha: 0.25,
      duration: 60,
      yoyo: true,
      repeat: 1,
      onComplete: () => entry.image.setAlpha(entry.combatant.hp > 0 ? 1 : 0.22),
    });
    this.tweens.add({
      targets: entry.image,
      x: entry.baseX + 6,
      duration: 45,
      yoyo: true,
      repeat: 1,
      onComplete: () => entry.image.setX(entry.baseX),
    });
  }
}

// 旧レイアウト(固定サイズのキャンバス)の名残。今は Scale.RESIZE なので
// 使っていないが、外から参照している箇所があるかもしれないので残しておく。
export const BATTLE_SCENE_SIZE = { width: 1280, height: 720 };
