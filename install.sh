#!/usr/bin/env sh
set -eu

REPO="mcKanses/missbetty"
VERSION="${BETTY_VERSION:-latest}"
SKIP_DEPS="${BETTY_SKIP_DEPS:-false}"
INSTALL_DIR="${BETTY_INSTALL_DIR:-/usr/local/bin}"

if [ "$(uname -s)" = "Linux" ]; then
  OS="linux"
elif [ "$(uname -s)" = "Darwin" ]; then
  OS="darwin"
else
  echo "Unsupported OS: $(uname -s)"
  exit 1
fi

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

need_sudo() {
  if [ "$(id -u)" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
    echo "sudo is required for this operation."
    exit 1
  fi
}

run_sudo() {
  need_sudo
  if [ -n "$SUDO" ]; then
    sudo "$@"
  else
    "$@"
  fi
}

install_with_pm() {
  PKG="$1"

  if command -v apt-get >/dev/null 2>&1; then
    run_sudo env DEBIAN_FRONTEND=noninteractive apt-get update
    run_sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y "$PKG"
    return 0
  fi

  if command -v apt >/dev/null 2>&1; then
    run_sudo env DEBIAN_FRONTEND=noninteractive apt update
    run_sudo env DEBIAN_FRONTEND=noninteractive apt install -y "$PKG"
    return 0
  fi

  if command -v dnf >/dev/null 2>&1; then
    run_sudo dnf install -y "$PKG"
    return 0
  fi

  if command -v yum >/dev/null 2>&1; then
    run_sudo yum install -y "$PKG"
    return 0
  fi

  if command -v pacman >/dev/null 2>&1; then
    run_sudo pacman -Sy --noconfirm "$PKG"
    return 0
  fi

  if command -v zypper >/dev/null 2>&1; then
    run_sudo zypper --non-interactive install "$PKG"
    return 0
  fi

  if command -v apk >/dev/null 2>&1; then
    run_sudo apk add --no-cache "$PKG"
    return 0
  fi

  return 1
}

install_docker_linux() {
  if command -v docker >/dev/null 2>&1; then
    return
  fi

  echo "Installing Docker Engine..."

  if command -v curl >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | run_sudo sh
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- https://get.docker.com | run_sudo sh
  else
    echo "Neither curl nor wget is available; cannot install Docker automatically."
    exit 1
  fi

  if command -v systemctl >/dev/null 2>&1; then
    run_sudo systemctl enable --now docker || true
  elif command -v service >/dev/null 2>&1; then
    run_sudo service docker start || true
  fi

  USER_TO_ADD="${SUDO_USER:-${USER:-}}"
  if [ -n "$USER_TO_ADD" ]; then
    run_sudo usermod -aG docker "$USER_TO_ADD" 2>/dev/null || true
  fi
}

ensure_docker_running_linux() {
  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker CLI is not available."
    exit 1
  fi

  if docker info >/dev/null 2>&1; then
    echo "✓ Docker daemon is running"
    return
  fi

  echo "Starting Docker daemon..."

  if command -v systemctl >/dev/null 2>&1; then
    run_sudo systemctl enable --now docker.service docker.socket >/dev/null 2>&1 || true
    run_sudo systemctl start docker >/dev/null 2>&1 || true
  elif command -v service >/dev/null 2>&1; then
    run_sudo service docker start >/dev/null 2>&1 || true
  elif command -v dockerd >/dev/null 2>&1; then
    run_sudo nohup dockerd >/tmp/betty-dockerd.log 2>&1 &
  fi

  for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if docker info >/dev/null 2>&1; then
      echo "✓ Docker daemon is running"
      return
    fi

    if run_sudo docker info >/dev/null 2>&1; then
      echo "✓ Docker daemon is running (current shell lacks docker group access yet)"
      echo "Run 'newgrp docker' or re-login once to use docker without sudo."
      return
    fi

    sleep 1
  done

  echo "Docker was installed, but daemon is not reachable yet."
  echo "Try starting it manually:"
  echo "  sudo systemctl start docker"
  echo "or"
  echo "  sudo service docker start"
  exit 1
}

install_mkcert_linux() {
  if command -v mkcert >/dev/null 2>&1; then
    mkcert -install >/dev/null 2>&1 || true
    return
  fi

  echo "Installing mkcert..."

  install_with_pm mkcert || true
  install_with_pm libnss3-tools || true

  if ! command -v mkcert >/dev/null 2>&1; then
    MKCERT_VERSION="v1.4.4"

    case "$(uname -m)" in
      x86_64|amd64) MKCERT_ARCH="amd64" ;;
      aarch64|arm64) MKCERT_ARCH="arm64" ;;
      *)
        echo "Unsupported architecture for mkcert fallback: $(uname -m)"
        exit 1
        ;;
    esac

    MKCERT_URL="https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-${MKCERT_ARCH}"

    if command -v curl >/dev/null 2>&1; then
      run_sudo curl -fsSL "$MKCERT_URL" -o /usr/local/bin/mkcert
    elif command -v wget >/dev/null 2>&1; then
      run_sudo wget -qO /usr/local/bin/mkcert "$MKCERT_URL"
    else
      echo "Neither curl nor wget is available; cannot install mkcert automatically."
      exit 1
    fi

    run_sudo chmod +x /usr/local/bin/mkcert
  fi

  mkcert -install >/dev/null 2>&1 || true
}

