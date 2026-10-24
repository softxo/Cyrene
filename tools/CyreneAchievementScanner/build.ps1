$ErrorActionPreference = "Stop"

$projectDirectory = $PSScriptRoot
$projectPath = Join-Path $projectDirectory "CyreneAchievementScanner.csproj"
$projectXml = [xml](Get-Content -Raw -LiteralPath $projectPath)
$scannerVersion = @($projectXml.Project.PropertyGroup.Version)[0]
if ([string]::IsNullOrWhiteSpace($scannerVersion)) {
    throw "The scanner project does not define a Version."
}
$vendorDirectory = Join-Path $projectDirectory "vendor"
$distributionDirectory = Join-Path $projectDirectory "release"
$publishDirectory = Join-Path $projectDirectory "obj\release-publish"
$scannerPath = Join-Path $vendorDirectory "YaeAchievement.exe"
$packageDirectory = Join-Path $distributionDirectory "CyreneScanner-v$scannerVersion-x64"
$packagePath = Join-Path $distributionDirectory "CyreneScanner-v$scannerVersion-x64.zip"

New-Item -ItemType Directory -Force -Path $vendorDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $distributionDirectory | Out-Null

foreach ($obsoleteItem in @(
    "CyreneAchievementScanner-x64",
    "CyreneAchievementScanner-x64.zip",
    "CyreneScanner-x64",
    "CyreneScanner-x64.zip",
    "CyreneScanner-v1.1.0-x64",
    "CyreneScanner-v1.1.0-x64.zip",
    "CyreneScanner-v$scannerVersion-x64",
    "CyreneScanner-v$scannerVersion-x64.zip"
)) {
    $obsoletePath = Join-Path $distributionDirectory $obsoleteItem
    if (Test-Path -LiteralPath $obsoletePath) {
        Remove-Item -LiteralPath $obsoletePath -Recurse -Force
    }
}

if (Test-Path -LiteralPath $publishDirectory) {
    Remove-Item -LiteralPath $publishDirectory -Recurse -Force
}

$headers = @{ "User-Agent" = "Cyrene-AchievementScanner-Build" }
$release = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/HolographicHat/Yae/releases/latest" `
    -Headers $headers

$asset = $release.assets | Where-Object { $_.name -eq "YaeAchievement.exe" } | Select-Object -First 1
if ($null -eq $asset) {
    throw "The latest Yae release does not contain YaeAchievement.exe."
}

Write-Host "Downloading YaeAchievement $($release.tag_name)..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $scannerPath -Headers $headers
Invoke-WebRequest `
    -Uri "https://raw.githubusercontent.com/HolographicHat/Yae/$($release.tag_name)/LICENSE" `
    -OutFile (Join-Path $vendorDirectory "GPL-3.0.txt") `
    -Headers $headers

$sourceArchiveUrl = "https://github.com/HolographicHat/Yae/archive/refs/tags/$($release.tag_name).zip"
$sourceArchivePath = Join-Path $distributionDirectory "Yae-$($release.tag_name)-source.zip"
Invoke-WebRequest -Uri $sourceArchiveUrl -OutFile $sourceArchivePath -Headers $headers
Set-Content -Path (Join-Path $vendorDirectory "SOURCE.txt") -Value @"
YaeAchievement version: $($release.tag_name)
Source: $sourceArchiveUrl
Licence: GPL-3.0-only
"@

dotnet publish `
    $projectPath `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -o $publishDirectory

if ($LASTEXITCODE -ne 0) {
    throw "AchievementScanner publish failed with exit code $LASTEXITCODE."
}

New-Item -ItemType Directory -Path $packageDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $publishDirectory "CyreneScanner.exe") -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory "THIRD_PARTY_NOTICES.md") -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $vendorDirectory "GPL-3.0.txt") -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $vendorDirectory "SOURCE.txt") -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory "README.md") -Destination (Join-Path $packageDirectory "README.txt")

$executablePath = Join-Path $packageDirectory "CyreneScanner.exe"
$checksum = (Get-FileHash -LiteralPath $executablePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -Path (Join-Path $packageDirectory "sha-256.txt") -Value "$checksum  CyreneScanner.exe"

Compress-Archive -Path (Join-Path $packageDirectory "*") -DestinationPath $packagePath

Write-Host "Built $executablePath"
Write-Host "Packaged $packagePath"
Write-Host "Downloaded corresponding source to $sourceArchivePath"
