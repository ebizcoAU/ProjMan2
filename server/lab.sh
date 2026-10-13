#!/usr/bin/env bash
# server/lab.sh — start/stop the ProjMan2 lab (dev) servers on this Mac.
# Run by the PM (Owner ruling 2026-10-14). Server Dev owns code + migrations.
#
#   ./lab.sh start   [svc...]   start services (default: all)
#   ./lab.sh stop    [svc...]   stop services
#   ./lab.sh restart [svc...]
#   ./lab.sh status             port + health of every service
#   ./lab.sh logs <svc>         tail -f the service log
#
# Services: api (5100), dashboard (5101), portal (5102), veritrade (5103).
#
# Safety: stop only kills the process tree that LISTENS on the service's port
# AND whose working directory is inside this repo's service folder. Never
# pkill by command line — nexus/ftpos run identical `nodemon`/`next` commands.
# Never touches MQTT (1883/9001) or MySQL (3306). The Mosquitto broker is
# SHARED (run from nexus/api/scripts/mosquitto, real ozlock hardware on it) —
# ProjMan2 is a client only (topic prefix projman2/). This script only CHECKS it.
# ⚠ The api sends REAL email/SMS (EMAIL_ENABLED/SMS_ENABLED in api/.env).

set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${PROJMAN2_LOG_DIR:-$HOME/projman2-logs}"
ALL="api dashboard portal veritrade"

port_of() {
  case "$1" in
    api) echo 5100 ;; dashboard) echo 5101 ;; portal) echo 5102 ;; veritrade) echo 5103 ;;
    *) echo "unknown service: $1 (expected: $ALL)" >&2; return 1 ;;
  esac
}

listener_pid() { lsof -nP -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | head -1; }
cwd_of()       { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'; }

# Topmost ancestor of $1 whose cwd is still inside $2 (the npm/nodemon parent).
root_of() {
  local pid=$1 dir=$2 parent
  while :; do
    parent=$(ps -o ppid= -p "$pid" | tr -d ' ')
    [ -z "$parent" ] || [ "$parent" -le 1 ] && break
    case "$(cwd_of "$parent")" in "$dir"|"$dir"/*) pid=$parent ;; *) break ;; esac
  done
  echo "$pid"
}

kill_tree() {
  local c
  for c in $(pgrep -P "$1"); do kill_tree "$c"; done
  kill "$1" 2>/dev/null
}

health() {
  local svc=$1 port=$2
  if [ "$svc" = api ]; then
    curl -s -m 5 "http://localhost:$port/internal/health" || echo "(no response)"
  else
    curl -s -o /dev/null -m 60 -w "HTTP %{http_code}" "http://localhost:$port/" || echo "(no response)"
  fi
}

start_one() {
  local svc=$1 port dir pid
  port=$(port_of "$svc") || return 1
  dir="$ROOT/$svc"
  if pid=$(listener_pid "$port") && [ -n "$pid" ]; then
    echo "$svc: already listening on :$port (pid $pid)"; return 0
  fi
  [ -d "$dir/node_modules" ] || { echo "$svc: no node_modules — run npm install in $dir first" >&2; return 1; }
  mkdir -p "$LOG_DIR"
  (cd "$dir" && nohup npm run dev >"$LOG_DIR/$svc-$port.log" 2>&1 &)
  for _ in $(seq 1 30); do
    [ -n "$(listener_pid "$port")" ] && break
    sleep 1
  done
  if [ -n "$(listener_pid "$port")" ]; then
    echo "$svc: up on :$port — $(health "$svc" "$port")"
    if [ "$svc" = api ]; then sleep 2; grep -m1 '\[MQTT\]' "$LOG_DIR/$svc-$port.log" || echo "api: ⚠ no MQTT line in log yet"; fi
    return 0
  else
    echo "$svc: did NOT come up on :$port — see $LOG_DIR/$svc-$port.log" >&2; return 1
  fi
}

stop_one() {
  local svc=$1 port dir pid top
  port=$(port_of "$svc") || return 1
  dir="$ROOT/$svc"
  pid=$(listener_pid "$port")
  [ -z "$pid" ] && { echo "$svc: not running"; return 0; }
  case "$(cwd_of "$pid")" in
    "$dir"|"$dir"/*) ;;
    *) echo "$svc: :$port is held by pid $pid outside $dir — NOT killing it" >&2; return 1 ;;
  esac
  top=$(root_of "$pid" "$dir")
  kill_tree "$top"
  for _ in $(seq 1 10); do [ -z "$(listener_pid "$port")" ] && break; sleep 1; done
  if [ -z "$(listener_pid "$port")" ]; then echo "$svc: stopped"; else echo "$svc: still listening on :$port" >&2; return 1; fi
}

deps() {
  local m=DOWN w=DOWN d=DOWN
  nc -z localhost 1883 2>/dev/null && m=up
  nc -z localhost 9001 2>/dev/null && w=up
  nc -z localhost 3306 2>/dev/null && d=up
  printf '%-10s :1883 %s  :9001(ws) %s   (shared broker — not managed here)\n' mqtt "$m" "$w"
  printf '%-10s :3306 %s\n' mysql "$d"
  [ "$m" = up ] && [ "$d" = up ]
}

status_all() {
  local svc port pid
  deps
  for svc in $ALL; do
    port=$(port_of "$svc")
    pid=$(listener_pid "$port")
    if [ -n "$pid" ]; then printf '%-10s :%s  UP   pid %-6s %s\n' "$svc" "$port" "$pid" "$(health "$svc" "$port")"
    else                   printf '%-10s :%s  DOWN\n' "$svc" "$port"; fi
  done
}

cmd=${1:-status}; shift || true
svcs=${*:-$ALL}
rc=0
case "$cmd" in
  start)   deps >/dev/null || { deps; echo "⚠ MQTT broker or MySQL is down — ask the Owner; do NOT start the shared broker from here" >&2; }
           for s in $svcs; do start_one "$s" || rc=1; done ;;
  stop)    for s in $svcs; do stop_one  "$s" || rc=1; done ;;
  restart) for s in $svcs; do stop_one "$s" && start_one "$s" || rc=1; done ;;
  status)  status_all ;;
  logs)    p=$(port_of "${1:?usage: lab.sh logs <svc>}") && exec tail -f "$LOG_DIR/$1-$p.log" ;;
  *)       sed -n '2,17p' "$0"; exit 1 ;;
esac
exit $rc
