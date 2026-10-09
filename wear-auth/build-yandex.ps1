$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$taskRoot = $PSScriptRoot
$taskOutput = Join-Path $taskRoot 'function.zip'
$taskZip = [IO.Compression.ZipArchive]::new([IO.File]::Open($taskOutput, [IO.FileMode]::Create), [IO.Compression.ZipArchiveMode]::Create)
try {
    $taskFiles = @('pairing.mjs', 'handler.mjs', 'ydb-store.mjs', 'yandex-adapter.mjs', 'yandex-runtime.mjs', 'package-lock.json', 'yandex-entry.cjs')
    foreach ($taskName in $taskFiles) {
        $taskEntryName = if ($taskName -eq 'yandex-entry.cjs') { 'index.js' } else { $taskName }
        $taskEntry = $taskZip.CreateEntry($taskEntryName)
        $taskDestination = $taskEntry.Open()
        $taskSource = [IO.File]::OpenRead((Join-Path $taskRoot $taskName))
        try { $taskSource.CopyTo($taskDestination) } finally { $taskSource.Dispose(); $taskDestination.Dispose() }
    }
    $taskPackage = Get-Content (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json
    $taskPackage.type = 'commonjs'
    $taskWriter = [IO.StreamWriter]::new($taskZip.CreateEntry('package.json').Open(), [Text.UTF8Encoding]::new($false))
    try { $taskWriter.Write(($taskPackage | ConvertTo-Json -Depth 10)) } finally { $taskWriter.Dispose() }
} finally { $taskZip.Dispose() }
Write-Output $taskOutput
