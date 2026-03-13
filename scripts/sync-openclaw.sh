#!/bin/bash
# OpenClaw Upstream Sync — with audit/review before merging
#
# Safe workflow:
#   1. ./scripts/sync-openclaw.sh              # audit: fetch + generate risk report
#   2. ./scripts/sync-openclaw.sh --approve    # merge reviewed changes to local main
#   3. ./scripts/sync-openclaw.sh --bump       # update Dockerfile to target version
#
# Options:
#   (no flags)         Fetch + audit only. Shows risk report, does NOT merge.
#   --approve          Merge upstream/main into local (ff-only). Push to fork.
#   --bump             Update Dockerfile openclaw version to latest stable tag.
#   --tag=vX.Y.Z       Target a specific tag instead of latest (for --bump).
#   --report=FILE      Write audit report to file (default: stdout + /tmp/openclaw-audit.md)
#
# Risk categories:
#   [BREAKING]    Config schema changes, removed APIs, major version bumps
#   [SECURITY]    Security fixes, auth changes, vulnerability patches
#   [DEPS]        Dependency changes (package.json, lockfile)
#   [CONFIG]      Config validation, Zod schema changes
#   [CHANNEL]     Telegram/Discord/Slack channel changes (affects our bot)
#   [AGENT]       Agent system, routing, bindings changes
#   [GATEWAY]     Gateway, middleware, startup changes

set -e

OPENCLAW_DIR="${OPENCLAW_DIR:-F:/vibe-coding/open-clawd}"
MOLTWORKER_DIR="${MOLTWORKER_DIR:-F:/vibe-coding/moltworker}"
DOCKERFILE="$MOLTWORKER_DIR/Dockerfile"
REPORT_FILE="/tmp/openclaw-audit.md"

DO_APPROVE=false
DO_BUMP=false
TARGET_TAG=""

for arg in "$@"; do
  case "$arg" in
    --approve)    DO_APPROVE=true ;;
    --bump)       DO_BUMP=true ;;
    --tag=*)      TARGET_TAG="${arg#--tag=}" ;;
    --report=*)   REPORT_FILE="${arg#--report=}" ;;
    --help)
      head -20 "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
  esac
done

# ============================================================
# HELPERS
# ============================================================

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
danger(){ echo -e "${RED}[RISK]${NC} $*"; }

# ============================================================
# FETCH & STATUS
# ============================================================

cd "$OPENCLAW_DIR"

echo -e "${BOLD}=== OpenClaw Upstream Audit ===${NC}"
echo ""
info "Repo: $OPENCLAW_DIR"
info "Current HEAD: $(git log --oneline -1)"

git fetch upstream --tags --quiet 2>/dev/null

LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse upstream/main)
BEHIND=$(git rev-list --count HEAD..upstream/main)

CURRENT_DOCKER_VER=$(grep -o 'openclaw@[0-9.]*' "$DOCKERFILE" 2>/dev/null | head -1 | sed 's/openclaw@//')
LATEST_TAG=$(git tag --sort=-version:refname | grep -E '^v20[0-9]{2}\.[0-9]+\.[0-9]+$' | head -1)
LATEST_VER="${LATEST_TAG#v}"

echo ""
echo -e "${BOLD}Versions:${NC}"
echo "  Local HEAD:        $(git rev-parse --short HEAD)"
echo "  Remote HEAD:       $(git rev-parse --short upstream/main)"
echo "  Commits behind:    $BEHIND"
echo "  Latest stable tag: $LATEST_TAG"
echo "  Dockerfile:        openclaw@$CURRENT_DOCKER_VER"

if [ "$LOCAL_HEAD" = "$REMOTE_HEAD" ]; then
  ok "Local repo is up to date."
  if [ "$CURRENT_DOCKER_VER" = "$LATEST_VER" ]; then
    ok "Dockerfile is up to date."
  else
    warn "Dockerfile outdated: $CURRENT_DOCKER_VER -> $LATEST_VER"
  fi
  [ "$DO_APPROVE" = false ] && [ "$DO_BUMP" = false ] && exit 0
fi

# ============================================================
# AUDIT (only when there are new commits and not just --bump)
# ============================================================

