# モンスター育成ゲーム (プロトタイプ)

スマホの横持ちで遊ぶ、モンスター育成ゲームの試作です。
はじまりのイベントで1体もらい、町から旅立ってダンジョンで戦い、
仲間にして、育てて、配合して強くしていきます。

**遊ぶ (スマホでどうぞ):** https://h-goto-sb-oss.github.io/monster-raising/

- モンスター285体。すべて自前のドット絵素材から切り出したもの。
- 10タイプ × 10タイプの配合表と、固定レシピ。
- ターン制の戦闘 (最大3体 対 最大3体)。
- 町・内装5か所・ダンジョン3階層を歩けるフィールド (Phaser)。

まだ試作です。進行状況はブラウザの中だけに残ります。

---

## この置き場所の中身

| フォルダ | 中身 |
| --- | --- |
| `game/` | ゲーム本体。React + Phaser + Vite。絵は `game/public/assets/` に入れてある。 |
| `monster_project/` | 素材とデータを作るPythonの道具一式。`build_*.py` と、その出力のJSON。 |

`monster_project/build_*.py` が作ったデータを `game/src/data/*.json` に流し込む、
という組み立てになっています。ゲームを動かすだけならPythonは要りません。

### GitHubに置いていないもの

素材の元データ (合計200MB超) は `.gitignore` で外してあります。手元のPCにだけあります。

- `monster_project/step1_normalized/` … 正規化前後のシートとスプライト、QA画像 (62MB)
- `monster_project/*.html`、`step2_dedup/*.html`、`step2_dedup/*.jpg` … 画像をbase64で焼き込んだ確認用ページ (1枚35MB前後)。`build_*.py` で作り直せる
- `node_modules/`、`game/dist/`、`game/dist-pages/`、`__pycache__/`

ゲームが実際に使う285体は `game/public/assets/monsters/` に取り込み済みなので、
上のものが無くてもゲームは普通に動きます。

---

## 手元で動かす

```
cd game
npm install
npm run dev
```

`http://localhost:5173/` が開きます。スマホの横向き (844×390あたり) を想定した画面です。
ブラウザの検証ツールで端末をスマホにして、横向きにすると本番に近い見え方になります。

本番と同じ形に固めるだけなら:

```
npm run build      # game/dist/ にできる。配信先はサイトの根 (/) 前提
```

---

## GitHub Pages に出し直す

カードゲーム (tri-elements) と同じやり方です。**PowerShell を開いて** 一発:

```powershell
cd C:\Users\pc\.claude\Monser_Raising
git add -A
git commit -m "変更の説明"
.\tools\publish_github.ps1
```

`tools\publish_github.ps1` がやること:

1. GitHubへのログイン確認 (未ログインならブラウザで認証)
2. `master` を push
3. `npm run build:pages` して、その中身だけを `gh-pages` ブランチへ載せ替え
4. GitHub Pages の設定を確認

GitHub Actions は使っていません。手で叩いたときだけ更新されます。
反映は1〜2分かかります。見た目が変わらないときは、スマホ側で
再読み込み (または一度タブを閉じる) を試してください。

### 落とし穴: Git Bash から `--base=/...` を叩かない

`npm run build:pages` の中身は

```
vite build --base=/monster-raising/ --outDir dist-pages
```

です。これを **Git Bash から** 実行すると、Git Bash が「/」始まりの引数を
Windowsのパスだと勘違いして `C:/Program Files/Git/monster-raising/` に書き換えてしまいます。
ビルド自体は成功するのに、出来上がったページはJSとCSSを変な場所に取りに行って404になり、
**真っ白な画面** になります。原因が見えにくく、一度これで時間を溶かしました
(カードゲームのほう、2026-08-28)。

**PowerShell か コマンドプロンプトから実行してください。**
`tools\publish_github.ps1` はPowerShell前提なので、そのまま使うぶんには安全です。

### 落とし穴: 絵のパスは「/」始まりで書いてある

ソースの中では絵を `/assets/monsters/U1-02.png` のように「/」始まりで指しています。
これはサイトの根で配信するときだけ正しく、GitHub Pages の
`https://.../monster-raising/` のような一段下がった場所では全部404になります。
これも画面はエラーにならず「絵だけ出ない」ので気づきにくい形で出ます。

対策として `game/vite.config.js` に `rebase-public-asset-paths` という小さな仕掛けを入れて、
ビルド時に `/assets/` を `/monster-raising/assets/` へ書き換えています。
JS・CSS・JSON をまとめて通すので、新しく絵を足すときも `/assets/...` と
今までどおり書けば大丈夫です。`npm run dev` では何もしません。

---

## 公開ページの設定

GitHub の Settings → Pages で、Source = `Deploy from a branch`、
Branch = `gh-pages` / `(root)` になっています。
GitHub Actions は使っていません (手で `build:pages` して push するだけ)。
