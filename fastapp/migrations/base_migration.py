from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseMigration(ABC):
    @property
    @abstractmethod
    def version(self) -> str:
        """Return semantic version of the migration (e.g., '0.1.0')."""
        pass

    @property
    @abstractmethod
    def migration_id(self) -> str:
        """Unique ID for tracking, e.g., 'v0_1_0_gog_keyring'."""
        pass

    @abstractmethod
    def upgrade_db(self, db) -> bool:
        """Run database-level document upgrades."""
        pass

    @abstractmethod
    def upgrade_vm(self, db, instance: Dict[str, Any]) -> bool:
        """Run SSH hotpatches or service updates for a specific running VM."""
        pass
