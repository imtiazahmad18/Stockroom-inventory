#!/usr/bin/env bash
# run.sh — starts the backend API and frontend dev server together.
#
# Usage:
#   ./run.sh
#
# Ctrl+C stops both — including their child processes. "npm run dev"
# itself spawns node/vite as a grandchild, so killing just the npm
# process isn't enough (it can leave the real server running and the
# port held). Each service is launched via setsid as the leader of its
# own process group, and cleanup() kills that whole group, with a
# SIGKILL fallback if anything ignores SIGTERM.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

# backend/db.js uses node:sqlite, which only exists from Node 22.5 on.
REQUIRED_MAJOR=22
REQUIRED_MINOR=5

CYAN='\033[36m'; MAGENTA='\033[35m'; RED='\033[31m'; RESET='\033[0m'

check_node_version() {
  if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}node is not on PATH.${RESET}" >&2
    exit 1
  fi
  local ver major minor
  ver="$(node -v)"           # e.g. v20.18.0
  major="${ver#v}"; major="${major%%.*}"
  minor="${ver#v*.}"; minor="${minor%%.*}"
  if (( major > REQUIRED_MAJOR || (major == REQUIRED_MAJOR && minor >= REQUIRED_MINOR) )); then
    return 0
  fi
  echo -e "${RED}The backend needs Node >= ${REQUIRED_MAJOR}.${REQUIRED_MINOR} (uses node:sqlite). You're running ${ver}.${RESET}" >&2
  echo "If you use nvm: nvm install ${REQUIRED_MAJOR} && nvm use ${REQUIRED_MAJOR}" >&2
  exit 1
}

BACKEND_PID=""
FRONTEND_PID=""
SHUTTING_DOWN=0

kill_group() {
  local pid="$1" signal="$2"
  [ -n "$pid" ] || return 0
  kill -0 "$pid" 2>/dev/null || return 0
  kill -"$signal" "-$pid" 2>/dev/null
}

cleanup() {
  [ "$SHUTTING_DOWN" = 1 ] && return
  SHUTTING_DOWN=1
  echo
  echo "Stopping backend and frontend…"

  kill_group "$BACKEND_PID" TERM
  kill_group "$FRONTEND_PID" TERM

  local waited=0
  while (( waited < 30 )); do
    kill -0 "$BACKEND_PID" 2>/dev/null || BACKEND_PID=""
    kill -0 "$FRONTEND_PID" 2>/dev/null || FRONTEND_PID=""
    [ -z "$BACKEND_PID" ] && [ -z "$FRONTEND_PID" ] && break
    sleep 0.1
    waited=$((waited + 1))
  done

  kill_group "$BACKEND_PID" KILL
  kill_group "$FRONTEND_PID" KILL

  exit 0
}

trap cleanup INT TERM

check_node_version

echo "Starting backend and frontend…"
echo -e "  ${CYAN}[backend]${RESET}  http://localhost:4000"
echo -e "  ${MAGENTA}[frontend]${RESET} http://localhost:5173"
echo "Press Ctrl+C to stop both."
echo

# $! must be captured directly in this shell right after each background
# launch — routing it through a function called via $(...) would run that
# function in a subshell whose command-substitution pipe the backgrounded
# grandchildren inherit, which hangs the substitution waiting for EOF.
setsid bash -c "cd '$BACKEND_DIR' && exec npm run dev" \
  > >(sed -u "s/^/$(printf "${CYAN}[backend]${RESET}") /") 2>&1 &
BACKEND_PID=$!

setsid bash -c "cd '$FRONTEND_DIR' && exec npm run dev" \
  > >(sed -u "s/^/$(printf "${MAGENTA}[frontend]${RESET}") /") 2>&1 &
FRONTEND_PID=$!

# If either service dies on its own, stop the other instead of leaving a
# single orphaned server running.
wait -n "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
echo "A process exited unexpectedly — stopping the other one."
cleanup
