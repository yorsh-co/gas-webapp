#!/usr/bin/env bash
#
# Install or update gas-webapp — backend, browser client, and peer
# dependencies — as one reviewable unit.
#
# Distributed from https://github.com/yorsh-co/gas-webapp — download this
# file into your own project and run it from there; it isn't meant to be
# subtree'd itself. See the README's Quick Start for the fetch command.
#
# gas-webapp ships as two branches — `dist` (compiled backend) and
# `dist-web` (browser client source) — because `git subtree` imports a
# branch root and has no way to select a subdirectory. gas-error (required)
# and gas-logger (optional, falls back to `console` if omitted) are separate
# repos entirely. This script handles all of it in one pass.
#
# Each target is added or updated based on whether its prefix already exists
# — `git subtree add` fails outright if the directory is already there, and
# that's exactly the condition `pull` requires, so there's no separate verb
# to remember: first run adds everything, every run after that pulls
# whatever's already present. A target you removed on purpose (e.g. deleted
# gas-logger because you don't use it) is treated as never-added and gets
# re-added, not silently skipped.
#
# Usage:
#   scripts/sync-gas-webapp.sh
#   scripts/sync-gas-webapp.sh --backend-only
#
# --backend-only skips the browser client entirely — for a project using
# gas-webapp purely as a server-side API. Peer dependencies are unaffected:
# gas-error and gas-logger are backend dependencies regardless.
#
# Every prefix, ref, and remote defaults to this project's own conventions
# and can be overridden without editing the script:
#
#   GAS_WEBAPP_BACKEND_PREFIX=src/lib/gas-webapp        (matches the backend Quick Start)
#   GAS_WEBAPP_BACKEND_REF=dist
#   GAS_WEBAPP_FRONTEND_PREFIX=src/web/public/js/lib/gas-webapp  (matches GasWebApp's default static.dirs.js)
#   GAS_WEBAPP_FRONTEND_REF=dist-web
#   GAS_WEBAPP_REMOTE=https://github.com/yorsh-co/gas-webapp.git
#   GAS_ERROR_PREFIX=src/lib/gas-error
#   GAS_ERROR_REF=dist
#   GAS_ERROR_REMOTE=https://github.com/yorsh-co/gas-error.git
#   GAS_LOGGER_PREFIX=src/lib/gas-logger
#   GAS_LOGGER_REF=dist
#   GAS_LOGGER_REMOTE=https://github.com/yorsh-co/gas-logger.git
#
#   GAS_WEBAPP_BACKEND_REF=dist-v0.2.0 GAS_WEBAPP_FRONTEND_REF=web-v0.2.0 \
#     scripts/sync-gas-webapp.sh
#
# The merge back is --no-ff and never --squash: squashing it would discard the
# `git-subtree-split` trailers `pull` needs to find each target's last import.

set -Eeuo pipefail

BACKEND_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --backend-only) BACKEND_ONLY=true ;;
    *)
      echo "usage: $0 [--backend-only]" >&2
      exit 2
      ;;
  esac
done

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is not clean — refusing to run" >&2
  exit 1
fi

BASE="$(git rev-parse --abbrev-ref HEAD)"
WORK="chore/sync-gas-webapp-$(date -u +%Y%m%d%H%M%S)"
SUMMARY=()

restore() {
  git merge --abort 2>/dev/null || true
  git checkout --quiet "$BASE" 2>/dev/null || true
  git branch -D "$WORK" 2>/dev/null || true
  echo "error: aborted, $BASE left unchanged" >&2
}
trap restore ERR

# Adds $prefix if it doesn't exist yet, otherwise pulls it — see the header
# comment for why that's the whole rule, no separate add/pull verb needed.
sync_target() {
  local label="$1" prefix="$2" remote="$3" ref="$4" action
  if [ -d "$prefix" ]; then
    action=pull
  else
    action=add
  fi
  echo "  $label: $action $prefix @ $ref"
  git subtree "$action" --prefix "$prefix" "$remote" "$ref" --squash
  SUMMARY+=("$label: $action  $prefix @ $ref")
}

git checkout --quiet -b "$WORK"

sync_target "gas-webapp (backend)" \
  "${GAS_WEBAPP_BACKEND_PREFIX:-src/lib/gas-webapp}" \
  "${GAS_WEBAPP_REMOTE:-https://github.com/yorsh-co/gas-webapp.git}" \
  "${GAS_WEBAPP_BACKEND_REF:-dist}"

if [ "$BACKEND_ONLY" = false ]; then
  sync_target "gas-webapp (browser client)" \
    "${GAS_WEBAPP_FRONTEND_PREFIX:-src/web/public/js/lib/gas-webapp}" \
    "${GAS_WEBAPP_REMOTE:-https://github.com/yorsh-co/gas-webapp.git}" \
    "${GAS_WEBAPP_FRONTEND_REF:-dist-web}"
fi

sync_target "gas-error" \
  "${GAS_ERROR_PREFIX:-src/lib/gas-error}" \
  "${GAS_ERROR_REMOTE:-https://github.com/yorsh-co/gas-error.git}" \
  "${GAS_ERROR_REF:-dist}"

sync_target "gas-logger" \
  "${GAS_LOGGER_PREFIX:-src/lib/gas-logger}" \
  "${GAS_LOGGER_REMOTE:-https://github.com/yorsh-co/gas-logger.git}" \
  "${GAS_LOGGER_REF:-dist}"

git checkout --quiet "$BASE"
git merge --no-ff --no-edit \
  -m "chore(lib): sync gas-webapp and peer dependencies

$(printf '%s\n' "${SUMMARY[@]}")" \
  "$WORK"

trap - ERR
git branch -d "$WORK"

echo "✓ done:"
printf '  %s\n' "${SUMMARY[@]}"