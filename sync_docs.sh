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
cp pwa/js/marees.js    docs/js/marees.js
cp pwa/js/mareesite.js docs/js/mareesite.js
cp pwa/js/meteo.js     docs/js/meteo.js
cp pwa/js/navigation.js docs/js/navigation.js
cp pwa/js/port.js      docs/js/port.js
cp pwa/js/prevision.js docs/js/prevision.js
cp pwa/js/sites.js     docs/js/sites.js

# CSS
cp pwa/css/style.css   docs/css/style.css

# SW + manifeste
cp pwa/sw.js           docs/sw.js
cp pwa/manifest.json   docs/manifest.json

# index.html (en corrigeant le lien guide-utilisateur)
sed 's|https://gallonr.github.io/diveSMPE/guide-utilisateur.html|guide-utilisateur.html|g' \
    pwa/index.html > docs/index.html

echo "✅ Synchronisation terminée"

# Commit & push
git add -A
git commit -m "$MSG"
git push origin HEAD

echo "🚀 Commit et push effectués : $MSG"
