$ErrorActionPreference = 'Stop'

$installDir = if ($env:BETTY_INSTALL_DIR) {
  $env:BETTY_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA 'Programs\betty'
}

$target = Join-Path $installDir 'betty.exe'
if (-not (Test-Path $target)) {
  Write-Host "betty not found at $target"
  exit 0
}

Remove-Item -Path $target -Force

if ((Test-Path $installDir) -and ((Get-ChildItem -Path $installDir -Force | Measure-Object).Count -eq 0)) {
  Remove-Item -Path $installDir -Force
}

Write-Host "betty uninstalled from $target"