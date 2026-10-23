#!/usr/bin/env bash
# Deploy su Aruba via FTP (curl). Da lanciare dalla cartella band-manager/.
#
#   deploy/deploy_aruba.sh <cartella> [--api] [--frontend]
#
#   <cartella>   sottocartella remota (es. band, band-test) accanto a quella di FTP_REMOTE_DIR
#   --api        carica php-api/ in <cartella>/api  (config.php e data/ NON vengono mai sovrascritti)
#   --frontend   compila (npm run build) e carica dist/ in <cartella>/
#   senza flag   equivale a --api --frontend
#
# Credenziali in deploy/.ftp.env (non versionato). Scrive solo dentro <cartella>.
set -euo pipefail

cd "$(dirname "$0")/.."
TARGET="${1:-}"
[[ -n "$TARGET" && "$TARGET" != --* ]] || { echo "uso: $0 <cartella> [--api] [--frontend]"; exit 1; }
[[ "$TARGET" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "nome cartella non valido: $TARGET"; exit 1; }
shift
DO_API=0; DO_FRONT=0
for a in "$@"; do case "$a" in --api) DO_API=1;; --frontend) DO_FRONT=1;; *) echo "opzione sconosciuta: $a"; exit 1;; esac; done
[[ $DO_API -eq 0 && $DO_FRONT -eq 0 ]] && DO_API=1 && DO_FRONT=1

set -a; . <(tr -d '\r' < deploy/.ftp.env | grep -E '^[A-Z_]+='); set +a
SCHEME="ftp"; SSL_OPT=""
if [[ "${FTP_SSL:-false}" == "true" ]]; then SSL_OPT="--ssl-reqd"; fi
REMOTE_ROOT="$(dirname "$FTP_REMOTE_DIR")"          # es. /www.motorn.it
REMOTE="$REMOTE_ROOT/$TARGET"
BASE_URL="$SCHEME://$FTP_HOST:${FTP_PORT:-21}$REMOTE"
CURL=(curl -sS --max-time 120 $SSL_OPT -u "$FTP_USER:$FTP_PASSWORD" --ftp-create-dirs)

upload() {  # upload <file locale> <percorso remoto relativo>
  "${CURL[@]}" -T "$1" "$BASE_URL/$2"
}

remote_has() {  # remote_has <cartella relativa> <nome>
  curl -sS --max-time 30 $SSL_OPT -u "$FTP_USER:$FTP_PASSWORD" "$BASE_URL/$1/" 2>/dev/null | tr -d '\r' | awk '{print $NF}' | grep -qx "$2"
}

echo "== Target: $REMOTE"

if [[ $DO_API -eq 1 ]]; then
  echo "== API"
  n=0
  while IFS= read -r -d '' f; do
    rel="${f#php-api/}"
    case "$rel" in
      config.php) continue ;;                                  # mai sovrascrivere la config
      data/.htaccess) ;;                                       # solo la protezione, non i dati
      data/*) continue ;;
    esac
    upload "$f" "api/$rel"; n=$((n+1))
  done < <(find php-api -type f -print0)
  upload frontend/public/.htaccess ".htaccess"                  # routing /api e fallback SPA
  echo "   $n file caricati (+ .htaccess radice)"

  if ! remote_has api config.php; then
    echo "   config.php assente: lo creo con una SECRET_KEY nuova"
    key="$(head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    tmp="$(mktemp)"
    sed "s/CAMBIA-QUESTA-CHIAVE/$key/" php-api/config.example.php > "$tmp"
    upload "$tmp" "api/config.php"; rm -f "$tmp"
  fi
fi

if [[ $DO_FRONT -eq 1 ]]; then
  echo "== Frontend"
  (cd frontend && npm run build >/dev/null)
  [[ -f frontend/dist/.htaccess ]] || { echo "dist/.htaccess mancante (public/.htaccess non copiato)"; exit 1; }
  n=0
  while IFS= read -r -d '' f; do
    upload "$f" "${f#frontend/dist/}"; n=$((n+1))
  done < <(find frontend/dist -type f -print0)
  echo "   $n file caricati"
fi

echo "== Fatto: https://www.motorn.it/$TARGET/"
