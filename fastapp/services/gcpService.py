"""
GCP Compute Engine Service
Manages VM instances and persistent disks for NemoClaw deployments.

Key security decision: VMs are created WITHOUT a GCP service account,
so they have zero access to any GCP APIs or project resources.
"""

import logging
import os
import time
import functools
from typing import Optional, Dict, List

from google.cloud import compute_v1
from google.oauth2 import service_account

logger = logging.getLogger(__name__)

# --- Resilience Helper ---
def gcp_retry(max_attempts=3, delay=2):
    """Decorator to retry GCP API calls on transient timeout errors."""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_err = None
            for attempt in range(max_attempts):
                try:
                    # Inject a default timeout if not present
                    if 'timeout' not in kwargs:
                        kwargs['timeout'] = 60
                    return func(*args, **kwargs)
                except Exception as e:
                    last_err = e
                    err_msg = str(e).lower()
                    if ("timed out" in err_msg or "deadline exceeded" in err_msg or "connection reset" in err_msg) and attempt < max_attempts - 1:
                        logger.warning(f"GCP API timeout on {func.__name__} (attempt {attempt+1}/{max_attempts}): {e}")
                        time.sleep(delay * (attempt + 1))
                        continue
                    raise last_err
            return None
        return wrapper
    return decorator

# --- Configuration ---
GCP_PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT_ID")  # required for GCP-VM placement; no maintainer default
GCP_REGION = os.getenv("GCP_REGION", "us-central1")
GCP_DEFAULT_ZONE = os.getenv("GCP_DEFAULT_ZONE", "us-central1-a")
GCP_CREDENTIALS_PATH = os.getenv(
    "GOOGLE_APPLICATION_CREDENTIALS",
    os.path.join(os.path.dirname(__file__), "..", "ce-admin-service-account.json")
)

# Machine image to use for VMs
VM_IMAGE_PROJECT = "ubuntu-os-cloud"
VM_IMAGE_FAMILY = "ubuntu-2404-lts-amd64"

# --- Machine type catalog for the UI ---
MACHINE_CATALOG = [
    {
        "id": "e2-small",
        "name": "E2 Small",
        "vcpus": 0.5,
        "memoryGb": 2,
        "description": "Eco — best for lightweight agents",
        "estimatedCostPerHour": 0.017,
    },
    {
        "id": "e2-medium",
        "name": "E2 Medium",
        "vcpus": 1,
        "memoryGb": 4,
        "description": "Basic — good for light workloads",
        "estimatedCostPerHour": 0.034,
    },
    {
        "id": "e2-standard-2",
        "name": "E2 Standard 2",
        "vcpus": 2,
        "memoryGb": 8,
        "description": "Standard — balanced compute and memory",
        "estimatedCostPerHour": 0.067,
    },
    {
        "id": "e2-standard-4",
        "name": "E2 Standard 4",
        "vcpus": 4,
        "memoryGb": 16,
        "description": "Performance — recommended for most users",
        "estimatedCostPerHour": 0.134,
    },
    {
        "id": "e2-standard-8",
        "name": "E2 Standard 8",
        "vcpus": 8,
        "memoryGb": 32,
        "description": "High Performance — for demanding workloads",
        "estimatedCostPerHour": 0.268,
    },
    {
        "id": "n2-standard-4",
        "name": "N2 Standard 4",
        "vcpus": 4,
        "memoryGb": 16,
        "description": "Compute Optimized — faster single-thread",
        "estimatedCostPerHour": 0.194,
    },
]


def _get_credentials():
    """Load GCP service account credentials."""
    creds_path = os.path.abspath(GCP_CREDENTIALS_PATH)
    if os.path.exists(creds_path):
        return service_account.Credentials.from_service_account_file(creds_path)
    # Fall back to Application Default Credentials
    return None


def _get_instances_client():
    creds = _get_credentials()
    return compute_v1.InstancesClient(credentials=creds)


def _get_disks_client():
    creds = _get_credentials()
    return compute_v1.DisksClient(credentials=creds)


def _get_snapshots_client():
    creds = _get_credentials()
    return compute_v1.SnapshotsClient(credentials=creds)


def _get_addresses_client():
    creds = _get_credentials()
    return compute_v1.AddressesClient(credentials=creds)


def _get_region_from_zone(zone: str) -> str:
    parts = zone.split("-")
    if len(parts) >= 2:
        return "-".join(parts[:-1])
    return "us-central1"


def _wait_for_zone_operation(operation, zone: str):
    """Wait for a zonal operation to complete."""
    creds = _get_credentials()
    op_client = compute_v1.ZoneOperationsClient(credentials=creds)
    op_client.wait(project=GCP_PROJECT, zone=zone, operation=operation.name)


