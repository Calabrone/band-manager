#!/bin/bash
# Setup iniziale Band Manager su Raspberry Pi 4
# Eseguire una sola volta come utente szz

set -e

PROJECT_DIR="/home/szz/Documents/progetti/band"
BACKEND_DIR="$PROJECT_DIR/backend"
FRONTEND_DIR="$PROJECT_DIR/frontend"

echo "=== Band Manager — Setup RPi ==="

# Crea struttura
mkdir -p "$BACKEND_DIR" "$FRONTEND_DIR"

# Python venv
echo ">>> Creo virtual environment Python..."
python3 -m venv "$PROJECT_DIR/venv"
source "$PROJECT_DIR/venv/bin/activate"
pip install --upgrade pip
pip install -r "$BACKEND_DIR/requirements.txt"

# Node (assicurarsi che sia installato)
if ! command -v node &> /dev/null; then
    echo ">>> Installo Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Frontend dependencies e build
echo ">>> Build frontend..."
cd "$FRONTEND_DIR"
npm install
npm run build

# .env
if [ ! -f "$BACKEND_DIR/.env" ]; then
    SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    echo "SECRET_KEY=$SECRET" > "$BACKEND_DIR/.env"
    echo ">>> Creato $BACKEND_DIR/.env con SECRET_KEY generato"
fi

# Nginx
echo ">>> Configuro Nginx..."
sudo cp "$PROJECT_DIR/deploy/nginx.conf" /etc/nginx/sites-available/band-manager
sudo ln -sf /etc/nginx/sites-available/band-manager /etc/nginx/sites-enabled/band-manager
sudo nginx -t && sudo systemctl reload nginx

# Systemd
echo ">>> Configuro servizio systemd..."
sudo cp "$PROJECT_DIR/deploy/band-backend.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable band-backend
sudo systemctl start band-backend

echo ""
echo "=== Setup completato ==="
echo "Backend:  http://127.0.0.1:8001"
echo "Frontend: http://$(hostname -I | awk '{print $1}'):82/band/"
echo "Credenziali default: admin / admin123 (cambia subito dalla pagina Admin)"
