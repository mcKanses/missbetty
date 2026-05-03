$ErrorActionPreference = 'Stop'

$repo = 'mcKanses/missbetty'
$version = if ($env:BETTY_VERSION) { $env:BETTY_VERSION } else { 'latest' }
$asset = 'betty-windows-x64.zip'
$skipDeps = if ($env:BETTY_SKIP_DEPS) { $env:BETTY_SKIP_DEPS -eq 'true' } else { $false }

# Install dependencies
function Install-Dependencies {
  if ($skipDeps) {
    Write-Host 'Skipping dependency installation (BETTY_SKIP_DEPS=true)'
    return
  }

  Write-Host ''
  Write-Host 'Betty requires Docker and optionally mkcert for local HTTPS.'
  Write-Host ''

  Install-DependenciesWindows
}

function Install-DependenciesWindows {
  $missingTools = @()

  # Check for Docker
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    $missingTools += 'docker'
  }

  # Check for mkcert
  if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    $missingTools += 'mkcert'
  }

  if ($missingTools.Count -eq 0) {
    Write-Host '✓ Docker and mkcert are already installed'
    return
  }

  Write-Host "Missing tools: $($missingTools -join ', ')"
  Write-Host ''

  # Check for Chocolatey
  if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    Write-Host 'This script requires Chocolatey or Docker Desktop to be installed manually.'
    Write-Host 'Please install from:'
    if ($missingTools -contains 'docker') {
      Write-Host '  - Docker Desktop: https://www.docker.com/products/docker-desktop'
    }
    if ($missingTools -contains 'mkcert') {
      Write-Host '  - mkcert: https://github.com/FiloSottile/mkcert'
      Write-Host '    OR via Chocolatey: choco install mkcert'
    }
    return
  }

  Write-Host 'Installing dependencies via Chocolatey...'
  Write-Host ''

  if ($missingTools -contains 'docker') {
    Write-Host 'Installing Docker...'
    choco install docker-desktop -y
    Write-Host '✓ Docker Desktop installed (restart required)'
  }

  if ($missingTools -contains 'mkcert') {
    Write-Host 'Installing mkcert...'
    choco install mkcert -y
    Write-Host '✓ mkcert installed'
  }

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

  Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force

  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  Copy-Item -Path (Join-Path $tmpDir 'betty.exe') -Destination (Join-Path $installDir 'betty.exe') -Force

  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }

  $segments = $userPath -split ';' | Where-Object { $_ -ne '' }
  if ($segments -notcontains $installDir) {
    $newPath = if ($userPath -eq '') { $installDir } else { "$userPath;$installDir" }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    Write-Host "Added $installDir to user PATH."
    Write-Host "Open a new terminal to use betty."
  }

  Write-Host "betty installed: $(Join-Path $installDir 'betty.exe')"

  # Install dependencies after betty
  Install-Dependencies

  Write-Host 'Run: betty --help'
}
finally {
  if (Test-Path $tmpDir) {
    Remove-Item -Path $tmpDir -Recurse -Force
  }
}