# One-shot process actions. Receives a base64 JSON payload and prints one JSON line.
# Actions: suspend | resume | kill | priority | spawn
param([string]$Payload)
$ErrorActionPreference = 'Stop'

function Write-Result($obj) {
  $obj | ConvertTo-Json -Compress -Depth 4
}

try {
  $json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($Payload))
  $req = $json | ConvertFrom-Json

  Add-Type -Namespace TmNative -Name Nt -MemberDefinition @"
[DllImport("ntdll.dll")] public static extern uint NtSuspendProcess(IntPtr h);
[DllImport("ntdll.dll")] public static extern uint NtResumeProcess(IntPtr h);
"@ -ErrorAction SilentlyContinue

  switch ($req.action) {
    'suspend' {
      foreach ($id in @($req.pids)) {
        $handle = (Get-Process -Id ([int]$id) -ErrorAction Stop).Handle
        $status = [TmNative.Nt]::NtSuspendProcess($handle)
        if ($status -ne 0) { throw "Windows refused to suspend PID $id (status $status)." }
      }
      Write-Result @{ ok = $true }
    }
    'resume' {
      foreach ($id in @($req.pids)) {
        $handle = (Get-Process -Id ([int]$id) -ErrorAction Stop).Handle
        $status = [TmNative.Nt]::NtResumeProcess($handle)
        if ($status -ne 0) { throw "Windows refused to resume PID $id (status $status)." }
      }
      Write-Result @{ ok = $true }
    }
    'kill' {
      $failed = @()
      foreach ($id in @($req.pids)) {
        try { Stop-Process -Id ([int]$id) -Force -ErrorAction Stop }
        catch { $failed += @{ pid = [int]$id; error = $_.Exception.Message } }
      }
      Write-Result @{ ok = ($failed.Count -eq 0); failed = @($failed) }
    }
    'priority' {
      $proc = Get-Process -Id ([int]$req.pid) -ErrorAction Stop
      $proc.PriorityClass = [System.Diagnostics.ProcessPriorityClass]$req.value
      Write-Result @{ ok = $true }
    }
    'spawn' {
      $args2 = @()
      if ($req.args) { $args2 = @($req.args) }
      $started = if ($args2.Count -gt 0) {
        Start-Process -FilePath $req.file -ArgumentList $args2 -PassThru -ErrorAction Stop
      } else {
        Start-Process -FilePath $req.file -PassThru -ErrorAction Stop
      }
      Write-Result @{ ok = $true; pid = $started.Id }
    }
    default { Write-Result @{ ok = $false; error = "Unknown action '$($req.action)'." } }
  }
} catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}

exit 0
