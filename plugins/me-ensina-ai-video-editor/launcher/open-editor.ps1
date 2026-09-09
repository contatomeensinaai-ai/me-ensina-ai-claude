param([switch]$NoOpen, [switch]$ValidateRelease)
$ErrorActionPreference = 'Stop'

function Read-MeaiRelease([string]$ManifestPath) {
    $manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    $release = $manifest.platforms.'win32-x64'
    if ($manifest.version -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$' -or
        $release.sha256 -cnotmatch '^[a-f0-9]{64}$' -or
        $release.packageDirectory -cnotmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$' -or
        $release.url -cnotmatch '^https://github\.com/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+/releases/download/[A-Za-z0-9._-]+/[A-Za-z0-9._-]+\.zip$') {
        throw 'releases.json invalido ou SHA ainda nao preenchido.'
    }
    return @{ version = $manifest.version; url = $release.url; sha256 = $release.sha256; packageDirectory = $release.packageDirectory }
}

function Get-MeaiHttpsFile([string]$Url, [string]$Destination) {
    Add-Type -AssemblyName System.Net.Http
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $client = [Net.Http.HttpClient]::new($handler)
    $client.Timeout = [TimeSpan]::FromMinutes(20)
    $client.DefaultRequestHeaders.UserAgent.ParseAdd('Me-Ensina-AI-Launcher/0.2.0')
    try {
        $uri = [Uri]$Url
        for ($hop = 0; $hop -lt 8; $hop++) {
            if ($uri.Scheme -ne 'https') { throw 'Redirecionamento sem HTTPS recusado.' }
            $response = $client.GetAsync($uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
            try {
                if ([int]$response.StatusCode -ge 300 -and [int]$response.StatusCode -lt 400) {
                    if (-not $response.Headers.Location) { throw 'Redirecionamento invalido.' }
                    $uri = [Uri]::new($uri, $response.Headers.Location)
                    continue
                }
                $response.EnsureSuccessStatusCode() | Out-Null
                $stream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew)
                try { $response.Content.CopyToAsync($stream).GetAwaiter().GetResult() } finally { $stream.Dispose() }
                return
            } finally { $response.Dispose() }
        }
        throw 'Muitos redirecionamentos no download.'
    } finally { $client.Dispose(); $handler.Dispose() }
}

function Expand-MeaiVerifiedZip([string]$Archive, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        [long]$size = 0
        if ($zip.Entries.Count -gt 50000) { throw 'ZIP com entradas demais.' }
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName
            if (-not $name -or $name.StartsWith('/') -or $name.Contains('\') -or $name -match '[\x00-\x1f<>:"|?*]') { throw 'Caminho inseguro no ZIP.' }
            foreach ($part in $name.TrimEnd('/').Split('/')) {
                if (-not $part -or $part -eq '.' -or $part -eq '..' -or $part -match '[. ]$' -or $part -match '^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') { throw 'Nome inseguro no ZIP.' }
            }
            if (-not $seen.Add($name.TrimEnd('/'))) { throw 'Entradas duplicadas no ZIP.' }
            if (($entry.ExternalAttributes -band 0xF0000000) -eq 0xA0000000 -or ($entry.ExternalAttributes -band 0x400) -ne 0) { throw 'Link inesperado no ZIP.' }
            $size += $entry.Length
            if ($size -gt 2147483648) { throw 'ZIP excede o limite de extracao.' }
        }
        [IO.Directory]::CreateDirectory($Destination) | Out-Null
        foreach ($entry in $zip.Entries) {
            $target = Join-Path $Destination $entry.FullName
            if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            $inputStream = $entry.Open()
            try {
                $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew)
                try { $inputStream.CopyTo($output) } finally { $output.Dispose() }
            } finally { $inputStream.Dispose() }
        }
    } finally { $zip.Dispose() }
}

