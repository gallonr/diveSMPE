#!/bin/bash
# build_notice_pdf.sh — Génère NOTICE_TECHNIQUE.pdf depuis NOTICE_TECHNIQUE.md
# avec la charte couleur SMPE (Côte d'Émeraude) et des encarts info / attention.
#
# Dépendances : pandoc, weasyprint, python3
#   sudo apt install pandoc
#   pipx install weasyprint      (ou : conda install -c conda-forge weasyprint)
#
# Usage : ./build_notice_pdf.sh

set -e
cd "$(dirname "$0")"

SRC="NOTICE_TECHNIQUE.md"
OUT="NOTICE_TECHNIQUE.pdf"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

DATE_FR="$(date '+%d/%m/%Y')"

# ── 1. Pré-traitement du Markdown ────────────────────────────────────────────
#  - retire le titre H1 (repris sur la page de couverture)
#  - retire la table des matières manuelle (pandoc en génère une paginée)
python3 - "$SRC" > "$WORK/notice.md" <<'PY'
import sys, re
txt = open(sys.argv[1], encoding="utf-8").read().splitlines()
out, i = [], 0
while i < len(txt):
    line = txt[i]
    if i == 0 and line.startswith("# "):
        i += 1
        continue
    if line.strip() == "## Table des matières":
        i += 1
        # avaler jusqu'au prochain séparateur horizontal inclus
        while i < len(txt) and txt[i].strip() != "---":
            i += 1
        i += 1  # saute le ---
        continue
    out.append(line)
    i += 1
print("\n".join(out).strip() + "\n")
PY

# ── 2. Feuille de style (charte SMPE, mise en page impression) ───────────────
cat > "$WORK/style.css" <<'CSS'
:root {
  --emeraude:       #3aafa8;
  --emeraude-dark:  #0c3e44;
  --emeraude-deep:  #031F1B;
  --emeraude-mid:   #267973;
  --emeraude-light: #69d6d0;
  --emeraude-pale:  #b3d7d4;
  --orange-smpe:    #ffa301;
  --orange-light:   #ffba41;
  --vert-ok:        #2ecc71;
  --orange-warn:    #f39c12;
  --rouge:          #e74c3c;
  --blanc:          #f8f8f4;
  --encre:          #16302c;
  --encre-doux:     #3f5b56;
}

/* ── Pages ────────────────────────────────────────────────────────────────── */
@page {
  size: A4;
  margin: 18mm 16mm 20mm 16mm;
  @bottom-left {
    content: "Notice technique diveSMPE";
    white-space: nowrap;
    font-family: 'Signika', 'DejaVu Sans', sans-serif;
    font-size: 7.5pt;
    color: var(--encre-doux);
  }
  @bottom-right {
    content: "p. " counter(page) " / " counter(pages);
    white-space: nowrap;
    font-family: 'Signika', 'DejaVu Sans', sans-serif;
    font-size: 7.5pt;
    color: var(--encre-doux);
  }
  @bottom-center {
    content: "";
    border-top: 0.6pt solid var(--emeraude-pale);
    width: 100%;
  }
}
@page cover {
  margin: 0;
  @bottom-left  { content: none; }
  @bottom-right { content: none; }
  @bottom-center { content: none; }
}
@page toc  { }

/* ── Base ─────────────────────────────────────────────────────────────────── */
html { font-size: 10pt; }
body {
  /* Noto Color Emoji volontairement absent du stack : présent, WeasyPrint y
     route aussi les chiffres ASCII (advance emoji → "2 0 2 6"). L'emoji reste
     rendu via le repli automatique de WeasyPrint. */
  font-family: 'Signika', 'DejaVu Sans', sans-serif;
  font-weight: 400;
  line-height: 1.5;
  color: var(--encre);
  background: #ffffff;
  hyphens: none;
}
p { margin: 0 0 .55em; orphans: 2; widows: 2; }
strong { font-weight: 700; color: var(--emeraude-dark); }
em { color: var(--encre-doux); }
a { color: var(--emeraude-mid); text-decoration: none; }
sup, sub { line-height: 0; }