def _wait_for_region_operation(operation, region: str):
    """Wait for a regional operation to complete."""
    creds = _get_credentials()
    op_client = compute_v1.RegionOperationsClient(credentials=creds)
    op_client.wait(project=GCP_PROJECT, region=region, operation=operation.name)


def _wait_for_global_operation(operation):
    """Wait for a global operation to complete."""
    creds = _get_credentials()
    op_client = compute_v1.GlobalOperationsClient(credentials=creds)
    op_client.wait(project=GCP_PROJECT, operation=operation.name)


# ===================== PERSISTENT DISK =====================

@gcp_retry()
def create_persistent_disk(disk_name: str, zone: str, size_gb: int = 50, labels: Optional[Dict] = None, timeout: int = 60) -> Dict:
    """
    Create a standalone persistent disk for user data.
    This disk survives VM deletion.
    """
    logger.info(f"Creating persistent disk {disk_name} in {zone} ({size_gb}GB)")
    
    client = _get_disks_client()
    
    disk = compute_v1.Disk()
    disk.name = disk_name
    disk.size_gb = size_gb
    disk.type_ = f"zones/{zone}/diskTypes/pd-standard"
    
    if labels:
        disk.labels = labels
    
    operation = client.insert(project=GCP_PROJECT, zone=zone, disk_resource=disk, timeout=timeout)
    _wait_for_zone_operation(operation, zone)
    
    logger.info(f"Persistent disk {disk_name} created successfully")
    return {"name": disk_name, "zone": zone, "sizeGb": size_gb}


@gcp_retry()
def delete_persistent_disk(disk_name: str, zone: str, timeout: int = 60):
    """Delete a persistent disk. Use with caution — data is lost."""
    logger.info(f"Deleting persistent disk {disk_name} in {zone}")
    client = _get_disks_client()
    
    try:
        operation = client.delete(project=GCP_PROJECT, zone=zone, disk=disk_name, timeout=timeout)
        _wait_for_zone_operation(operation, zone)
        logger.info(f"Persistent disk {disk_name} deleted")
    except Exception as e:
        logger.error(f"Failed to delete disk {disk_name}: {e}")
        raise


@gcp_retry()
def disk_exists(disk_name: str, zone: str, timeout: int = 30) -> bool:
    """Check if a persistent disk exists."""
    client = _get_disks_client()
    try:
        client.get(project=GCP_PROJECT, zone=zone, disk=disk_name, timeout=timeout)
        return True
    except Exception as e:
        if "not found" in str(e).lower():
            return False
        raise e


# ===================== SNAPSHOTS =====================

def create_snapshot(disk_name: str, zone: str, snapshot_name: str) -> Dict:
    """Create a snapshot of a persistent disk for backup."""
    logger.info(f"Creating snapshot {snapshot_name} of disk {disk_name}")
    
    client = _get_disks_client()
    
    snapshot = compute_v1.Snapshot()
    snapshot.name = snapshot_name
    
    operation = client.create_snapshot(
        project=GCP_PROJECT,
        zone=zone,
        disk=disk_name,
        snapshot_resource=snapshot,
    )
    _wait_for_zone_operation(operation, zone)
    
    logger.info(f"Snapshot {snapshot_name} created successfully")
    return {"name": snapshot_name, "sourceDisk": disk_name}


def delete_snapshot(snapshot_name: str):
    """Delete a disk snapshot."""
    client = _get_snapshots_client()
    try:
        operation = client.delete(project=GCP_PROJECT, snapshot=snapshot_name)
        _wait_for_global_operation(operation)
    except Exception as e:
        logger.error(f"Failed to delete snapshot {snapshot_name}: {e}")
        raise


# ===================== VM INSTANCES =====================