function Test-MeaiPackage([string]$Package) {
    return (Test-Path -LiteralPath (Join-Path $Package 'bin/node.exe') -PathType Leaf) -and
           (Test-Path -LiteralPath (Join-Path $Package 'runtime/server.mjs') -PathType Leaf) -and
           ((Test-Path -LiteralPath (Join-Path $Package 'editor/dist/index.html') -PathType Leaf) -or
            (Test-Path -LiteralPath (Join-Path $Package 'setup-editor.mjs') -PathType Leaf))
}

function Start-MeaiEditor {
    if ($ValidateRelease) { Read-MeaiRelease (Join-Path $PSScriptRoot 'releases.json') | Out-Null; Write-Output 'releases.json valido'; return }
    if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem -or ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64' -and $env:PROCESSOR_ARCHITEW6432 -ne 'AMD64')) { throw 'Este pacote requer Windows x64.' }
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5201/api/health' -TimeoutSec 2
        if ($health.app -eq 'me-ensina-ai-editor') { Write-Output 'Editor ja disponivel: http://127.0.0.1:5201/'; return }
    } catch { }
    $base = if ($env:MEAI_DATA_DIR) { $env:MEAI_DATA_DIR } else { Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Me Ensina AI' }
    if ($base -notmatch '^[A-Za-z]:[\\/]') { throw 'MEAI_DATA_DIR precisa ser um caminho absoluto local.' }
    $base = [IO.Path]::GetFullPath($base)
    $package = if ($env:MEAI_PACKAGE_DIR) { $env:MEAI_PACKAGE_DIR } else { Join-Path $base 'current' }
    if ($package -notmatch '^[A-Za-z]:[\\/]') { throw 'MEAI_PACKAGE_DIR precisa ser absoluto local.' }
    if (-not (Test-MeaiPackage $package)) {
        $release = Read-MeaiRelease (Join-Path $PSScriptRoot 'releases.json')
        $releases = Join-Path $base 'releases'
        [IO.Directory]::CreateDirectory($releases) | Out-Null
        $target = Join-Path $releases ($release.version + '-win32-x64-' + $release.sha256.Substring(0,16))
        $package = Join-Path $target $release.packageDirectory
        $marker = Join-Path $target 'verified-sha256'
        if (-not (Test-MeaiPackage $package) -or -not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw).Trim() -cne $release.sha256) {
            if (Test-Path -LiteralPath $target) { throw 'Instalacao incompleta existente preservada. Revise a pasta de releases.' }
            $lockPath = $target + '.lock'
            $lock = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            $stage = Join-Path $releases ('.download-' + [Guid]::NewGuid().ToString())
            try {
                [IO.Directory]::CreateDirectory($stage) | Out-Null
                $zip = Join-Path $stage 'release.zip'
                Write-Output 'Baixando release verificada. Nao sera instalado outro Codex.'
                Get-MeaiHttpsFile $release.url $zip
                if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -cne $release.sha256) { throw 'SHA-256 divergente. Pacote nao executado.' }
                $content = Join-Path $stage 'content'
                Expand-MeaiVerifiedZip $zip $content
                if (-not (Test-MeaiPackage (Join-Path $content $release.packageDirectory))) { throw 'Release sem runtime completo.' }
                [IO.File]::WriteAllText((Join-Path $content 'verified-sha256'), $release.sha256)
                [IO.Directory]::Move($content, $target)
            } finally {
                $lock.Dispose()
                Remove-Item -LiteralPath $lockPath -Force
                if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
            }
        }
    }
    $node = Join-Path $package 'bin/node.exe'
    $arguments = @((Join-Path $PSScriptRoot 'start-editor.mjs'), '--package-dir', $package)
    if ($NoOpen) { $arguments += '--no-open' }
    & $node @arguments
    if ($LASTEXITCODE -ne 0) { throw 'O editor nao iniciou. Consulte a mensagem acima.' }
}
if ($MyInvocation.InvocationName -ne '.') {
    try { Start-MeaiEditor } catch { Write-Error $_; exit 1 }
}
