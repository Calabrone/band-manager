#!/usr/bin/env bash
# Scarica il DB SQLite da Aruba (FTP) in backups/ con timestamp. Da lanciare da band-manager/.
#   deploy/backup_db_aruba.sh [cartella]     (default: band)
# Fare un backup prima di ogni deploy che tocchi il backend.
set -euo pipefail
cd "$(dirname "$0")/.."
TARGET="${1:-band}"
[[ "$TARGET" =~ ^[A-Za-z0-9_-]+$ ]] || { echo "nome cartella non valido: $TARGET"; exit 1; }

set -a; . <(tr -d '\r' < deploy/.ftp.env | grep -E '^[A-Z_]+='); set +a
SSL_OPT=""; [[ "${FTP_SSL:-false}" == "true" ]] && SSL_OPT="--ssl-reqd"
URL="ftp://$FTP_HOST:${FTP_PORT:-21}$(dirname "$FTP_REMOTE_DIR")/$TARGET/api/data/band_manager.db"

mkdir -p backups
OUT="backups/band_manager_${TARGET}_$(date +%Y%m%d_%H%M%S).db"
curl -sS --max-time 120 $SSL_OPT -u "$FTP_USER:$FTP_PASSWORD" "$URL" -o "$OUT"
python - "$OUT" <<'EOF'
import sqlite3, sys
c = sqlite3.connect(sys.argv[1])
print("integrity_check:", c.execute("pragma integrity_check").fetchone()[0])
print({t: c.execute(f"select count(*) from {t}").fetchone()[0] for t in ("user", "song", "appsetting", "comment", "songlike")})
EOF
echo "Backup: $OUT"
