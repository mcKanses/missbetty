#!/usr/bin/env sh
set -eu

# Check for root privileges (not required when BETTY_INSTALL_DIR is set)
if [ -z "${BETTY_INSTALL_DIR:-}" ] && [ "$(id -u)" -ne 0 ]; then
  echo "This script must be run as root."
  echo "Please run:"
  echo "  curl -fsSL https://raw.githubusercontent.com/mcKanses/missbetty/main/install.sh | sudo sh"
  echo "or download the script and run it with sudo."
  exit 1
fi

REPO="mcKanses/missbetty"

# Root needs no sudo, and minimal systems (containers, some WSL distros) run as
# root without sudo installed.
if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
else
  SUDO=""
fi
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
  if command -v docker >/dev/null 2>&1 && command -v mkcert >/dev/null 2>&1; then
    echo "✓ Docker and mkcert are already installed"
    return
  fi

  if [ "$(id -u)" -ne 0 ] && [ -z "$SUDO" ]; then
    echo "sudo is required for automatic dependency installation."
    echo "Install manually: Docker, Docker Compose, mkcert"
    exit 1
  fi

  install_with_pm() {
    PKG="$1"

    if command -v apt-get >/dev/null 2>&1; then
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get update
      $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y "$PKG"
      return 0
    fi

    if command -v apt >/dev/null 2>&1; then
      $SUDO env DEBIAN_FRONTEND=noninteractive apt update
      $SUDO env DEBIAN_FRONTEND=noninteractive apt install -y "$PKG"
      return 0
    fi

    if command -v dnf >/dev/null 2>&1; then
      $SUDO dnf install -y "$PKG"
      return 0
    fi

    if command -v yum >/dev/null 2>&1; then
      $SUDO yum install -y "$PKG"
      return 0
    fi

    if command -v pacman >/dev/null 2>&1; then
      $SUDO pacman -Sy --noconfirm "$PKG"
      return 0
    fi

    if command -v zypper >/dev/null 2>&1; then
      $SUDO zypper --non-interactive install "$PKG"
      return 0
    fi

    if command -v apk >/dev/null 2>&1; then
      $SUDO apk add --no-cache "$PKG"
      return 0
    fi

    return 1
  }

  distro_id() {
    ( . /etc/os-release 2>/dev/null && echo "${ID:-}" ) || true
  }

  # get.docker.com covers Debian, Ubuntu, Fedora, CentOS and RHEL and refuses
  # other distributions; those ship Docker in their own repositories, or (Alma,
  # Rocky) use Docker's RHEL repository.
  install_docker_from_distro() {
    case "$1" in
      arch|manjaro|endeavouros) install_with_pm docker && install_with_pm docker-compose ;;
      opensuse*|sles) install_with_pm docker && install_with_pm docker-compose ;;
      alpine) install_with_pm docker && install_with_pm docker-cli-compose ;;
      amzn) install_with_pm docker ;;
      almalinux|rocky)
        $SUDO dnf install -y dnf-plugins-core &&
          $SUDO dnf config-manager --add-repo https://download.docker.com/linux/rhel/docker-ce.repo &&
          $SUDO dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin ;;
    esac
  }

  install_docker_linux() {
    if command -v docker >/dev/null 2>&1; then
      return
    fi

    echo "Installing Docker Engine..."
    DISTRO="$(distro_id)"
    case "$DISTRO" in
      arch|manjaro|endeavouros|opensuse*|sles|alpine|amzn|almalinux|rocky)
        # A failure is reported by the docker check after this function.
        install_docker_from_distro "$DISTRO" || true ;;
      *)
        if command -v curl >/dev/null 2>&1; then
          curl -fsSL https://get.docker.com | $SUDO sh
        elif command -v wget >/dev/null 2>&1; then
          wget -qO- https://get.docker.com | $SUDO sh
        else
          echo "Neither curl nor wget is available; cannot install Docker automatically."
          exit 1
        fi ;;
    esac

    if command -v systemctl >/dev/null 2>&1; then
      $SUDO systemctl enable --now docker || true
    elif command -v rc-update >/dev/null 2>&1; then
      # OpenRC (Alpine)
      $SUDO rc-update add docker default || true
      $SUDO rc-service docker start || true
    elif command -v service >/dev/null 2>&1; then
      $SUDO service docker start || true
    fi

    # USER is unset in many root containers, which set -u would abort on.
    USER_TO_ADD="${SUDO_USER:-${USER:-}}"
    if [ -n "$USER_TO_ADD" ]; then
      $SUDO usermod -aG docker "$USER_TO_ADD" 2>/dev/null || true
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
      $SUDO systemctl enable --now docker.service docker.socket >/dev/null 2>&1 || true
      $SUDO systemctl start docker >/dev/null 2>&1 || true
    elif command -v service >/dev/null 2>&1; then
      $SUDO service docker start >/dev/null 2>&1 || true
    elif command -v dockerd >/dev/null 2>&1; then
      $SUDO nohup dockerd >/tmp/betty-dockerd.log 2>&1 &
    fi

    for attempt in 1 2 3 4 5 6 7 8 9 10; do
      if docker info >/dev/null 2>&1; then
        echo "✓ Docker daemon is running"
        return
      fi
      if $SUDO docker info >/dev/null 2>&1; then
        echo "✓ Docker daemon is running (current shell lacks docker group access yet)"
        echo "Re-login once to use docker without sudo."
        return
      fi
      sleep 1
    done

    if $SUDO docker info >/dev/null 2>&1; then
      echo "✓ Docker daemon is running (current shell lacks docker group access yet)"
      echo "Re-login once to use docker without sudo."
      return
    fi

    echo "Docker was installed, but daemon is not reachable yet."
    if command -v systemctl >/dev/null 2>&1; then
      if [ "$(ps -p 1 -o comm= 2>/dev/null || true)" != "systemd" ]; then
        echo "This host does not run systemd as PID 1; service startup may be restricted."
      fi
      echo "Docker service status (if available):"
      $SUDO systemctl --no-pager --full status docker 2>/dev/null | tail -n 25 || true
    fi
    echo "Try starting it manually and rerun:"
    echo "  $SUDO systemctl start docker"
    echo "or"
    echo "  $SUDO service docker start"
    exit 1
  }

  # Found by path as well: sudo's secure_path (RHEL, Fedora) leaves out
  # /usr/local/bin, where the fallback below installs mkcert.
  find_mkcert() {
    if command -v mkcert 2>/dev/null; then
      return
    fi
    if [ -x /usr/local/bin/mkcert ]; then
      echo /usr/local/bin/mkcert
    fi
  }

  install_mkcert_linux() {
    if [ -n "$(find_mkcert)" ]; then
      return
    fi

    echo "Installing mkcert..."

    install_with_pm mkcert || true
    install_with_pm libnss3-tools || true

    if [ -z "$(find_mkcert)" ]; then
      # mkcert publishes no checksums; these are the sha256 of the v1.4.4
      # release binaries, so a swapped download is refused.
      MKCERT_VERSION="v1.4.4"
      case "$(uname -m)" in
        x86_64|amd64) MKCERT_ARCH="amd64"; MKCERT_SHA256="6d31c65b03972c6dc4a14ab429f2928300518b26503f58723e532d1b0a3bbb52" ;;
        aarch64|arm64) MKCERT_ARCH="arm64"; MKCERT_SHA256="b98f2cc69fd9147fe4d405d859c57504571adec0d3611c3eefd04107c7ac00d0" ;;
        *)
          echo "Unsupported architecture for mkcert fallback: $(uname -m)"
          exit 1
          ;;
      esac

      MKCERT_URL="https://github.com/FiloSottile/mkcert/releases/download/${MKCERT_VERSION}/mkcert-${MKCERT_VERSION}-linux-${MKCERT_ARCH}"

      fetch "$MKCERT_URL" "$TMP_DIR/mkcert"
      ACTUAL_MKCERT_SHA="$(sha256sum "$TMP_DIR/mkcert" | awk '{print $1}')"
      if [ "$ACTUAL_MKCERT_SHA" != "$MKCERT_SHA256" ]; then
        echo "Checksum verification failed for mkcert ${MKCERT_VERSION} (${MKCERT_ARCH})."
        exit 1
      fi
      $SUDO install -m 0755 "$TMP_DIR/mkcert" /usr/local/bin/mkcert
    fi

    # The CA must belong to the user who runs betty: run as root, mkcert would
    # create and trust a second CA under /root that betty never uses.
    MKCERT_BIN="$(find_mkcert)"
    if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ]; then
      sudo -u "$SUDO_USER" -H "$MKCERT_BIN" -install >/dev/null 2>&1 || true
    else
      "$MKCERT_BIN" -install >/dev/null 2>&1 || true
    fi
  }

  install_docker_linux
  ensure_docker_running_linux
  install_mkcert_linux

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker installation failed."
    echo "Install Docker Engine for your distribution: https://docs.docker.com/engine/install/"
    exit 1
  fi

  if [ -z "$(find_mkcert)" ]; then
    echo "mkcert installation failed."
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1 && ! $SUDO docker compose version >/dev/null 2>&1; then
    echo "Docker is installed, but Docker Compose plugin is not available yet."
    echo "Install it: https://docs.docker.com/compose/install/linux/"
  fi

  echo "✓ Dependencies installed (Docker + mkcert)"
  if ! docker info >/dev/null 2>&1 && $SUDO docker info >/dev/null 2>&1; then
    echo "Docker is ready, but this shell has not picked up docker group permissions yet."
    echo "Run 'newgrp docker' now, or re-login once, then use Betty without sudo."
  fi
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

  # sudo may drop Homebrew's directory from PATH, so look in its default
  # prefixes too (/opt/homebrew on Apple Silicon, /usr/local on Intel).
  BREW="$(command -v brew 2>/dev/null || true)"
  for candidate in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [ -z "$BREW" ] && [ -x "$candidate" ]; then BREW="$candidate"; fi
  done

  if [ -z "$BREW" ]; then
    echo "This script requires Homebrew. Please install from https://brew.sh"
    echo "Then run this installer again."
    return
  fi

  # Homebrew refuses to run as root, and mkcert must trust its CA in the
  # user's keychain, so both run as the user who invoked sudo.
  if [ "$(id -u)" -eq 0 ]; then
    if [ -z "${SUDO_USER:-}" ] || [ "$SUDO_USER" = "root" ]; then
      echo "Homebrew cannot run as root. Install Docker Desktop and mkcert as your user:"
      echo "  brew install --cask docker && brew install mkcert && mkcert -install"
      return
    fi
    as_user() { sudo -u "$SUDO_USER" -H "$@"; }
  else
    as_user() { "$@"; }
  fi

  echo "Running brew update..."
  as_user "$BREW" update

  if echo "$MISSING_TOOLS" | grep -q "docker"; then
    echo "Installing Docker Desktop..."
    as_user "$BREW" install --cask docker
    echo "⚠ Please start Docker Desktop from Applications folder"
    echo "✓ Docker Desktop installed"
  fi

  if echo "$MISSING_TOOLS" | grep -q "mkcert"; then
    echo "Installing mkcert..."
    as_user "$BREW" install mkcert
    as_user "$(dirname "$BREW")/mkcert" -install >/dev/null 2>&1 || true
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

