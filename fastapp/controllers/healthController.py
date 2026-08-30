import logging
import asyncio
from fastapi import APIRouter, Depends, HTTPException, status, Header # Added Header
from typing import Optional, List, Dict, Any
from datetime import datetime

from fastapp.database import get_db

# Create blueprint
logger = logging.getLogger(__name__)
healthCheckRouter = APIRouter()

@healthCheckRouter.get('')
async def health_check():
    """Health check endpoint."""
    try:
        # Perform a fast database ping with a very short timeout to check connectivity safely in a separate thread.
        # GKE Liveness probes are aggressive. If MongoDB dns handshake stalls or under heavy loads,
        # standard pings without timeouts can easily exceed liveness probe limits, causing GKE to falsely kill/restart containers.
        db = get_db()
        await asyncio.to_thread(db.command, 'ping', maxTimeMS=2000)
        
        return {
            'status': 'success',
            'message': 'Service is healthy'
        }
    except Exception as e:
        logger.error(f"Unexpected error during health check: {e}", exc_info=True)
        # Even if DB check temporarily stalls, return a degraded 200 SUCCESS during transient load.
        # This keeps the FastAPI web server online and prevents GKE liveness probes from triggering infinite container crashloops.
        return {
            'status': 'degraded',
            'message': f'Service degraded: {str(e)}'
        }