if [ "$BEHIND" -gt 0 ] && [ "$DO_BUMP" = false ]; then

  echo ""
  echo -e "${BOLD}=== Risk Audit ($BEHIND commits) ===${NC}"

  RANGE="HEAD..upstream/main"

  # Collect all changed files
  CHANGED_FILES=$(git diff --name-only $RANGE)

  # --- BREAKING: config schema changes ---
  SCHEMA_CHANGES=$(echo "$CHANGED_FILES" | grep -E 'zod-schema|config/types' | head -20)
  if [ -n "$SCHEMA_CHANGES" ]; then
    danger "[BREAKING] Config schema/validation changed:"
    echo "$SCHEMA_CHANGES" | sed 's/^/    /'
    echo ""
  fi

  # --- SECURITY: auth, jwt, pairing, secrets ---
  SECURITY_CHANGES=$(echo "$CHANGED_FILES" | grep -iE 'auth|jwt|secret|pairing|security|csp|cors|origin|hmac|token' | head -20)
  SECURITY_COMMITS=$(git log --oneline $RANGE | grep -iE 'security|auth|vuln|cve|ghsa|xss|injection|csrf' | head -10)
  if [ -n "$SECURITY_CHANGES" ] || [ -n "$SECURITY_COMMITS" ]; then
    danger "[SECURITY] Security-related changes detected:"
    [ -n "$SECURITY_CHANGES" ] && echo "$SECURITY_CHANGES" | sed 's/^/    /'
    [ -n "$SECURITY_COMMITS" ] && echo "  Commits:" && echo "$SECURITY_COMMITS" | sed 's/^/    /'
    echo ""
  fi

  # --- DEPS: package.json, lockfile changes ---
  DEPS_CHANGES=$(echo "$CHANGED_FILES" | grep -E 'package\.json|pnpm-lock|yarn\.lock|package-lock' | head -10)
  if [ -n "$DEPS_CHANGES" ]; then
    warn "[DEPS] Dependency files changed:"
    echo "$DEPS_CHANGES" | sed 's/^/    /'
    echo ""
  fi

  # --- CONFIG: general config changes ---
  CONFIG_CHANGES=$(echo "$CHANGED_FILES" | grep -E 'src/config/' | head -20)
  if [ -n "$CONFIG_CHANGES" ]; then
    warn "[CONFIG] Config system changed:"
    echo "$CONFIG_CHANGES" | sed 's/^/    /'
    echo ""
  fi

  # --- CHANNEL: telegram, discord, slack ---
  CHANNEL_CHANGES=$(echo "$CHANGED_FILES" | grep -iE 'telegram|discord|slack|channel' | head -20)
  CHANNEL_COMMITS=$(git log --oneline $RANGE | grep -iE 'telegram|discord|slack' | head -10)
  if [ -n "$CHANNEL_CHANGES" ]; then
    warn "[CHANNEL] Chat channel changes (may affect our bots):"
    echo "$CHANNEL_CHANGES" | sed 's/^/    /'
    [ -n "$CHANNEL_COMMITS" ] && echo "  Commits:" && echo "$CHANNEL_COMMITS" | sed 's/^/    /'
    echo ""
  fi

  # --- AGENT: agent routing, bindings ---
  AGENT_CHANGES=$(echo "$CHANGED_FILES" | grep -iE 'agent|routing|binding' | head -20)
  if [ -n "$AGENT_CHANGES" ]; then
    warn "[AGENT] Agent/routing system changed:"
    echo "$AGENT_CHANGES" | sed 's/^/    /'
    echo ""
  fi

  # --- GATEWAY: gateway startup, middleware ---
  GW_CHANGES=$(echo "$CHANGED_FILES" | grep -iE 'gateway|middleware|startup' | head -20)
  if [ -n "$GW_CHANGES" ]; then
    warn "[GATEWAY] Gateway/middleware changes:"
    echo "$GW_CHANGES" | sed 's/^/    /'
    echo ""
  fi

  # --- Summary stats ---
  TOTAL_FILES=$(echo "$CHANGED_FILES" | wc -l)
  BREAKING_COUNT=$(echo "$CHANGED_FILES" | grep -cE 'zod-schema|config/types|BREAKING' 2>/dev/null || echo 0)
  SECURITY_COUNT=$(echo "$CHANGED_FILES" | grep -ciE 'auth|jwt|secret|security' 2>/dev/null || echo 0)

  echo -e "${BOLD}=== Audit Summary ===${NC}"
  echo "  Total files changed: $TOTAL_FILES"
  echo "  Breaking risk files: $BREAKING_COUNT"
  echo "  Security risk files: $SECURITY_COUNT"
  echo "  New tags since current: $(git tag --sort=-version:refname | grep -E '^v20[0-9]{2}\.[0-9]+\.[0-9]+$' | while read t; do [ "$(git merge-base --is-ancestor "$t" HEAD 2>/dev/null; echo $?)" != "0" ] && echo "$t"; done | wc -l)"
  echo ""

  # --- Release notes from tags ---
  echo -e "${BOLD}=== Release Tags (since $CURRENT_DOCKER_VER) ===${NC}"
  git tag --sort=-version:refname | grep -E '^v20[0-9]{2}\.[0-9]+\.[0-9]+$' | while read tag; do
    tag_ver="${tag#v}"
    # Compare versions: only show tags newer than current docker version
    if [ "$(printf '%s\n' "$CURRENT_DOCKER_VER" "$tag_ver" | sort -V | head -1)" = "$CURRENT_DOCKER_VER" ] && [ "$tag_ver" != "$CURRENT_DOCKER_VER" ]; then
      tag_date=$(git log -1 --format=%ci "$tag" 2>/dev/null | cut -d' ' -f1)
      tag_msg=$(git tag -l --format='%(contents:subject)' "$tag" 2>/dev/null)
      echo "  $tag ($tag_date) $tag_msg"
    fi
  done
  echo ""

  # --- Write report file ---
  {
    echo "# OpenClaw Audit Report"
    echo "Generated: $(date -Iseconds)"
    echo "Range: $(git rev-parse --short HEAD)..$(git rev-parse --short upstream/main) ($BEHIND commits)"
    echo "Current Dockerfile: openclaw@$CURRENT_DOCKER_VER"
    echo "Latest tag: $LATEST_TAG"
    echo ""
    echo "## Risk Files"
    [ -n "$SCHEMA_CHANGES" ] && echo "### [BREAKING] Schema" && echo '```' && echo "$SCHEMA_CHANGES" && echo '```'
    [ -n "$SECURITY_CHANGES" ] && echo "### [SECURITY]" && echo '```' && echo "$SECURITY_CHANGES" && echo '```'
    [ -n "$CHANNEL_CHANGES" ] && echo "### [CHANNEL]" && echo '```' && echo "$CHANNEL_CHANGES" && echo '```'
    [ -n "$AGENT_CHANGES" ] && echo "### [AGENT]" && echo '```' && echo "$AGENT_CHANGES" && echo '```'
    echo ""
    echo "## All Commits"
    git log --oneline $RANGE
  } > "$REPORT_FILE"
  info "Full report saved to: $REPORT_FILE"

  # --- Decision ---
  if [ "$DO_APPROVE" = false ]; then
    echo ""
    echo -e "${BOLD}=== Next Steps ===${NC}"
    echo "  1. Review the audit above (especially [BREAKING] and [SECURITY])"
    echo "  2. Check release notes: git log --oneline v$CURRENT_DOCKER_VER..$LATEST_TAG"
    echo "  3. If safe, run:  $0 --approve"
    echo "  4. Then bump:     $0 --bump"
    echo "  5. Or target tag: $0 --bump --tag=$LATEST_TAG"
    exit 0
  fi
