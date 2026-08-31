// MapScene.js
// 歩けるマップのキャンバス。町・内装・ダンジョンで同じシーンを使い回す。
//
// レイアウト方針は BattleScreen と同じ「フルブリード」:
//   キャンバスがビューポート全体を占め、UI(十字キー/決定ボタン/見出し)は
//   React 側が **上に重ねる**。縦に何も積まないので、844x390 の
//   スマホ横画面でもページのスクロールバーが出ない。
//
// マップの絵は床も建物も家具も焼き込み済みの1枚絵で、当たり判定だけを
// field/maps.js が持つ。だから「机の裏に回り込む」ような重なりは
// 人物同士でしか起きない(人物は足元Yで前後関係を決める)。
//
// 移動は 64px のマス単位。1歩ぶんを tween で動かし、着いた瞬間に
//   onEvent('step', {tile, facing})       … ダンジョンのエンカウント判定に使う
//   onEvent('trigger', {trigger, tile})   … 扉・階段・町の出口
// を鳴らす。React 側はこの2つだけ見ていればよい。
//
// 入力はキーボード(矢印/WASD)と、React から差し込む setPad()/pressAction() の
// 両方。スマホは画面を指でふさぐので、どちらか一方では足りない。

import Phaser from 'phaser';
import {
  TILE, CHAR_FRAME, CHAR_SHEETS, DIR_FRAME, OBJECT_IMAGES, BOSS_TRIGGER_RANGE,
} from '../field/maps.js';

/** 1マス歩くのにかける時間(ms)。短すぎると操作が滑る、長いともっさりする。 */
const STEP_MS = 135;

/** 壁に向かって歩こうとしたとき、向きだけ変えて止まる時間(ms)。 */
const BUMP_MS = 90;

/** 画面の縦に見せたいマス数の目安。スマホ横でも8マスは見えるようにする。 */
const TARGET_TILES_Y = 8;

/** キーと向きの対応。event.key(1文字/Arrow*) と event.code(KeyW など)の両方を引ける。 */
const KEY_DIRS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', a: 'left', s: 'down', d: 'right',
  W: 'up', A: 'left', S: 'down', D: 'right',
  KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right',
};

/** 決定(はなす/しらべる)のキー。 */
const ACTION_KEYS = new Set([' ', 'Enter', 'z', 'Z', 'Space', 'KeyZ']);

const DIRS = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

const DIR_NAMES = ['up', 'down', 'left', 'right'];

// --- 町をうろつく住人のツマミ ---------------------------------------------
// 「にぎわい」であって「交通」ではないので、主人公よりずっと遅く、
// 1〜2マス歩いては立ち止まる。値をいじるならここだけ。
//
// 1人ずつ上書きもできる (maps.js の wanderers[] に stepMs / pauseMin / pauseMax)。
// 子供は速く、老人はゆっくり。同じ速さで歩かせると、背丈が違うだけの
// 同じ人になってしまう。
const WANDER = {
  stepMs: 320,        // 1マスにかける時間(主人公の135msより かなり遅い)
  pauseMin: 500,      // 立ち止まる時間の下限
  pauseMax: 2200,     // 同 上限(実際は pauseMin + 0〜この値)
  turnChance: 0.3,    // 歩かずに向きだけ変える確率(きょろきょろする)
  runMin: 1,          // 一度に続けて歩くマス数
  runMax: 2,
};

export class MapScene extends Phaser.Scene {
  constructor() {
    super('MapScene');
    this.map = null;
    this.onEvent = null;
    this.padDir = null;      // React の十字キーから入る向き
    this.actionPressed = false;
    this.inputLocked = false; // メッセージ表示中などは動かさない
    this.ready = false;
  }

  init(data) {
    this.map = data.map;
    this.spawn = data.spawn;
    this.onEvent = data.onEvent || (() => {});
    this.ready = false;
    this.moving = false;
    this.bumpUntil = 0;
    this.stepParity = 0;
    this.padDir = null;
    this.actionPressed = false;
    this.inputLocked = false;
    this.heldDirs = new Set();
    this.lastDir = null;
    this.tapDir = null;
    this.padTapDir = null;
    this.padConsumed = false;
  }

