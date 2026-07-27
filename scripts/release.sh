#!/usr/bin/env bash
set -euo pipefail

# Publishes two consumer-facing subsets of the local `dist/` build output to
# two branches, so `git subtree` can pull the backend and browser packages
# independently — a consumer doesn't want frontend-only files landing under
# their Apps Script `src/lib/`, or vice versa.
#
#   dist      — backend: everything in `dist/` except `web/`. Pointed at by
#               README's `git subtree add` command.
#   dist-web  — browser client: `dist/web/` only, flattened so its contents
#               sit at branch root, matching how `git subtree add` expects to
#               find files (no leading `web/` in the consumer's own tree).
#
# Both branch trees are flat (no top-level dist/ folder) — nested dirs like
# middleware/ or web/'s own subfolders are preserved as-is once past that
# top-level split.
#
# Shipped to both branches:
#   - shared/gas-webapp.contract.types.d.ts — the wire contract (request/
#     response envelope) both packages compile against. Kept in sync by
#     living in one file and shipping to both, rather than two copies that
#     can drift.
#   - LICENSE.md, CHANGELOG.md — one project history/license, so a consumer
#     of either branch sees the whole picture, not just their half.
#
# Excluded from what ships (both branches):
#   - **/types/*.js — type-only files (interfaces/types) compile to empty
#                     .js with nothing at runtime; only their .d.ts is useful.
#                     The ** matches this at any depth, e.g. web/types/*.js.
#   - shared/*.js   — same reasoning: gas-webapp.contract.types.ts is
#                     type-only, its compiled .js is an empty stub.
#   - internal/     — ambient peer-dependency declarations (gas-webapp.peer
#                     .types.ts) used only so `tsc --noEmit` resolves GasError/
#                     GasLogger locally. Shipping these would collide with the
#                     real gas-error/gas-logger packages once a consumer
#                     subtrees both — never emit .js or .d.ts for this dir.
#                     Backend-only in practice, but excluded from the web
#                     flatten too in case that ever changes.

VERSION=$(node --input-type=module -e "console.log((await import('./package.json', { with: { type: 'json' } })).default.version)")

# --- shared helpers -----------------------------------------------------
#
# Setup, commit, tag, and push are identical across both targets; only the
# branch name, worktree dir, and file-sync step differ.

setup_worktree() {
  local branch="$1" dir="$2"
  if ! git show-ref --verify --quiet "refs/heads/$branch"; then
    echo "  $branch branch doesn't exist yet — creating orphan branch..."
    git worktree add --detach "$dir"
    git -C "$dir" checkout --orphan "$branch"
    git -C "$dir" rm -rf . > /dev/null 2>&1 || true
  elif [ ! -d "$dir" ]; then
    git worktree add "$dir" "$branch"
  fi
}

publish_worktree() {
  local dir="$1" branch="$2" tag="$3"
  (
    cd "$dir"
    git add -A
    git commit -m "merge: $VERSION"
    git tag "$tag"
    git push origin "$branch" --tags
  )
}

# --- dist (backend) ------------------------------------------------------

BACKEND_DIR=.worktrees/dist

echo "Checking out dist worktree..."
setup_worktree dist "$BACKEND_DIR"

echo "Syncing dist release contents..."
rsync -a --delete \
  --exclude '.git' \
  --exclude 'internal/' \
  --exclude '**/types/*.js' \
  --exclude 'shared/*.js' \
  --exclude 'web/' \
  --exclude 'README.md' \
  --exclude 'LICENSE.md' \
  --exclude 'CHANGELOG.md' \
  --exclude 'package.json' \
  "dist/" "$BACKEND_DIR/"
cp README.md LICENSE.md CHANGELOG.md "$BACKEND_DIR/"
node scripts/write-release-package-json.js > "$BACKEND_DIR/package.json"

echo "Committing and tagging dist..."
publish_worktree "$BACKEND_DIR" dist "dist/$VERSION"

# --- dist-web (browser client) -------------------------------------------

WEB_DIR=.worktrees/dist-web

echo "Checking out dist-web worktree..."
setup_worktree dist-web "$WEB_DIR"

echo "Syncing dist-web release contents..."
# `web/` is excluded from its own sync (not `--exclude 'shared/'`) below on
# purpose: this call flattens dist/web/* to branch root, and shared/ is
# populated by the second rsync call — excluding it here just stops this
# call's `--delete` from removing what the second call just wrote.
rsync -a --delete \
  --exclude '.git' \
  --exclude 'internal/' \
  --exclude '**/types/*.js' \
  --exclude 'shared/' \
  --exclude 'README.md' \
  --exclude 'LICENSE.md' \
  --exclude 'CHANGELOG.md' \
  --exclude 'package.json' \
  "dist/web/" "$WEB_DIR/"
rsync -a --delete \
  --exclude '*.js' \
  "dist/shared/" "$WEB_DIR/shared/"
cp dist/web/README.md "$WEB_DIR/README.md"
cp LICENSE.md CHANGELOG.md "$WEB_DIR/"

echo "Committing and tagging dist-web..."
publish_worktree "$WEB_DIR" dist-web "dist-web/$VERSION"