import logging
import os
from datetime import datetime, timezone
from pymongo.errors import DuplicateKeyError
from fastapp.database import get_db
from fastapp.migrations.v0_1_0_migration import Migration_0_1_0

logger = logging.getLogger(__name__)

# Register all migrations chronologically here
MIGRATIONS = [
    Migration_0_1_0()
]

def run_all_migrations():
    """
    Main entry point for running declarative database and VM migrations on startup.
    """
    db = get_db()
    
    lock_acquired = False
    try:
        db["migrations_lock"].create_index("lockId", unique=True)
        db["migrations_lock"].create_index("createdAt", expireAfterSeconds=600)

        # Idempotent index creation for the customer-support conversation pipeline collections.
        # Not a versioned migration (create_index is a safe no-op if already present) - just
        # ensured once per startup here rather than inventing a separate startup hook.
        from fastapp.models.customerProfileModel import CustomerProfileModel
        from fastapp.models.conversationModel import ConversationModel
        from fastapp.models.messageModel import MessageModel
        from fastapp.models.flowModel import FlowModel
        CustomerProfileModel._ensureIndexes()
        ConversationModel._ensureIndexes()
        MessageModel._ensureIndexes()
        FlowModel._ensureIndexes()

        db["migrations_lock"].insert_one({
            "lockId": "global_migration_lock",
            "createdAt": datetime.now(timezone.utc)
        })
        lock_acquired = True
        logger.info("Successfully acquired database migration lock.")
    except DuplicateKeyError:
        logger.info("Database migration lock is already held by another replica. Skipping migrations.")
        return
    except Exception as e:
        logger.error(f"Error attempting to acquire migration lock: {e}")
        return

    try:
        target_version = os.environ.get("VERSION", "0.1.0").strip()
        logger.info(f"Target system version for migration: {target_version}")

        for migration in MIGRATIONS:
            if migration.version > target_version:
                logger.info(f"Skipping migration {migration.migration_id} (version {migration.version} is greater than target {target_version})")
                continue

            completed = db["migrations"].find_one({
                "migrationId": migration.migration_id,
                "status": "success"
            })

            if not completed:
                logger.info(f"Applying database migration: {migration.migration_id} (version {migration.version})")
                try:
                    success = migration.upgrade_db(db)
                    if success:
                        db["migrations"].insert_one({
                            "migrationId": migration.migration_id,
                            "version": migration.version,
                            "appliedAt": datetime.now(timezone.utc),
                            "status": "success",
                            "type": "database"
                        })
                        logger.info(f"Successfully applied database migration: {migration.migration_id}")
                    else:
                        raise RuntimeError("upgrade_db returned False")
                except Exception as e:
                    logger.error(f"Failed to apply database migration {migration.migration_id}: {e}")
                    db["migrations"].insert_one({
                        "migrationId": migration.migration_id,
                        "version": migration.version,
                        "appliedAt": datetime.now(timezone.utc),
                        "status": "failed",
                        "error": str(e),
                        "type": "database"
                    })
                    return

            query = {
                "status": {"$in": ["running", "updating"]},
                "$or": [
                    {"deployedVersion": {"$exists": False}},
                    {"deployedVersion": {"$lt": migration.version}}
                ]
            }
            
            pending_instances = list(db["instances"].find(query))
            if pending_instances:
                logger.info(f"Found {len(pending_instances)} running instances requiring VM migration to {migration.version}")
                
                for inst in pending_instances:
                    inst_id = str(inst["_id"])
                    fleet_id = inst.get("fleetId")
                    
                    original_inst_status = inst.get("status", "running")
                    original_fleet_status = "provisioned"
                    
                    if fleet_id:
                        fleet = db["fleets"].find_one({"_id": fleet_id})
                        if fleet:
                            original_fleet_status = fleet.get("status", "provisioned")
                            db["fleets"].update_one(
                                {"_id": fleet_id},
                                {"$set": {"status": "updating", "updatedAt": datetime.now(timezone.utc)}}
                            )
                    
                    db["instances"].update_one(
                        {"_id": inst["_id"]},
                        {"$set": {"status": "updating", "updatedDate": datetime.now(timezone.utc)}}
                    )
                    
                    try:
                        vm_success = migration.upgrade_vm(db, inst)
                        if vm_success:
                            db["instances"].update_one(
                                {"_id": inst["_id"]},
                                {
                                    "$set": {
                                        "status": "running", 
                                        "deployedVersion": migration.version,
                                        "updatedDate": datetime.now(timezone.utc)
                                    }
                                }
                            )
                            logger.info(f"Successfully migrated VM instance {inst_id} to version {migration.version}")
                        else:
                            raise RuntimeError("upgrade_vm returned False")
                    except Exception as e:
                        logger.error(f"Failed to migrate VM instance {inst_id}: {e}")
                        db["instances"].update_one(
                            {"_id": inst["_id"]},
                            {
                                "$set": {
                                    "status": "error", 
                                    "errorMessage": f"Migration {migration.version} failed: {str(e)}",
                                    "updatedDate": datetime.now(timezone.utc)
                                }
                            }
                        )
                    
                    if fleet_id:
                        db["fleets"].update_one(
                            {"_id": fleet_id},
                            {"$set": {"status": original_fleet_status, "updatedAt": datetime.now(timezone.utc)}}
                        )

        logger.info("All pending migrations completed.")
    finally:
        if lock_acquired:
            try:
                db["migrations_lock"].delete_one({"lockId": "global_migration_lock"})
                logger.info("Successfully released database migration lock.")
            except Exception as e:
                logger.error(f"Error releasing migration lock: {e}")
