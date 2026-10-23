#!/usr/bin/env bash
# Controlla che la build del frontend usi il percorso base atteso (asset, manifest, service worker).
# Uso (da band-manager/):  tests/frontend/check_base.sh [/band/ | /]
set -euo pipefail
cd "$(dirname "$0")/../../frontend"
BASE="${1:-/band/}"

# Git Bash converte i valori che sembrano percorsi (/band/ -> C:/Program Files/Git/band/): lo escludiamo
export MSYS2_ENV_CONV_EXCL=VITE_BASE
VITE_BASE="$BASE" npm run build >/dev/null
fail=0
ok()  { echo "ok   $*"; }
bad() { echo "FAIL $*"; fail=1; }

grep -q "src=\"${BASE}assets/" dist/index.html && ok "index.html: asset sotto $BASE" || bad "index.html: asset non sotto $BASE"
grep -q "href=\"${BASE}apple-touch-icon.png\"" dist/index.html && ok "index.html: icone sotto $BASE" || bad "index.html: icone non sotto $BASE"
manifest=$(ls dist/manifest.webmanifest)
for k in start_url scope id; do
  grep -q "\"$k\":\"$BASE\"" "$manifest" && ok "manifest.$k = $BASE" || bad "manifest.$k != $BASE"
done
grep -q "\"src\":\"${BASE}icon-192.png\"" "$manifest" && ok "manifest: icone sotto $BASE" || bad "manifest: icone non sotto $BASE"
esc="$(printf '%s' "$BASE" | sed 's#/#\\/#g')"   # /band/ -> \/band\/  (come serializzato nella regex di sw.js)
grep -qF "registerRoute(/${esc}api\\/" dist/sw.js && ok "sw.js: NetworkOnly su ${BASE}api/" || bad "sw.js: regola NetworkOnly per ${BASE}api/ mancante"
[[ -f dist/.htaccess ]] && ok "dist/.htaccess presente" || bad "dist/.htaccess mancante"
if [[ "$BASE" == "/" ]]; then
  ! grep -q '/band/' dist/index.html dist/manifest.webmanifest && ok "nessun /band/ residuo" || bad "/band/ residuo con base /"
fi
exit $fail
