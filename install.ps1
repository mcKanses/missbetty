# Run through `irm | iex`, this script shares the caller's session; their
# preferences are put back at the end.
$bettyCallerErrorAction = $ErrorActionPreference
$bettyCallerProgress = $ProgressPreference
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 renders a progress bar per downloaded chunk, which makes
# downloads many times slower.
$ProgressPreference = 'SilentlyContinue'

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

# Runs a native command and reports whether it exited with 0. `if (cmd)` would
# test the command's output, not its exit code, and Windows PowerShell 5.1 turns
# stderr output into a terminating error under 'Stop'.
function Test-NativeCommand {
  param([scriptblock]$Command)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Command *> $null
    return $LASTEXITCODE -eq 0
  }
  catch {
    return $false
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }
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

  if (Test-NativeCommand { docker info }) {
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
    if (Test-NativeCommand { docker info }) {
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

  if (Test-NativeCommand { mkcert -install }) {
    Write-Host '✓ mkcert CA installed'
  }
  else {
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

# -OutFile has no literal form and reads [ and ] in a TEMP path as wildcards; a
# bare file name inside the temp directory avoids them.
function Save-Download([string]$Uri, [string]$Name) {
  Push-Location -LiteralPath $tmpDir
  try { Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Name -ErrorAction Stop }
  finally { Pop-Location }
  Join-Path $tmpDir $Name
}

try {
  Write-Host "Downloading $url"
  $zipPath = Save-Download $url 'betty.zip'
  $checksumPath = Save-Download $checksumUrl 'betty.zip.sha256'

  $expectedLine = Get-Content -LiteralPath $checksumPath | Select-Object -First 1
  $expectedHash = ($expectedLine -split '\s+')[0].ToLower()

  if ([string]::IsNullOrWhiteSpace($expectedHash)) {
    throw 'Missing checksum content in checksum file.'
  }

  $actualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $zipPath).Hash.ToLower()

  if ($actualHash -ne $expectedHash) {
    throw "Checksum verification failed for $asset."
  }

  Write-Host 'Checksum verification passed.'

  # The checksum proves the download is intact, not who built it. The archive
  # is also signed with Sigstore (keyless) by this repository's release-binaries
  # workflow; with cosign installed that signature is checked too, and
  # BETTY_REQUIRE_SIGNATURE=true refuses to install without it.
  $requireSignature = $env:BETTY_REQUIRE_SIGNATURE -eq 'true'
  # Only runs on main sign releases; a run from another branch could carry a
  # modified workflow.
  $signerIdentity = '^https://github\.com/mcKanses/missbetty/\.github/workflows/release-binaries\.yml@refs/heads/main$'
  $signerIssuer = 'https://token.actions.githubusercontent.com'

  if ($null -ne (Get-Command cosign -ErrorAction SilentlyContinue)) {
    # cosign reports even success on stderr; Windows PowerShell 5.1 would turn
    # that into a terminating error under 'Stop', so judge by exit code only.
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    # cosign v3 deprecates --signature/--certificate in favour of a Sigstore
    # bundle. Releases from 1.10.6 carry one; older ones and older cosign use the
    # signature and certificate.
    $cosignMajor = 0
    if ((& cosign version 2>&1 | Out-String) -match 'GitVersion:\s*v(\d+)') { $cosignMajor = [int]$Matches[1] }
    $signatureArgs = $null
    if ($cosignMajor -ge 3) {
      try { $signatureArgs = @('--bundle', (Save-Download "$url.sigstore.json" 'betty.zip.sigstore.json')) } catch { $signatureArgs = $null }
    }
    if ($null -eq $signatureArgs) {
      $ErrorActionPreference = $previousPreference
      $signaturePath = Save-Download "$url.sig" 'betty.zip.sig'
      $certificatePath = Save-Download "$url.pem" 'betty.zip.pem'
      $ErrorActionPreference = 'Continue'
      $signatureArgs = @('--signature', $signaturePath, '--certificate', $certificatePath)
    }
    $cosignOutput = & cosign verify-blob $zipPath @signatureArgs --certificate-identity-regexp $signerIdentity --certificate-oidc-issuer $signerIssuer 2>&1
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

  # Not Expand-Archive: Windows PowerShell's version reads [ and ] in the
  # destination as wildcards, even with -LiteralPath.
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, (Join-Path $tmpDir 'extracted'))

  New-Item -ItemType Directory -Path $installDir -Force | Out-Null
  $target = Join-Path $installDir 'betty.exe'
  # The slow copy goes next to the target first; the swap is then two renames.
  # A running betty.exe (e.g. during `betty update`) cannot be overwritten, but
  # it can be renamed. The aside name is unique, since an older betty still
  # running may hold an earlier one; betty removes them on its next start.
  # -LiteralPath throughout: [ and ] in a user name are wildcards to -Path.
  $staged = "$target.new"
  $previous = "$target.$([System.Guid]::NewGuid().ToString('N')).old"
  $swapped = $false
  try {
    Copy-Item -LiteralPath (Join-Path $tmpDir 'extracted\betty.exe') -Destination $staged -Force
    if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $previous }
    Move-Item -LiteralPath $staged -Destination $target
    $swapped = $true
  }
  finally {
    # finally, not catch: Ctrl+C runs only finally blocks.
    if (-not $swapped) {
      if ((Test-Path -LiteralPath $previous) -and -not (Test-Path -LiteralPath $target)) { Move-Item -LiteralPath $previous -Destination $target }
      Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
    }
  }
  Remove-Item -LiteralPath $previous -Force -ErrorAction SilentlyContinue

  # The user PATH is read and written unexpanded, as REG_EXPAND_SZ:
  # [Environment]::Get/SetEnvironmentVariable would expand every %VAR% entry and
  # store it as a fixed path.
  $envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  $userPath = [string]$envKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $segments = @($userPath -split ';' | Where-Object { $_ -ne '' })
  $listed = @($segments | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -eq $installDir.TrimEnd('\') }).Count -gt 0

  # `betty update` sets BETTY_SKIP_PATH: an existing install keeps its PATH as it is.
  if ($env:BETTY_SKIP_PATH -ne 'true' -and -not $listed) {
    $newPath = if ($userPath -eq '') { $installDir } else { "$($userPath.TrimEnd(';'));$installDir" }
    $envKey.SetValue('Path', $newPath, [Microsoft.Win32.RegistryValueKind]::ExpandString)
    # Setting a variable through .NET tells running programs (Explorer, new
    # terminals) that the environment changed; the registry write alone does not.
    [Environment]::SetEnvironmentVariable('BETTY_PATH_CHANGED', '1', 'User')
    [Environment]::SetEnvironmentVariable('BETTY_PATH_CHANGED', $null, 'User')
    Write-Host "Added $installDir to user PATH."
    Write-Host "Open a new terminal to use betty."
  }
  $envKey.Close()

  Write-Host "betty installed: $(Join-Path $installDir 'betty.exe')"

  # The hosts file keeps its default permissions. betty asks for elevation (UAC)
  # when it adds or removes an entry, instead of every process of this user
  # being able to rewrite the file.

  Install-DependenciesWindows

  Write-Host 'Run: betty --help'
}
finally {
  if (Test-Path -LiteralPath $tmpDir) {
    Remove-Item -LiteralPath $tmpDir -Recurse -Force
  }
  $ErrorActionPreference = $bettyCallerErrorAction
  $ProgressPreference = $bettyCallerProgress
}