/* ── Page de couverture ──────────────────────────────────────────────────── */
.cover {
  page: cover;
  break-after: page;
  box-sizing: border-box;
  position: relative;
  color: var(--blanc);
  background: var(--emeraude-deep);
  padding: 46mm 24mm 24mm;
  height: 296mm;
  width: 210mm;
  overflow: hidden;
}
.cover h1 { break-before: avoid; }
.cover h1::before { content: none; }
.cover::after {
  content: "";
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 10mm;
  background: var(--orange-smpe);
}
.cover .kicker {
  font-size: 10pt;
  letter-spacing: .28em;
  text-transform: uppercase;
  color: var(--emeraude-light);
  margin-bottom: 10mm;
}
.cover h1 {
  font-size: 34pt;
  line-height: 1.12;
  font-weight: 700;
  color: #ffffff;
  border: none;
  margin: 0 0 6mm;
  padding: 0;
}
.cover .sub {
  font-size: 12.5pt;
  font-weight: 300;
  color: var(--emeraude-pale);
  max-width: 130mm;
}
.cover .swatches {
  margin: 16mm 0 10mm;
  display: flex;
  gap: 0;
}
.cover .swatches span {
  display: inline-block;
  width: 26mm;
  height: 6mm;
}
.cover .meta {
  position: absolute;
  bottom: 24mm;
  font-size: 9.5pt;
  color: var(--emeraude-pale);
  line-height: 1.7;
}
.cover .meta .big { color: #fff; font-weight: 600; font-size: 11pt; }

/* ── Sommaire ────────────────────────────────────────────────────────────── */
.toc-title {
  page: toc;
  break-before: page;
  break-after: avoid;
  font-size: 20pt;
  font-weight: 700;
  color: var(--emeraude-dark);
  border-bottom: 2.5pt solid var(--emeraude);
  padding-bottom: 3mm;
  margin: 0 0 6mm;
}
.toc-title::before {
  content: "";
  display: block;
  width: 16mm; height: 3pt;
  background: var(--orange-smpe);
  margin-bottom: 3mm;
}
#TOC {
  page: toc;
  break-after: page;
}
#TOC ul { list-style: none; margin: 0; padding: 0; }
#TOC li { margin: .12em 0; }
#TOC > ul > li { margin-top: .5em; }
#TOC > ul > li > a { font-weight: 700; color: var(--emeraude-dark); }
#TOC ul ul { padding-left: 6mm; }
#TOC ul ul a { color: var(--encre); font-weight: 400; }
#TOC a { display: block; }
#TOC a::after {
  content: leader('. ') target-counter(attr(href), page);
  color: var(--encre-doux);
  font-weight: 400;
}

/* ── Titres ──────────────────────────────────────────────────────────────── */
h1, h2, h3, h4 {
  font-family: 'Signika', 'DejaVu Sans', sans-serif;
  font-weight: 700;
  color: var(--emeraude-dark);
  break-after: avoid;
  break-inside: avoid;
  line-height: 1.25;
}
h1 {
  font-size: 19pt;
  font-weight: 700;
  break-before: page;
  margin: 0 0 5mm;
  padding-bottom: 2.5mm;
  border-bottom: 2.5pt solid var(--emeraude);
}
h1::before {
  content: "";
  display: block;
  width: 16mm;
  height: 3pt;
  background: var(--orange-smpe);
  margin-bottom: 3mm;
}
h2 {
  font-size: 13.5pt;
  font-weight: 700;
  margin: 8mm 0 3mm;
  padding-left: 3.5mm;
  border-left: 4pt solid var(--emeraude);
}
h3 {
  font-size: 11.5pt;
  font-weight: 700;
  color: var(--emeraude-mid);
  margin: 6mm 0 2mm;
}
h4 {
  font-size: 10pt;
  font-weight: 700;
  color: #9a6200;
  margin: 4mm 0 1.5mm;
}

/* ── Listes ──────────────────────────────────────────────────────────────── */
ul, ol { margin: 0 0 .6em; padding-left: 5.5mm; }
li { margin: .12em 0; }
li > p { margin: 0 0 .3em; }