install_dependencies_linux() {
  if command -v docker >/dev/null 2>&1 && command -v mkcert >/dev/null 2>&1; then
    echo "✓ Docker and mkcert are already installed"
    ensure_docker_running_linux
    mkcert -install >/dev/null 2>&1 || true
    return
  fi

  install_docker_linux
  ensure_docker_running_linux
  install_mkcert_linux

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker installation failed."
    exit 1
  fi

  if ! command -v mkcert >/dev/null 2>&1; then
    echo "mkcert installation failed."
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1 && ! run_sudo docker compose version >/dev/null 2>&1; then
    echo "Docker is installed, but Docker Compose plugin is not available yet."
    echo "Try installing docker-compose-plugin with your package manager."
  fi

  echo "✓ Dependencies installed (Docker + mkcert)"
}

install_dependencies_macos() {
  MISSING_TOOLS=""

  if ! command -v docker >/dev/null 2>&1; then
    MISSING_TOOLS="$MISSING_TOOLS docker"
  fi

  if ! command -v mkcert >/dev/null 2>&1; then
    MISSING_TOOLS="$MISSING_TOOLS mkcert"
  fi

  if [ -z "$MISSING_TOOLS" ]; then
    echo "✓ Docker and mkcert are already installed"
    mkcert -install >/dev/null 2>&1 || true
    return
  fi

  echo "Missing tools:$MISSING_TOOLS"
  echo ""

  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required for automatic dependency installation on macOS."
    echo "Install Homebrew from https://brew.sh and rerun this installer."
    return
  fi

  echo "Running brew update..."
  brew update

  if echo "$MISSING_TOOLS" | grep -q "docker"; then
    echo "Installing Docker Desktop..."
    brew install --cask docker
    echo "⚠ Please start Docker Desktop from Applications."
  fi

  if echo "$MISSING_TOOLS" | grep -q "mkcert"; then
    echo "Installing mkcert..."
    brew install mkcert
  fi

  if command -v mkcert >/dev/null 2>&1; then
    mkcert -install >/dev/null 2>&1 || true
  fi

  echo "✓ Dependencies installed"
}

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

TARGET="$INSTALL_DIR/betty"

echo "Installing to $TARGET"

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP_DIR/betty" "$TARGET"
else
  run_sudo mkdir -p "$INSTALL_DIR"
  run_sudo mv "$TMP_DIR/betty" "$TARGET"
fi

echo "betty installed: $TARGET"

install_dependencies

echo ""
echo "Run: betty --help"