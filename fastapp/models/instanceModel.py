from fastapp.database import get_db
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from bson import ObjectId
import secrets


DEFAULT_AGENT_MD = """You are an autonomous corporate agent.

## Execution Contract

- Start actionable work in the same heartbeat. Do not stop at a plan unless the issue explicitly asks for planning.
- Keep the work moving until it is done. If you need QA to review it, ask them. If you need your boss to review it, ask them.
- Leave durable progress in task comments, documents, or work products, then update the issue to a clear final disposition before you exit.
- Comments, documents, screenshots, work products, and `Remaining` bullets are evidence, not valid liveness paths by themselves.
- Final disposition checklist: mark `done` when complete and verified; use `in_review` only with a real reviewer, approval, interaction, or monitor path; use `blocked` only with first-class blockers or a named unblock owner/action; create delegated follow-up issues with blockers when another agent owns the next step; keep `in_progress` only when a live continuation path exists.
- Use child issues for parallel or long delegated work instead of polling agents, sessions, or processes.
- Create child issues directly when you know what needs to be done. If the board/user needs to choose suggested tasks, answer structured questions, or confirm a proposal first, create an issue-thread interaction on the current issue with `POST /api/issues/{issueId}/interactions` using `kind: "suggest_tasks"`, `kind: "ask_user_questions"`, or `kind: "request_confirmation"`.
- Use `request_confirmation` instead of asking for yes/no decisions in markdown. For plan approval, update the `plan` document first, create a confirmation bound to the latest plan revision, use an idempotency key like `confirmation:{issueId}:plan:{revisionId}`, and wait for acceptance before creating implementation subtasks.
- Set `supersedeOnUserComment: true` when a board/user comment should invalidate the pending confirmation. If you wake up from that comment, revise the artifact or proposal and create a fresh confirmation if confirmation is still needed.
- If someone needs to unblock you, assign or route the ticket with a comment that names the unblock owner and action.
- Respect budget, pause/cancel, approval gates, and company boundaries.

### 🌐 External Network & VM Resource Isolation
*   **Virtual Machine Context**: You are running inside an isolated Docker container on a cloud Virtual Machine (GCP VM).
*   **No Internal Access**: The user, as well as superior/subordinate agents, are on entirely separate machines and networks. They have **no access** to your VM's local filesystem, local databases, or internal container ports.
*   **Localhost is Invalid**: Never respond with local references, file paths, or `localhost` URLs (e.g., `http://localhost:3000` or `http://127.0.0.1:8000`).
*   **Public IP Deployment**: If you are asked to build, deploy, or run a service (such as a website, API, or web app), you must deploy it to the VM's public IP address and configure the appropriate port so that external users can actually access and review your work.
*   **Obtaining your Public IP**: You can easily obtain your VM's public IP address by running `curl -s ifconfig.me` or `curl -s icanhazip.com` inside your terminal shell. Always use this public IP to construct any preview URLs you present to the user.

### 🤝 Empathy for Non-Technical Users & Collaborators
*   **Diverse Backgrounds**: Keep in mind that users or collaborating agents may come from non-technical backgrounds or completely unrelated fields.
*   **Understand Intent & Requests**: Focus on understanding the functional goals of their requests. Translate tech-heavy jargon into clear, business-oriented results.
*   **Proactive Planning & Packaging**: Do not just write code and assume the user can run it. Package the application, start the service, verify the public port is accessible, and report back with a fully functional, public URL. This resource-aware, user-centric thinking must be applied systematically to all technical and non-technical tasks.

Do not let work sit here. You must always update your task with a comment.
"""


