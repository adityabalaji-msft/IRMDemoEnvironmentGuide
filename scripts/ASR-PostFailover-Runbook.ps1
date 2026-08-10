<#
.SYNOPSIS
    ASR Post-Failover Runbook - Restores app connectivity after zone failover/failback.

.DESCRIPTION
    Attach this runbook to an ASR Recovery Plan as a post-failover action.
    It handles:
      1. Public IP + DNS label attachment
      2. Worker VM URL discovery and .env update
      3. SQL AD admin set to new VM managed identity
      4. Service restart on both VMs

    Works for EITHER direction (zone 1-2 or zone 2-1).

.PARAMETER RecoveryPlanContext
    Automatically passed by ASR when triggered from a Recovery Plan.
    If running manually, pass the target resource group name as a string.
#>

param (
    [Parameter(Mandatory = $true)]
    [Object] $RecoveryPlanContext
)

# --- Configuration ---
$MainVmName        = "zr-vm-zonal-vm"
$WorkerVmName      = "zr-vm-zonal-worker"
$MainNicName       = "zr-vm-zonal-nic"
$WorkerNicName     = "zr-vm-zonal-worker-nic"
$DnsLabel          = "zr-vm-zonal-demo"
$PipName           = "zr-vm-zonal-pip"
$Location          = "westus2"
$SqlServerName     = "zr-aks-yerto2m6texc4-sqlsvr"
$SqlServerRg       = "zr-demo-rg-4"
$Subscription      = "c3d3eb0c-9ba7-4d4c-828e-cb6874714034"
$AppEnvPath        = "/opt/scenario6-vm-zonal/.env"
$WorkerPort        = "8081"
$PrimaryRg         = "zr-demo-vm-rg"
$RecoveryRg        = "zr-demo-vm-recovery-rg"

# --- Authenticate with Managed Identity ---
Write-Output "Authenticating with system-assigned managed identity..."
try {
    Connect-AzAccount -Identity -ErrorAction Stop | Out-Null
    Set-AzContext -SubscriptionId $Subscription -ErrorAction Stop | Out-Null
    Write-Output "  Authenticated successfully."
} catch {
    Write-Error "Failed to authenticate: $_"
    throw
}

# --- Determine Target Resource Group ---
# When called from ASR Recovery Plan, RecoveryPlanContext is a JSON string
# When called manually, it can be the target RG name directly
if ($RecoveryPlanContext -is [string]) {
    try {
        $context = $RecoveryPlanContext | ConvertFrom-Json
        # ASR context: determine target RG from failover direction
        $failoverDirection = $context.FailoverDirection
        Write-Output "ASR Failover Direction: $failoverDirection"
        if ($failoverDirection -eq "PrimaryToRecovery") {
            $TargetRg = $RecoveryRg
        } else {
            $TargetRg = $PrimaryRg
        }
    } catch {
        # Manual invocation - treat as target RG name
        $TargetRg = $RecoveryPlanContext
    }
} else {
    # Object from ASR
    try {
        $context = $RecoveryPlanContext
        $failoverDirection = $context.FailoverDirection
        if ($failoverDirection -eq "PrimaryToRecovery") {
            $TargetRg = $RecoveryRg
        } else {
            $TargetRg = $PrimaryRg
        }
    } catch {
        Write-Error "Could not determine target RG from RecoveryPlanContext: $_"
        throw
    }
}

# Determine the "other" RG
if ($TargetRg -eq $PrimaryRg) {
    $OtherRg = $RecoveryRg
} else {
    $OtherRg = $PrimaryRg
}

Write-Output "============================================="
Write-Output "ASR Post-Failover Recovery"
Write-Output "============================================="
Write-Output "Target RG: $TargetRg"
Write-Output "Other RG:  $OtherRg"
Write-Output "============================================="

# =============================================================================
# Step 1: Public IP + DNS Label
# =============================================================================
Write-Output ""
Write-Output "[1/4] Configuring Public IP with DNS label..."

# Check if old PIP in OTHER RG holds our DNS label - clean it up
$oldPips = Get-AzPublicIpAddress -ResourceGroupName $OtherRg -ErrorAction SilentlyContinue |
    Where-Object { $_.DnsSettings.DomainNameLabel -eq $DnsLabel }

foreach ($oldPip in $oldPips) {
    Write-Output "  Found old PIP '$($oldPip.Name)' in $OtherRg with DNS label. Cleaning up..."
    # Detach from NIC if attached
    if ($oldPip.IpConfiguration) {
        $nicId = ($oldPip.IpConfiguration.Id -split '/ipConfigurations/')[0]
        $nicName = ($nicId -split '/')[-1]
        $nicRg = ($nicId -split '/resourceGroups/')[1].Split('/')[0]
        Write-Output "  Detaching from NIC $nicName..."
        $nic = Get-AzNetworkInterface -Name $nicName -ResourceGroupName $nicRg
        $nic.IpConfigurations[0].PublicIpAddress = $null
        Set-AzNetworkInterface -NetworkInterface $nic | Out-Null
    }
    Write-Output "  Deleting old PIP '$($oldPip.Name)'..."
    Remove-AzPublicIpAddress -Name $oldPip.Name -ResourceGroupName $OtherRg -Force
}

# Check if target RG already has a PIP with our DNS label
$targetPip = Get-AzPublicIpAddress -ResourceGroupName $TargetRg -ErrorAction SilentlyContinue |
    Where-Object { $_.DnsSettings.DomainNameLabel -eq $DnsLabel }

