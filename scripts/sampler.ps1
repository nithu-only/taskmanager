# Long-lived sampler: writes one JSON line per tick to stdout.
# Started by src/lib/host.ts and read line-by-line by Node.
# -Ticks N stops after N samples (used for smoke tests); 0 means run forever.
param([int]$Ticks = 0)
$ErrorActionPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false) } catch {}

$cachePath = Join-Path $PSScriptRoot 'versioninfo.json'
$vi = @{}
if (Test-Path -LiteralPath $cachePath) {
  try {
    $raw = Get-Content -LiteralPath $cachePath -Raw | ConvertFrom-Json
    foreach ($prop in $raw.PSObject.Properties) {
      $vi[$prop.Name] = @([string]$prop.Value.company, [string]$prop.Value.description)
    }
  } catch {}
}

$cores   = [Environment]::ProcessorCount
$user    = if ($env:USERNAME) { $env:USERNAME } else { 'User' }
$os      = Get-CimInstance Win32_OperatingSystem
$cs      = Get-CimInstance Win32_ComputerSystem
$cpuInfo = Get-CimInstance Win32_Processor | Select-Object -First 1
$net     = Get-CimInstance Win32_NetworkAdapter -Filter 'NetEnabled=True' |
           Where-Object { $_.NetConnectionID } | Select-Object -First 1

[pscustomobject]@{
  type        = 'hello'
  hostName    = $env:COMPUTERNAME
  os          = if ($os.Caption) { $os.Caption } else { 'Windows' }
  osVersion   = [string]$os.Version
  cpuName     = if ($cpuInfo.Name) { ($cpuInfo.Name -replace '\s+', ' ').Trim() } else { 'Unknown CPU' }
  cores       = if ($cpuInfo.NumberOfCores) { [int]$cpuInfo.NumberOfCores } else { $cores }
  logical     = $cores
  baseGhz     = if ($cpuInfo.MaxClockSpeed) { [math]::Round($cpuInfo.MaxClockSpeed / 1000, 2) } else { 0 }
  memoryTotalMb = [math]::Round($cs.TotalPhysicalMemory / 1MB, 0)
  userName    = $user
  networkName = if ($net.Name) { $net.Name } else { '' }
  bootedAt    = try { $os.LastBootUpTime.ToUniversalTime().ToString('o') } catch { $null }
} | ConvertTo-Json -Compress -Depth 3

$prevNet = $null
$prevTick = 0
$tickCount = 0

while ($Ticks -le 0 -or $tickCount -lt $Ticks) {
  $tickCount++
  $tick = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

  $cim = @{}
  foreach ($p in (Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, WorkingSetSize, ThreadCount, HandleCount, ReadTransferCount, WriteTransferCount, CommandLine, ExecutablePath, CreationDate, UserModeTime, KernelModeTime, SessionId)) {
    if ($p.ProcessId -ne $null) { $cim[[int]$p.ProcessId] = $p }
  }

  $live = @{}
  foreach ($p in [System.Diagnostics.Process]::GetProcesses()) {
    $responding = $true
    $priority = ''
    try { $responding = [bool]$p.Responding } catch {}
    try { $priority = $p.PriorityClass.ToString() } catch {}
    $live[$p.Id] = @{ responding = $responding; priority = $priority }
  }

  # Resolve publisher/description only for executables not seen before.
  $missing = @()
  foreach ($p in $cim.Values) {
    if ($p.ExecutablePath -and -not $vi.ContainsKey($p.ExecutablePath)) { $missing += $p.ExecutablePath }
  }
  $missing = $missing | Sort-Object -Unique
  foreach ($path in $missing) {
    try {
      $v = (Get-Item -LiteralPath $path -ErrorAction Stop).VersionInfo
      $vi[$path] = @([string]$v.CompanyName, [string]$v.FileDescription)
    } catch {
      $vi[$path] = @('', '')
    }
  }
  if ($missing.Count -gt 0) {
    $out = @{}
    foreach ($k in $vi.Keys) { $out[$k] = @{ company = $vi[$k][0]; description = $vi[$k][1] } }
    try { $out | ConvertTo-Json -Compress -Depth 3 | Set-Content -LiteralPath $cachePath -Encoding UTF8 } catch {}
  }

  $netBytes = $prevNet
  if ($tickCount % 3 -eq 1) {
    $bytes = 0
    foreach ($ni in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
      if ($ni.OperationalStatus -eq 'Up' -and $ni.NetworkInterfaceType -ne 'Loopback') {
        try {
          $st = $ni.GetIPStatistics()
          $bytes += [double]$st.BytesReceived + [double]$st.BytesSent
        } catch {}
      }
    }
    $netBytes = $bytes
  }
  $netMbps = 0
  if ($prevNet -ne $null -and $netBytes -ge $prevNet -and $tick -gt $prevTick) {
    $netMbps = [math]::Round((($netBytes - $prevNet) * 8) / ($tick - $prevTick) / 1000, 2)
  }
  $prevNet = $netBytes
  $prevTick = $tick

  $list = [System.Collections.Generic.List[object]]::new()
  foreach ($p in $cim.Values) {
    $pid2 = [int]$p.ProcessId
    $exe = $p.ExecutablePath
    $company = ''
    $desc = ''
    if ($exe -and $vi.ContainsKey($exe)) { $company = $vi[$exe][0]; $desc = $vi[$exe][1] }
    $extra = $live[$pid2]
    $created = $null
    try { if ($p.CreationDate) { $created = $p.CreationDate.ToUniversalTime().ToString('o') } } catch {}
    $list.Add([pscustomobject]@{
      pid        = $pid2
      ppid       = if ($p.ParentProcessId) { [int]$p.ParentProcessId } else { 0 }
      name       = [string]$p.Name
      wsMb       = [math]::Round([double]$p.WorkingSetSize / 1MB, 1)
      threads    = [int]$p.ThreadCount
      handles    = [int]$p.HandleCount
      ioBytes    = [double]$p.ReadTransferCount + [double]$p.WriteTransferCount
      cpuSec     = ([double]$p.UserModeTime + [double]$p.KernelModeTime) / 10000000
      cmd        = [string]$p.CommandLine
      exe        = [string]$exe
      started    = $created
      session    = [int]$p.SessionId
      responding = if ($extra) { [bool]$extra.Responding } else { $true }
      priority   = if ($extra -and $extra.PriorityClass) { [string]$extra.PriorityClass } else { '' }
      company    = [string]$company
      description = [string]$desc
    })
  }

  [pscustomobject]@{
    type        = 'sample'
    at          = $tick
    cores       = $cores
    totalMb     = [math]::Round([double]$os.TotalVisibleMemorySize / 1024, 0)
    freeMb      = [math]::Round([double]$os.FreePhysicalMemory / 1024, 0)
    networkMbps = $netMbps
    processes   = $list
  } | ConvertTo-Json -Compress -Depth 4

  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 3000
}
