#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
VERSION="22.23.4"
NAME="node-v${VERSION}-darwin-arm64"
ARCHIVE="$ROOT/.runtime-cache/${NAME}.tar.gz"
EXPECTED="c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428"
DEST="${1:-$ROOT/.runtime-cache/extracted}"
case "$DEST" in "$ROOT"/*) ;; *) echo "Runtime destination must stay inside the source/build folder." >&2; exit 1;; esac
mkdir -p "$ROOT/.runtime-cache" "$DEST"
if [ ! -f "$ARCHIVE" ]; then
  /usr/bin/curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
    "https://nodejs.org/download/release/v${VERSION}/${NAME}.tar.gz" --output "${ARCHIVE}.partial"
  /bin/mv "${ARCHIVE}.partial" "$ARCHIVE"
fi
ACTUAL="$(/usr/bin/shasum -a 256 "$ARCHIVE" | /usr/bin/awk '{print $1}')"
if [ "$ACTUAL" != "$EXPECTED" ]; then
  echo "Pinned Node archive checksum failed; refusing to extract or run it." >&2
  exit 1
fi
TEMP="$(/usr/bin/mktemp -d "$ROOT/.runtime-cache/unpack.XXXXXX")"
trap '/bin/rm -rf "$TEMP"' EXIT
/usr/bin/tar -xzf "$ARCHIVE" -C "$TEMP"
/bin/cp "$TEMP/$NAME/bin/node" "$DEST/node"
/bin/cp "$TEMP/$NAME/LICENSE" "$DEST/NODE-LICENSE.txt"
/bin/chmod 755 "$DEST/node"
/usr/bin/printf '%s  %s\n' "$EXPECTED" "${NAME}.tar.gz" > "$DEST/NODE-ARCHIVE-SHA256.txt"
/usr/bin/printf '%s\n' "$VERSION" > "$DEST/NODE-VERSION.txt"
echo "Verified pinned Apple Silicon Node runtime ${VERSION}."
