#!/usr/bin/env sh
set -eu

REPO="mcKanses/missbetty"
VERSION="${BETTY_VERSION:-latest}"
SKIP_DEPS="${BETTY_SKIP_DEPS:-false}"

if [ "$(uname -s)" = "Linux" ]; then
  OS="linux"
elif [ "$(uname -s)" = "Darwin" ]; then
  OS="darwin"
else
  echo "Unsupported OS: $(uname -s)"
  exit 1
fi

# Install dependencies
install_dependencies() {
  if [ "$SKIP_DEPS" = "true" ]; then
    echo "Skipping dependency installation (BETTY_SKIP_DEPS=true)"
    return
  fi

  echo ""
  echo "Betty requires Docker and optionally mkcert for local HTTPS."
  echo ""

  if [ "$OS" = "linux" ]; then
    install_dependencies_linux
  elif [ "$OS" = "darwin" ]; then
    install_dependencies_macos
  fi
}

install_dependencies_linux() {
  MISSING_TOOLS=""

  # Check for Docker
  if ! command -v docker >/dev/null 2>&1; then
    MISSING_TOOLS="$MISSING_TOOLS docker"
  fi

  # Check for mkcert
  if ! command -v mkcert >/dev/null 2>&1; then
    MISSING_TOOLS="$MISSING_TOOLS mkcert"
  fi

  if [ -z "$MISSING_TOOLS" ]; then
    echo "✓ Docker and mkcert are already installed"
    return
  fi

  echo "Missing tools:$MISSING_TOOLS"
  echo ""

  if ! command -v apt >/dev/null 2>&1; then
    echo "This script requires apt (Debian/Ubuntu). Please install manually:"
    echo "  - Docker: https://docs.docker.com/engine/install/"
    echo "  - mkcert: https://github.com/FiloSottile/mkcert"
    return
  fi

  echo "Running apt update..."
  sudo apt update

  if echo "$MISSING_TOOLS" | grep -q "docker"; then
    echo "Installing Docker..."
    # Check if docker is available in apt
    if apt-cache search --names-only "^docker.io$" 2>/dev/null | grep -q "docker"; then
      sudo apt install -y docker.io docker-compose-plugin
      sudo usermod -aG docker "$USER" 2>/dev/null || true
      echo "✓ Docker installed (you may need to log out and back in for group changes)"
    else
      echo "⚠ Docker not found in apt. Please install from https://docs.docker.com/engine/install/"
    fi
  fi

  if echo "$MISSING_TOOLS" | grep -q "mkcert"; then
    echo "Installing mkcert..."
    # Try to install from apt first, then from source
    if apt-cache search --names-only "^mkcert$" 2>/dev/null | grep -q "mkcert"; then
      sudo apt install -y mkcert
      echo "✓ mkcert installed"
    else
      echo "Installing mkcert from source..."
      MKCERT_VERSION="v1.4.4"
      MKCERT_ARCH="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
      MKCERT_URL="https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-${MKCERT_ARCH}"
      
      if command -v curl >/dev/null 2>&1; then
        sudo curl -fsSL "$MKCERT_URL" -o /usr/local/bin/mkcert
      elif command -v wget >/dev/null 2>&1; then
        sudo wget -qO /usr/local/bin/mkcert "$MKCERT_URL"
      else
        echo "⚠ Neither curl nor wget available. Cannot install mkcert."
        echo "Please install manually: https://github.com/FiloSottile/mkcert"
        return
      fi
      
      sudo chmod +x /usr/local/bin/mkcert
      echo "✓ mkcert installed"
    fi
  fi

  echo ""
}

install_dependencies_macos() {
  MISSING_TOOLS=""

  # Check for Docker
  if ! command -v docker >/dev/null 2>&1; then
    MISSING_TOOLS="$MISSING_TOOLS docker"
  fi

  # Check for mkcert
  if ! command -v mkcert >/dev/null 2>&1; then
    MISSING_TOOLS="$MISSING_TOOLS mkcert"
  fi

  if [ -z "$MISSING_TOOLS" ]; then
    echo "✓ Docker and mkcert are already installed"
    return
  fi

  echo "Missing tools:$MISSING_TOOLS"
  echo ""

  if ! command -v brew >/dev/null 2>&1; then
    echo "This script requires Homebrew. Please install from https://brew.sh"
    echo "Then run this installer again."
    return
  fi

  echo "Running brew update..."
  brew update

  if echo "$MISSING_TOOLS" | grep -q "docker"; then
    echo "Installing Docker Desktop..."
    brew install --cask docker
    echo "⚠ Please start Docker Desktop from Applications folder"
    echo "✓ Docker Desktop installed"
  fi

  if echo "$MISSING_TOOLS" | grep -q "mkcert"; then
    echo "Installing mkcert..."
    brew install mkcert
    mkcert -install >/dev/null 2>&1 || true
    echo "✓ mkcert installed"
  fi

  echo ""
}


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

# Install dependencies after betty
install_dependencies

echo "Run: betty --help"