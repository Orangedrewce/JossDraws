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

# Canonical list of files that are mirrored from src/ to docs/
# Keep this explicit to avoid accidentally copying secrets or dev-only assets.
$relativePaths = @(
    'CNAME',
    'index.html',
    'review.html',
    'mgmt-7f8a2d9e.html',
    'sitemap.xml',
    'robots.txt',

    'css/Styles.css',
    'css/mgmt.css',

    'js/click-spark.js',
    'js/FormSubmission.js',
    'js/hero-slideshow.js',
    'js/masonry-gallery.js',
    'js/page-inline.js',
    'js/tabs-router.js',
    'js/webgl.js'
)

$copied = New-Object System.Collections.Generic.List[string]

foreach ($rel in $relativePaths) {
    $from = Join-Path $srcRoot $rel
    $to = Join-Path $docsRoot $rel

    if (!(Test-Path -Path $from -PathType Leaf)) {
        Write-Warning "Source missing, skipping: src/$rel"
        continue
    }

    $destDir = Split-Path -Parent $to
    if (!(Test-Path -Path $destDir -PathType Container)) {
        if ($PSCmdlet.ShouldProcess($destDir, 'New-Item -ItemType Directory')) {
            New-Item -ItemType Directory -Path $destDir -Force | Out-Null
        }
    }

    if ($PSCmdlet.ShouldProcess("docs/$rel", "Copy-Item from src/$rel")) {
        Copy-Item -Path $from -Destination $to -Force
        $copied.Add($rel) | Out-Null
    }
}

Write-Host "Synced $($copied.Count) file(s) from src -> docs." -ForegroundColor Green

if ($Verify) {
    $mismatches = New-Object System.Collections.Generic.List[string]

    foreach ($rel in $copied) {
        $from = Join-Path $srcRoot $rel
        $to = Join-Path $docsRoot $rel

        if (!(Test-Path -Path $to -PathType Leaf)) {
            $mismatches.Add($rel) | Out-Null
            continue
        }

        $a = (Get-FileHash -Algorithm SHA256 -Path $from).Hash
        $b = (Get-FileHash -Algorithm SHA256 -Path $to).Hash
        if ($a -ne $b) {
            $mismatches.Add($rel) | Out-Null
        }
    }

    if ($mismatches.Count -gt 0) {
        Write-Host "Verification failed. Mismatched file(s):" -ForegroundColor Red
        $mismatches | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
        exit 2
    }

    Write-Host "Verification passed (SHA256 match)." -ForegroundColor Green
}
