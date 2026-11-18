# One-shot Windows service queries and actions.
# Actions: list | start | stop | restart | startupType
param([string]$Payload)
$ErrorActionPreference = 'Stop'

function Write-Result($obj) {
  $obj | ConvertTo-Json -Compress -Depth 4
}

try {
  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Payload))
  $req = $json | ConvertFrom-Json

  switch ($req.action) {
    'list' {
      $rows = @()
      foreach ($s in (Get-CimInstance Win32_Service -Property Name, DisplayName, Description, State, StartMode, ProcessId, StartName)) {
        $rows += @{
          name        = [string]$s.Name
          displayName = [string]$s.DisplayName
          description = [string]$s.Description
          state       = [string]$s.State
          startMode   = [string]$s.StartMode
          pid         = [int]$s.ProcessId
          account     = [string]$s.StartName
        }
      }
      Write-Result @{ ok = $true; services = @($rows) }
    }
    'start' {
      Start-Service -Name $req.name -ErrorAction Stop
      Write-Result @{ ok = $true }
    }
    'stop' {
      Stop-Service -Name $req.name -Force -ErrorAction Stop
      Write-Result @{ ok = $true }
    }
    'restart' {
      Restart-Service -Name $req.name -Force -ErrorAction Stop
      Write-Result @{ ok = $true }
    }
    'startupType' {
      Set-Service -Name $req.name -StartupType $req.value -ErrorAction Stop
      Write-Result @{ ok = $true }
    }
    default { Write-Result @{ ok = $false; error = "Unknown action '$($req.action)'." } }
  }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}

exit 0
