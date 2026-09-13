#Requires -Version 5.1

[CmdletBinding()]
param()

Set-StrictMode -Version Latest

function Get-NormalizedPath {
  param([Parameter(Mandatory = $true)][string]$Path)

  return [System.IO.Path]::GetFullPath($Path).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
}

$projectDirectory = Get-NormalizedPath (Split-Path -Parent $PSScriptRoot)
$packagePath = Join-Path $projectDirectory 'package.json'
if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
  throw "package.json was not found: $packagePath"
}

$packageInfo = Get-Content -LiteralPath $packagePath -Raw -Encoding UTF8 -ErrorAction Stop |
  ConvertFrom-Json -ErrorAction Stop
$productName = [string]$packageInfo.productName
if ([string]::IsNullOrWhiteSpace($productName)) {
  throw 'package.json does not define productName; the user-data directory cannot be resolved.'
}

$appDataDirectory = Get-NormalizedPath ([Environment]::GetFolderPath(
  [Environment+SpecialFolder]::ApplicationData
))
$backupRoot = Get-NormalizedPath (Join-Path $appDataDirectory "$productName-new-user-backups")
$targetPath = Get-NormalizedPath (Join-Path $appDataDirectory $productName)

# Safety boundary: only the productName directory directly inside AppData may
# be moved.
$targetParent = Get-NormalizedPath (Split-Path -Parent $targetPath)
if (-not [string]::Equals($targetParent, $appDataDirectory, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to process a path outside the AppData boundary: $targetPath"
}

# The packaged process uses productName. Development normally uses electron.exe.
# Detect only this project and never stop unrelated Electron applications.
$installedProcesses = @(Get-Process -Name $productName -ErrorAction SilentlyContinue)
$developmentProcesses = @(
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      $_.Name -in @('electron.exe', 'node.exe') -and
      $_.CommandLine -and
      $_.CommandLine.IndexOf($projectDirectory, [StringComparison]::OrdinalIgnoreCase) -ge 0
    }
)

if ($installedProcesses.Count -gt 0 -or $developmentProcesses.Count -gt 0) {
  throw 'Live2D Companion is still running. Exit the packaged app and stop any development instance, then run this script again.'
}

$targetExists = Test-Path -LiteralPath $targetPath -PathType Container
if (-not $targetExists) {
  Write-Host 'No Live2D Companion user data exists. The next launch is already equivalent to a new user.' -ForegroundColor Yellow
  exit 0
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$backupDirectory = Get-NormalizedPath (Join-Path $backupRoot $timestamp)

# Verify that the timestamped directory is directly inside the dedicated backup
# root before creating it or moving any data.
$backupParent = Get-NormalizedPath (Split-Path -Parent $backupDirectory)
if (-not [string]::Equals($backupParent, $backupRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to use an unexpected backup path: $backupDirectory"
}

New-Item -ItemType Directory -Path $backupDirectory -Force -ErrorAction Stop | Out-Null

$destination = Join-Path $backupDirectory $productName
Move-Item -LiteralPath $targetPath -Destination $destination -ErrorAction Stop
Write-Host "Backed up: $targetPath" -ForegroundColor DarkGray

Write-Host ''
Write-Host 'The new-user environment is ready.' -ForegroundColor Green
Write-Host "Original user data backup: $backupDirectory" -ForegroundColor Cyan
Write-Host 'Start the app now to see the default Mori Suit pet and all initial settings.'
Write-Host 'To restore later, exit the app and move the backed-up folders into AppData.'