@gcp_retry()
def create_instance(
    vm_name: str,
    zone: str,
    machine_type: str,
    disk_name: str,
    ssh_pubkey: str,
    startup_script: str,
    labels: Optional[Dict] = None,
    extra_metadata: Optional[Dict[str, str]] = None,
    disk_size_gb: int = 64,
    timeout: int = 60
) -> Dict:
    """
    Create a Compute Engine VM instance.
    """
    logger.info(f"Creating VM {vm_name} in {zone} ({machine_type}, {disk_size_gb}GB disk)")

    client = _get_instances_client()

    # --- Boot disk ---
    boot_disk = compute_v1.AttachedDisk()
    boot_disk.auto_delete = True
    boot_disk.boot = True
    boot_disk.initialize_params = compute_v1.AttachedDiskInitializeParams()
    boot_disk.initialize_params.source_image = (
        f"projects/{VM_IMAGE_PROJECT}/global/images/family/{VM_IMAGE_FAMILY}"
    )
    boot_disk.initialize_params.disk_size_gb = disk_size_gb
    boot_disk.initialize_params.disk_type = f"zones/{zone}/diskTypes/pd-standard"
    
    # --- Allocate static external IP ---
    region = _get_region_from_zone(zone)
    address_client = _get_addresses_client()
    static_ip_address = None
    ip_name = f"ip-{vm_name}"
    
    try:
        logger.info(f"Allocating static external IP {ip_name} in region {region}")
        address_resource = compute_v1.Address()
        address_resource.name = ip_name
        
        try:
            operation = address_client.insert(project=GCP_PROJECT, region=region, address_resource=address_resource, timeout=timeout)
            _wait_for_region_operation(operation, region)
        except Exception as e:
            if "already exists" in str(e).lower() or "409" in str(e):
                logger.warning(f"Static IP {ip_name} already exists. Using existing.")
            else:
                raise
        
        addr_info = address_client.get(project=GCP_PROJECT, region=region, address=ip_name, timeout=timeout)
        static_ip_address = addr_info.address
        logger.info(f"Using static IP: {static_ip_address}")
    except Exception as e:
        logger.error(f"Failed to allocate static IP for {vm_name}, falling back to ephemeral: {e}")
    
    # --- Network interface with external IP ---
    network_interface = compute_v1.NetworkInterface()
    network_interface.name = "global/networks/default"
    access_config = compute_v1.AccessConfig()
    access_config.name = "External NAT"
    access_config.type_ = "ONE_TO_ONE_NAT"
    if static_ip_address:
        access_config.nat_i_p = static_ip_address
    network_interface.access_configs = [access_config]
    
    # --- Metadata (startup script + SSH key) ---
    metadata = compute_v1.Metadata()
    metadata.items = [
        compute_v1.Items(key="startup-script", value=startup_script),
        compute_v1.Items(key="ssh-keys", value=f"minerclaw:{ssh_pubkey}"),
    ]
    
    if extra_metadata:
        for k, v in extra_metadata.items():
            metadata.items.append(compute_v1.Items(key=k, value=str(v)))
    
    # --- Firewall tags ---
    tags = compute_v1.Tags()
    tags.items = ["http-server", "https-server", "nemoclaw-dashboard", "allow-all-user-ports"]
    
    # --- Instance definition ---
    instance = compute_v1.Instance()
    instance.name = vm_name
    instance.machine_type = f"zones/{zone}/machineTypes/{machine_type}"
    instance.disks = [boot_disk]
    instance.network_interfaces = [network_interface]
    instance.metadata = metadata
    instance.tags = tags
    
    if labels:
        instance.labels = labels
    
    instance.service_accounts = []
    
    try:
        operation = client.insert(project=GCP_PROJECT, zone=zone, instance_resource=instance, timeout=timeout)
        _wait_for_zone_operation(operation, zone)
    except Exception as e:
        if "already exists" in str(e).lower() or "409" in str(e):
            logger.warning(f"Instance {vm_name} already exists. Assuming success from previous attempt.")
        else:
            raise
    
    # Get the created instance to retrieve its IP
    created = client.get(project=GCP_PROJECT, zone=zone, instance=vm_name, timeout=timeout)
    external_ip = None
    if created.network_interfaces and created.network_interfaces[0].access_configs:
        external_ip = created.network_interfaces[0].access_configs[0].nat_i_p
    
    logger.info(f"VM {vm_name} created with IP {external_ip}")
    return {
        "vmName": vm_name,
        "zone": zone,
        "externalIp": external_ip,
        "status": "RUNNING",
    }


@gcp_retry()
def clear_startup_script(vm_name: str, zone: str, timeout: int = 60):
    """Remove the startup-script from the VM metadata to prevent it from running again on restart."""
    logger.info(f"Clearing startup script from VM {vm_name}")
    client = _get_instances_client()
    inst = client.get(project=GCP_PROJECT, zone=zone, instance=vm_name, timeout=timeout)
    
    metadata = inst.metadata
    new_items = [item for item in metadata.items if item.key != 'startup-script']
    metadata.items = new_items
    
    operation = client.set_metadata(project=GCP_PROJECT, zone=zone, instance=vm_name, metadata_resource=metadata, timeout=timeout)
    _wait_for_zone_operation(operation, zone)
    logger.info(f"Startup script cleared from VM {vm_name}")


@gcp_retry()
def get_instance(vm_name: str, zone: str, timeout: int = 30) -> Optional[Dict]:
    """Get VM instance details including status and external IP."""
    client = _get_instances_client()
    inst = client.get(project=GCP_PROJECT, zone=zone, instance=vm_name, timeout=timeout)
    external_ip = None
    if inst.network_interfaces and inst.network_interfaces[0].access_configs:
        external_ip = inst.network_interfaces[0].access_configs[0].nat_i_p
    
    return {
        "vmName": vm_name,
        "zone": zone,
        "status": inst.status,
        "externalIp": external_ip,
        "machineType": inst.machine_type.split("/")[-1] if inst.machine_type else None,
    }

