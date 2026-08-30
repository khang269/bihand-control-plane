import os
from fastapp.database import init_db, get_db
from fastapp.services.sshService import execute_command

init_db()
db = get_db()
# Get latest openclaw instance
inst = list(db['instances'].find({'status': 'running', 'iteration': 'openclaw'}).sort('createdAt', -1).limit(1))[0]
ip = inst['externalIp']
key = inst['sshKeyPrivate']

print(f"Connecting to {ip}...")

res = execute_command(ip, key, "docker ps -a")
print("Docker PS:")
print(res['stdout'])

res = execute_command(ip, key, "docker logs openclaw-openclaw-gateway-1")
print("Docker Logs:")
print(res['stdout'])

res = execute_command(ip, key, "systemctl status nginx")
print("Nginx Status:")
print(res['stdout'])

