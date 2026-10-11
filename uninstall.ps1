# Run through `irm | iex`, this script shares the caller's session: it must not
# `exit` (that closes their window) or leave its preferences behind, so the
# body runs in its own scope.
& {
  $ErrorActionPreference = 'Stop'

  $installDir = if ($env:BETTY_INSTALL_DIR) {
    $env:BETTY_INSTALL_DIR
  } else {
    Join-Path $env:LOCALAPPDATA 'Programs\betty'
  }

  # -LiteralPath throughout: [ and ] in a user name are wildcards to -Path.
  $target = Join-Path $installDir 'betty.exe'
  if (Test-Path -LiteralPath $target) {
    try {
      Remove-Item -LiteralPath $target -Force
      Write-Host "betty uninstalled from $target"
    } catch {
      # A running betty.exe cannot be deleted. The PATH is cleaned up anyway.
      Write-Warning "Could not remove $target ($($_.Exception.Message)). Close betty and delete the file."
    }
  } else {
    Write-Host "betty not found at $target"
  }
  # Left behind by `betty update` when betty.exe was replaced while running, or
  # by an interrupted install.
  Get-ChildItem -LiteralPath $installDir -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'betty.exe*.old' -or $_.Name -eq 'betty.exe.new' } |
    Remove-Item -Force -ErrorAction SilentlyContinue

  # Takes the install directory back out of the user PATH, read and written
  # unexpanded so other %VAR% entries stay as they are.
  $envKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try {
    $userPath = [string]$envKey.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $segments = @($userPath -split ';' | Where-Object { $_ -ne '' })
    $kept = @($segments | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ne $installDir.TrimEnd('\') })
    if ($kept.Count -ne $segments.Count) {
      $envKey.SetValue('Path', ($kept -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
      [Environment]::SetEnvironmentVariable('BETTY_PATH_CHANGED', '1', 'User')
      [Environment]::SetEnvironmentVariable('BETTY_PATH_CHANGED', $null, 'User')
      Write-Host "Removed $installDir from user PATH."
    }
  }
  finally {
    $envKey.Close()
  }

  if ((Test-Path -LiteralPath $installDir) -and ((Get-ChildItem -LiteralPath $installDir -Force | Measure-Object).Count -eq 0)) {
    Remove-Item -LiteralPath $installDir -Force
  }
}
