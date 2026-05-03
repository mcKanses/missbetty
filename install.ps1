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
  $hasChoco = $null -ne (Get-Command choco -ErrorAction SilentlyContinue)
  $hasWinget = $null -ne (Get-Command winget -ErrorAction SilentlyContinue)

  function Install-PackageAuto {
    param(
      [string]$Name,
      [string]$ChocoPackage,
      [string]$WingetId
    )

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

    throw "Neither Chocolatey nor winget is available for automatic $Name installation."
  }

  function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = (($machinePath, $userPath) -join ';')
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

    for ($i = 1; $i -le 60; $i++) {
      if (docker info 1>$null 2>$null) {
        Write-Host '✓ Docker daemon is running'
        return
      }
      Start-Sleep -Seconds 2
    }

    throw 'Docker was installed but daemon did not become ready. A reboot or first-time Docker Desktop setup may be required.'
  }

  function Ensure-MkcertInstalled {
    if ($null -eq (Get-Command mkcert -ErrorAction SilentlyContinue)) {
      throw 'mkcert was not found after installation.'
    }

    try {
      mkcert -install | Out-Null
    }
    catch {
      Write-Host 'mkcert installed, but trust store setup may require elevated permissions.'
    }
  }

  $missingTools = @()
  if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
    $missingTools += 'docker'
  }
  if ($null -eq (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    $missingTools += 'mkcert'
  }

  if ($missingTools.Count -eq 0) {
    Write-Host '✓ Docker and mkcert are already installed'
    if (docker info 1>$null 2>$null) {
      Write-Host '✓ Docker daemon is running'
    } else {
      Ensure-DockerDesktopRunning
    }
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