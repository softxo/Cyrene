$ErrorActionPreference = "Stop"

$projectDirectory = $PSScriptRoot
$vendorDirectory = Join-Path $projectDirectory "vendor"
$distributionDirectory = Join-Path $projectDirectory "dist"
$scannerPath = Join-Path $vendorDirectory "YaeAchievement.exe"
$packageDirectory = Join-Path $distributionDirectory "package"
$packagePath = Join-Path $distributionDirectory "CyreneAchievementScanner-win-x64.zip"

New-Item -ItemType Directory -Force -Path $vendorDirectory | Out-Null
New-Item -ItemType Directory -Force -Path $distributionDirectory | Out-Null

foreach ($obsoleteFile in @("AchievementScanner.exe", "AchievementScanner.pdb")) {
    $obsoletePath = Join-Path $distributionDirectory $obsoleteFile
    if (Test-Path -LiteralPath $obsoletePath) {
        Remove-Item -LiteralPath $obsoletePath -Force
    }
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

Add-Type -AssemblyName System.Drawing
$applicationIcon = [System.Drawing.Icon]::ExtractAssociatedIcon($scannerPath)
if ($null -eq $applicationIcon) {
    throw "Unable to extract the official Yae application icon."
}
$iconStream = [System.IO.File]::Create((Join-Path $vendorDirectory "app.ico"))
try {
    $applicationIcon.Save($iconStream)
}
finally {
    $iconStream.Dispose()
    $applicationIcon.Dispose()
}

$sourceArchiveUrl = "https://github.com/HolographicHat/Yae/archive/refs/tags/$($release.tag_name).zip"
$sourceArchivePath = Join-Path $distributionDirectory "Yae-$($release.tag_name)-source.zip"
Invoke-WebRequest -Uri $sourceArchiveUrl -OutFile $sourceArchivePath -Headers $headers
Set-Content -Path (Join-Path $vendorDirectory "SOURCE.txt") -Value @"
YaeAchievement version: $($release.tag_name)
Source: $sourceArchiveUrl
Licence: GPL-3.0-only
"@

dotnet publish `
    (Join-Path $projectDirectory "CyreneAchievementScanner.csproj") `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -o $distributionDirectory

if ($LASTEXITCODE -ne 0) {
    throw "AchievementScanner publish failed with exit code $LASTEXITCODE."
}

if (Test-Path -LiteralPath $packageDirectory) {
    Remove-Item -LiteralPath $packageDirectory -Recurse -Force
}
if (Test-Path -LiteralPath $packagePath) {
    Remove-Item -LiteralPath $packagePath -Force
}

New-Item -ItemType Directory -Path $packageDirectory | Out-Null
Copy-Item -LiteralPath (Join-Path $distributionDirectory "CyreneAchievementScanner.exe") -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $projectDirectory "THIRD_PARTY_NOTICES.md") -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $vendorDirectory "GPL-3.0.txt") -Destination $packageDirectory
Copy-Item -LiteralPath (Join-Path $vendorDirectory "SOURCE.txt") -Destination $packageDirectory
Compress-Archive -Path (Join-Path $packageDirectory "*") -DestinationPath $packagePath
Remove-Item -LiteralPath $packageDirectory -Recurse -Force

Write-Host "Built $distributionDirectory\CyreneAchievementScanner.exe"
Write-Host "Packaged $packagePath"
Write-Host "Downloaded corresponding source to $sourceArchivePath"