/* ── Tableaux ────────────────────────────────────────────────────────────── */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 2mm 0 4mm;
  font-size: 8.7pt;
  break-inside: auto;
}
thead { display: table-header-group; }
th {
  background: var(--emeraude-dark);
  color: #fff;
  font-weight: 600;
  text-align: left;
  padding: 2mm 2.4mm;
  border: 0.4pt solid var(--emeraude-dark);
}
td {
  padding: 1.8mm 2.4mm;
  border: 0.4pt solid #d3e6e3;
  vertical-align: top;
}
tbody tr { break-inside: avoid; }
tbody tr:nth-child(even) { background: #f1f8f7; }

/* ── Code ────────────────────────────────────────────────────────────────── */
code {
  font-family: 'DejaVu Sans Mono', monospace;
  font-size: 8.4pt;
  background: #e9f4f2;
  color: var(--emeraude-dark);
  padding: 0.3mm 1mm;
  border-radius: 2px;
}
pre {
  font-family: 'DejaVu Sans Mono', monospace;
  font-size: 7.4pt;
  line-height: 1.35;
  background: #f1f8f7;
  border: 0.5pt solid #d3e6e3;
  border-left: 3pt solid var(--emeraude);
  border-radius: 3px;
  padding: 3mm 3.5mm;
  margin: 2mm 0 4mm;
  white-space: pre;
  overflow-wrap: normal;
  break-inside: avoid;
}
pre code { background: none; padding: 0; font-size: inherit; color: var(--encre); }

/* ── Encarts (info / attention) ─────────────────────────────────────────── */
.callout {
  margin: 3mm 0 4mm;
  padding: 2.6mm 4mm 2.6mm 4mm;
  border-left: 4pt solid;
  border-radius: 3px;
  font-size: 9pt;
  break-inside: avoid;
}
.callout > :last-child { margin-bottom: 0; }
.callout::before {
  display: block;
  font-size: 7.5pt;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
  margin-bottom: 1.4mm;
}
.callout.infobox {
  background: #ecf6f5;
  border-left-color: var(--emeraude);
}
.callout.infobox::before {
  content: "\2139  Information";
  color: var(--emeraude-mid);
}
.callout.alertbox {
  background: #fff5e3;
  border-left-color: var(--orange-smpe);
}
.callout.alertbox::before {
  content: "\26A0  Attention";
  color: #9a6200;
}
.callout code { background: rgba(255,255,255,.65); }

hr {
  border: none;
  border-top: 0.6pt solid var(--emeraude-pale);
  margin: 5mm 0;
}

blockquote {
  margin: 3mm 0;
  padding-left: 4mm;
  border-left: 3pt solid var(--emeraude-pale);
  color: var(--encre-doux);
}
CSS

# ── 3. Gabarit pandoc (couverture + sommaire + corps) ──────────────────────
cat > "$WORK/template.html" <<'TPL'
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>$title$</title>
  <!--INJECT-STYLE-->
</head>
<body>

<section class="cover">
  <div class="kicker">Club SMPE — Saint-Malo Plongée Emeraude</div>
  <h1>$title$</h1>
  <div class="sub">$subtitle$</div>
  <div class="swatches">
    <span style="background:#0c3e44"></span>
    <span style="background:#267973"></span>
    <span style="background:#3aafa8"></span>
    <span style="background:#69d6d0"></span>
    <span style="background:#ffa301"></span>
  </div>
  <div class="meta">
    <div class="big">diveSMPE</div>
    Baie de Saint-Malo · Application PWA offline<br>
    Notice technique &amp; notice d'utilisation<br>
    $date$
  </div>
</section>

$if(table-of-contents)$
<h1 class="toc-title">Sommaire</h1>
<nav id="TOC">
$table-of-contents$
</nav>
$endif$

$body$

</body>
</html>
TPL

# ── 4. Markdown → HTML ────────────────────────────────────────────────────
pandoc "$WORK/notice.md" \
  -f gfm+tex_math_dollars-yaml_metadata_block \
  -t html5 \
  --standalone \
  --toc --toc-depth=3 \
  --template="$WORK/template.html" \
  --metadata title="Notice technique — diveSMPE" \
  --metadata subtitle="Structure de l'application, rôle de chaque script, module et widget, et notice d'utilisation pour smartphone, tablette et ordinateur." \
  --metadata date="$DATE_FR" \
  -o "$WORK/notice.html"

# Injection de la feuille de style dans le <head>
python3 - "$WORK/notice.html" "$WORK/style.css" <<'PY'
import sys
html_path, css_path = sys.argv[1], sys.argv[2]
html = open(html_path, encoding="utf-8").read()
css = open(css_path, encoding="utf-8").read()
html = html.replace("<!--INJECT-STYLE-->", "<style>\n" + css + "\n</style>", 1)
open(html_path, "w", encoding="utf-8").write(html)
PY

# ── 5. blockquotes → encarts .infobox / .alertbox ─────────────────────────
python3 - "$WORK/notice.html" <<'PY'
import sys, re
p = sys.argv[1]
html = open(p, encoding="utf-8").read()

def repl(m):
    inner = m.group(1)
    is_alert = ("⚠" in inner) or ("Règle</strong>" in inner) or ("NE PAS" in inner)
    cls = "alertbox" if is_alert else "infobox"
    # retire une puce d'icône initiale (⚠️ / ℹ️) déjà portée par l'encart
    inner = re.sub(r'(<p>)\s*(?:⚠️?|ℹ️?|⚠|ℹ)[\s ]*', r'\1', inner, count=1)
    return f'<div class="callout {cls}">{inner}</div>'

html = re.sub(r'<blockquote>(.*?)</blockquote>', repl, html, flags=re.S)
open(p, "w", encoding="utf-8").write(html)
PY

# ── 6. HTML → PDF ────────────────────────────────────────────────────────
weasyprint "$WORK/notice.html" "$OUT"

echo "✅ $OUT généré ($(du -h "$OUT" | cut -f1))"
