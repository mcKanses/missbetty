#!/usr/bin/env sh
set -eu

INSTALL_DIR="${BETTY_INSTALL_DIR:-/usr/local/bin}"
TARGET="$INSTALL_DIR/betty"

if [ ! -e "$TARGET" ]; then
  echo "betty not found at $TARGET"
  exit 0
fi

echo "Removing $TARGET"
if [ -w "$INSTALL_DIR" ]; then
  rm -f "$TARGET"
else
  sudo rm -f "$TARGET"
fi

echo "betty uninstalled from $TARGET"