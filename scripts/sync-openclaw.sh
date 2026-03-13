#!/bin/bash
# Sync local OpenClaw fork and optionally update moltworker Dockerfile
#
# Usage:
#   ./scripts/sync-openclaw.sh                    # check only
#   ./scripts/sync-openclaw.sh --pull             # pull latest
#   ./scripts/sync-openclaw.sh --pull --update    # pull + update Dockerfile version
#
# Prerequisites:
#   - F:\vibe-coding\open-clawd must be a clone of openclaw/openclaw
#   - F:\vibe-coding\moltworker must have a Dockerfile with openclaw@version

set -e

OPENCLAW_DIR="${OPENCLAW_DIR:-F:/vibe-coding/open-clawd}"
MOLTWORKER_DIR="${MOLTWORKER_DIR:-F:/vibe-coding/moltworker}"
DOCKERFILE="$MOLTWORKER_DIR/Dockerfile"

DO_PULL=false
DO_UPDATE=false

for arg in "$@"; do
  case "$arg" in
    --pull)   DO_PULL=true ;;
    --update) DO_UPDATE=true ;;
    --help)
      echo "Usage: $0 [--pull] [--update]"
      echo "  --pull    Pull latest from origin/main"
      echo "  --update  Update Dockerfile openclaw version to latest tag"
      exit 0
      ;;
  esac
done

echo "=== OpenClaw Sync Check ==="
echo ""

# 1. Check open-clawd repo
cd "$OPENCLAW_DIR"
echo "Repo: $OPENCLAW_DIR"
echo "Current HEAD: $(git log --oneline -1)"

git fetch origin --tags --quiet 2>/dev/null

LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse origin/main)
BEHIND=$(git rev-list --count HEAD..origin/main)

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  echo "Status: UP TO DATE"
else
  echo "Status: $BEHIND commits behind origin/main"
  echo ""
  echo "Recent upstream commits:"
  git log --oneline HEAD..origin/main | head -15
  echo ""

  if [ "$DO_PULL" = true ]; then
    echo "Pulling latest..."
    git pull origin main --ff-only
    echo "Pulled successfully. Now at: $(git log --oneline -1)"
  else
    echo "Run with --pull to update."
  fi
fi

# 2. Check latest release tag
LATEST_TAG=$(git tag --sort=-version:refname | grep -E '^v20[0-9]{2}\.[0-9]+\.[0-9]+$' | head -1)
echo ""
echo "=== Version Info ==="
echo "Latest stable tag: $LATEST_TAG"

# 3. Check Dockerfile version
if [ -f "$DOCKERFILE" ]; then
  CURRENT_VERSION=$(grep -o 'openclaw@[0-9.]*' "$DOCKERFILE" | head -1 | sed 's/openclaw@//')
  TAG_VERSION="${LATEST_TAG#v}"
  echo "Dockerfile version: openclaw@$CURRENT_VERSION"

  if [ "$CURRENT_VERSION" = "$TAG_VERSION" ]; then
    echo "Dockerfile: UP TO DATE"
  else
    echo "Dockerfile: OUTDATED (latest: $TAG_VERSION)"

    if [ "$DO_UPDATE" = true ]; then
      echo ""
      echo "Updating Dockerfile: openclaw@$CURRENT_VERSION -> openclaw@$TAG_VERSION"
      sed -i "s/openclaw@$CURRENT_VERSION/openclaw@$TAG_VERSION/" "$DOCKERFILE"
      echo "Updated. Don't forget to commit and deploy!"
    else
      echo "Run with --update to bump Dockerfile version."
    fi
  fi
else
  echo "Dockerfile not found at $DOCKERFILE"
fi

echo ""
echo "=== Done ==="
