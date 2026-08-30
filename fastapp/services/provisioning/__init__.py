from .bihand_worker_strategy import BihandWorkerStrategy
from .base_strategy import BaseProvisioningStrategy
from .openclaw_strategy import OpenClawStrategy
from .nemoclaw_strategy import NemoClawStrategy
from .hermes_strategy import HermesStrategy
from .claude_code_strategy import ClaudeCodeStrategy
from .open_code_strategy import OpenCodeStrategy
from .codex_strategy import CodexStrategy

def get_provisioning_strategy(iteration: str) -> BaseProvisioningStrategy:
    iteration_lower = iteration.lower()
    if iteration_lower == "nemoclaw":
        return NemoClawStrategy()
    elif iteration_lower == "hermes":
        return HermesStrategy()
    elif iteration_lower == "claudecode" or iteration_lower == "claude-code":
        return ClaudeCodeStrategy()
    elif iteration_lower == "opencode":
        return OpenCodeStrategy()
    elif iteration_lower == "openclaw":
        return OpenClawStrategy()
    elif iteration_lower == "codex":
        return CodexStrategy()
    elif iteration_lower == "bihand":
        return BihandWorkerStrategy()
    
    # Default to Bihand Worker for any unrecognized fleet agents
    return BihandWorkerStrategy()
