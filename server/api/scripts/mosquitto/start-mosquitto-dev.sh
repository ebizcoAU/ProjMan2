#!/bin/bash
# scripts/mosquitto/start-mosquitto-dev.sh
# Sets up and starts local Mosquitto for ProjMan2 development.
# Ported from Nexus's own script, ProjMan2-branded.
#
# Usage:
#   chmod +x scripts/mosquitto/start-mosquitto-dev.sh
#   ./scripts/mosquitto/start-mosquitto-dev.sh

set -e

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ProjMan2 — Local Mosquitto Dev Broker"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if ! command -v mosquitto &> /dev/null; then
  echo -e "${RED}❌ Mosquitto not found.${NC}"
  echo ""
  echo "Install with:"
  echo "  brew install mosquitto"
  echo ""
  exit 1
fi

echo -e "${GREEN}✅ Mosquitto found${NC}: $(mosquitto -v 2>&1 | head -1 || true)"

for PORT in 1883 9001; do
  PID=$(lsof -ti :$PORT 2>/dev/null || true)
  if [ -n "$PID" ]; then
    echo -e "${YELLOW}⚠️  Port $PORT in use (PID $PID) — killing...${NC}"
    kill -9 $PID 2>/dev/null || true
    sleep 0.5
  fi
done

mkdir -p /tmp/mosquitto-projman2
echo -e "${GREEN}✅ Persistence dir${NC}: /tmp/mosquitto-projman2"

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")
echo -e "${GREEN}✅ Mac LAN IP${NC}: $LAN_IP (use this instead of localhost for a physical device over WiFi)"

CONF="$(dirname "$0")/mosquitto.dev.conf"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Mosquitto..."
echo "  Config:     $CONF"
echo "  TCP:        mqtt://localhost:1883     (ProjMan2 API server)"
echo "  WebSocket:  ws://localhost:9001/mqtt  (Dashboard/Portal/VeriTrade browser, or a device on $LAN_IP)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Press Ctrl+C to stop."
echo ""

mosquitto -c "$CONF"
