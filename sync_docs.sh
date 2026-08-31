#!/bin/bash
# sync_docs.sh — Synchronise pwa/ vers docs/ puis commit & push
# Usage : ./sync_docs.sh "message de commit"

set -e

MSG="${1:-sync: mise à jour docs depuis pwa}"

echo "🔄 Synchronisation pwa/ → docs/..."

# Fichiers JS
cp pwa/js/app.js       docs/js/app.js
cp pwa/js/auth.js      docs/js/auth.js
cp pwa/js/bathy.js     docs/js/bathy.js
cp pwa/js/carte.js     docs/js/carte.js
cp pwa/js/config.js    docs/js/config.js
cp pwa/js/courants.js  docs/js/courants.js
cp pwa/js/marees.js    docs/js/marees.js
cp pwa/js/mareesite.js docs/js/mareesite.js
cp pwa/js/meteo.js     docs/js/meteo.js
cp pwa/js/navigation.js docs/js/navigation.js
cp pwa/js/port.js      docs/js/port.js
cp pwa/js/prevision.js docs/js/prevision.js
cp pwa/js/sites.js     docs/js/sites.js
cp pwa/js/biplongee.js docs/js/biplongee.js
cp pwa/js/cgu.js       docs/js/cgu.js
cp pwa/js/tutorial.js  docs/js/tutorial.js
cp pwa/js/retourexperience.js docs/js/retourexperience.js
cp pwa/js/mareesexport.js docs/js/mareesexport.js

# CSS
cp pwa/css/style.css   docs/css/style.css

# SW + manifeste
cp pwa/sw.js           docs/sw.js
cp pwa/manifest.json   docs/manifest.json

# index.html (en corrigeant le lien guide-utilisateur)
sed 's|https://gallonr.github.io/diveSMPE/guide-utilisateur.html|guide-utilisateur.html|g' \
    pwa/index.html > docs/index.html

# Données (générées par r/build_all.R) — bathy_sites.json (version allégée),
# courants_grid.json + miniatures bathy. sites.geojson et marees.json ne sont
# plus publiés (servis en live via le Worker Cloudflare) —
# cf. specs/2026-08-31-live-worker-data-design.md.
# Sans cette étape, docs/ (le site publié) reste figé sur d'anciennes
# données même après un build_all.R à jour (incident 2026-08-26).
cp pwa/data/bathy_sites.json  docs/data/bathy_sites.json
if [ -f pwa/data/courants_grid.json ]; then
    cp pwa/data/courants_grid.json docs/data/courants_grid.json
fi
rsync -a --delete pwa/data/thumbs/ docs/data/thumbs/

# Marées : publiées dans le KV Cloudflare (données non publiques, cf.
# specs/2026-08-31-live-worker-data-design.md) plutôt que committées.
# wrangler peut être installé globalement (wrangler dans le PATH) ou n'être
# joignable que via npx — on gère les deux cas.
if command -v wrangler >/dev/null 2>&1; then
    WRANGLER_CMD="wrangler"
elif command -v npx >/dev/null 2>&1 && (cd cloudflare-worker && npx wrangler --version >/dev/null 2>&1); then
    WRANGLER_CMD="npx wrangler"
else
    WRANGLER_CMD=""
fi

if [ -n "$WRANGLER_CMD" ] && [ -f pwa/data/marees.json ]; then
    echo "🌊 Publication marees.json dans le KV Cloudflare ($WRANGLER_CMD)..."
    (cd cloudflare-worker && $WRANGLER_CMD kv key put "marees" --binding=MAREES_KV --path=../pwa/data/marees.json --remote)
else
    echo "⚠️  wrangler introuvable (ni global ni via npx) ou pwa/data/marees.json absent — publication KV ignorée."
fi

echo "✅ Synchronisation terminée"

# Commit & push
git add -A
git commit -m "$MSG"
git push origin HEAD

echo "🚀 Commit et push effectués : $MSG"