  preload() {
    const map = this.map;
    if (!this.textures.exists(map.imageUrl)) this.load.image(map.imageUrl, map.imageUrl);
    const sheets = new Set([
      'hero',
      // 絵に描き込まれているNPC(painted)はスプライトを持たない
      ...map.npcs.filter((n) => !n.painted).map((n) => n.sheet),
      ...(map.wanderers || []).map((w) => w.sheet),
    ]);
    sheets.forEach((name) => {
      const url = CHAR_SHEETS[name];
      if (!url || this.textures.exists(url)) return;
      this.load.spritesheet(url, url, { frameWidth: CHAR_FRAME.width, frameHeight: CHAR_FRAME.height });
    });
    if ((map.objects || []).some((o) => o.kind === 'chest')) {
      [OBJECT_IMAGES.chestClosed, OBJECT_IMAGES.chestOpen].forEach((url) => {
        if (!this.textures.exists(url)) this.load.image(url, url);
      });
    }
    if ((map.objects || []).some((o) => o.kind === 'stairs')) {
      [OBJECT_IMAGES.stairsUp, OBJECT_IMAGES.stairsDown].forEach((url) => {
        if (!this.textures.exists(url)) this.load.image(url, url);
      });
    }
    // 散らしてある置きもの(樽・石像など)とボスの絵。同じ種類が何個あっても
    // テクスチャは1枚で足りる。読めなくても「絵が出ないだけ」で歩ける。
    new Set(
      (map.objects || [])
        .filter((o) => (o.kind === 'prop' || o.kind === 'boss') && o.imageUrl)
        .map((o) => o.imageUrl),
    ).forEach((url) => {
      if (!this.textures.exists(url)) this.load.image(url, url);
    });
    // 床に落ちているどうぐの絵 (items.json の icon)。同じ種類が何個落ちていても
    // テクスチャは1枚で足りる。
    new Set(
      (map.objects || [])
        .filter((o) => o.kind === 'floorItem' && !o.taken && o.iconUrl)
        .map((o) => o.iconUrl),
    ).forEach((url) => {
      if (!this.textures.exists(url)) this.load.image(url, url);
    });
  }