if [ "$VERSION" = "latest" ]; then
  URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
  CHECKSUM_URL="https://github.com/${REPO}/releases/latest/download/${ASSET}.sha256"
else
  URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}"
  CHECKSUM_URL="https://github.com/${REPO}/releases/download/${VERSION}/${ASSET}.sha256"
fi

TMP_DIR="$(mktemp -d)"
# The EXIT trap cleans up; INT and TERM must end the script, which a trap for
# them alone would not.
trap 'rm -rf "$TMP_DIR"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO "$2" "$1"; }
else
  echo "Neither curl nor wget is available."
  exit 1
fi

# Minimal images (openSUSE, Amazon Linux) ship without tar.
if ! command -v tar >/dev/null 2>&1; then
  echo "tar is required to unpack betty. Install it with your package manager and run this script again."
  exit 1
fi

echo "Downloading ${URL}"
fetch "$URL" "$TMP_DIR/betty.tar.gz"
fetch "$CHECKSUM_URL" "$TMP_DIR/betty.tar.gz.sha256"

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

# The checksum proves the download is intact, not who built it. The archive is
# also signed with Sigstore (keyless) by this repository's release-binaries
# workflow; with cosign installed that signature is checked too, and
# BETTY_REQUIRE_SIGNATURE=true refuses to install without it.
REQUIRE_SIGNATURE="${BETTY_REQUIRE_SIGNATURE:-false}"
# Only runs on main sign releases; a workflow run from any other branch could
# carry a modified workflow.
SIGNER_IDENTITY='^https://github\.com/mcKanses/missbetty/\.github/workflows/release-binaries\.yml@refs/heads/main$'
SIGNER_ISSUER='https://token.actions.githubusercontent.com'

