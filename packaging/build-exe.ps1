# Builds a single portable TaskManager.exe.
#
#   npm run package:exe
#
# The exe embeds a zip payload containing the Next.js standalone build, the
# PowerShell helper scripts and node.exe. Logs and the extracted app live under
# %LOCALAPPDATA%\TaskManagerPortable after the first launch.

[CmdletBinding()]
param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$pkg = Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$version = [string]$pkg.version
if ([string]::IsNullOrWhiteSpace($version)) {
    throw "package.json is missing a version."
}
$safeVersion = ($version -replace "[^0-9A-Za-z.-]", "_")

$outDir = Join-Path $PSScriptRoot "out"
$stage = Join-Path $outDir "stage"
$work = Join-Path $outDir "build"
$outExe = Join-Path $outDir "TaskManager.exe"

if (-not $SkipBuild) {
    Write-Host "==> Building the Next.js standalone server"
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "next build failed."
    }
}

$standalone = Join-Path $root ".next\standalone"
if (-not (Test-Path (Join-Path $standalone "server.js"))) {
    throw "No standalone build found at .next\standalone. Run without -SkipBuild."
}

Write-Host "==> Staging payload"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
New-Item -ItemType Directory -Path $work -Force | Out-Null

Copy-Item (Join-Path $standalone "*") $stage -Recurse -Force

# next build does not copy static assets into the standalone folder.
$staticSource = Join-Path $root ".next\static"
if (Test-Path $staticSource) {
    Copy-Item $staticSource (Join-Path $stage ".next\static") -Recurse -Force
}

$scriptsStage = Join-Path $stage "scripts"
New-Item -ItemType Directory -Path $scriptsStage -Force | Out-Null
Copy-Item (Join-Path $root "scripts\*.ps1") $scriptsStage -Force
Copy-Item (Join-Path $root "README.md") $stage -Force
Remove-Item (Join-Path $scriptsStage "versioninfo.json") -ErrorAction SilentlyContinue

$nodeExe = (Get-Command node).Source
if (-not $nodeExe -or -not (Test-Path $nodeExe)) {
    throw "node.exe was not found on PATH."
}
Copy-Item $nodeExe (Join-Path $stage "node.exe") -Force

Write-Host "==> Packing payload ($([math]::Round((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)) MB)"
$zipPath = Join-Path $work "payload.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$entryNames = Get-ChildItem $stage -Force | ForEach-Object { $_.Name }
Push-Location $stage
try {
    & tar -a -c -f $zipPath @entryNames
    if ($LASTEXITCODE -ne 0) { throw "tar failed to create the payload archive." }
}
finally {
    Pop-Location
}

$versionFile = Join-Path $work "app.version"
Set-Content -Path $versionFile -Value $safeVersion -Encoding ASCII -NoNewline

Write-Host "==> Compiling launcher"
$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
    throw "The .NET Framework C# compiler (csc.exe) was not found."
}

$icon = Join-Path $PSScriptRoot "icon.ico"
if (-not (Test-Path $icon)) {
    Write-Host "==> Generating icon"
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap 64, 64
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.Clear([System.Drawing.Color]::FromArgb(15, 23, 42))
    $font = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = 'Center'
    $format.LineAlignment = 'Center'
    $g.DrawString('TM', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF 0, 0, 64, 64), $format)
    $iconHandle = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
    $stream = [System.IO.File]::Create($icon)
    $iconHandle.Save($stream)
    $stream.Close()
    $g.Dispose()
    $bmp.Dispose()
}

$numericVersion = "1.0.0.0"
if ($version -match '^(\d+)\.(\d+)\.(\d+)') {
    $numericVersion = "$($Matches[1]).$($Matches[2]).$($Matches[3]).0"
}

# Explorer and SignPath both read these; keep them in sync with package.json.
$assemblyInfo = @"
using System.Reflection;

[assembly: AssemblyTitle("Task Manager")]
[assembly: AssemblyDescription("Windows Task Manager web app (portable)")]
[assembly: AssemblyCompany("nithu-only")]
[assembly: AssemblyProduct("Task Manager")]
[assembly: AssemblyCopyright("Copyright (c) 2026 nithu-only")]
[assembly: AssemblyVersion("$numericVersion")]
[assembly: AssemblyFileVersion("$numericVersion")]
[assembly: AssemblyInformationalVersion("$version")]
"@
$assemblyInfoPath = Join-Path $work "AssemblyInfo.cs"
Set-Content -Path $assemblyInfoPath -Value $assemblyInfo -Encoding UTF8

$cscArgs = @(
    "/nologo"
    "/target:winexe"
    "/optimize+"
    "/platform:anycpu"
    "/win32icon:$icon"
    "/win32manifest:$(Join-Path $PSScriptRoot 'app.manifest')"
    "/resource:$zipPath,payload.zip"
    "/resource:$versionFile,app.version"
    "/out:$outExe"
    "/reference:System.dll"
    "/reference:System.Drawing.dll"
    "/reference:System.Windows.Forms.dll"
    "/reference:System.IO.Compression.dll"
    "/reference:System.IO.Compression.FileSystem.dll"
    (Join-Path $PSScriptRoot "Launcher.cs")
    $assemblyInfoPath
)

& $csc @cscArgs
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outExe)) {
    throw "The launcher failed to compile."
}

Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue

$sizeMb = [math]::Round((Get-Item $outExe).Length / 1MB, 1)
Write-Host ""
Write-Host "Built $outExe ($sizeMb MB)"
Write-Host "Share that single file. On first run it extracts to %LOCALAPPDATA%\TaskManagerPortable."
