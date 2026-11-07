#!/bin/bash
# Thrice-daily Star Battle render + upload at 11:00 / 15:30 / 19:30 US Eastern. Invoked by launchd
# (~/Library/LaunchAgents/com.arke.star-battle-daily.plist). Mirrors sfm-illusion-gen's
# .saint-expeditus/daily-run.sh. See .saint-expeditus/PROJECT_DECISIONS.md.
set -euo pipefail

PROJECT_DIR="/Users/arke/Projects/vue-star-battle"
SLUG="vue-star-battle"
TOKEN="$HOME/.saint-expeditus/youtube-tokens/${SLUG}.json"
cd "$PROJECT_DIR"
echo "[star-battle-daily] $(date '+%F %T') start"

# Loud Node floor: the renderer + process.loadEnvFile need ≥20, but interactive
# shells on this Mac default to 18 — fail fast with a timestamp instead of a cryptic tsx trace.
NODE_MAJOR="$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)"
if [ -z "${NODE_MAJOR:-}" ] || [ "$NODE_MAJOR" -lt 20 ]; then
  echo "[star-battle-daily] $(date '+%F %T') node $(node --version 2>/dev/null || echo missing) < 20 — need Node ≥20 on PATH" >&2
  exit 1
fi

# No channel yet → do nothing (no render, no puzzle number consumed). Authorize once with:
#   cd /Users/arke/Projects/saint-expeditus && npx --prefix discord-bot tsx discord-bot/src/youtube-auth.ts --channel vue-star-battle
if [ ! -f "$TOKEN" ]; then
  echo "[star-battle-daily] channel '${SLUG}' not authorized yet — skipping" >&2
  exit 0
fi

# launchd fires at both Manila times for each ET slot (EDT +12 h / EST +13 h); only the one
# that lands on an ET slot hour runs, so US DST is handled with no plist edits. FORCE=1 bypasses.
ET_HOUR="$(TZ=America/New_York date +%H)"
case "$ET_HOUR" in
  11|15|19) ;;
  *) if [ "${FORCE:-0}" != 1 ]; then echo "[star-battle-daily] ${ET_HOUR}h ET is not a slot (DST twin) — skipping"; exit 0; fi ;;
esac

VIDEO="$(node_modules/.bin/tsx video/cli.ts daily --out-dir output/daily --keep-days 30 | tail -1)"
if [ -z "$VIDEO" ] || [ ! -f "$VIDEO" ]; then
  echo "[star-battle-daily] $(date '+%F %T') render failed — no video produced" >&2
  exit 1
fi

# Bounded same-file upload retry. Re-invoking the uploader on the identical mp4 is
# dedup-idempotent (0 quota if the first attempt actually landed), while re-rendering
# would burn a new puzzle number. Never retry quota/auth failures: each genuine new
# insert costs 1,600 of the ~6/day quota pool shared with every other channel.
attempt=1
while [ "$attempt" -le 3 ]; do
  UPLOAD_OUT="$(node_modules/.bin/tsx .saint-expeditus/upload-daily.ts "$VIDEO" "$PROJECT_DIR" 2>&1)" && UPLOAD_OK=1 || UPLOAD_OK=0
  if [ "$UPLOAD_OK" -eq 1 ]; then echo "$UPLOAD_OUT"; break; fi
  echo "$UPLOAD_OUT" >&2
  if echo "$UPLOAD_OUT" | grep -qiE 'quotaExceeded|quota exceeded|forbidden| 403'; then
    echo "[star-battle-daily] $(date '+%F %T') upload failed with quota/auth error — not retrying" >&2
    exit 1
  fi
  if [ "$attempt" -eq 3 ]; then
    echo "[star-battle-daily] $(date '+%F %T') upload failed after 3 attempts — giving up" >&2
    exit 1
  fi
  echo "[star-battle-daily] $(date '+%F %T') upload attempt $attempt failed — retrying same file in 5 min" >&2
  sleep 300
  attempt=$((attempt + 1))
done
