# CrawClaw Installer for Windows (PowerShell)
# Usage: iwr -useb https://crawclaw.ai/install.ps1 | iex
# Or: & ([scriptblock]::Create((iwr -useb https://crawclaw.ai/install.ps1))) -NoOnboard

param(
    [string]$InstallMethod = "npm",
    [string]$Tag = "latest",
    [string]$GitDir = "$env:USERPROFILE\crawclaw",
    [switch]$NoOnboard,
    [switch]$NoGitUpdate,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$INSTALLER_BOUND_PARAMETERS = @{}
foreach ($key in $PSBoundParameters.Keys) {
    $INSTALLER_BOUND_PARAMETERS[$key] = $PSBoundParameters[$key]
}

# Colors
$ACCENT = "`e[38;2;255;77;77m"    # coral-bright
$SUCCESS = "`e[38;2;0;229;204m"    # cyan-bright
$WARN = "`e[38;2;255;176;32m"     # amber
$ERROR = "`e[38;2;230;57;70m"     # coral-mid
$MUTED = "`e[38;2;90;100;128m"    # text-muted
$NC = "`e[0m"                     # No Color
$PreferredNodeMajor = 24
$MinimumNodeMajor = 22
$MinimumNodeMinorForMajor = 14

function Write-Host {
    param([string]$Message, [string]$Level = "info")
    $msg = switch ($Level) {
        "success" { "$SUCCESS✓$NC $Message" }
        "warn" { "$WARN!$NC $Message" }
        "error" { "$ERROR✗$NC $Message" }
        default { "$MUTED·$NC $Message" }
    }
    Microsoft.PowerShell.Host\Write-Host $msg
}

function Write-Banner {
    Write-Host ""
    Write-Host "${ACCENT}  🦀 CrawClaw Installer$NC" -Level info
    Write-Host "${MUTED}  All your chats, one CrawClaw.$NC" -Level info
    Write-Host ""
}

function Invoke-InstallerNativeCommand {
    param(
        [string]$Command,
        [string[]]$Arguments = @(),
        [string]$Action = "command"
    )

    $global:LASTEXITCODE = 0
    try {
        $output = & $Command @Arguments 2>&1
    } catch {
        Write-Host "$Action failed" -Level error
        Write-Host "First actionable error:" -Level error
        Write-Host $_.Exception.Message -Level error
        return $false
    }
    $exitCode = $LASTEXITCODE
    if ($null -eq $exitCode) {
        $exitCode = 0
    }

    if ($output) {
        $output | ForEach-Object { Microsoft.PowerShell.Host\Write-Host $_ }
    }

    if ($exitCode -eq 0) {
        return $true
    }

    $message = (@($output) | Select-Object -First 12) -join [Environment]::NewLine
    if ([string]::IsNullOrWhiteSpace($message)) {
        $message = "$Command exited with code $exitCode."
    }

    Write-Host "$Action failed (exit $exitCode)" -Level error
    Write-Host "First actionable error:" -Level error
    Write-Host $message -Level error
    return $false
}

function Test-TruthyEnv {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    $normalized = $Value.Trim().ToLowerInvariant()
    return @("1", "true", "yes", "on").Contains($normalized)
}

function Test-FalseyEnv {
    param([string]$Value)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    $normalized = $Value.Trim().ToLowerInvariant()
    return @("0", "false", "no", "off").Contains($normalized)
}

function Apply-EnvironmentDefaults {
    if (!$script:INSTALLER_BOUND_PARAMETERS.ContainsKey("InstallMethod") -and ![string]::IsNullOrWhiteSpace($env:CRAWCLAW_INSTALL_METHOD)) {
        $script:InstallMethod = $env:CRAWCLAW_INSTALL_METHOD
    }
    if (!$script:INSTALLER_BOUND_PARAMETERS.ContainsKey("Tag")) {
        if (![string]::IsNullOrWhiteSpace($env:CRAWCLAW_VERSION)) {
            $script:Tag = $env:CRAWCLAW_VERSION
        } elseif (Test-TruthyEnv -Value $env:CRAWCLAW_BETA) {
            $script:Tag = "beta"
        }
    }
    if (!$script:INSTALLER_BOUND_PARAMETERS.ContainsKey("GitDir") -and ![string]::IsNullOrWhiteSpace($env:CRAWCLAW_GIT_DIR)) {
        $script:GitDir = $env:CRAWCLAW_GIT_DIR
    }
    if (!$script:INSTALLER_BOUND_PARAMETERS.ContainsKey("NoOnboard") -and (Test-TruthyEnv -Value $env:CRAWCLAW_NO_ONBOARD)) {
        $script:NoOnboard = $true
    }
    if (!$script:INSTALLER_BOUND_PARAMETERS.ContainsKey("NoGitUpdate") -and (Test-FalseyEnv -Value $env:CRAWCLAW_GIT_UPDATE)) {
        $script:NoGitUpdate = $true
    }
    if (!$script:INSTALLER_BOUND_PARAMETERS.ContainsKey("DryRun") -and (Test-TruthyEnv -Value $env:CRAWCLAW_DRY_RUN)) {
        $script:DryRun = $true
    }
}

function Resolve-InstallMethod {
    param([string]$Method)

    if ([string]::IsNullOrWhiteSpace($Method)) {
        return "npm"
    }

    $normalized = $Method.Trim().ToLowerInvariant()
    if ($normalized -eq "npm" -or $normalized -eq "git") {
        return $normalized
    }

    throw "Invalid -InstallMethod '$Method'. Expected 'npm' or 'git'."
}

function Get-ExecutionPolicyStatus {
    $policy = Get-ExecutionPolicy
    if ($policy -eq "Restricted" -or $policy -eq "AllSigned") {
        return @{ Blocked = $true; Policy = $policy }
    }
    return @{ Blocked = $false; Policy = $policy }
}

function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Ensure-ExecutionPolicy {
    $status = Get-ExecutionPolicyStatus
    if ($status.Blocked) {
        Write-Host "PowerShell execution policy is set to: $($status.Policy)" -Level warn
        Write-Host "This prevents scripts like npm.ps1 from running." -Level warn
        Write-Host ""
        
        # Try to set execution policy for current process
        try {
            Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -ErrorAction Stop
            Write-Host "Set execution policy to RemoteSigned for current process" -Level success
            return $true
        } catch {
            Write-Host "Could not automatically set execution policy" -Level error
            Write-Host ""
            Write-Host "To fix this, run:" -Level info
            Write-Host "  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process" -Level info
            Write-Host ""
            Write-Host "Or run PowerShell as Administrator and execute:" -Level info
            Write-Host "  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine" -Level info
            return $false
        }
    }
    return $true
}

function Get-NodeVersion {
    try {
        $version = node --version 2>$null
        if ($version) {
            return $version -replace '^v', ''
        }
    } catch { }
    return $null
}

function Get-NpmVersion {
    try {
        $version = npm --version 2>$null
        if ($version) {
            return $version
        }
    } catch { }
    return $null
}

function ConvertTo-NodeVersionParts {
    param([string]$Version)

    if ([string]::IsNullOrWhiteSpace($Version)) {
        return $null
    }
    $normalized = $Version.Trim() -replace '^v', ''
    if ($normalized -notmatch '^(\d+)\.(\d+)\.(\d+)') {
        return $null
    }
    return @{
        Major = [int]$Matches[1]
        Minor = [int]$Matches[2]
        Patch = [int]$Matches[3]
    }
}

function Test-NodeVersionSupported {
    param([string]$Version)

    $parts = ConvertTo-NodeVersionParts -Version $Version
    if ($null -eq $parts) {
        return $false
    }
    if ($parts.Major -gt $MinimumNodeMajor) {
        return $true
    }
    if ($parts.Major -eq $MinimumNodeMajor -and $parts.Minor -ge $MinimumNodeMinorForMajor) {
        return $true
    }
    return $false
}

function Install-Node {
    Write-Host "Node.js not found" -Level info
    Write-Host "Installing Node.js 24 (Node 22.14+ remains compatible)..." -Level info
    
    # Try winget first
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "  Using winget..." -Level info
        if (
            Invoke-InstallerNativeCommand `
                -Command "winget" `
                -Arguments @("install", "OpenJS.NodeJS.LTS", "--accept-package-agreements", "--accept-source-agreements") `
                -Action "Node.js install via winget"
        ) {
            # Refresh PATH
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Write-Host "  Node.js installed via winget" -Level success
            return $true
        }
        Write-Host "  Winget install failed; trying the next installer" -Level warn
    }
    
    # Try chocolatey
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "  Using chocolatey..." -Level info
        if (
            Invoke-InstallerNativeCommand `
                -Command "choco" `
                -Arguments @("install", "nodejs-lts", "-y") `
                -Action "Node.js install via Chocolatey"
        ) {
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Write-Host "  Node.js installed via chocolatey" -Level success
            return $true
        }
        Write-Host "  Chocolatey install failed; trying the next installer" -Level warn
    }
    
    # Try scoop
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        Write-Host "  Using scoop..." -Level info
        if (
            Invoke-InstallerNativeCommand `
                -Command "scoop" `
                -Arguments @("install", "nodejs-lts") `
                -Action "Node.js install via Scoop"
        ) {
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Write-Host "  Node.js installed via scoop" -Level success
            return $true
        }
        Write-Host "  Scoop install failed" -Level warn
    }
    
    Write-Host "Could not install Node.js automatically" -Level error
    Write-Host "Please install Node.js 24 from https://nodejs.org, or Node.js 22.14+ if you need the compatibility floor." -Level info
    return $false
}

function Ensure-Node {
    $nodeVersion = Get-NodeVersion
    if ($nodeVersion) {
        $parts = ConvertTo-NodeVersionParts -Version $nodeVersion
        if (Test-NodeVersionSupported -Version $nodeVersion) {
            Write-Host "Node.js v$nodeVersion found" -Level success
            if ($parts.Major -lt $PreferredNodeMajor) {
                Write-Host "Node.js 24 is recommended; continuing with supported Node.js v$nodeVersion." -Level warn
            }
            return $true
        }
        Write-Host "Node.js v$nodeVersion found, but need v22.14+ (Node 24 recommended)" -Level warn
    }
    return Install-Node
}

function Get-GitVersion {
    try {
        $version = git --version 2>$null
        if ($version) {
            return $version
        }
    } catch { }
    return $null
}

function Install-Git {
    Write-Host "Git not found" -Level info
    Write-Host "Git is required before installing CrawClaw packages on Windows." -Level error
    
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "  Installing Git via winget..." -Level info
        if (
            Invoke-InstallerNativeCommand `
                -Command "winget" `
                -Arguments @("install", "Git.Git", "--accept-package-agreements", "--accept-source-agreements") `
                -Action "Git install via winget"
        ) {
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
            Write-Host "  Git installed" -Level success
            return $true
        }
        Write-Host "  Winget Git install failed" -Level warn
    }
    
    Write-Host "Please install Git for Windows from: https://git-scm.com" -Level error
    Write-Host "Open a new PowerShell after installing Git so PATH updates apply." -Level info
    return $false
}

