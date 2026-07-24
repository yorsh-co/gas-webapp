#!/usr/bin/env bash
set -euo pipefail

# Publishes only the consumer-facing subset to the `dist` branch,
# which `git subtree add` points to in README.

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
rsync -a --delete "dist/" "$WORKTREE_DIR/dist/"
cp README.md LICENSE.md CHANGELOG.md "$WORKTREE_DIR/"
node scripts/write-release-package-json.js > "$WORKTREE_DIR/package.json"

echo "Committing and tagging..."
cd "$WORKTREE_DIR"
git add -A
git commit -m "merge: $VERSION"
git tag "dist/$VERSION"
git push origin dist --tags
