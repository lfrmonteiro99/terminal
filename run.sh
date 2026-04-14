#!/usr/bin/env bash
# Terminal Engine — dev/onboarding runner.
#
# Usage:
#   ./run.sh           Start daemon + frontend, open browser.
#   ./run.sh --clean   Stop stack, remove volumes, rebuild from scratch.
#   ./run.sh --logs    Tail live logs from both services.
#   ./run.sh stop      Stop the stack (keeps volumes).
#   ./run.sh status    Show container status.
#
# Requires: Docker + Docker Compose v2.
# Everything runs in containers — no Rust or Node toolchain needed on host.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$SCRIPT_DIR"

# --- styling -----------------------------------------------------------------
if [[ -t 1 ]]; then
  C_RESET=$'\e[0m'; C_BOLD=$'\e[1m'; C_RED=$'\e[31m'
  C_GREEN=$'\e[32m'; C_YELLOW=$'\e[33m'; C_BLUE=$'\e[34m'; C_DIM=$'\e[2m'
else
  C_RESET=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_DIM=''
fi
log()  { printf '%s==>%s %s\n' "$C_BLUE$C_BOLD" "$C_RESET" "$*"; }
ok()   { printf '%s ✓%s %s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YELLOW$C_BOLD" "$C_RESET" "$*"; }
die()  { printf '%s✗%s %s\n' "$C_RED$C_BOLD" "$C_RESET" "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
command -v docker >/dev/null 2>&1 \
  || die "Docker not installed. https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 \
  || die "Docker daemon not running. Start it and retry."
docker compose version >/dev/null 2>&1 \
  || die "Docker Compose v2 not available. Upgrade to Docker Desktop or install the compose plugin."

DAEMON_PORT=3000
FRONTEND_PORT=5173

check_port() {
  local port="$1" label="$2"
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE ":${port}\$"; then
    die "Port ${port} (${label}) already in use. Free it or stop the conflicting process, then retry."
  fi
}

open_browser() {
  local url="$1"
  if   command -v xdg-open   >/dev/null 2>&1; then xdg-open   "$url" >/dev/null 2>&1 &
  elif command -v open       >/dev/null 2>&1; then open       "$url" >/dev/null 2>&1 &
  elif command -v start      >/dev/null 2>&1; then start      "$url" >/dev/null 2>&1 &
  else warn "Could not auto-open browser. Navigate to: $url"
  fi
}

wait_for_daemon() {
  local deadline=$(( $(date +%s) + 60 ))
  log "Waiting for daemon at http://localhost:${DAEMON_PORT} ..."
  while (( $(date +%s) < deadline )); do
    if curl -fsS "http://localhost:${DAEMON_PORT}/health" >/dev/null 2>&1 \
       || curl -fsS --max-time 2 "http://localhost:${DAEMON_PORT}/" >/dev/null 2>&1 \
       || (echo > /dev/tcp/localhost/${DAEMON_PORT}) >/dev/null 2>&1; then
      ok "Daemon is up."
      return 0
    fi
    sleep 1
  done
  die "Daemon did not come up within 60s. Run './run.sh --logs' to investigate."
}

# --- commands ----------------------------------------------------------------
cmd="${1:-up}"
case "$cmd" in
  stop)
    log "Stopping stack..."
    docker compose down
    ok "Stopped."
    ;;

  status)
    docker compose ps
    ;;

  --logs|logs)
    log "Tailing logs (Ctrl+C to exit)..."
    docker compose logs -f --tail=100
    ;;

  --clean|clean)
    log "Stopping stack and removing volumes..."
    docker compose down --volumes
    log "Rebuilding images from scratch..."
    docker compose build --no-cache
    check_port "$DAEMON_PORT" daemon
    check_port "$FRONTEND_PORT" frontend
    log "Starting stack..."
    docker compose up -d
    wait_for_daemon
    ok "Frontend: ${C_BOLD}http://localhost:${FRONTEND_PORT}${C_RESET}"
    open_browser "http://localhost:${FRONTEND_PORT}"
    printf '%sDev auth token:%s dev-token-123 %s(set in docker-compose.yml)%s\n' \
      "$C_DIM" "$C_RESET" "$C_DIM" "$C_RESET"
    ;;

  up|'')
    check_port "$DAEMON_PORT" daemon
    check_port "$FRONTEND_PORT" frontend
    log "Building images (cached layers reused)..."
    docker compose build
    log "Starting stack..."
    docker compose up -d
    wait_for_daemon
    ok "Frontend: ${C_BOLD}http://localhost:${FRONTEND_PORT}${C_RESET}"
    ok "Daemon WS: ws://localhost:${DAEMON_PORT}/ws"
    open_browser "http://localhost:${FRONTEND_PORT}"
    printf '%sDev auth token:%s dev-token-123 %s(set in docker-compose.yml)%s\n' \
      "$C_DIM" "$C_RESET" "$C_DIM" "$C_RESET"
    printf '%sTip:%s  ./run.sh --logs   tail logs\n' "$C_DIM" "$C_RESET"
    printf '%s     %s  ./run.sh stop     stop the stack\n' "$C_DIM" "$C_RESET"
    ;;

  help|-h|--help)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    ;;

  *)
    die "Unknown command: $cmd (try './run.sh --help')"
    ;;
esac
