#!/usr/bin/env python3
"""JavaScriptなしでも閲覧できる単体HTMLを生成する。"""
from __future__ import annotations
import base64, html, json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
MASTER=ROOT/'step2_dedup'/'monster_master_330.json'
SPRITES=ROOT/'step1_normalized'/'sprites'
OVERVIEW=ROOT/'step1_normalized'/'qa'/'overview.jpg'
DEDUP=ROOT/'step2_dedup'/'dedup_review.jpg'
OUT=ROOT/'monster_project_static.html'

def uri(p:Path)->str:
    mime='image/jpeg' if p.suffix.lower()=='.jpg' else 'image/png'
    return 'data:'+mime+';base64,'+base64.b64encode(p.read_bytes()).decode()

def main():
    rows=json.loads(MASTER.read_text(encoding='utf-8'))
    for r in rows: r['image']=uri(SPRITES/f"{r['id']}.png")
    counts={s:sum(r['status']==s for r in rows) for s in ['採用','保留','除外候補']}
    types=['スライム','ドラゴン','けもの','鳥翼','自然','むし','水棲','物質','不死','幻魔']
    type_counts={t:sum(r['status']!='除外候補' and r['type']==t for r in rows) for t in types}
    cards=[]
    for r in rows:
        sec=''.join(f'<span class="tag">副:{html.escape(x)}</span>' for x in r['secondary_types'])
        cards.append(f'''<article class="monster"><img src="{r['image']}" alt="{html.escape(r['id'])}"><div class="info"><small>{html.escape(r['id'])}・{html.escape(r['tier'])}</small><input value="{html.escape(r['working_name'],quote=True)}" maxlength="8" aria-label="{html.escape(r['id'])} 名前"><p>{html.escape(r['description'])}</p><select aria-label="{html.escape(r['id'])} 判定"><option {'selected' if r['status']=='採用' else ''}>採用</option><option {'selected' if r['status']=='除外候補' else ''}>除外候補</option></select><span class="tag">{html.escape(r['type'])}</span>{sec}</div></article>''')
    recipes=json.loads((ROOT/'step3_fusion'/'fixed_recipe_seeds.json').read_text(encoding='utf-8'))
    recipe_html=''.join(f'<li><b>{html.escape(r["recipe_id"])}</b>　{html.escape(r["bloodline_id"])} + {html.escape(" + ".join(r["partner_ids"]))}　→　<b>{html.escape(r["target_id"])}</b>（{html.escape(r["target_name"])}）<br><small>{html.escape(r["design_rationale"])}</small></li>' for r in recipes)
    type_html=''.join(f'<div class="stat"><b>{type_counts[t]}</b>{t}</div>' for t in types)
    rows_html=''.join(cards)
    doc=f'''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>モンスタープロジェクト・静的版</title><style>
*{{box-sizing:border-box}}html{{scroll-behavior:smooth}}body{{margin:0;background:#0d1320;color:#edf2fb;font-family:system-ui,sans-serif}}header{{position:sticky;top:0;z-index:2;background:#151d30f5;border-bottom:1px solid #34415c;padding:12px 16px}}h1{{font-size:20px;margin:0 0 9px}}nav{{display:flex;gap:7px;flex-wrap:wrap}}nav a{{color:#fff;text-decoration:none;background:#29466a;border:1px solid #536d94;border-radius:7px;padding:8px 11px}}main{{max-width:1400px;margin:auto;padding:15px}}section{{scroll-margin-top:100px;margin:20px 0 42px}}.panel{{background:#171f32;border:1px solid #34415c;border-radius:12px;padding:14px}}.stats{{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:12px 0}}.stat{{background:#171f32;border:1px solid #34415c;border-radius:12px;padding:12px}}.stat b{{display:block;font-size:24px;color:#8fd8ff}}.hero,.compare{{width:100%;border:1px solid #34415c;border-radius:10px;background:#101626}}.hero{{max-height:680px;object-fit:contain;object-position:top}}.compare{{margin-top:10px}}.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:11px}}.monster{{background:#171f32;border:1px solid #34415c;border-radius:11px;overflow:hidden}}.monster img{{display:block;width:100%;height:190px;object-fit:contain;image-rendering:pixelated;background:repeating-conic-gradient(#20283a 0 25%,#182033 0 50%) 0/20px 20px}}.info{{padding:9px}}small{{color:#b9c6db}}input,select{{max-width:100%;background:#101a2c;color:#fff;border:1px solid #516789;border-radius:5px;padding:6px;margin:5px 2px 4px 0}}input{{width:100%}}p{{font-size:13px;color:#c6d0e0;margin:5px 0;min-height:38px}}.tag{{display:inline-block;font-size:11px;background:#2a3958;border-radius:999px;padding:3px 7px;margin:2px}}li{{background:#1a263b;border-left:3px solid #5db5e4;padding:9px;margin:7px 0;list-style:none}}ul{{padding:0}}.note{{color:#c5d0e1;font-size:13px;line-height:1.6}}@media(max-width:550px){{.monster img{{height:155px}}}}
</style></head><body><header><h1>モンスタープロジェクト（JavaScriptなし・単体版）</h1><nav><a href="#home">概要</a><a href="#catalog">330体台帳</a><a href="#dedup">重複比較</a><a href="#fusion">合体設計</a></nav></header><main>
<section id="home"><div class="stats"><div class="stat"><b>330</b>登録画像</div><div class="stat"><b>{counts['採用']}</b>採用</div><div class="stat"><b>{counts['除外候補']}</b>除外候補</div><div class="stat"><b>10</b>タイプ</div></div><div class="panel"><p class="note">固定仕様：1800×1500px、6列×5段、1マス300×300px。各モンスターは同じ座標で切り抜き可能です。入力欄と判定欄は直接変更できますが、JavaScriptなしのため自動保存・書き出しはありません。</p></div><img class="hero" src="{uri(OVERVIEW)}" alt="330体一覧"></section>
<section id="catalog"><div class="panel"><h2>330体台帳</h2><p class="note">名前欄は8文字まで、判定欄は採用／除外候補を選べます。スマホのページ内検索でIDや名前を探せます。</p><div class="stats">{type_html}</div></div><div class="grid">{rows_html}</div></section>
<section id="dedup"><div class="panel"><h2>重複候補18グループ</h2><p class="note">緑が代表案、赤が除外候補です。今回、保留は残していません。</p><img class="compare" src="{uri(DEDUP)}" alt="重複候補比較"></div></section>
<section id="fusion"><div class="panel"><h2>合体設計 v0.1</h2><p class="note">血統側のタイプを主タイプにし、相手側の要素を外見・副タグ・耐性・特技継承へ加える方針です。能力値は未接続です。</p><h3>固定合体 試作30件</h3><ul>{recipe_html}</ul></div></section>
</main></body></html>'''
    OUT.write_text(doc,encoding='utf-8')
    print(OUT,OUT.stat().st_size)

if __name__=='__main__': main()
