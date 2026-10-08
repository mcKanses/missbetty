$ErrorActionPreference = 'Stop'

# No Administrator rights needed: betty installs into the user's profile and
# user PATH. Dependency installers ask for elevation themselves where needed.
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")

$repo = 'mcKanses/missbetty'
$version = if ($env:BETTY_VERSION) { $env:BETTY_VERSION } else { 'latest' }
$skipDeps = if ($env:BETTY_SKIP_DEPS) { $env:BETTY_SKIP_DEPS -eq 'true' } else { $false }

# The OS architecture, not the process's: an x64 PowerShell under emulation on
# ARM64 Windows still gets the native arm64 binary.
$osArch = try { [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch { $env:PROCESSOR_ARCHITECTURE }
$asset = if ($osArch -match '^arm64$') { 'betty-windows-arm64.zip' } else { 'betty-windows-x64.zip' }

$dockerWaitSeconds = 240
if ($env:BETTY_DOCKER_WAIT_SECONDS) {
  $parsedWait = 0
  if ([int]::TryParse($env:BETTY_DOCKER_WAIT_SECONDS, [ref]$parsedWait)) { $dockerWaitSeconds = [Math]::Max(30, $parsedWait) }
}

function Refresh-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = (($machinePath, $userPath) -join ';')
}

function Install-PackageAuto {
  param(
    [string]$Name,
    [string]$ChocoPackage,
    [string]$WingetId
  )

  # Chocolatey needs an elevated shell; winget prompts for elevation itself.
  $hasChoco = $isAdmin -and $null -ne (Get-Command choco -ErrorAction SilentlyContinue)
  $hasWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)

  if ($hasChoco) {
    Write-Host "Installing $Name via Chocolatey..."
    choco install $ChocoPackage -y --no-progress
    return
  }

  if ($hasWinget) {
    Write-Host "Installing $Name via winget..."
    winget install --id $WingetId --exact --source winget --accept-package-agreements --accept-source-agreements --silent
    return
  }

  throw "winget is not available for automatic $Name installation. Install $Name manually, or rerun this installer from an elevated PowerShell to use Chocolatey."
}

function Ensure-DockerDesktopRunning {
  if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
    Refresh-ProcessPath
  }

  if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker CLI is still not available after installation.'
  }

  if (docker info 1>$null 2>$null) {
    Write-Host '✓ Docker daemon is running'
    return
  }

  $dockerDesktopExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'

  if (Test-Path $dockerDesktopExe) {
    Write-Host 'Starting Docker Desktop...'
    Start-Process -FilePath $dockerDesktopExe | Out-Null
  }

  $deadline = (Get-Date).AddSeconds($dockerWaitSeconds)
  while ((Get-Date) -lt $deadline) {
    if (docker info 1>$null 2>$null) {
      Write-Host '✓ Docker daemon is running'
      return
    }

    Start-Sleep -Seconds 2
  }

  throw "Docker was installed but the daemon did not become ready within $dockerWaitSeconds seconds. A reboot or first-time Docker Desktop setup may be required; raise the wait with BETTY_DOCKER_WAIT_SECONDS."
}