function Ensure-Git {
    $gitVersion = Get-GitVersion
    if ($gitVersion) {
        Write-Host "$gitVersion found" -Level success
        return $true
    }
    return Install-Git
}

function Install-CrawClawNpm {
    param([string]$Target = "latest")

    $installSpec = Resolve-PackageInstallSpec -Target $Target
    
    Write-Host "Installing CrawClaw ($installSpec)..." -Level info
    
    $npmArgs = @("install", "-g", $installSpec, "--no-fund", "--no-audit")
    if (![string]::IsNullOrWhiteSpace($env:CRAWCLAW_NPM_LOGLEVEL)) {
        $npmArgs += @("--loglevel", $env:CRAWCLAW_NPM_LOGLEVEL.Trim())
    }
    if (
        Invoke-InstallerNativeCommand `
            -Command "npm" `
            -Arguments $npmArgs `
            -Action "npm install"
    ) {
        Write-Host "CrawClaw installed" -Level success
        return $true
    }
    Write-Host "npm install failed" -Level error
    return $false
}

function Resolve-CrawClawGitEntryPath {
    param([string]$RepoDir)

    try {
        $resolvedRepoDir = (Resolve-Path -LiteralPath $RepoDir -ErrorAction Stop).ProviderPath
    } catch {
        $resolvedRepoDir = [System.IO.Path]::GetFullPath($RepoDir)
    }

    return [System.IO.Path]::Combine($resolvedRepoDir, "dist", "entry.js")
}

function Escape-BatchLiteral {
    param([string]$Value)

    return $Value.Replace("%", "%%")
}

function Install-CrawClawGit {
    param([string]$RepoDir, [switch]$Update)
    
    Write-Host "Installing CrawClaw from git..." -Level info
    
    if (!(Test-Path $RepoDir)) {
        Write-Host "  Cloning repository..." -Level info
        if (!(Invoke-InstallerNativeCommand -Command "git" -Arguments @("clone", "https://github.com/qianleigood/crawclaw.git", $RepoDir) -Action "git clone")) {
            return $false
        }
    } elseif ($Update) {
        Write-Host "  Updating repository..." -Level info
        if (!(Invoke-InstallerNativeCommand -Command "git" -Arguments @("-C", $RepoDir, "pull", "--rebase") -Action "git pull --rebase")) {
            return $false
        }
    }
    
    # Install pnpm if not present
    if (!(Get-Command pnpm -ErrorAction SilentlyContinue)) {
        Write-Host "  Installing pnpm..." -Level info
        if (!(Invoke-InstallerNativeCommand -Command "npm" -Arguments @("install", "-g", "pnpm") -Action "pnpm install")) {
            return $false
        }
    }
    
    # Install dependencies
    Write-Host "  Installing dependencies..." -Level info
    if (!(Invoke-InstallerNativeCommand -Command "pnpm" -Arguments @("install", "--dir", $RepoDir) -Action "pnpm install --dir")) {
        return $false
    }
    
    # Build
    Write-Host "  Building..." -Level info
    if (!(Invoke-InstallerNativeCommand -Command "pnpm" -Arguments @("--dir", $RepoDir, "build") -Action "pnpm build")) {
        return $false
    }
    
    # Create wrapper
    $wrapperDir = "$env:USERPROFILE\.local\bin"
    if (!(Test-Path $wrapperDir)) {
        New-Item -ItemType Directory -Path $wrapperDir -Force | Out-Null
    }

    $entryPath = Resolve-CrawClawGitEntryPath -RepoDir $RepoDir
    $entryPathForBatch = Escape-BatchLiteral -Value $entryPath
    
    @"
@echo off
node "$entryPathForBatch" %*
"@ | Out-File -FilePath "$wrapperDir\crawclaw.cmd" -Encoding ASCII -Force
    
    Write-Host "CrawClaw installed" -Level success
    return $true
}

function Test-ExplicitPackageInstallSpec {
    param([string]$Target)

    if ([string]::IsNullOrWhiteSpace($Target)) {
        return $false
    }

    return $Target.Contains("://") -or
        $Target.Contains("#") -or
        $Target -match '^(file|github|git\+ssh|git\+https|git\+http|git\+file|npm):'
}

function Resolve-PackageInstallSpec {
    param([string]$Target = "latest")

    $trimmed = $Target.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) {
        return "crawclaw@latest"
    }
    if ($trimmed.ToLowerInvariant() -eq "main") {
        return "github:crawclaw/crawclaw#main"
    }
    if (Test-ExplicitPackageInstallSpec -Target $trimmed) {
        return $trimmed
    }
    return "crawclaw@$trimmed"
}

function Add-ToPath {
    param([string]$Path)
    
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$Path*") {
        [Environment]::SetEnvironmentVariable("Path", "$currentPath;$Path", "User")
        Write-Host "Added $Path to user PATH" -Level info
    }
    if ($env:Path -notlike "*$Path*") {
        $env:Path = "$env:Path;$Path"
    }
}

function Resolve-CrawClawCommand {
    $command = Get-Command crawclaw -ErrorAction SilentlyContinue
    if ($command -and $command.Source) {
        return $command.Source
    }
    return "crawclaw"
}

function Invoke-CrawClawDoctor {
    $crawclaw = Resolve-CrawClawCommand
    if (
        !(Invoke-InstallerNativeCommand `
            -Command $crawclaw `
            -Arguments @("doctor", "--non-interactive", "--fix") `
            -Action "crawclaw doctor --non-interactive --fix")
    ) {
        Write-Host "Doctor repair failed. Fix the first actionable error above, then rerun: crawclaw doctor --fix --non-interactive" -Level warn
        return $false
    }
    if (
        Invoke-InstallerNativeCommand `
            -Command $crawclaw `
            -Arguments @("doctor", "--non-interactive") `
            -Action "crawclaw doctor --non-interactive"
    ) {
        return $true
    }
    Write-Host "Doctor reported issues. Fix the first actionable error above, then rerun: crawclaw doctor --non-interactive" -Level warn
    return $false
}

function Write-PostInstallNextSteps {
    Write-Host ""
    Write-Host "Native Windows validation:" -Level info
    Write-Host "  crawclaw doctor --non-interactive" -Level info
    Write-Host "  crawclaw onboard --non-interactive --mode local --install-daemon --skip-skills --accept-risk" -Level info
    Write-Host "  crawclaw gateway status --deep --require-rpc" -Level info
}

# Main
function Main {
    Write-Banner

    Apply-EnvironmentDefaults
    try {
        $script:InstallMethod = Resolve-InstallMethod -Method $InstallMethod
    } catch {
        Write-Host $_.Exception.Message -Level error
        exit 2
    }
    
    Write-Host "Windows detected" -Level success
    
    # Check and handle execution policy FIRST, before any npm calls
    if (!(Ensure-ExecutionPolicy)) {
        Write-Host ""
        Write-Host "Installation cannot continue due to execution policy restrictions" -Level error
        exit 1
    }
    
    if (!(Ensure-Node)) {
        exit 1
    }

    if (!(Ensure-Git)) {
        exit 1
    }
    
    if ($InstallMethod -eq "git") {
        if ($DryRun) {
            Write-Host "[DRY RUN] Would install CrawClaw from git to $GitDir" -Level info
        } else {
            if (!(Install-CrawClawGit -RepoDir $GitDir -Update:(-not $NoGitUpdate))) {
                exit 1
            }
        }
    } else {
        # npm method
        if ($DryRun) {
            Write-Host "[DRY RUN] Would install CrawClaw via npm ($((Resolve-PackageInstallSpec -Target $Tag)))" -Level info
        } else {
            if (!(Install-CrawClawNpm -Target $Tag)) {
                exit 1
            }
        }
    }
    
    # Try to add npm global bin to PATH
    try {
        $npmPrefix = npm config get prefix 2>$null
        if ($npmPrefix) {
            Add-ToPath -Path "$npmPrefix"
        }
    } catch { }
    
    if (!$DryRun) {
        if (!(Invoke-CrawClawDoctor)) {
            exit 1
        }
        if ($NoOnboard) {
            Write-Host "Skipping onboarding next steps output was requested with -NoOnboard." -Level info
        } else {
            Write-PostInstallNextSteps
        }
    }
    
    Write-Host ""
    Write-Host "🦀 CrawClaw installed successfully!" -Level success
}

Main
