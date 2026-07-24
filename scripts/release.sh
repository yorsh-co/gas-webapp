#!/usr/bin/env bash
set -euo pipefail

# Publishes only the consumer-facing subset to the `dist` branch,
# which `git subtree add` points to in README. The dist branch tree
# is flat (no top-level dist/ folder) — module files sit at branch
# root, with nested dirs like middleware/ preserved as-is.
#
# Excluded from what ships:
#   - types/*.js   — type-only files (interfaces/types) compile to empty
#                    .js with nothing at runtime; only their .d.ts is useful.
#   - internal/    — ambient peer-dependency declarations (gas-webapp.peer
#                    .types.ts) used only so `tsc --noEmit` resolves GasError/
#                    GasLogger locally. Shipping these would collide with the
#                    real gas-error/gas-logger packages once a consumer
#                    subtrees both — never emit .js or .d.ts for this dir.

VERSION=$(node --input-type=module -e "console.log((await import('./package.json', { with: { type: 'json' } })).default.version)")
WORKTREE_DIR=.worktrees/dist

echo "Checking out release worktree..."
if ! git show-ref --verify --quiet refs/heads/dist; then
  echo "dist branch doesn't exist yet — creating orphan branch..."
  git worktree add --detach "$WORKTREE_DIR"
  git -C "$WORKTREE_DIR" checkout --orphan dist
  git -C "$WORKTREE_DIR" rm -rf . > /dev/null 2>&1 || true
else
  if [ ! -d "$WORKTREE_DIR" ]; then
    git worktree add "$WORKTREE_DIR" dist
  fi
fi

echo "Syncing release contents..."
rsync -a --delete \
  --exclude '.git' \
  --exclude 'internal/' \
  --exclude 'types/*.js' \
  --exclude 'README.md' \
  --exclude 'LICENSE.md' \
  --exclude 'CHANGELOG.md' \
  --exclude 'package.json' \
  "dist/" "$WORKTREE_DIR/"
cp README.md LICENSE.md CHANGELOG.md "$WORKTREE_DIR/"
node scripts/write-release-package-json.js > "$WORKTREE_DIR/package.json"

echo "Committing and tagging..."
cd "$WORKTREE_DIR"
git add -A
git commit -m "merge: $VERSION"
git tag "dist/$VERSION"
git push origin dist --tags
