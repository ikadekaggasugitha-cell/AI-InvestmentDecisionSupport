#!/usr/bin/env bash
#
# Run every CI gate, then commit and push — the whole pre-flight in one command.
#
# The gate list is copied from .github/workflows/ci.yml on purpose. A local run
# that passes here and fails in CI wastes a cycle, so this script fails on
# exactly what CI fails on and nothing softer. Edit one and you must edit the other.
#
# Push always asks first. Passing checks is not consent to publish, and a script
# that pushes on your behalf removes the moment you would normally slow down.
#
# Usage:  ./scripts/ship.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$REPO_DIR/backend"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; RESET=''
fi

die() { printf '%s%s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

run() {
  local label="$1" started elapsed
  shift
  started=$(date +%s)
  printf '%s%s%s\n' "$BOLD" "$label" "$RESET"
  "$@" || die "$label failed — nothing was committed or pushed."
  elapsed=$(( $(date +%s) - started ))
  printf '%s  ok, %ss%s\n\n' "$GREEN" "$elapsed" "$RESET"
}

unpushed() {
  git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1 || return 0
  git log --oneline '@{u}..HEAD'
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  awk 'NR > 1 && /^set -euo/ { exit } NR > 2 { sub(/^# ?/, ""); print }' "${BASH_SOURCE[0]}"
  exit 0
fi

cd "$REPO_DIR"
git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

if git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1; then
  die "a merge is in progress — finish or abort it first"
fi

for path in rebase-merge rebase-apply; do
  if [ -d "$(git rev-parse --git-path "$path")" ]; then
    die "a rebase is in progress — finish or abort it first"
  fi
done

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
RUFF="$BACKEND_DIR/.venv/bin/ruff"
PYTEST="$BACKEND_DIR/.venv/bin/pytest"

[ -x "$RUFF" ] && [ -x "$PYTEST" ] \
  || die "backend/.venv is missing ruff or pytest — see backend/requirements-test.txt"
command -v npm >/dev/null || die "npm not found on PATH"
[ -d "$REPO_DIR/node_modules" ] || die "node_modules missing — run: npm ci"

if [ "$BRANCH" = "main" ]; then
  printf '%sOn main, so CI runs on whatever you push.%s\n\n' "$DIM" "$RESET"
fi

if [ -z "$(git status --porcelain)" ] && [ -z "$(unpushed)" ]; then
  echo "Nothing to commit, nothing to push."
  exit 0
fi

git add -A

# .gitignore already covers the common cases; this catches what it misses, such
# as a key added from a directory whose ignore rule no longer applies.
LEAKED="$(
  git diff --cached --name-only --diff-filter=ACM \
    | grep -Ei '(^|/)\.env($|\.)|id_rsa|\.(pem|key|p12|pfx)$|credentials.*\.json$|service-account.*\.json$' \
    | grep -Ev '\.env\.(example|template|sample)$' \
    || true
)"
if [ -n "$LEAKED" ]; then
  printf '%sRefusing to stage these — they look like credentials:%s\n' "$RED" "$RESET" >&2
  printf '%s\n' "$LEAKED" | sed 's/^/  /' >&2
  exit 1
fi

cd "$BACKEND_DIR"
run "ruff" "$RUFF" check .

# The hermetic flags CI sets, so the suite needs no Postgres or Redis.
export AUTH_BYPASS=true USE_MOCK_SIGNALS=true USE_MOCK_RISK=true USE_MOCK_MARKET=true
export USE_MOCK_PORTFOLIO=true USE_MOCK_BROKSUM=true METRICS_ENABLED=false RATE_LIMIT_ENABLED=false
run "pytest (60% coverage gate)" "$PYTEST"

cd "$REPO_DIR"
run "frontend typecheck" npm run --silent typecheck
run "frontend lint" npm run --silent lint
run "frontend tests" npm run --silent test -- --run
run "frontend build" npm run --silent build

MESSAGE_FILE="$(git rev-parse --git-path SHIP_COMMIT_MSG)"

if [ -z "$(git diff --cached --name-only)" ]; then
  echo "Nothing staged — skipping the commit step."
else
  cat >"$MESSAGE_FILE" <<'EOF'
# <type>(<scope>): <summary in the imperative>
#
# Why this change and not just what changed. Wrap at 72 columns.
#
# Types used in this repo: feat, fix, refactor, test, docs, chore.
EOF

  echo
  git diff --cached --stat

  EDITOR_BIN="${GIT_EDITOR:-${VISUAL:-${EDITOR:-}}}"
  [ -n "$EDITOR_BIN" ] || die "no editor set — export GIT_EDITOR, e.g. GIT_EDITOR='code --wait'"

  # Unquoted so that GIT_EDITOR="code --wait" works, not just a bare binary name.
  $EDITOR_BIN "$MESSAGE_FILE" || die "the editor exited with an error"

  # --cleanup=strip is explicit: with -F alone git keeps the #'d template lines.
  git commit --cleanup=strip -F "$MESSAGE_FILE" || die "commit aborted — nothing was pushed"
fi

# Resolved before the commit, because unpushed() reports nothing for a branch
# that has no upstream, which is exactly the branch that needs `push -u`.
if UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
  AHEAD="$(git log --oneline "$UPSTREAM"..HEAD)"
  PUSH=(git push)
  TARGET="$UPSTREAM"
  COUNT="$(printf '%s\n' "$AHEAD" | wc -l | tr -d ' ')"
  QUESTION="Push $COUNT commit(s) to $TARGET?"
else
  git remote get-url origin >/dev/null 2>&1 || die "no upstream and no origin remote to set one with"
  AHEAD="$(git log --oneline -10)"
  PUSH=(git push -u origin "$BRANCH")
  TARGET="origin/$BRANCH"
  QUESTION="Push $BRANCH to $TARGET? This sets it as the upstream."
fi

echo
printf '%s%s%s\n' "$BOLD" "$QUESTION" "$RESET"
printf '%s\n' "$AHEAD" | sed 's/^/  /'
echo

read -r -p "Proceed? [y/N] " reply || reply=""
case "$reply" in
  [yY]|[yY][eE][sS]) ;;
  *) echo "Not pushed."; exit 0 ;;
esac

run "push" "${PUSH[@]}"