if ($targetPip) {
    Write-Output "  PIP '$($targetPip.Name)' in $TargetRg already has DNS label."
    # Ensure it's attached to the main VM NIC
    $mainNic = Get-AzNetworkInterface -Name $MainNicName -ResourceGroupName $TargetRg
    if (-not $mainNic.IpConfigurations[0].PublicIpAddress -or
        $mainNic.IpConfigurations[0].PublicIpAddress.Id -ne $targetPip.Id) {
        Write-Output "  Attaching to main VM NIC..."
        $mainNic.IpConfigurations[0].PublicIpAddress = $targetPip
        Set-AzNetworkInterface -NetworkInterface $mainNic | Out-Null
    } else {
        Write-Output "  Already attached to main VM NIC."
    }
} else {
    # Create new PIP
    Write-Output "  Creating new PIP '$PipName' with DNS label '$DnsLabel'..."
    $vm = Get-AzVM -ResourceGroupName $TargetRg -Name $MainVmName
    $vmZone = $vm.Zones[0]

    $pipParams = @{
        Name              = $PipName
        ResourceGroupName = $TargetRg
        Location          = $Location
        AllocationMethod  = "Static"
        Sku               = "Standard"
        DomainNameLabel   = $DnsLabel
    }
    if ($vmZone) { $pipParams.Zone = $vmZone }

    $newPip = New-AzPublicIpAddress @pipParams
    Write-Output "  Attaching PIP to main VM NIC..."
    $mainNic = Get-AzNetworkInterface -Name $MainNicName -ResourceGroupName $TargetRg
    $mainNic.IpConfigurations[0].PublicIpAddress = $newPip
    Set-AzNetworkInterface -NetworkInterface $mainNic | Out-Null
}

$pip = Get-AzPublicIpAddress -Name $PipName -ResourceGroupName $TargetRg -ErrorAction SilentlyContinue
$publicIp = if ($pip) { $pip.IpAddress } else { "unknown" }
Write-Output "  Public IP: $publicIp ($DnsLabel.$Location.cloudapp.azure.com)"

# =============================================================================
# Step 2: Update Worker URL in .env
# =============================================================================
Write-Output ""
Write-Output "[2/4] Updating worker VM URL..."

$workerNic = Get-AzNetworkInterface -Name $WorkerNicName -ResourceGroupName $TargetRg -ErrorAction SilentlyContinue
$workerIp = $workerNic.IpConfigurations[0].PrivateIpAddress

if ($workerIp) {
    Write-Output "  Worker private IP: $workerIp"
    $updateScript = "sed -i 's|WORKER_VM_URL=.*|WORKER_VM_URL=http://${workerIp}:${WorkerPort}|' ${AppEnvPath}; grep WORKER_VM_URL ${AppEnvPath}"
    $result = Invoke-AzVMRunCommand -ResourceGroupName $TargetRg -VMName $MainVmName `
        -CommandId 'RunShellScript' -ScriptString $updateScript
    Write-Output "  $($result.Value[0].Message)"
} else {
    Write-Warning "  Could not determine worker IP!"
}

# =============================================================================
# Step 3: Set Managed Identity as SQL AD Admin
# =============================================================================
Write-Output ""
Write-Output "[3/4] Setting VM managed identity as SQL AD admin..."

$vm = Get-AzVM -ResourceGroupName $TargetRg -Name $MainVmName
$identityPrincipalId = $vm.Identity.PrincipalId

if ($identityPrincipalId) {
    Write-Output "  VM identity: $identityPrincipalId"
    Set-AzSqlServerActiveDirectoryAdministrator `
        -ResourceGroupName $SqlServerRg `
        -ServerName $SqlServerName `
        -DisplayName $MainVmName `
        -ObjectId $identityPrincipalId | Out-Null
    Write-Output "  SQL AD admin set to $MainVmName"
} else {
    Write-Warning "  VM has no managed identity!"
}

# =============================================================================
# Step 4: Restart Services
# =============================================================================
Write-Output ""
Write-Output "[4/4] Restarting services..."

# Restart worker first
$workerScript = "systemctl restart scenario6-worker 2>/dev/null || systemctl restart scenario6 2>/dev/null; sleep 2; systemctl is-active scenario6-worker 2>/dev/null || systemctl is-active scenario6 2>/dev/null || echo 'unknown'"
try {
    Invoke-AzVMRunCommand -ResourceGroupName $TargetRg -VMName $WorkerVmName `
        -CommandId 'RunShellScript' -ScriptString $workerScript -ErrorAction SilentlyContinue | Out-Null
    Write-Output "  Worker service restarted."
} catch {
    Write-Output "  Worker restart skipped (VM may not be accessible yet)."
}

# Restart main app
$mainScript = "systemctl restart scenario6; sleep 3; systemctl is-active scenario6"
$result = Invoke-AzVMRunCommand -ResourceGroupName $TargetRg -VMName $MainVmName `
    -CommandId 'RunShellScript' -ScriptString $mainScript
Write-Output "  Main service: $($result.Value[0].Message)"

# =============================================================================
# Verification
# =============================================================================
Write-Output ""
Write-Output "============================================="
Write-Output "Post-Failover Recovery Complete!"
Write-Output "============================================="
Write-Output "App URL: http://${DnsLabel}.${Location}.cloudapp.azure.com:8080"
Write-Output "============================================="

