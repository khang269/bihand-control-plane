"""
SSH Service — manages SSH connections and SFTP file operations to user VMs.
Uses paramiko for pure-Python SSH2 support.
"""

import logging
import io
import stat
from typing import Optional, List, Dict, Callable, Tuple

import paramiko

logger = logging.getLogger(__name__)

SSH_USERNAME = "minerclaw"
SSH_PORT = 22
CONNECT_TIMEOUT = 30


def _get_pkey(private_key_str: str) -> paramiko.RSAKey:
    """Parse an RSA private key from a PEM string."""
    key_file = io.StringIO(private_key_str)
    return paramiko.RSAKey.from_private_key(key_file)


def _connect(ip: str, private_key_str: str) -> paramiko.SSHClient:
    """Establish an SSH connection to a VM."""
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    pkey = _get_pkey(private_key_str)
    client.connect(
        hostname=ip,
        port=SSH_PORT,
        username=SSH_USERNAME,
        pkey=pkey,
        timeout=CONNECT_TIMEOUT,
        look_for_keys=False,
        allow_agent=False,
    )
    return client


def open_shell(
    ip: str,
    private_key: str,
    cols: int = 80,
    rows: int = 24,
) -> Tuple[paramiko.SSHClient, paramiko.Channel]:
    """
    Open an interactive PTY shell on the VM for a live terminal session.
    Caller owns the returned client/channel and must close both when done.
    """
    client = _connect(ip, private_key)
    channel = client.invoke_shell(term="xterm-256color", width=cols, height=rows)
    channel.settimeout(0.0)
    return client, channel


def execute_command(
    ip: str,
    private_key: str,
    command: str,
    on_output: Optional[Callable[[str], None]] = None,
) -> Dict:
    """
    Execute a command on the remote VM via SSH.
    
    Args:
        ip: VM external IP
        private_key: RSA private key PEM string
        command: Shell command to execute
        on_output: Optional callback for streaming stdout lines
    
    Returns:
        dict with exit_code, stdout, stderr
    """
    client = None
    try:
        client = _connect(ip, private_key)
        
        # Use exec_command with get_pty for interactive-like output
        stdin, stdout, stderr = client.exec_command(command, get_pty=True, timeout=600)
        
        output_lines = []
        if on_output:
            # Stream output line by line
            for line in stdout:
                line_str = line.strip()
                output_lines.append(line_str)
                on_output(line_str)
        else:
            output_lines = stdout.read().decode("utf-8", errors="replace").splitlines()
        
        exit_code = stdout.channel.recv_exit_status()
        stderr_text = stderr.read().decode("utf-8", errors="replace")
        
        return {
            "exitCode": exit_code,
            "stdout": "\n".join(output_lines),
            "stderr": stderr_text,
        }
    except Exception as e:
        logger.error(f"SSH command failed on {ip}: {e}")
        raise
    finally:
        if client:
            client.close()


def execute_command_stream(
    ip: str,
    private_key: str,
    command: str,
):
    """
    Generator that yields stdout lines as they arrive.
    Used for WebSocket streaming of provision logs.
    """
    client = None
    try:
        client = _connect(ip, private_key)
        stdin, stdout, stderr = client.exec_command(command, get_pty=True, timeout=600)
        
        for line in stdout:
            yield line.strip()
        
        exit_code = stdout.channel.recv_exit_status()
        if exit_code != 0:
            stderr_text = stderr.read().decode("utf-8", errors="replace")
            yield f"[ERROR] Exit code {exit_code}: {stderr_text}"
    except Exception as e:
        yield f"[ERROR] SSH stream failed: {e}"
    finally:
        if client:
            client.close()


def test_connection(ip: str, private_key: str) -> bool:
    """Test if SSH connection can be established."""
    client = None
    try:
        client = _connect(ip, private_key)
        return True
    except Exception:
        return False
    finally:
        if client:
            client.close()


def _get_sudo_sftp(client: paramiko.SSHClient) -> paramiko.SFTPClient:
    """Open an SFTP session as root by running the sftp-server binary via sudo."""
    channel = client.get_transport().open_session()
    # Common path for Debian/Ubuntu based images
    channel.exec_command("sudo /usr/lib/openssh/sftp-server")
    return paramiko.SFTPClient(channel)

# ===================== SFTP FILE OPERATIONS =====================

def list_directory(ip: str, private_key: str, path: str = "/root/.openclaw") -> List[Dict]:
    """List files and directories at the given path on the VM."""
    client = None
    try:
        client = _connect(ip, private_key)
        sftp = _get_sudo_sftp(client)
        
        entries = []
        for attr in sftp.listdir_attr(path):
            is_dir = stat.S_ISDIR(attr.st_mode)
            entries.append({
                "name": attr.filename,
                "path": f"{path}/{attr.filename}".replace("//", "/"),
                "is_dir": is_dir,
                "size": attr.st_size if not is_dir else None,
                "modified": attr.st_mtime,
            })
        
        # Sort: directories first, then files, alphabetically
        entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
        
        sftp.close()
        return entries
    except FileNotFoundError:
        return []
    except Exception as e:
        logger.error(f"SFTP list failed on {ip}:{path}: {e}")
        raise
    finally:
        if client:
            client.close()


def download_file(ip: str, private_key: str, remote_path: str) -> bytes:
    """Download a file from the VM and return its contents as bytes."""
    client = None
    try:
        client = _connect(ip, private_key)
        sftp = _get_sudo_sftp(client)
        
        buffer = io.BytesIO()
        sftp.getfo(remote_path, buffer)
        
        sftp.close()
        buffer.seek(0)
        return buffer.read()
    except Exception as e:
        logger.error(f"SFTP download failed for {remote_path} on {ip}: {e}")
        raise
    finally:
        if client:
            client.close()


def upload_file(ip: str, private_key: str, remote_path: str, file_data: bytes):
    """Upload file data to the VM at the specified path."""
    client = None
    try:
        client = _connect(ip, private_key)
        sftp = _get_sudo_sftp(client)
        
        buffer = io.BytesIO(file_data)
        sftp.putfo(buffer, remote_path)
        
        sftp.close()
        logger.info(f"Uploaded {len(file_data)} bytes to {ip}:{remote_path}")
    except Exception as e:
        logger.error(f"SFTP upload failed for {remote_path} on {ip}: {e}")
        raise
    finally:
        if client:
            client.close()


def delete_file(ip: str, private_key: str, remote_path: str):
    """Delete a file on the VM."""
    client = None
    try:
        client = _connect(ip, private_key)
        sftp = _get_sudo_sftp(client)
        
        # Check if it's a directory
        try:
            attr = sftp.stat(remote_path)
            if stat.S_ISDIR(attr.st_mode):
                sftp.rmdir(remote_path)
            else:
                sftp.remove(remote_path)
        except FileNotFoundError:
            pass
        
        sftp.close()
        logger.info(f"Deleted {remote_path} on {ip}")
    except Exception as e:
        logger.error(f"SFTP delete failed for {remote_path} on {ip}: {e}")
        raise
    finally:
        if client:
            client.close()


def generate_ssh_keypair() -> Dict[str, str]:
    """Generate a new RSA key pair for VM access."""
    key = paramiko.RSAKey.generate(4096)
    
    # Private key as PEM string
    private_buf = io.StringIO()
    key.write_private_key(private_buf)
    private_key_str = private_buf.getvalue()
    
    # Public key in OpenSSH format
    public_key_str = f"{key.get_name()} {key.get_base64()} minerclaw@minerClaw"
    
    return {
        "private": private_key_str,
        "public": public_key_str,
    }