class InstanceModel:
    """
    MongoDB 'instances' collection model.
    Tracks NemoClaw VM instances provisioned for users.
    
    Document shape:
    {
        "_id": ObjectId,
        "userId": str,              # user email (owner)
        "userHash": str,            # user hash for quick lookup
        "vmName": str,              # GCP VM name e.g. "nc-a1b2c3d4"
        "zone": str,                # e.g. "us-central1-a"
        "alias": str,               # user-friendly name e.g. "Research Bot"
        "labels": dict,             # GCP labels for resource grouping
        "machineType": str,         # e.g. "e2-standard-4"
        "diskName": str,            # persistent disk name
        "diskSizeGb": int,          # persistent disk size
        "externalIp": str | None,   # VM external IP when running
        "status": str,              # provisioning|installing|running|stopped|error|deleted
        "provider": str,            # gemini|openai|anthropic|deepseek
        "model": str,               # model identifier
        "dashboardToken": str,      # auth token for OpenClaw dashboard
        "sshKeyPrivate": str,       # private key (encrypted at rest)
        "sshKeyPublic": str,        # public key
        "provisionLog": [str],      # log entries
        "errorMessage": str | None,
        "createdBy": str,           # admin email who provisioned
        "createdDate": datetime,
        "updatedDate": datetime
    }
    """

    collectionName = "instances"

    @staticmethod
    def _collection():
        return get_db()["instances"]

    @classmethod
    def _createInstance(
        cls,
        userId: str,
        userHash: str,
        vmName: str,
        zone: str,
        machineType: str,
        diskName: str,
        diskSizeGb: int,
        provider: str,
        model: str,
        sshKeyPrivate: str,
        sshKeyPublic: str,
        createdBy: str,
        alias: str = "Default Instance",
        labels: Optional[Dict] = None,
        iteration: str = "openclaw",
        fleetId: Optional[str] = None,
        fleetRole: Optional[str] = None,
        agentMd: str = DEFAULT_AGENT_MD,
        customAgentMd: str = "",
        soulMd: str = "",
        heartbeatMd: str = "",
        toolsMd: str = "",
        reportsTo: Optional[str] = None,
        title: str = "Employee",
        mcpConfig: str = "{\n  \"mcpServers\": {}\n}",
        enabledSkills: Optional[List[str]] = None,
        avatarHash: Optional[str] = None,
        skillsFiles: Optional[List[Dict]] = None,
        oauthToken: Optional[str] = None,
        customBaseUrl: Optional[str] = None,
    ) -> Dict:
        """Create a new instance record."""
        currentTime = datetime.now(timezone.utc)
        dashboardToken = secrets.token_urlsafe(32)

        instance = {
            "userId": userId,
            "userHash": userHash,
            "vmName": vmName,
            "zone": zone,
            "alias": alias,
            "labels": labels or {},
            "machineType": machineType,
            "iteration": iteration,
            "diskName": diskName,
            "diskSizeGb": diskSizeGb,
            "externalIp": None,
            "status": "provisioning_queued",
            "fleetId": fleetId,
            "fleetRole": fleetRole,
            "title": title,
            "reportsTo": reportsTo,
            "provider": provider,
            "model": model,
            "oauthToken": oauthToken,
            "customBaseUrl": customBaseUrl,
            "dashboardToken": dashboardToken,
            "sshKeyPrivate": sshKeyPrivate,
            "sshKeyPublic": sshKeyPublic,
            "provisionLog": [],
            "errorMessage": None,
            "agentMd": agentMd,
            "customAgentMd": customAgentMd,
            "soulMd": soulMd,
            "heartbeatMd": heartbeatMd,
            "toolsMd": toolsMd,
            "mcpConfig": mcpConfig,
            "adapterConfig": {},
            "enabledSkills": enabledSkills or [],
            "skillsFiles": skillsFiles or [],
            "avatarHash": avatarHash,
            "createdBy": createdBy,
            "createdDate": currentTime,
            "updatedDate": currentTime,
            "lastBilledAt": currentTime,
            "billingCycleStart": currentTime,
            "taskMetadata": {
                "taskId": None,
                "startedAt": None,
                "lastError": None
            }
        }

        result = get_db()[cls.collectionName].insert_one(instance)
        return cls._getById(str(result.inserted_id))

    @classmethod
    def _updateTaskMetadata(cls, instanceId: str, taskId: str = None, startedAt: datetime = None, lastError: str = None):
        """Update Celery task metadata for an instance."""
        db = get_db()
        update_fields = {}
        if taskId is not None:
            update_fields["taskMetadata.taskId"] = taskId
        if startedAt is not None:
            update_fields["taskMetadata.startedAt"] = startedAt
        if lastError is not None:
            update_fields["taskMetadata.lastError"] = lastError
        
        if update_fields:
            update_fields["updatedDate"] = datetime.now(timezone.utc)
            db[cls.collectionName].update_one(
                {"_id": ObjectId(instanceId)},
                {"$set": update_fields}
            )

    @classmethod
    def _updateStatus(cls, instanceId: str, status: str, errorMessage: Optional[str] = None, startupLogs: Optional[str] = None):
        """Update instance status."""
        db = get_db()
        update = {
            "$set": {
                "status": status,
                "updatedDate": datetime.now(timezone.utc),
            }
        }
        if errorMessage is not None:
            update["$set"]["errorMessage"] = errorMessage
        if startupLogs is not None:
            update["$set"]["startupLogs"] = startupLogs
        
        # State machine protection: don't overwrite 'deleting' or 'deleted' unless new status is 'deleted'
        query = {"_id": ObjectId(instanceId)}
        if status not in ["deleting", "deleted", "error"]:
            query["status"] = {"$nin": ["deleting", "deleted"]}
            
        result = db[cls.collectionName].update_one(query, update)
        
        # If it didn't update because of the status lock, don't return the doc as updated
        if result.matched_count == 0 and status not in ["deleting", "deleted", "error"]:
            return
        
        doc = db[cls.collectionName].find_one({"_id": ObjectId(instanceId)})
        if doc and "fleetId" in doc:
            try:
                from fastapp.controllers.websocketController import broadcast_fleet_activity
                broadcast_fleet_activity(doc["fleetId"], {
                    "type": "instance_status_change",
                    "data": {
                        "instanceId": str(doc["_id"]),
                        "status": status,
                        "ip": doc.get("externalIp"),
                        "errorMessage": errorMessage
                    }
                })
            except Exception:
                pass

    @classmethod
    def _updateConfig(
        cls,
        instanceId: str,
        agentMd: Optional[str],
        soulMd: Optional[str],
        toolsMd: Optional[str],
        mcpConfig: Optional[str],
        customAgentMd: Optional[str] = None,
    ):
        """Update instance specific settings (Agent identity and MCP)."""
        db = get_db()
        update_fields: Dict[str, Any] = {
            "updatedDate": datetime.now(timezone.utc),
        }

        if agentMd is not None:
            update_fields["agentMd"] = agentMd
        if customAgentMd is not None:
            update_fields["customAgentMd"] = customAgentMd
        if soulMd is not None:
            update_fields["soulMd"] = soulMd
        if toolsMd is not None:
            update_fields["toolsMd"] = toolsMd
        if mcpConfig is not None:
            update_fields["mcpConfig"] = mcpConfig

        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {"$set": update_fields}
        )

    @classmethod
    def _updateAvatarHash(cls, instanceId: str, avatarHash: Optional[str]):
        """Update avatar hash of an instance."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {"$set": {"avatarHash": avatarHash, "updatedDate": datetime.now(timezone.utc)}}
        )

    @classmethod
    def _setEnabledSkills(cls, instanceId: str, enabledSkills: List[str]):
        """Update enabled agent skills list for an instance."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {
                "$set": {
                    "enabledSkills": enabledSkills,
                    "updatedDate": datetime.now(timezone.utc),
                }
            }
        )

    @classmethod
    def _setToolConnection(cls, instanceId: str, toolKey: str, connection: Dict[str, Any]):
        """Upsert connection metadata for an agent tool/integration."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {
                "$set": {
                    f"toolConnections.{toolKey}": connection,
                    "updatedDate": datetime.now(timezone.utc),
                }
            }
        )

    @classmethod
    def _setAdapterConfig(cls, instanceId: str, adapterConfig: Dict[str, Any]):
        """Persist Paperclip-style adapter configuration metadata for an instance."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {
                "$set": {
                    "adapterConfig": adapterConfig,
                    "updatedDate": datetime.now(timezone.utc),
                }
            }
        )

    @classmethod
    def _setHeartbeatMd(cls, instanceId: str, heartbeatMd: str):
        """Persist HEARTBEAT.md content for an instance."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {
                "$set": {
                    "heartbeatMd": heartbeatMd,
                    "updatedDate": datetime.now(timezone.utc),
                }
            }
        )

    @classmethod
    def _setSocialCredentialId(cls, instanceId: str, credentialId: Optional[str]):
        """Bind or unbind a specific social media credential to an instance."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {
                "$set": {
                    "socialCredentialId": credentialId,
                    "updatedDate": datetime.now(timezone.utc),
                }
            }
        )

    @classmethod
    def _setPlatformCredentialId(cls, instanceId: str, platform: str, credentialId: Optional[str]):
        """Bind or unbind a platform-specific social media credential."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {
                "$set": {
                    f"socialCredentials.{platform}": credentialId,
                    "updatedDate": datetime.now(timezone.utc),
                }
            }
        )

    @classmethod
    def _updateIp(cls, instanceId: str, externalIp: Optional[str]):
        """Update the external IP of an instance."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {
                "$set": {
                    "externalIp": externalIp,
                    "updatedDate": datetime.now(timezone.utc),
                }
            }
        )
        
        doc = db[cls.collectionName].find_one({"_id": ObjectId(instanceId)})
        if doc and "fleetId" in doc:
            try:
                from fastapp.controllers.websocketController import broadcast_fleet_activity
                broadcast_fleet_activity(doc["fleetId"], {
                    "type": "instance_status_change",
                    "data": {
                        "instanceId": str(doc["_id"]),
                        "status": doc.get("status"),
                        "ip": externalIp
                    }
                })
            except Exception:
                pass

    @classmethod
    def _updateToken(cls, instanceId: str, token: str):
        """Update the dashboard token from the actual OpenClaw deployment."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {
                "$set": {
                    "dashboardToken": token,
                    "updatedDate": datetime.now(timezone.utc),
                }
            }
        )

    @classmethod
    def _appendLog(cls, instanceId: str, message: str):
        """Append a log entry to the provision log."""
        db = get_db()
        db[cls.collectionName].update_one(
            {"_id": ObjectId(instanceId)},
            {
                "$push": {"provisionLog": f"[{datetime.now(timezone.utc).isoformat()}] {message}"},
                "$set": {"updatedDate": datetime.now(timezone.utc)},
            }
        )

    @classmethod
    def _delete(cls, instanceId: str):
        """Soft-delete an instance (mark as deleted)."""
        cls._updateStatus(instanceId, "deleted")

    @classmethod
    def _hardDelete(cls, instanceId: str):
        """Permanently remove the instance record."""
        db = get_db()
        db[cls.collectionName].delete_one({"_id": ObjectId(instanceId)})

    @classmethod
    def _serialize(cls, doc: Dict) -> Optional[Dict]:
        """Serialize a MongoDB document for API responses."""
        if not doc:
            return None
        doc["_id"] = str(doc["_id"])
        # Strip private key from serialized output for safety
        # Only include it when explicitly needed (SSH operations)
        return doc

    @classmethod
    def _listByUser(cls, userId: str) -> List[Dict]:
        """List all instances for a specific user (excluding deleted)."""
        db = get_db()
        cursor = db[cls.collectionName].find({
            "userId": userId,
            "status": {"$ne": "deleted"}
        }).sort("createdDate", -1)
        return [cls._serialize(doc) for doc in cursor if doc]

    @classmethod
    def _listByFleet(cls, fleetId: str) -> List[Dict]:
        """List all active/running instances belonging to a specific company fleet."""
        db = get_db()
        cursor = db[cls.collectionName].find({
            "fleetId": fleetId,
            "status": {"$ne": "deleted"}
        }).sort("createdDate", 1)
        return [cls._serialize(doc) for doc in cursor if doc]

    @classmethod
    def _listAll(cls, status_filter: Optional[str] = None) -> List[Dict]:
        """List all instances, optionally filtered by status (excluding deleted by default unless explicitly requested)."""
        db = get_db()
        query = {}
        if status_filter:
            query["status"] = status_filter
        else:
            query["status"] = {"$ne": "deleted"}
            
        cursor = db[cls.collectionName].find(query).sort("createdDate", -1)
        return [cls._serialize(doc) for doc in cursor if doc]

    @classmethod
    def _getById(cls, instanceId: str) -> Optional[Dict]:
        """Get an instance by its ID."""
        db = get_db()
        doc = db[cls.collectionName].find_one({"_id": ObjectId(instanceId)})
        return cls._serialize(doc)

    @classmethod
    def _getByIdWithKeys(cls, instanceId: str) -> Optional[Dict]:
        """Get instance including SSH keys (for internal service use only)."""
        db = get_db()
        doc = db[cls.collectionName].find_one({"_id": ObjectId(instanceId)})
        if not doc:
            return None
        doc["_id"] = str(doc["_id"])
        return doc

    @classmethod
    def _sanitizeForUser(cls, doc: Dict) -> Dict:
        """Remove sensitive fields before sending to non-admin users."""
        if not doc:
            return doc
        sanitized = {**doc}
        sanitized.pop("sshKeyPrivate", None)
        sanitized.pop("sshKeyPublic", None)
        # Keep dashboardToken so the frontend user can connect to the OpenClaw Dashboard!
        sanitized.pop("provisionLog", None)
        sanitized.pop("taskMetadata", None)
        return sanitized