function Ensure-MkcertInstalled {
  if ($null -eq (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    Refresh-ProcessPath
  }

  if ($null -eq (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    throw 'mkcert was not found after installation.'
  }

  try {
    mkcert -install | Out-Null
    Write-Host '✓ mkcert CA installed'
  }
  catch {
    Write-Host 'mkcert installed, but trust store setup may require additional permissions.'
  }
}

function Install-DependenciesWindows {
  if ($skipDeps) {
    Write-Host 'Skipping dependency installation (BETTY_SKIP_DEPS=true)'
    return
  }

  Write-Host ''
  Write-Host 'Betty requires Docker and optionally mkcert for local HTTPS.'
  Write-Host ''

  $missingTools = @()

  if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
    $missingTools += 'docker'
  }

  if ($null -eq (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    $missingTools += 'mkcert'
  }

  if ($missingTools.Count -eq 0) {
    Write-Host '✓ Docker and mkcert are already installed'
    Ensure-DockerDesktopRunning
    Ensure-MkcertInstalled
    return
  }

  Write-Host "Missing tools: $($missingTools -join ', ')"
  Write-Host ''

  if ($missingTools -contains 'docker') {
    Install-PackageAuto -Name 'Docker Desktop' -ChocoPackage 'docker-desktop' -WingetId 'Docker.DockerDesktop'
  }

  if ($missingTools -contains 'mkcert') {
    Install-PackageAuto -Name 'mkcert' -ChocoPackage 'mkcert' -WingetId 'FiloSottile.mkcert'
  }

  Refresh-ProcessPath
  Ensure-DockerDesktopRunning
  Ensure-MkcertInstalled

  Write-Host '✓ Dependencies installed (Docker + mkcert)'
  Write-Host ''
}

$installDir = if ($env:BETTY_INSTALL_DIR) {
  $env:BETTY_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA 'Programs\betty'
}

if ($version -eq 'latest') {
  $url = "https://github.com/$repo/releases/latest/download/$asset"
  $checksumUrl = "https://github.com/$repo/releases/latest/download/$asset.sha256"
} else {
  $url = "https://github.com/$repo/releases/download/$version/$asset"
  $checksumUrl = "https://github.com/$repo/releases/download/$version/$asset.sha256"
}

$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("betty-install-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmpDir | Out-Null

try {
  $zipPath = Join-Path $tmpDir 'betty.zip'
  $checksumPath = Join-Path $tmpDir 'betty.zip.sha256'

  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $zipPath
  Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumPath

  $expectedLine = Get-Content -Path $checksumPath | Select-Object -First 1
  $expectedHash = ($expectedLine -split '\s+')[0].ToLower()

  if ([string]::IsNullOrWhiteSpace($expectedHash)) {
    throw 'Missing checksum content in checksum file.'
  }

  $actualHash = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLower()

  if ($actualHash -ne $expectedHash) {
    throw "Checksum verification failed for $asset."
  }

  Write-Host 'Checksum verification passed.'

  # The checksum proves the download is intact, not who built it. The archive
  # is also signed with Sigstore (keyless) by this repository's release-binaries
  # workflow; with cosign installed that signature is checked too, and
  # BETTY_REQUIRE_SIGNATURE=true refuses to install without it.
  $requireSignature = $env:BETTY_REQUIRE_SIGNATURE -eq 'true'
  $signerIdentity = '^https://github\.com/mcKanses/missbetty/\.github/workflows/release-binaries\.yml@refs/heads/'
  $signerIssuer = 'https://token.actions.githubusercontent.com'

  if ($null -ne (Get-Command cosign -ErrorAction SilentlyContinue)) {
    $signaturePath = Join-Path $tmpDir 'betty.zip.sig'
    $certificatePath = Join-Path $tmpDir 'betty.zip.pem'
    Invoke-WebRequest -Uri "$url.sig" -OutFile $signaturePath
    Invoke-WebRequest -Uri "$url.pem" -OutFile $certificatePath
    # cosign reports even success on stderr; Windows PowerShell 5.1 would turn
    # that into a terminating error under 'Stop', so judge by exit code only.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $cosignOutput = & cosign verify-blob $zipPath --signature $signaturePath --certificate $certificatePath --certificate-identity-regexp $signerIdentity --certificate-oidc-issuer $signerIssuer 2>&1
    $cosignExit = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($cosignExit -ne 0) {
      throw "Signature verification failed for ${asset}:`n$($cosignOutput -join "`n")"
    }
    Write-Host "Signature verification passed (signed by $repo's release workflow)."
  }
  elseif ($requireSignature) {
    throw 'BETTY_REQUIRE_SIGNATURE=true, but cosign is not installed. Install cosign (e.g. winget install sigstore.cosign) and run the installer again.'
  }
  else {
    Write-Host 'Signature not verified: cosign is not installed (checksum only).'
  }

  Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force

  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  Copy-Item -Path (Join-Path $tmpDir 'betty.exe') -Destination (Join-Path $installDir 'betty.exe') -Force

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) {
    $userPath = ''
  }

  $segments = $userPath -split ';' | Where-Object { $_ -ne '' }

  if ($segments -notcontains $installDir) {
    $newPath = if ($userPath -eq '') { $installDir } else { "$userPath;$installDir" }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "Added $installDir to user PATH."
    Write-Host "Open a new terminal to use betty."
  }

  Write-Host "betty installed: $(Join-Path $installDir 'betty.exe')"

  # The hosts file keeps its default permissions. betty asks for elevation (UAC)
  # when it adds or removes an entry, instead of every process of this user
  # being able to rewrite the file.

  Install-DependenciesWindows

  Write-Host 'Run: betty --help'
}
finally {
  if (Test-Path $tmpDir) {
    Remove-Item -Path $tmpDir -Recurse -Force
  }
}