#!/usr/bin/env sh
set -eu

REPO="mcKanses/missbetty"
VERSION="${BETTY_VERSION:-latest}"

if [ "$(uname -s)" = "Linux" ]; then
  OS="linux"
elif [ "$(uname -s)" = "Darwin" ]; then
  OS="darwin"
else
  echo "Unsupported OS: $(uname -s)"
  exit 1
fi

ARCH_RAW="$(uname -m)"
if [ "$ARCH_RAW" = "x86_64" ] || [ "$ARCH_RAW" = "amd64" ]; then
  ARCH="x64"
elif [ "$ARCH_RAW" = "aarch64" ] || [ "$ARCH_RAW" = "arm64" ]; then
  ARCH="arm64"
else
  echo "Unsupported architecture: $ARCH_RAW"
  exit 1
fi

ASSET="betty-${OS}-${ARCH}.tar.gz"
if [ "$OS" = "darwin" ] && [ "$ARCH" = "x64" ]; then
  echo "No prebuilt macOS x64 binary published yet."
  echo "Please use an arm64 machine or build from source."
  exit 1
fi

if [ "$OS" = "linux" ] && [ "$ARCH" = "arm64" ]; then
  echo "No prebuilt Linux arm64 binary published yet."
  echo "Please use an x64 machine or build from source."
  exit 1
fi

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
  CHECKSUM_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}.sha256"
else
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
  CHECKSUM_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}.sha256"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

echo "Downloading ${URL}"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$URL" -o "$TMP_DIR/betty.tar.gz"
  curl -fsSL "$CHECKSUM_URL" -o "$TMP_DIR/betty.tar.gz.sha256"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP_DIR/betty.tar.gz" "$URL"
  wget -qO "$TMP_DIR/betty.tar.gz.sha256" "$CHECKSUM_URL"
else
  echo "Neither curl nor wget is available."
  exit 1
fi

EXPECTED_SHA="$(awk '{print $1}' "$TMP_DIR/betty.tar.gz.sha256")"
if [ -z "$EXPECTED_SHA" ]; then
  echo "Missing checksum information in ${ASSET}.sha256"
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA="$(sha256sum "$TMP_DIR/betty.tar.gz" | awk '{print $1}')"
elif command -v shasum >/dev/null 2>&1; then
  ACTUAL_SHA="$(shasum -a 256 "$TMP_DIR/betty.tar.gz" | awk '{print $1}')"
else
  echo "No SHA256 tool available (sha256sum/shasum)."
  exit 1
fi

if [ "$EXPECTED_SHA" != "$ACTUAL_SHA" ]; then
  echo "Checksum verification failed for ${ASSET}."
  exit 1
fi

echo "Checksum verification passed."

tar -xzf "$TMP_DIR/betty.tar.gz" -C "$TMP_DIR"
chmod +x "$TMP_DIR/betty"

INSTALL_DIR="${BETTY_INSTALL_DIR:-/usr/local/bin}"
TARGET="$INSTALL_DIR/betty"

echo "Installing to $TARGET"
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP_DIR/betty" "$TARGET"
else
  sudo mkdir -p "$INSTALL_DIR"
  sudo mv "$TMP_DIR/betty" "$TARGET"
fi

echo "betty installed: $TARGET"
echo "Run: betty --help"