# sudo may drop cosign's directory from PATH (e.g. Homebrew's), so look in the
# usual install locations too.
COSIGN="$(command -v cosign 2>/dev/null || true)"
for candidate in /opt/homebrew/bin/cosign /usr/local/bin/cosign /usr/bin/cosign; do
  if [ -z "$COSIGN" ] && [ -x "$candidate" ]; then COSIGN="$candidate"; fi
done

if [ -n "$COSIGN" ]; then
  fetch "$URL.sig" "$TMP_DIR/betty.tar.gz.sig"
  fetch "$URL.pem" "$TMP_DIR/betty.tar.gz.pem"
  if ! COSIGN_OUTPUT="$("$COSIGN" verify-blob "$TMP_DIR/betty.tar.gz" \
    --signature "$TMP_DIR/betty.tar.gz.sig" \
    --certificate "$TMP_DIR/betty.tar.gz.pem" \
    --certificate-identity-regexp "$SIGNER_IDENTITY" \
    --certificate-oidc-issuer "$SIGNER_ISSUER" 2>&1)"; then
    echo "Signature verification failed for ${ASSET}:"
    echo "$COSIGN_OUTPUT"
    exit 1
  fi
  echo "Signature verification passed (signed by ${REPO}'s release workflow)."
elif [ "$REQUIRE_SIGNATURE" = "true" ]; then
  echo "BETTY_REQUIRE_SIGNATURE=true, but cosign is not installed."
  echo "Install cosign (https://docs.sigstore.dev/cosign/system_config/installation/) and run the installer again."
  exit 1
else
  echo "Signature not verified: cosign is not installed (checksum only)."
fi

# --no-same-owner: as root, tar would otherwise restore the owner stored in the
# archive (the CI build user), and that user could replace /usr/local/bin/betty.
tar --no-same-owner -xzf "$TMP_DIR/betty.tar.gz" -C "$TMP_DIR"
chmod +x "$TMP_DIR/betty"

INSTALL_DIR="${BETTY_INSTALL_DIR:-/usr/local/bin}"
TARGET="$INSTALL_DIR/betty"

echo "Installing to $TARGET"
# Create the directory as the current user first, so a custom directory in the
# user's home does not end up owned by root.
mkdir -p "$INSTALL_DIR" 2>/dev/null || $SUDO mkdir -p "$INSTALL_DIR"
if [ -w "$INSTALL_DIR" ]; then
  mv "$TMP_DIR/betty" "$TARGET"
else
  # install, not mv: mv would keep the invoking user as owner of a binary in a
  # root-owned directory (e.g. /usr/local/bin when updated by `betty update`).
  $SUDO install -m 0755 "$TMP_DIR/betty" "$TARGET"
fi

echo "betty installed: $TARGET"

# Install dependencies after betty
install_dependencies

echo "Run: betty --help"