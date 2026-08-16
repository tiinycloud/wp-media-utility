#!/usr/bin/env bash
# Pack WP CSM Monitor into wp-csm-monitor-vX.Y.Z.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PHP="$ROOT/wp-csm-monitor.php"

HDR="$(grep -E '^\s*\*\s*Version:' "$PHP" | head -1 | sed -E 's/.*Version:[[:space:]]*([0-9][0-9.]*)/\1/')"
CONST="$(grep "WP_CSM_MONITOR_VERSION" "$PHP" | grep define | head -1 | sed -E "s/.*'WP_CSM_MONITOR_VERSION'[[:space:]]*,[[:space:]]*'([^']+)'.*/\1/")"

if [[ -z "$HDR" || -z "$CONST" || "$HDR" != "$CONST" ]]; then
	echo "Version mismatch or missing (header=$HDR constant=$CONST)" >&2
	exit 1
fi

NAME="wp-csm-monitor-v${HDR}.zip"
OUT="$ROOT/$NAME"
STAGE="$ROOT/.pack-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/wp-csm-monitor"
cp "$ROOT/wp-csm-monitor.php" "$STAGE/wp-csm-monitor/"
cp "$ROOT/monitor.js" "$STAGE/wp-csm-monitor/"
cp "$ROOT/README.md" "$STAGE/wp-csm-monitor/"
[[ -f "$ROOT/LICENSE" ]] && cp "$ROOT/LICENSE" "$STAGE/wp-csm-monitor/"
[[ -f "$ROOT/pack.sh" ]] && cp "$ROOT/pack.sh" "$STAGE/wp-csm-monitor/"

rm -f "$OUT"
( cd "$STAGE" && zip -r "$OUT" wp-csm-monitor -x "*.DS_Store" -x "*/.*" )
rm -rf "$STAGE"
cp -f "$OUT" "$ROOT/wp-csm-monitor.zip"
echo "Packed $NAME"
ls -la "$OUT"
