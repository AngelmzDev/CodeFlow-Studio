param([string]$OutputDirectory = 'dist')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repoRoot
if ($env:OS -ne 'Windows_NT') { throw 'Windows is required to build this executable.' }
$manifest = Get-Content -LiteralPath 'desktop/runtimes.json' -Raw | ConvertFrom-Json
$cacheRoot = Join-Path $repoRoot '.cache/windows'
$buildRoot = Join-Path $cacheRoot ([guid]::NewGuid().ToString('N'))
$payloadRoot = Join-Path $buildRoot 'payload'
New-Item -ItemType Directory -Force $cacheRoot,$payloadRoot,$OutputDirectory | Out-Null
function Get-VerifiedArchive($runtime, $label) {
  if ($runtime.sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "Missing SHA256 for $label" }
  $target = Join-Path $cacheRoot ($label + '-' + $runtime.sha256.Substring(0,12) + '.zip')
  if (!(Test-Path -LiteralPath $target)) {
    Write-Host "Downloading $label $($runtime.version)..."
    Invoke-WebRequest -Uri $runtime.url -OutFile $target -UseBasicParsing
  }
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $runtime.sha256) { throw "SHA256 mismatch: $label. Delete $target and retry." }
  return $target
}
$nodeArchive = Get-VerifiedArchive $manifest.node 'node'
$pythonArchive = Get-VerifiedArchive $manifest.python 'python'
$jdkArchive = Get-VerifiedArchive $manifest.jdk 'jdk'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$runtimeRoot = Join-Path $payloadRoot 'runtime'
New-Item -ItemType Directory -Force $runtimeRoot | Out-Null
[System.IO.Compression.ZipFile]::ExtractToDirectory($nodeArchive,(Join-Path $buildRoot 'node'))
$nodeDir = Get-ChildItem (Join-Path $buildRoot 'node') -Directory | Select-Object -First 1
Copy-Item -LiteralPath (Join-Path $nodeDir.FullName 'node.exe') -Destination $runtimeRoot
New-Item -ItemType Directory -Force (Join-Path $runtimeRoot 'node') | Out-Null
Copy-Item -LiteralPath (Join-Path $nodeDir.FullName 'LICENSE') -Destination (Join-Path $runtimeRoot 'node/LICENSE')
[System.IO.Compression.ZipFile]::ExtractToDirectory($pythonArchive,(Join-Path $runtimeRoot 'python'))
[System.IO.Compression.ZipFile]::ExtractToDirectory($jdkArchive,(Join-Path $buildRoot 'jdk'))
$jdkDir = Get-ChildItem (Join-Path $buildRoot 'jdk') -Directory | Select-Object -First 1
Copy-Item -LiteralPath $jdkDir.FullName -Destination (Join-Path $runtimeRoot 'jdk') -Recurse
& node scripts/build.mjs
if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed' }
& node desktop/bundle.mjs (Join-Path $payloadRoot 'backend')
if ($LASTEXITCODE -ne 0) { throw 'Backend bundle failed' }
foreach ($folder in @('.build','adapters','examples')) { Copy-Item -LiteralPath (Join-Path $repoRoot $folder) -Destination (Join-Path $payloadRoot $folder) -Recurse }
New-Item -ItemType Directory -Force (Join-Path $payloadRoot 'web') | Out-Null
foreach ($file in @('index.html','styles.css')) { Copy-Item -LiteralPath (Join-Path $repoRoot ('web/'+$file)) -Destination (Join-Path $payloadRoot ('web/'+$file)) }
foreach ($file in @('LICENSE','THIRD_PARTY_NOTICES.md','SECURITY.md','desktop/runtimes.json')) { Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination $payloadRoot }
Copy-Item -LiteralPath 'docs/windows-portable.md' -Destination $payloadRoot
$payloadZip = Join-Path $buildRoot 'payload.zip'
Write-Host 'Compressing bundled runtimes...'
[System.IO.Compression.ZipFile]::CreateFromDirectory($payloadRoot,$payloadZip,[System.IO.Compression.CompressionLevel]::Optimal,$false)
$payloadId = (Get-FileHash -LiteralPath $payloadZip -Algorithm SHA256).Hash.ToLower()
$launcherSource = Join-Path $buildRoot 'Launcher.cs'
(Get-Content -LiteralPath 'desktop/Launcher.cs' -Raw).Replace('__PAYLOAD_ID__',$payloadId.Substring(0,16)) | Set-Content -LiteralPath $launcherSource -Encoding utf8
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$exe = Join-Path ([System.IO.Path]::GetFullPath($OutputDirectory)) 'CodeFlow-Studio-Windows-x64.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll "/resource:$payloadZip,payload.zip" "/out:$exe" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed' }
$exeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLower()
($exeHash + '  ' + [System.IO.Path]::GetFileName($exe)) | Set-Content -LiteralPath ($exe+'.sha256') -Encoding ascii
Write-Host "Built $exe"

# Publish the exact Temurin source archive beside the binary distribution.
$sourceArchive = Get-VerifiedArchive $manifest.jdkSources 'jdk-sources'
$sourceOutput = Join-Path ([System.IO.Path]::GetFullPath($OutputDirectory)) 'Temurin-JDK21-sources.tar.gz'
Copy-Item -LiteralPath $sourceArchive -Destination $sourceOutput
($manifest.jdkSources.sha256 + '  Temurin-JDK21-sources.tar.gz') | Set-Content -LiteralPath ($sourceOutput+'.sha256') -Encoding ascii