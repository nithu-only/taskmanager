# One-shot startup app queries and actions.
# Actions: list | disable | enable | add | remove | setcommand
# Only entries under HKCU\...\Run can be changed without administrator rights;
# disabled entries are parked in a reversible backup key.
param([string]$Payload)
$ErrorActionPreference = 'Stop'

$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$offKey = 'HKCU:\Software\TaskManager\DisabledStartup'

function Write-Result($obj) {
  $obj | ConvertTo-Json -Compress -Depth 4
}

function Get-RunValue([string]$key, [string]$name) {
  if (-not (Test-Path -LiteralPath $key)) { return $null }
  $item = Get-Item -LiteralPath $key
  if ($item.GetValueNames() -notcontains $name) { return $null }
  return $item.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
}

function ConvertTo-SafeText([string]$text) {
  # Registry values occasionally hold malformed UTF-16 or control bytes. Keeping
  # only printable ASCII guarantees valid JSON and a value that is safe to write back.
  return [regex]::Replace([string]$text, '[^\x20-\x7E]', '')
}

function Get-RunInfo([string]$key) {
  $map = @{}
  $opaque = @()
  if (Test-Path -LiteralPath $key) {
    $item = Get-Item -LiteralPath $key
    foreach ($name in $item.GetValueNames()) {
      $value = $item.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
      if ($value -is [byte[]]) {
        # Registry values stored as REG_BINARY (some installers do this) cannot be
        # round-tripped safely, so they are shown but never modified.
        $map[$name] = '(binary value)'
        $opaque += $name
        continue
      }
      $text = [string]$value
      $safe = ConvertTo-SafeText $text
      if ($safe -ne $text) { $opaque += $name }
      $map[$name] = $safe
    }
  }
  return [pscustomobject]@{ map = $map; opaque = $opaque }
}

try {
  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Payload))
  $req = $json | ConvertFrom-Json

  switch ($req.action) {
    'list' {
      $entries = @()
      foreach ($e in (Get-CimInstance Win32_StartupCommand -Property Name, Command, Location, User)) {
        $entries += @{
          name     = ConvertTo-SafeText ([string]$e.Name)
          command  = ConvertTo-SafeText ([string]$e.Command)
          location = ConvertTo-SafeText ([string]$e.Location)
          user     = ConvertTo-SafeText ([string]$e.User)
        }
      }
      $onInfo = Get-RunInfo $runKey
      $offInfo = Get-RunInfo $offKey
      Write-Result @{
        ok      = $true
        entries = @($entries)
        on      = $onInfo.map
        off     = $offInfo.map
        opaque  = @($onInfo.opaque + $offInfo.opaque)
      }
    }
    'disable' {
      $value = Get-RunValue $runKey $req.name
      if ($null -eq $value) { throw "'$($req.name)' is not a startup entry this app can change without administrator rights." }
      if (-not (Test-Path -LiteralPath $offKey)) { New-Item -Path $offKey -Force | Out-Null }
      New-ItemProperty -LiteralPath $offKey -Name $req.name -Value $value -PropertyType String -Force | Out-Null
      Remove-ItemProperty -LiteralPath $runKey -Name $req.name -ErrorAction Stop
      Write-Result @{ ok = $true }
    }
    'enable' {
      $value = Get-RunValue $offKey $req.name
      if ($null -eq $value) { throw "'$($req.name)' is not disabled by this app." }
      New-ItemProperty -LiteralPath $runKey -Name $req.name -Value $value -PropertyType String -Force | Out-Null
      Remove-ItemProperty -LiteralPath $offKey -Name $req.name -ErrorAction Stop
      Write-Result @{ ok = $true }
    }
    'add' {
      New-ItemProperty -LiteralPath $runKey -Name $req.name -Value $req.command -PropertyType String -Force | Out-Null
      Write-Result @{ ok = $true }
    }
    'remove' {
      if ($null -ne (Get-RunValue $runKey $req.name)) { Remove-ItemProperty -LiteralPath $runKey -Name $req.name -ErrorAction Stop }
      if ($null -ne (Get-RunValue $offKey $req.name)) { Remove-ItemProperty -LiteralPath $offKey -Name $req.name -ErrorAction Stop }
      Write-Result @{ ok = $true }
    }
    'setcommand' {
      if ($null -ne (Get-RunValue $runKey $req.name)) {
        New-ItemProperty -LiteralPath $runKey -Name $req.name -Value $req.command -PropertyType String -Force | Out-Null
      } elseif ($null -ne (Get-RunValue $offKey $req.name)) {
        New-ItemProperty -LiteralPath $offKey -Name $req.name -Value $req.command -PropertyType String -Force | Out-Null
      } else {
        throw "'$($req.name)' is not a startup entry this app can change without administrator rights."
      }
      Write-Result @{ ok = $true }
    }
    default { Write-Result @{ ok = $false; error = "Unknown action '$($req.action)'." } }
  }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}

exit 0
