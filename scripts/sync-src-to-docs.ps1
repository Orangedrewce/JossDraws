#if I skip in chat; do NOT! manually sync, changes need to be tested. you are not doing me a favor

[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [switch]$Verify
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$srcRoot = Join-Path $repoRoot 'src'
$docsRoot = Join-Path $repoRoot 'docs'

if (!(Test-Path -Path $srcRoot -PathType Container)) {
    throw "Missing src folder: $srcRoot"
}
if (!(Test-Path -Path $docsRoot -PathType Container)) {
    throw "Missing docs folder: $docsRoot"
}

# Canonical list of files mirrored from src/ to docs/
# Keep this explicit to avoid accidentally copying secrets or dev-only assets.
$fileMappings = @(
    @{ Source = 'JossDraws/CNAME'; Dest = 'CNAME' },
    @{ Source = 'JossDraws/index.html'; Dest = 'index.html' },
    @{ Source = 'Dashboard/css/review.html'; Dest = 'review.html' },
    @{ Source = 'Dashboard/mgmt-7f8a2d9e.html'; Dest = 'mgmt-7f8a2d9e.html' },
    @{ Source = 'JossDraws/sitemap.xml'; Dest = 'sitemap.xml' },
    @{ Source = 'JossDraws/robots.txt'; Dest = 'robots.txt' },
    @{ Source = 'JossDraws/googledb898fc8cc038b74.html'; Dest = 'googledb898fc8cc038b74.html' },

    @{ Source = 'JossDraws/css/Styles.css'; Dest = 'css/Styles.css' },
    @{ Source = 'Dashboard/css/mgmt.css'; Dest = 'css/mgmt.css' },

    @{ Source = 'JossDraws/js/click-spark.js'; Dest = 'js/click-spark.js' },
    @{ Source = 'JossDraws/js/FormSubmission.js'; Dest = 'js/FormSubmission.js' },
    @{ Source = 'JossDraws/js/hero-slideshow.js'; Dest = 'js/hero-slideshow.js' },
    @{ Source = 'JossDraws/js/masonry-gallery.js'; Dest = 'js/masonry-gallery.js' },
    @{ Source = 'Dashboard/js/mgmt.js'; Dest = 'js/mgmt.js' },
    @{ Source = 'JossDraws/js/page-inline.js'; Dest = 'js/page-inline.js' },
    @{ Source = 'JossDraws/js/shop-renderer.js'; Dest = 'js/shop-renderer.js' },
    @{ Source = 'JossDraws/js/tabs-router.js'; Dest = 'js/tabs-router.js' },
    @{ Source = 'JossDraws/js/webgl.js'; Dest = 'js/webgl.js' }
)

$copied = New-Object System.Collections.Generic.List[string]

foreach ($mapping in $fileMappings) {
    $fromRel = $mapping.Source
    $toRel = $mapping.Dest

    $from = Join-Path $srcRoot $fromRel
    $to = Join-Path $docsRoot $toRel

    if (!(Test-Path -Path $from -PathType Leaf)) {
        Write-Warning "Source missing, skipping: src/$fromRel"
        continue
    }

    $destDir = Split-Path -Parent $to
    if (!(Test-Path -Path $destDir -PathType Container)) {
        if ($PSCmdlet.ShouldProcess($destDir, 'New-Item -ItemType Directory')) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
    }

    if ($PSCmdlet.ShouldProcess("docs/$toRel", "Copy-Item from src/$fromRel")) {
        Copy-Item -Path $from -Destination $to -Force
        $copied.Add($toRel) | Out-Null
    }
}

Write-Host "Synced $($copied.Count) file(s) from src -> docs." -ForegroundColor Green

if ($Verify) {
    $mismatches = New-Object System.Collections.Generic.List[string]

    foreach ($toRel in $copied) {
        $mapping = $fileMappings | Where-Object { $_.Dest -eq $toRel } | Select-Object -First 1
        if (-not $mapping) {
            $mismatches.Add($toRel) | Out-Null
            continue
        }

        $from = Join-Path $srcRoot $mapping.Source
        $to = Join-Path $docsRoot $mapping.Dest

        if (!(Test-Path -Path $to -PathType Leaf)) {
            $mismatches.Add($toRel) | Out-Null
            continue
        }

        $a = (Get-FileHash -Algorithm SHA256 -Path $from).Hash
        $b = (Get-FileHash -Algorithm SHA256 -Path $to).Hash
        if ($a -ne $b) {
            $mismatches.Add($toRel) | Out-Null
        }
    }

    if ($mismatches.Count -gt 0) {
        Write-Host "Verification failed. Mismatched file(s):" -ForegroundColor Red
        $mismatches | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
        exit 2
    }

    Write-Host "Verification passed (SHA256 match)." -ForegroundColor Green
}