  create() {
    const map = this.map;
    this.cameras.main.setBackgroundColor(map.bgColor);

    this.mapImage = this.add.image(0, 0, map.imageUrl).setOrigin(0, 0).setDepth(-1000);
    // 実素材は 1マス=64px ちょうどで描かれているが、念のため実寸に合わせる。
    this.mapImage.setDisplaySize(map.cols * TILE, map.rows * TILE);
    if (map.tint) this.mapImage.setTint(map.tint);

    // NPC。足元の影 -> 人物 の順に置き、深度は足元Yで決める。
    map.npcs.forEach((npc) => {
      if (npc.painted) return; // 内装の絵にもう描かれている
      const [tx, ty] = npc.tile;
      const { x, y } = this.tileToFoot(tx, ty);
      this.add.ellipse(x, y - 3, TILE * 0.5, TILE * 0.2, 0x000000, 0.28).setDepth(y - 1);
      const sprite = this.add.sprite(x, y, CHAR_SHEETS[npc.sheet], DIR_FRAME[npc.facing] ?? 0);
      sprite.setOrigin(0.5, 1).setDepth(y);
    });

    this.buildObjects();
    this.buildWanderers();

    // 主人公。
    const foot = this.tileToFoot(this.spawn.x, this.spawn.y);
    this.tx = this.spawn.x;
    this.ty = this.spawn.y;
    this.facing = this.spawn.facing || 'down';
    this.shadow = this.add.ellipse(foot.x, foot.y - 3, TILE * 0.5, TILE * 0.2, 0x000000, 0.3);
    this.player = this.add.sprite(foot.x, foot.y, CHAR_SHEETS.hero, DIR_FRAME[this.facing]);
    this.player.setOrigin(0.5, 1);
    this.updateDepths();

    // キーボード。
    //
    // Phaser の Keyboard プラグインは廃止予定の event.keyCode で照合するので、
    // keyCode を載せてこない環境(自動テストや一部のIME経由)では一切反応しない。
    // ここは素の DOM イベントを自分で拾い、標準の event.key / event.code で見る。
    //
    // 向きは「押しているキーの集合」と「離すのが速すぎた1回ぶん(tapDir)」の
    // 両方を持つ。isDown を毎フレーム見るだけだと、1フレーム(16ms)より短い
    // チョン押しを取りこぼして「キーが効かない」ように見えてしまう。
    this.heldDirs = new Set();
    this.lastDir = null;
    this.tapDir = null;

    this.onKeyDown = (e) => {
      if (e.repeat) return;
      const dir = KEY_DIRS[e.key] || KEY_DIRS[e.code];
      if (dir) {
        e.preventDefault(); // 矢印キーでページを動かさない
        this.heldDirs.add(dir);
        this.lastDir = dir;
        this.tapDir = dir;
        return;
      }
      if (ACTION_KEYS.has(e.key) || ACTION_KEYS.has(e.code)) {
        e.preventDefault();
        this.pressAction();
      }
    };
    this.onKeyUp = (e) => {
      const dir = KEY_DIRS[e.key] || KEY_DIRS[e.code];
      if (dir) this.heldDirs.delete(dir);
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    this.ready = true;
    // 検証用の取っ手。本番ビルドでは丸ごと消える。
    if (import.meta.env.DEV) window.__mrgScene = this;
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
    });
    this.layout();
    this.onEvent('ready', { tile: { x: this.tx, y: this.ty }, facing: this.facing });
  }

  /** マス座標 -> そのマスの足元(下中央)のピクセル座標。 */
  tileToFoot(tx, ty) {
    return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE };
  }

  /** 画面サイズが決まった/変わったときにズームとカメラ位置を決め直す。 */
  layout() {
    if (!this.ready) return;
    const w = this.scale.width;
    const h = this.scale.height;
    if (!w || !h) return;
    // 低い画面(スマホ横)では引いて8マス見せ、広い画面では等倍で止める。
    // 等倍を超えて拡大すると、書き込まれた絵がただ粗くなる。
    let zoom = Math.min(1, Math.max(0.5, h / (TARGET_TILES_Y * TILE)));
    // ただし内装のようにマップが画面より小さい場合は、そのままだと
    // 周りに黒帯が出る。画面を覆うところまでは寄せる。
    const cover = Math.max(w / (this.map.cols * TILE), h / (this.map.rows * TILE));
    zoom = Math.min(1.6, Math.max(zoom, cover));
    this.cameras.main.setZoom(zoom);
    this.centerCamera();
  }

  /** カメラを主人公に寄せる。マップの外(黒帯)が見えないようにクランプする。 */
  centerCamera() {
    const cam = this.cameras.main;
    const mapW = this.map.cols * TILE;
    const mapH = this.map.rows * TILE;
    const halfW = cam.width / (2 * cam.zoom);
    const halfH = cam.height / (2 * cam.zoom);
    const px = this.player.x;
    const py = this.player.y - TILE / 2;
    const cx = mapW <= halfW * 2 ? mapW / 2 : Math.min(Math.max(px, halfW), mapW - halfW);
    const cy = mapH <= halfH * 2 ? mapH / 2 : Math.min(Math.max(py, halfH), mapH - halfH);
    cam.centerOn(cx, cy);
  }

  updateDepths() {
    this.player.setDepth(this.player.y);
    this.shadow.setDepth(this.player.y - 1);
  }

  setFrame() {
    const base = DIR_FRAME[this.facing] ?? 0;
    this.player.setFrame(base + (this.moving ? this.stepParity : 0));
  }

  // ------------------------------------------------------------ 外から叩く

  /**
   * React の十字キー。null で離した。
   *
   * キーボードと同じで、「押して離すのが1フレーム(16ms)より速い」ことがある。
   * マウスで十字キーをクリックするとまさにこれで、padDir を見るだけだと
   * 押した事実ごと消えてしまい、ボタンが効かないように見える。
   * だから押した向きを padTapDir に1回ぶん取っておく。
   * ただし、すでに1フレームでも読まれた押下(=長押し)は、離したときに
   * 取っておいたぶんを捨てる。残すと指を離してから1マス余分に動いてしまう。
   */
  setPad(dir) {
    if (dir) {
      if (!this.padDir) this.padConsumed = false; // ここから新しい押下
      this.padDir = dir;
      this.padTapDir = dir;
    } else {
      this.padDir = null;
      if (this.padConsumed) this.padTapDir = null;
    }
  }

  /** React の決定ボタン / スペースキー。 */
  pressAction() {
    if (this.inputLocked) return;
    this.actionPressed = true;
  }

  /** メッセージ表示中などに動きを止める。 */
  setInputLocked(locked) {
    this.inputLocked = locked;
    if (!locked) return;
    // 取り置きの1歩ぶんも捨てる。残すとメッセージを閉じた瞬間に
    // 「閉じるボタンを押したはずが1マス歩いていた」が起きる。
    this.padDir = null;
    this.padTapDir = null;
    this.tapDir = null;
  }

  // -------------------------------------------------------------- 毎フレーム

  update(time, delta) {
    if (!this.ready) return;

    this.updateWanderers(delta);

    if (this.actionPressed) {
      this.actionPressed = false;
      if (!this.moving) this.tryInteract();
    }

    if (this.inputLocked || this.moving || time < this.bumpUntil) return;

    const dir = this.readDirection();
    if (!dir) {
      this.setFrame();
      return;
    }

    if (this.facing !== dir) {
      this.facing = dir;
      this.setFrame();
    }

    const [dx, dy] = DIRS[dir];
    const nx = this.tx + dx;
    const ny = this.ty + dy;
    if (this.map.isBlocked(nx, ny)) {
      // 壁。向きだけ変えて少し待つ(向き変えと移動を撃ち分けられるように)。
      this.bumpUntil = time + BUMP_MS;
      return;
    }
    this.stepTo(nx, ny);
  }

  readDirection() {
    if (this.padDir) {
      // 押しっぱなしを1歩ぶん使ったら、同じ押下で積んだ取り置きは捨てる。
      this.padConsumed = true;
      this.padTapDir = null;
      this.tapDir = null;
      return this.padDir;
    }
    if (this.heldDirs && this.heldDirs.size > 0) {
      // 押しっぱなしぶんを1歩使ったら、同じ押下で積んだ tapDir は捨てる。
      // 残したままだと、キーを離したあとに下の tapDir でもう1歩ぶん動いてしまい、
      // チョン押し1回で2マス進む(＝1マスの微調整ができない)。
      this.tapDir = null;
      // 同時押しは「最後に押したほう」を優先する
      if (this.lastDir && this.heldDirs.has(this.lastDir)) return this.lastDir;
      return this.heldDirs.values().next().value;
    }
    // 押して離すのが速すぎた1回ぶん。取りこぼすと「キーが効かない」に見える。
    if (this.tapDir) {
      const dir = this.tapDir;
      this.tapDir = null;
      return dir;
    }
    if (this.padTapDir) {
      const dir = this.padTapDir;
      this.padTapDir = null;
      return dir;
    }
    return null;
  }

  stepTo(nx, ny) {
    this.moving = true;
    this.stepParity = this.stepParity ? 0 : 1;
    this.setFrame();
    const dest = this.tileToFoot(nx, ny);
    this.tweens.add({
      targets: [this.player, this.shadow],
      x: dest.x,
      y: (target) => (target === this.shadow ? dest.y - 3 : dest.y),
      duration: STEP_MS,
      ease: 'Linear',
      onUpdate: () => {
        this.updateDepths();
        this.centerCamera();
      },
      onComplete: () => {
        this.tx = nx;
        this.ty = ny;
        this.moving = false;
        this.setFrame();
        this.updateDepths();
        this.centerCamera();
        // 床のどうぐは「踏んだら拾う」。宝箱(調べて開ける)と役割を分けてある
        // ので、決定ボタンでは拾えない。歩数の判定より先に渡したいので、
        // trigger ではなく step にのせる(同じ1歩で戦闘が始まっても、
        // 拾ったこと自体は先に確定する)。
        const floorItem = this.floorItemAt(nx, ny);
        this.onEvent('step', {
          tile: { x: nx, y: ny },
          facing: this.facing,
          floorItem,
          takeFloorItem: floorItem
            ? () => {
              floorItem.taken = true;
              this.takeFloorItemSprite(floorItem.id);
            }
            : null,
        });
        // ボス部屋。奥まで踏み込んだら、ぶつかる前に立ちはだかられる。
        // 「ボスのマスを調べる」だけにすると、部屋の主の前を素通りできて
        // しまい、出口の無い部屋に閉じこめられただけになる。
        if (this.map.bossTile) {
          const [bx, by] = this.map.bossTile;
          const near = Math.max(Math.abs(nx - bx), Math.abs(ny - by)) <= BOSS_TRIGGER_RANGE;
          if (near) {
            this.onEvent('trigger', {
              trigger: { type: 'bossFight' }, tile: { x: nx, y: ny }, facing: this.facing,
            });
            return;
          }
        }
        const trigger = this.map.triggerAt(nx, ny);
        if (trigger) {
          this.onEvent('trigger', { trigger, tile: { x: nx, y: ny }, facing: this.facing });
        }
      },
    });
  }

  // ----------------------------------------------------------- 置いてある物

  /**
   * 宝箱などの「マップに置いてある物」を並べる。
   *
   * 宝箱はマスごと通れなくしてある(field/maps.js)ので、上下左右どこから来ても
   * 「正面のマス = 宝箱のマス」になり、四方どちらからでも調べられる。
   *
   * 床に落ちているどうぐは逆に通れるマスに置く。踏んで拾うものなので、
   * 通れなくしたら永久に拾えない。ふわふわ上下させて「落ちている物」だと
   * 分かるようにしてある(床の絵に描き込まれた飾りと区別がつかないと、
   * 拾えることに気づいてもらえない)。
   */
  buildObjects() {
    this.objectSprites = new Map();
    this.floorItemSprites = new Map();
    (this.map.objects || []).forEach((obj) => {
      if (obj.kind === 'stairs') {
        // 1マスちょうど(64px)で書き出してある。踏んで使うものなので、
        // 深度は床のどうぐと同じ「マスの下辺の1つ手前」= 乗った主人公が手前に来る。
        const url = obj.dir === 'up' ? OBJECT_IMAGES.stairsUp : OBJECT_IMAGES.stairsDown;
        if (!this.textures.exists(url)) return;
        const cx = obj.tile[0] * TILE + TILE / 2;
        const cy = obj.tile[1] * TILE + TILE / 2;
        this.add.image(cx, cy, url)
          .setOrigin(0.5, 0.5)
          .setDepth(obj.tile[1] * TILE + TILE - 1);
        return;
      }
      if (obj.kind === 'prop') {
        // 宝箱とまったく同じ置き方(足元そろえ + うっすら影)。
        // マスは通れないので、四方どちらからでも「しらべる」が届く。
        if (!obj.imageUrl || !this.textures.exists(obj.imageUrl)) return;
        const { x, y } = this.tileToFoot(obj.tile[0], obj.tile[1]);
        this.add.ellipse(x, y - 5, TILE * 0.55, TILE * 0.18, 0x000000, 0.28).setDepth(y - 2);
        this.add.image(x, y - 3, obj.imageUrl).setOrigin(0.5, 1).setDepth(y - 1);
        return;
      }
      if (obj.kind === 'boss') {
        // ボス部屋の主。1マスに収めると小物と同じ大きさになってしまうので、
        // 2マスぶんの高さで置いて「大きい」ことを見せる。
        if (!obj.imageUrl || !this.textures.exists(obj.imageUrl)) return;
        const { x, y } = this.tileToFoot(obj.tile[0], obj.tile[1]);
        this.add.ellipse(x, y - 6, TILE * 1.1, TILE * 0.34, 0x000000, 0.35).setDepth(y - 2);
        const img = this.add.image(x, y, obj.imageUrl).setOrigin(0.5, 1).setDepth(y - 1);
        const h = TILE * 2;
        const aspect = img.width > 0 ? img.width / img.height : 1;
        img.setDisplaySize(h * aspect, h);
        // ゆっくり上下させて「生きている」ことを見せる。
        this.tweens.add({
          targets: img, y: y - 6, duration: 1400, ease: 'Sine.easeInOut', yoyo: true, repeat: -1,
        });
        return;
      }
      if (obj.kind === 'chest') {
        const { x, y } = this.tileToFoot(obj.tile[0], obj.tile[1]);
        // 足元にうっすら影。床にちゃんと「置いてある」ように見せる。
        this.add.ellipse(x, y - 6, TILE * 0.62, TILE * 0.2, 0x000000, 0.3).setDepth(y - 2);
        const url = obj.opened ? OBJECT_IMAGES.chestOpen : OBJECT_IMAGES.chestClosed;
        const img = this.add.image(x, y - 3, url).setOrigin(0.5, 1).setDepth(y - 1);
        this.objectSprites.set(obj.id, img);
        return;
      }
      if (obj.kind !== 'floorItem' || obj.taken || !obj.iconUrl) return;
      if (!this.textures.exists(obj.iconUrl)) return;
      const cx = obj.tile[0] * TILE + TILE / 2;
      const cy = obj.tile[1] * TILE + TILE / 2;
      // 深度はマスの下辺。主人公が同じマスに乗ったとき、どうぐが手前に
      // 描かれて主人公を隠すことがないようにする。
      const depth = obj.tile[1] * TILE + TILE;
      const shadow = this.add.ellipse(cx, cy + 18, TILE * 0.42, TILE * 0.14, 0x000000, 0.32)
        .setDepth(depth - 2);
      // 素材は48pxちょうどで書き出してあるので、等倍のまま置く
      // (build_field_assets.py の ITEM_ICON_PX)。中途半端に縮めると
      // ドットが間引かれて、せっかくのドット絵がガタガタになる。
      const img = this.add.image(cx, cy, obj.iconUrl).setOrigin(0.5, 0.5).setDepth(depth - 1);
      const float = this.tweens.add({
        targets: img,
        y: cy - 5,
        duration: 900,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });
      this.floorItemSprites.set(obj.id, { img, shadow, float });
    });
  }

  /** 宝箱を開いた絵に差し替える。App 側が「中身を渡せた」ときだけ呼ぶ。 */
  openChestSprite(id) {
    const img = this.objectSprites && this.objectSprites.get(id);
    if (img) img.setTexture(OBJECT_IMAGES.chestOpen);
  }

  /** そのマスに落ちているどうぐ。まだ拾われていないものだけ返す。 */
  floorItemAt(x, y) {
    return (this.map.objects || []).find(
      (o) => o.kind === 'floorItem' && !o.taken && o.tile[0] === x && o.tile[1] === y,
    ) || null;
  }

  /** 拾えたときだけ呼ばれる。絵を消す。 */
  takeFloorItemSprite(id) {
    const entry = this.floorItemSprites && this.floorItemSprites.get(id);
    if (!entry) return;
    entry.float?.remove();
    entry.img.destroy();
    entry.shadow.destroy();
    this.floorItemSprites.delete(id);
  }

  // ------------------------------------------------------- うろつく住人

  /**
   * 町の住人を並べる。主人公と同じ8コマのシートを使うので、
   * 歩き方も向きの出し方も主人公とまったく同じ理屈になる。
   *
   * わざと「主人公にぶつからない」ようにしてある(すり抜ける)。
   * こうしておけば、住人が路地や扉の前をふさいで主人公が動けなくなる、
   * という事故が起きようがない。住人どうしは重ならないよう避け合う。
   */
  buildWanderers() {
    this.wanderers = [];
    this.wanderOccupied = new Set();
    (this.map.wanderers || []).forEach((def) => {
      const [tx, ty] = def.tile;
      if (this.map.isBlocked(tx, ty)) {
        // 持ち場が壁の中。**黙って消える**のがいちばん困る(住人を1人足したのに
        // 町のどこを探しても居ない、という形で出てくる)。開発中は声を上げる。
        if (import.meta.env.DEV) {
          console.warn(
            `[MapScene] 住人 ${def.sheet} の持ち場 (${tx},${ty}) は通れないマスです。`
            + ' この住人は出てきません (field/maps.js の wanderers を直してください)',
          );
        }
        return;
      }
      const { x, y } = this.tileToFoot(tx, ty);
      // 最初の12人は素材を1人ずつコマいっぱい(112px)へ引き伸ばして作ったので、
      // 子供もそのままだと大人と同じ背丈になる。def.scale で縮めて背格好を作る。
      // あとから届いた5人は素材の時点で背丈が描き分けてある(子供80px /
      // 老人98px / 大人112px)ので scale は付けない。maps.js の
      // RESIDENT_SHEETS のコメントを参照。
      const scale = def.scale ?? 1;
      const shadow = this.add.ellipse(x, y - 3, TILE * 0.5 * scale, TILE * 0.2 * scale, 0x000000, 0.26);
      const facing = DIR_NAMES[Math.floor(Math.random() * 4)];
      const sprite = this.add.sprite(x, y, CHAR_SHEETS[def.sheet], DIR_FRAME[facing]);
      sprite.setOrigin(0.5, 1);
      sprite.setScale(scale);
      // 1人ずつの歩き方。書いていなければ WANDER の共通値を使う。
      const pauseMin = def.pauseMin ?? WANDER.pauseMin;
      const pauseMax = def.pauseMax ?? WANDER.pauseMax;
      const w = {
        sprite,
        shadow,
        tx,
        ty,
        home: [tx, ty],
        radius: def.radius ?? 2,
        stepMs: def.stepMs ?? WANDER.stepMs,
        pauseMin,
        pauseMax,
        facing,
        parity: 0,
        moving: false,
        stepsLeft: 0,
        // 初期の待ち時間をばらけさせる。そろって動き出すと機械に見える。
        wait: pauseMin + Math.random() * pauseMax,
      };
      this.setWandererFrame(w);
      this.updateWandererDepth(w);
      this.wanderOccupied.add(`${tx},${ty}`);
      this.wanderers.push(w);
    });
  }

  setWandererFrame(w) {
    w.sprite.setFrame((DIR_FRAME[w.facing] ?? 0) + (w.moving ? w.parity : 0));
  }

  updateWandererDepth(w) {
    w.sprite.setDepth(w.sprite.y);
    w.shadow.setDepth(w.sprite.y - 1);
  }

  /** 住人が入れるマス。壁でなく、扉や出口でなく、他の住人が居ないこと。 */
  canWanderTo(w, x, y) {
    if (this.map.isBlocked(x, y)) return false;
    // 扉・階段・町の出口の上には立たせない(絵として最悪だし、紛らわしい)
    if (this.map.triggerAt(x, y)) return false;
    // 決まった場所からあまり離れさせない。町じゅうを渡り歩かれると
    // 「そこに住んでいる人」に見えなくなる。
    if (Math.abs(x - w.home[0]) > w.radius || Math.abs(y - w.home[1]) > w.radius) return false;
    return !this.wanderOccupied.has(`${x},${y}`);
  }

  /**
   * 住人をすすめる。1人あたり「タイマーを減らす」だけなので、
   * 経路探索は無い(スマホでタイルマップとカメラの隣で動かすため)。
   */
  updateWanderers(delta) {
    const list = this.wanderers;
    if (!list || list.length === 0) return;
    const dt = Math.min(delta || 16, 100);
    for (let i = 0; i < list.length; i += 1) {
      const w = list[i];
      if (w.moving) continue;
      w.wait -= dt;
      if (w.wait > 0) continue;

      if (w.stepsLeft <= 0) {
        // 立ち止まっているあいだは、たまに向きだけ変える(きょろきょろ)
        if (Math.random() < WANDER.turnChance) {
          w.facing = DIR_NAMES[Math.floor(Math.random() * 4)];
          this.setWandererFrame(w);
          w.wait = w.pauseMin + Math.random() * w.pauseMax;
          continue;
        }
        // 4方向をシャッフルして、行けるほうを1つ選ぶ。まったくの
        // 行き当たりばったりにすると、壁ぎわの住人がほとんど動かなくなる。
        const dirs = DIR_NAMES.slice();
        for (let k = dirs.length - 1; k > 0; k -= 1) {
          const j = Math.floor(Math.random() * (k + 1));
          [dirs[k], dirs[j]] = [dirs[j], dirs[k]];
        }
        const pick = dirs.find((dir) => {
          const [ddx, ddy] = DIRS[dir];
          return this.canWanderTo(w, w.tx + ddx, w.ty + ddy);
        });
        if (!pick) {
          w.wait = w.pauseMin + Math.random() * w.pauseMax;
          continue;
        }
        w.facing = pick;
        w.stepsLeft = WANDER.runMin + Math.floor(Math.random() * (WANDER.runMax - WANDER.runMin + 1));
      }

      const [dx, dy] = DIRS[w.facing];
      const nx = w.tx + dx;
      const ny = w.ty + dy;
      this.setWandererFrame(w);
      if (!this.canWanderTo(w, nx, ny)) {
        // 行き止まり。向き直して、ひと呼吸おく。
        w.stepsLeft = 0;
        w.wait = w.pauseMin + Math.random() * w.pauseMax;
        continue;
      }
      this.stepWanderer(w, nx, ny);
    }
  }

  stepWanderer(w, nx, ny) {
    w.moving = true;
    w.stepsLeft -= 1;
    w.parity = w.parity ? 0 : 1;
    this.setWandererFrame(w);
    this.wanderOccupied.delete(`${w.tx},${w.ty}`);
    this.wanderOccupied.add(`${nx},${ny}`);
    const dest = this.tileToFoot(nx, ny);
    this.tweens.add({
      targets: [w.sprite, w.shadow],
      x: dest.x,
      y: (target) => (target === w.shadow ? dest.y - 3 : dest.y),
      duration: w.stepMs,
      ease: 'Linear',
      onUpdate: () => this.updateWandererDepth(w),
      onComplete: () => {
        w.tx = nx;
        w.ty = ny;
        w.moving = false;
        this.updateWandererDepth(w);
        if (w.stepsLeft <= 0) {
          w.wait = w.pauseMin + Math.random() * w.pauseMax;
          this.setWandererFrame(w);
        }
      },
    });
  }

  /**
   * 正面のマスを調べる。
   * カウンター越しにも話せるよう、家具などで塞がれていたら
   * もう1マス先まで見る(道具屋の店主が受付の内側に立っているため)。
   *
   * 宝箱は自分のマスが通れないので、上下左右どこに立っていても
   * 「向いているマス = 宝箱のマス」になる。だから向きを問わず開けられる。
   */
  tryInteract() {
    const [dx, dy] = DIRS[this.facing];
    const here = { tile: { x: this.tx, y: this.ty }, facing: this.facing };
    for (let step = 1; step <= 2; step += 1) {
      const x = this.tx + dx * step;
      const y = this.ty + dy * step;
      if (x < 0 || y < 0 || x >= this.map.cols || y >= this.map.rows) break;
      const npc = this.map.npcs.find((n) => n.tile[0] === x && n.tile[1] === y);
      if (npc) {
        this.onEvent('interact', { ...here, npc });
        return;
      }
      const trigger = this.map.triggerAt(x, y);
      if (trigger && trigger.type === 'look') {
        this.onEvent('interact', { ...here, npc: null, look: trigger.text });
        return;
      }
      if (trigger && trigger.type === 'chest') {
        const chest = (this.map.objects || []).find((o) => o.id === trigger.id);
        if (chest) {
          this.onEvent('interact', {
            ...here,
            npc: null,
            chest,
            openChest: () => {
              chest.opened = true;
              this.openChestSprite(chest.id);
            },
          });
          return;
        }
      }
      // 1マス目が空いているなら、その先に話しかける理由はない
      if (!this.map.isBlocked(x, y)) break;
    }
    this.onEvent('interact', { ...here, npc: null });
  }
}
