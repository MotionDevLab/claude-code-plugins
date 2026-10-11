<#
.SYNOPSIS
  Patches the local OpenClaude cdt plugin cache with a Chromium executablePath
  (for Windows machines without real Chrome, e.g. Edge-only).

.DESCRIPTION
  OpenClaude copies the marketplace repo verbatim into the local plugin cache:
    $HOME\.openclaude\plugins\cache\motiondevlab-plugins\cdt\<version>\.claude-plugin\plugin.json
  The repo ships stock Chrome-default config (no --executablePath) for
  portability. On a machine with no real chrome.exe, chrome-devtools-mcp fails
  with "Could not find Chrome". A chrome.exe shim that re-launches Edge cannot
  work (CDP pipe fds 3/4 break across a native intermediate - proven shim v1-v9,
  Edge exit 13). The supported fix is patching the LOCAL CACHE COPY with
  --executablePath pointing at Edge (or Brave).

  This script applies that patch idempotently across all cached cdt versions.
  It never touches the repo checkout. Safe to re-run after every plugin
  update/reinstall (which rewrites the cache copy).

.EXAMPLE
  .\patch-cdt-edge.ps1
  # auto-detect Edge, patch all cached cdt versions

.EXAMPLE
  .\patch-cdt-edge.ps1 -ExecutablePath "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
  # patch with Brave instead of Edge

.EXAMPLE
  .\patch-cdt-edge.ps1 -ListOnly
  # show status without writing

.EXAMPLE
  .\patch-cdt-edge.ps1 -WhatIf
  # preview changes without writing
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string]$ExecutablePath = "",
  [string]$Marketplace = "motiondevlab-plugins",
  [string]$Plugin = "cdt",
  [switch]$ListOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-Home {
  if ($HOME -and (Test-Path $HOME)) { return $HOME }
  return $env:USERPROFILE
}

function Find-Edge {
  $candidates = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:LocalAppData "Microsoft\Edge\Application\msedge.exe")
  )
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c -PathType Leaf)) { return $c }
  }
  return $null
}

$userHome = Resolve-Home
if (-not $ExecutablePath) {
  $ExecutablePath = Find-Edge
  if (-not $ExecutablePath) {
    Write-Error ("No Edge found. Install per-user Chrome (preferred), or pass " +
      "-ExecutablePath pointing at Edge/Brave/Chromium, e.g.`n" +
      '  .\patch-cdt-edge.ps1 -ExecutablePath "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"')
    exit 1
  }
}
if (-not (Test-Path $ExecutablePath -PathType Leaf)) {
  Write-Error "Executable not found: $ExecutablePath"
  exit 1
}

# MCP passes this to npx/puppeteer; forward slashes survive JSON + arg parsing.
$exeForward = $ExecutablePath.Replace('\', '/')
$exeArg = "--executablePath=$exeForward"

$cacheBase = Join-Path $userHome ".openclaude\plugins\cache\$Marketplace\$Plugin"
if (-not (Test-Path $cacheBase -PathType Container)) {
  Write-Error ("Cache dir not found: $cacheBase`n" +
    "Run first: openclaude plugin install $Plugin@$Marketplace")
  exit 1
}

$versionDirs = @(Get-ChildItem -Path $cacheBase -Directory | Sort-Object Name)
if (-not $versionDirs -or $versionDirs.Count -eq 0) {
  Write-Error "No version dirs under $cacheBase"
  exit 1
}

$exitCode = 0
foreach ($dir in $versionDirs) {
  $pluginJson = Join-Path $dir.FullName ".claude-plugin\plugin.json"
  if (-not (Test-Path $pluginJson -PathType Leaf)) {
    Write-Warning "skip $($dir.Name): no .claude-plugin\plugin.json"
    continue
  }

  $json = Get-Content -Raw -Encoding UTF8 $pluginJson | ConvertFrom-Json
  $server = $json.mcpServers.cdt
  if (-not $server) {
    Write-Warning "skip $($dir.Name): mcpServers.cdt missing"
    $exitCode = 1
    continue
  }

  # NB: $args is PowerShell's automatic argv variable - never use it for our own data.
  $curArgs = @($server.args)
  if ($curArgs.Count -eq 0 -or ($curArgs[0] -notlike "chrome-devtools-mcp@*")) {
    Write-Warning "skip $($dir.Name): unexpected args[0] '$($curArgs[0])'"
    $exitCode = 1
    continue
  }

  $alreadyOk = ($curArgs.Count -ge 2) -and ($curArgs[1] -eq $exeArg)
  $status = if ($alreadyOk) { "OK" } else { "NEEDS-PATCH (current: $($curArgs -join ' '))" }
  Write-Host "$($dir.Name): $status"

  if ($alreadyOk -or $ListOnly) { continue }

  # Preserve any extra args beyond index 1 except stale executable selectors:
  # --executablePath=<p>, --executablePath <p>, -e <p>, or a legacy bare path.
  $filtered = @($curArgs[0], $exeArg)
  $i = 1
  while ($i -lt $curArgs.Count) {
    $a = $curArgs[$i]
    if ($a -like "--executablePath=*") { $i += 1; continue }
    if ($a -eq "--executablePath" -or $a -eq "-e") { $i += 2; continue }
    if ($i -eq 1 -and $a -notlike "-*") { $i += 1; continue }  # stale bare path
    $filtered += $a
    $i += 1
  }

  if ($PSCmdlet.ShouldProcess($pluginJson, "set args = $($filtered -join ' ')")) {
    $backup = "$pluginJson.bak"
    Copy-Item $pluginJson $backup -Force
    $json.mcpServers.cdt.args = $filtered
    $out = $json | ConvertTo-Json -Depth 10
    # UTF8 without BOM to match stock formatting.
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($pluginJson, $out + "`r`n", $utf8)
    Write-Host "  patched $($dir.Name), backup: $backup"
    Write-Host "  next: reload plugins, then verify with list_pages -> navigate_page -> take_snapshot"
  }
}

exit $exitCode