fi

# ============================================================
# APPROVE (merge after audit)
# ============================================================

if [ "$DO_APPROVE" = true ] && [ "$BEHIND" -gt 0 ]; then
  echo ""
  echo -e "${BOLD}=== Merging upstream (ff-only) ===${NC}"

  # Safety: only fast-forward, never create merge commits
  if git merge --ff-only upstream/main; then
    ok "Merged $BEHIND commits. Now at: $(git log --oneline -1)"

    # Push to fork (origin = sirendhead/clawdbot)
    info "Pushing to fork (origin)..."
    if git push origin main; then
      ok "Fork synced: origin/main updated"
    else
      warn "Push to fork failed — may need manual push: git push origin main"
    fi
  else
    danger "Fast-forward merge failed! You may have local commits."
    echo "  If you have custom patches, rebase them:"
    echo "    git rebase upstream/main"
    echo "  Or check divergence:"
    echo "    git log --oneline upstream/main..HEAD"
    exit 1
  fi
fi

# ============================================================
# BUMP Dockerfile version
# ============================================================

if [ "$DO_BUMP" = true ]; then
  echo ""
  echo -e "${BOLD}=== Dockerfile Version Bump ===${NC}"

  BUMP_TAG="${TARGET_TAG:-$LATEST_TAG}"
  BUMP_VER="${BUMP_TAG#v}"

  if [ -z "$BUMP_VER" ]; then
    danger "No target version found."
    exit 1
  fi

  echo "  Current: openclaw@$CURRENT_DOCKER_VER"
  echo "  Target:  openclaw@$BUMP_VER"

  if [ "$CURRENT_DOCKER_VER" = "$BUMP_VER" ]; then
    ok "Dockerfile already at $BUMP_VER"
  else
    sed -i "s/openclaw@$CURRENT_DOCKER_VER/openclaw@$BUMP_VER/" "$DOCKERFILE"
    ok "Updated Dockerfile: openclaw@$CURRENT_DOCKER_VER -> openclaw@$BUMP_VER"
    echo ""
    warn "Next: review, commit, and deploy:"
    echo "  cd $MOLTWORKER_DIR"
    echo "  git diff Dockerfile"
    echo "  git add Dockerfile && git commit -m 'chore: bump openclaw to $BUMP_TAG'"
    echo "  npx wrangler deploy"
  fi
fi

echo ""
echo -e "${BOLD}=== Done ===${NC}"
