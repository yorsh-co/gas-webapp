#!/usr/bin/env bash
#
# Install or update the gas-webapp browser client as one reviewable unit.
#
# Distributed from https://github.com/yorsh-co/gas-webapp — download this
# file into your own project and run it from there; it isn't meant to be
# subtree'd itself. See the README's Quick Start for the fetch command.
#
# The backend and its peers (gas-error, gas-logger, gas-lock) are not handled
# here: install them with gasdev bundle, which covers Apps Script code only.
# The browser client stays on `git subtree` and ships on its own branch,
# `dist-web`, since `git subtree` imports a branch root and cannot select a
# subdirectory.
#
# gasdev bundle treats `gasLibrary.peers` as optional, so it will not pull
# gas-error in on its own — list gas-error explicitly under
# `gasdev.bundle.libraries`, or the bundle fails only at runtime.
#
# The target is added or updated based on whether its prefix already exists
# — `git subtree add` fails outright if the directory is already there, and
# that's exactly the condition `pull` requires, so there's no separate verb
# to remember: the first run adds, every run after that pulls.
#
# Usage:
#   scripts/sync-gas-webapp.sh
#
# The prefix, ref, and remote default to this project's own conventions and
# can be overridden without editing the script:
#
#   GAS_WEBAPP_FRONTEND_PREFIX=src/web/public/js/lib/gas-webapp  (matches GasWebApp's default static.dirs.js)
#   GAS_WEBAPP_FRONTEND_REF=dist-web
#   GAS_WEBAPP_REMOTE=https://github.com/yorsh-co/gas-webapp.git
#
#   GAS_WEBAPP_FRONTEND_REF=dist-web/v1.0.0 scripts/sync-gas-webapp.sh
#
# The merge back is --no-ff and never --squash: squashing it would discard the
# `git-subtree-split` trailers `pull` needs to find the last import.

set -Eeuo pipefail

# --untracked-files=no is deliberate: right after downloading this script,
# it's an untracked file in the repo it's about to run in. Only uncommitted
# changes to tracked files are worth blocking on.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "error: uncommitted changes — refusing to run" >&2
  exit 1
fi

BASE="$(git rev-parse --abbrev-ref HEAD)"
WORK="chore/sync-gas-webapp-$(date -u +%Y%m%d%H%M%S)"
PREFIX="${GAS_WEBAPP_FRONTEND_PREFIX:-src/web/public/js/lib/gas-webapp}"
REMOTE="${GAS_WEBAPP_REMOTE:-https://github.com/yorsh-co/gas-webapp.git}"
REF="${GAS_WEBAPP_FRONTEND_REF:-dist-web}"

restore() {
  git merge --abort 2>/dev/null || true
  git checkout --quiet "$BASE" 2>/dev/null || true
  git branch -D "$WORK" 2>/dev/null || true
  echo "error: aborted, $BASE left unchanged" >&2
}
trap restore ERR

if [ -d "$PREFIX" ]; then
  ACTION=pull
else
  ACTION=add
fi

git checkout --quiet -b "$WORK"
echo "  gas-webapp (browser client): $ACTION $PREFIX @ $REF"
git subtree "$ACTION" --prefix "$PREFIX" "$REMOTE" "$REF" --squash

git checkout --quiet "$BASE"
git merge --no-ff --no-edit \
  -m "chore(lib): sync gas-webapp browser client

gas-webapp (browser client): $ACTION  $PREFIX @ $REF" \
  "$WORK"

trap - ERR
git branch -d "$WORK"

echo "✓ done: $ACTION $PREFIX @ $REF"

if git status --porcelain --untracked-files=normal -- "$0" 2>/dev/null | grep -q '^??'; then
  echo ""
  echo "Note: $0 itself isn't committed yet — worth adding so it's" \
    "there next time and for anyone else on the project."
fi