@gcp_retry()
def get_instance_serial_port_output(vm_name: str, zone: str, port: int = 1, timeout: int = 30) -> str:
    """Retrieve the raw serial port output from a VM."""
    client = _get_instances_client()
    response = client.get_serial_port_output(
        request={"project": GCP_PROJECT, "zone": zone, "instance": vm_name, "port": port},
        timeout=timeout
    )
    return response.contents


@gcp_retry()
def stop_instance(vm_name: str, zone: str, timeout: int = 60):
    """Stop a VM instance. Persistent disk is preserved."""
    logger.info(f"Stopping VM {vm_name}")
    client = _get_instances_client()
    operation = client.stop(project=GCP_PROJECT, zone=zone, instance=vm_name, timeout=timeout)
    _wait_for_zone_operation(operation, zone)
    logger.info(f"VM {vm_name} stopped")


@gcp_retry()
def start_instance(vm_name: str, zone: str, timeout: int = 60):
    """Start a stopped or suspended VM instance."""
    logger.info(f"Starting VM {vm_name}")
    client = _get_instances_client()
    operation = client.start(project=GCP_PROJECT, zone=zone, instance=vm_name, timeout=timeout)
    _wait_for_zone_operation(operation, zone)
    logger.info(f"VM {vm_name} started")


@gcp_retry()
def suspend_instance(vm_name: str, zone: str, timeout: int = 60):
    """Suspend a running VM instance. State is saved to disk."""
    logger.info(f"Suspending VM {vm_name}")
    client = _get_instances_client()
    operation = client.suspend(project=GCP_PROJECT, zone=zone, instance=vm_name, timeout=timeout)
    _wait_for_zone_operation(operation, zone)
    logger.info(f"VM {vm_name} suspended")


@gcp_retry()
def resume_instance(vm_name: str, zone: str, timeout: int = 60):
    """Resume a suspended VM instance."""
    logger.info(f"Resuming VM {vm_name}")
    client = _get_instances_client()
    operation = client.resume(project=GCP_PROJECT, zone=zone, instance=vm_name, timeout=timeout)
    _wait_for_zone_operation(operation, zone)
    logger.info(f"VM {vm_name} resumed")


@gcp_retry()
def set_machine_type(vm_name: str, zone: str, machine_type: str, timeout: int = 60):
    """Change the machine type of a stopped instance."""
    logger.info(f"Changing machine type of VM {vm_name} to {machine_type}")
    client = _get_instances_client()
    request_resource = compute_v1.InstancesSetMachineTypeRequest(
        machine_type=f"zones/{zone}/machineTypes/{machine_type}"
    )
    operation = client.set_machine_type(
        project=GCP_PROJECT,
        zone=zone,
        instance=vm_name,
        instances_set_machine_type_request_resource=request_resource,
        timeout=timeout
    )
    _wait_for_zone_operation(operation, zone)
    logger.info(f"Machine type of VM {vm_name} changed to {machine_type}")


@gcp_retry()
def delete_instance(vm_name: str, zone: str, timeout: int = 60):
    """
    Delete a VM instance. The persistent data disk is NOT deleted
    (auto_delete=False), so user data is preserved.
    """
    logger.info(f"Deleting VM {vm_name} (disk preserved)")
    client = _get_instances_client()
    try:
        operation = client.delete(project=GCP_PROJECT, zone=zone, instance=vm_name, timeout=timeout)
        _wait_for_zone_operation(operation, zone)
        logger.info(f"VM {vm_name} deleted")
    except Exception as e:
        logger.error(f"Failed to delete VM {vm_name}: {e}")
        raise
    finally:
        # Release the regional static external IP address
        try:
            region = _get_region_from_zone(zone)
            address_client = _get_addresses_client()
            ip_name = f"ip-{vm_name}"
            logger.info(f"Releasing static external IP {ip_name} in region {region}")
            operation = address_client.delete(project=GCP_PROJECT, region=region, address=ip_name, timeout=timeout)
            _wait_for_region_operation(operation, region)
            logger.info(f"Static external IP {ip_name} released")
        except Exception as e:
            if "not found" in str(e).lower() or "404" in str(e):
                logger.info(f"Static IP {ip_name} already released or not found.")
            else:
                logger.warning(f"Failed to release static external IP {ip_name}: {e}")

def get_machine_catalog() -> List[Dict]:
    """Return the available machine types for the setup wizard."""
    return MACHINE_CATALOG
