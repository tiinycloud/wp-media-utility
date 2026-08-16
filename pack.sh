#!/usr/bin/env bash
# Pack WP Media Utility into wp-media-utility-vX.Y.Z.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PHP="$ROOT/wp-media-utility.php"

HDR="$(grep -E '^\s*\*\s*Version:' "$PHP" | head -1 | sed -E 's/.*Version:[[:space:]]*([0-9][0-9.]*)/\1/')"
CONST="$(grep "WP_MEDIA_UTILITY_VERSION" "$PHP" | grep define | head -1 | sed -E "s/.*'WP_MEDIA_UTILITY_VERSION'[[:space:]]*,[[:space:]]*'([^']+)'.*/\1/")"

if [[ -z "$HDR" || -z "$CONST" || "$HDR" != "$CONST" ]]; then
	echo "Version mismatch or missing (header=$HDR constant=$CONST)" >&2
	exit 1
fi

NAME="wp-media-utility-v${HDR}.zip"
OUT="$ROOT/$NAME"
STAGE="$ROOT/.pack-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE/wp-media-utility"
cp "$ROOT/wp-media-utility.php" "$STAGE/wp-media-utility/"
cp "$ROOT/monitor.js" "$STAGE/wp-media-utility/"
cp "$ROOT/README.md" "$STAGE/wp-media-utility/"
cp "$ROOT/catalog.json" "$STAGE/wp-media-utility/"
[[ -f "$ROOT/LICENSE" ]] && cp "$ROOT/LICENSE" "$STAGE/wp-media-utility/"
[[ -f "$ROOT/pack.sh" ]] && cp "$ROOT/pack.sh" "$STAGE/wp-media-utility/"

rm -f "$OUT"
( cd "$STAGE" && zip -r "$OUT" wp-media-utility -x "*.DS_Store" -x "*/.*" )
rm -rf "$STAGE"
cp -f "$OUT" "$ROOT/wp-media-utility.zip"
echo "Packed $NAME"
ls -la "$OUT"
