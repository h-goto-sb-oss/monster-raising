# ============================================================
# GitHub Pages への公開。既に一度実行していれば再実行してもOK。
#
#   1. GitHubへのログイン（未ログインのときだけ、ブラウザでコードを入力）
#   2. リポジトリ作成＋push（既にあれば最新をpushするだけ）
#   3. game/dist-pages/ の中身を gh-pages ブランチへ反映してGitHub Pagesを有効化
#
#   GitHub Pages の「ブランチから配信」は / か /docs しか選べないので、
#   master ブランチのファイル構成には手を加えず、gh-pages という
#   専用ブランチのルートに、ビルドしたものだけを置いて配信する。
#
#   ★必ず PowerShell から実行すること。
#     Git Bash から `vite build --base=/monster-raising/` を叩くと、
#     Git Bash が「/」始まりの引数をWindowsのパスと勘違いして
#     C:/Program Files/Git/monster-raising/ に書き換えてしまう。
#     ビルドは成功するのに公開ページは真っ白（JS/CSSが404）になる。
#
#   使い方: このプロジェクトのフォルダで PowerShell を開いて
#     .\tools\publish_github.ps1
# ============================================================
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

$repo = "monster-raising"

$gh = "C:\Program Files\GitHub CLI\gh.exe"
if (-not (Test-Path $gh)) { $gh = "gh" }   # PATHに通っていればそちらを使う

Write-Host "== 1. GitHubへのログインを確認します ==" -ForegroundColor Cyan
& $gh auth status *>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "未ログインです。表示されるコードをブラウザで入力してください" -ForegroundColor Cyan
  & $gh auth login --hostname github.com --git-protocol https --web
} else {
  Write-Host "ログイン済みでした。そのまま進めます" -ForegroundColor DarkGray
}
$owner = & $gh api user --jq .login

Write-Host ""
Write-Host "== 2. リポジトリを作って push します ==" -ForegroundColor Cyan
& $gh repo view "$owner/$repo" *>$null
if ($LASTEXITCODE -eq 0) {
  Write-Host "リポジトリは既に有ります。最新の内容をpushします" -ForegroundColor DarkGray
  if (-not (git remote get-url origin 2>$null)) {
    git remote add origin "https://github.com/$owner/$repo.git"
  }
  git push -u origin HEAD
} else {
  & $gh repo create $repo --public --source=. --remote=origin --push
}

Write-Host ""
Write-Host "== 3. Pages用にビルドして gh-pages ブランチへ配信します ==" -ForegroundColor Cyan
# https://<ユーザー名>.github.io/monster-raising/ のようにサブパスで配信されるので、
# 素材のパスもそれに合わせて --base で焼き込む（通常の npm run build とは別出力）。
Remove-Item -Recurse -Force game\dist-pages -ErrorAction SilentlyContinue
Push-Location game
npm run build:pages
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "ビルドに失敗しました" }
Pop-Location

# 現在のリポジトリを一切汚さないよう、専用の worktree（別フォルダ）で
# gh-pages ブランチを作り直して push する。
$worktree = Join-Path $env:TEMP "$repo-gh-pages"
Remove-Item -Recurse -Force $worktree -ErrorAction SilentlyContinue
git branch -D gh-pages 2>$null | Out-Null
git worktree prune
git worktree add --orphan -b gh-pages $worktree

Copy-Item game\dist-pages\* $worktree -Recurse -Force
# .nojekyll が無いと GitHub Pages が Jekyll として処理して、
# 「_」で始まるファイルなどを勝手に外してしまう。
New-Item -ItemType File -Path (Join-Path $worktree ".nojekyll") -Force | Out-Null

Push-Location $worktree
git add -A
git commit -q -m "Deploy: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push -f origin gh-pages
Pop-Location
git worktree remove $worktree --force

Write-Host ""
Write-Host "== 4. GitHub Pages を有効化します ==" -ForegroundColor Cyan
try {
  & $gh api -X POST "repos/$owner/$repo/pages" -f "source[branch]=gh-pages" -f "source[path]=/" | Out-Null
} catch {
  & $gh api -X PUT "repos/$owner/$repo/pages" -f "source[branch]=gh-pages" -f "source[path]=/" | Out-Null
}

Write-Host ""
Write-Host "公開URL: https://$owner.github.io/$repo/" -ForegroundColor Green
Write-Host "（反映まで1〜2分ほどかかります。今後は素材やコードを変えたら、もう一度このスクリプトを実行してください）"
