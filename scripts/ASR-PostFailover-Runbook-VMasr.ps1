<#
.SYNOPSIS
    ASR Post-Failover Runbook for Scenario 6 ASR VMs
    Restores app connectivity after zone failover/failback.

.DESCRIPTION
    Attach this runbook to the ASR Recovery Plan "scenario6-asr-group" as a
    post-failover action.  It handles:
      1. Public IP + DNS label attachment (zr-inventory-asr.westus2.cloudapp.azure.com)
      2. Worker VM URL discovery and .env update
      3. SQL AD admin set to new VM managed identity
      4. Service restart on both VMs (scenario6-vm-asr)

    Works for EITHER direction (zone 1->2 or zone 2->1).

.PARAMETER RecoveryPlanContext
    Automatically passed by ASR when triggered from a Recovery Plan.
    If running manually, pass the target resource group name as a string.
    If omitted, defaults to the recovery resource group (PrimaryToRecovery).
#>

param (
    [Parameter(Mandatory = $false)]
    [Object] $RecoveryPlanContext = $null
)

# --- Configuration ---
$MainVmName        = "zr-vm-asr-vm"
$WorkerVmName      = "zr-vm-asr-worker"
$MainNicName       = "zr-vm-asr-nic"
$WorkerNicName     = "zr-vm-asr-worker-nic"
$DnsLabel          = "zr-inventory-asr"
$PipName           = "zr-vm-asr-pip"
$Location          = "westus2"
$SqlServerName     = "zr-vm-asr-ydrrjg2o6aqq2"
$SqlServerRg       = "zr-demo-vm-asr-rg"
$Subscription      = "c3d3eb0c-9ba7-4d4c-828e-cb6874714034"
$AppEnvPath        = "/opt/scenario6-vm-asr/.env"
$WorkerPort        = "8081"
$MainServiceName   = "scenario6-vm-asr"
$WorkerServiceName = "scenario6-worker"
$AppPort           = "80"
$PrimaryRg         = "zr-demo-vm-asr-rg"
$RecoveryRg        = "zr-demo-vm-asr-recovery-rg"

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
if ($null -eq $RecoveryPlanContext) {
    # Manual run with no parameter - default to recovery RG
    Write-Output "No RecoveryPlanContext provided. Defaulting to recovery RG: $RecoveryRg"
    $TargetRg = $RecoveryRg
} elseif ($RecoveryPlanContext -is [string]) {
    try {
        $context = $RecoveryPlanContext | ConvertFrom-Json
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
Write-Output "ASR Post-Failover Recovery (VM-ASR Scenario)"
Write-Output "============================================="
Write-Output "Target RG: $TargetRg"
Write-Output "Other RG:  $OtherRg"
Write-Output "============================================="

# =============================================================================
# Step 1: Public IP + DNS Label
# =============================================================================
Write-Output ""
Write-Output "[1/4] Configuring Public IP with DNS label..."

# Clean up old PIP in OTHER RG if it holds our DNS label
$oldPips = Get-AzPublicIpAddress -ResourceGroupName $OtherRg -ErrorAction SilentlyContinue |
    Where-Object { $_.DnsSettings.DomainNameLabel -eq $DnsLabel }

foreach ($oldPip in $oldPips) {
    Write-Output "  Found old PIP '$($oldPip.Name)' in $OtherRg with DNS label. Cleaning up..."
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

$pip = Get-AzPublicIpAddress -ResourceGroupName $TargetRg -ErrorAction SilentlyContinue |
    Where-Object { $_.DnsSettings.DomainNameLabel -eq $DnsLabel }
$publicIp = if ($pip) { $pip.IpAddress } else { "unknown" }
Write-Output "  Public IP: $publicIp ($DnsLabel.$Location.cloudapp.azure.com)"

# =============================================================================
# Step 2: Update Worker URL in .env
# =============================================================================
Write-Output ""
Write-Output "[2/4] Updating worker VM URL..."

$workerNic = Get-AzNetworkInterface -Name $WorkerNicName -ResourceGroupName $TargetRg -ErrorAction SilentlyContinue
if (-not $workerNic) {
    # After failover, NIC names may have "-ASRReplica" suffix
    $workerNic = Get-AzNetworkInterface -ResourceGroupName $TargetRg -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*worker*" } | Select-Object -First 1
}
$workerIp = $workerNic.IpConfigurations[0].PrivateIpAddress

if ($workerIp) {
    Write-Output "  Worker private IP: $workerIp"
    $updateScript = "sed -i 's|WORKER_VM_URL=.*|WORKER_VM_URL=http://${workerIp}:${WorkerPort}|' ${AppEnvPath}; grep WORKER_VM_URL ${AppEnvPath}"
    $result = Invoke-AzVMRunCommand -ResourceGroupName $TargetRg -VMName $MainVmName `
        -CommandId 'RunShellScript' -ScriptString $updateScript
    Write-Output "  $($result.Value[0].Message)"
} else {
    Write-Warning "  Could not determine worker IP! Trying public IP..."
    $workerPip = Get-AzPublicIpAddress -ResourceGroupName $TargetRg -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*worker*" } | Select-Object -First 1
    if ($workerPip) {
        $workerIp = $workerPip.IpAddress
        Write-Output "  Worker public IP: $workerIp"
        $updateScript = "sed -i 's|WORKER_VM_URL=.*|WORKER_VM_URL=http://${workerIp}:${WorkerPort}|' ${AppEnvPath}; grep WORKER_VM_URL ${AppEnvPath}"
        $result = Invoke-AzVMRunCommand -ResourceGroupName $TargetRg -VMName $MainVmName `
            -CommandId 'RunShellScript' -ScriptString $updateScript
        Write-Output "  $($result.Value[0].Message)"
    } else {
        Write-Warning "  Could not determine worker IP at all!"
    }
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
    Write-Warning "  VM has no managed identity! Enable system-assigned identity first."
}

# =============================================================================
# Step 4: Restart Services
# =============================================================================
Write-Output ""
Write-Output "[4/4] Restarting services..."

# Restart worker first (main depends on it for health checks)
$workerScript = "systemctl restart ${WorkerServiceName} 2>/dev/null || systemctl restart scenario6-worker 2>/dev/null; sleep 2; systemctl is-active ${WorkerServiceName} 2>/dev/null || systemctl is-active scenario6-worker 2>/dev/null || echo 'service-not-found'"
try {
    Invoke-AzVMRunCommand -ResourceGroupName $TargetRg -VMName $WorkerVmName `
        -CommandId 'RunShellScript' -ScriptString $workerScript -ErrorAction SilentlyContinue | Out-Null
    Write-Output "  Worker service restarted."
} catch {
    Write-Output "  Worker restart skipped (VM may not be accessible yet)."
}

# Restart main app
$mainScript = "systemctl restart ${MainServiceName}; sleep 3; systemctl is-active ${MainServiceName}"
$result = Invoke-AzVMRunCommand -ResourceGroupName $TargetRg -VMName $MainVmName `
    -CommandId 'RunShellScript' -ScriptString $mainScript
Write-Output "  Main service: $($result.Value[0].Message)"

# =============================================================================
# Step 5: NSG Rule for port 80 (ensure web traffic allowed)
# =============================================================================
Write-Output ""
Write-Output "[5/5] Ensuring NSG allows port $AppPort..."

$nsgs = Get-AzNetworkSecurityGroup -ResourceGroupName $TargetRg -ErrorAction SilentlyContinue
foreach ($nsg in $nsgs) {
    $existingRule = $nsg.SecurityRules | Where-Object {
        $_.DestinationPortRange -eq $AppPort -and $_.Direction -eq "Inbound" -and $_.Access -eq "Allow"
    }
    if (-not $existingRule) {
        Write-Output "  Adding port $AppPort rule to NSG '$($nsg.Name)'..."
        Add-AzNetworkSecurityRuleConfig -NetworkSecurityGroup $nsg `
            -Name "AllowAppHTTP" -Priority 1003 `
            -Direction Inbound -Access Allow -Protocol Tcp `
            -SourceAddressPrefix '*' -SourcePortRange '*' `
            -DestinationAddressPrefix '*' -DestinationPortRange $AppPort | Out-Null
        Set-AzNetworkSecurityGroup -NetworkSecurityGroup $nsg | Out-Null
    } else {
        Write-Output "  Port $AppPort already allowed in NSG '$($nsg.Name)'."
    }
}

# =============================================================================
# Verification
# =============================================================================
Write-Output ""
Write-Output "============================================="
Write-Output "Post-Failover Recovery Complete!"
Write-Output "============================================="
Write-Output "App URL: http://${DnsLabel}.${Location}.cloudapp.azure.com"
Write-Output "============================================="
