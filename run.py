import logging
import os
import uvicorn

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# Use relative imports
from fastapp.controllers.healthController import healthCheckRouter
from fastapp.controllers.authController import authRouter
from fastapp.controllers.adminController import adminRouter
from fastapp.controllers.instanceController import instanceRouter
from fastapp.controllers.fleetController import fleetRouter

from fastapp.controllers.websocketController import wsRouter
from fastapp.controllers.hermesProxyController import hermesRouter
from fastapp.controllers.workController import workRouter
from fastapp.controllers.agentM2MController import agentM2MRouter
from fastapp.controllers.credentialController import credentialRouter
from fastapp.controllers.architectureController import architectureRouter
from fastapp.controllers.filmStudioController import filmStudioRouter
from fastapp.controllers.llmController import llmRouter
from fastapp.controllers.channelWebhookController import channelWebhookRouter
from fastapp.controllers.tradingStudioController import tradingStudioRouter
from fastapp.controllers.sandboxController import sandboxRouter
from fastapp.utils.errorHandler import register_error_handlers
from fastapp.utils.logger import setup_logging
from fastapp.database import init_db
from contextlib import asynccontextmanager
import asyncio
from datetime import datetime, timezone

load_dotenv(override=True)

PORT = int(os.environ.get("PORT", 8501))
NUMBER_OF_WORKERS = int(os.environ.get("NUMBER_OF_WORKERS", 1))
TIMEOUT_KEEP_ALIVE = int(os.environ.get("TIMEOUT_KEEP_ALIVE", 600))

# --- Logging Configuration ---
setup_logging()
logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Offload database initialization and migrations to a non-blocking background task.
    # This allows the lifespan context to yield instantly, opening Port 8501 
    # so GKE Readiness and Liveness probes succeed without timeout.
    async def startup_background_tasks():
        try:
            logger.info("Initializing database in background...")
            await asyncio.to_thread(init_db)
            logger.info("Database initialized successfully in background.")
            
            # Give the HTTP server a brief moment to stabilize
            await asyncio.sleep(1)
            logger.info("Starting background system migrations...")
            from fastapp.migrations import run_all_migrations
            # Run the blocking migration runner safely in an executor thread
            await asyncio.to_thread(run_all_migrations)
        except Exception as e:
            logger.error(f"Failed to initialize database or run migrations in background: {e}")

    asyncio.create_task(startup_background_tasks())
    yield
    # Shutdown logic (if any) could go here

# --- Create FastAPI App Instance ---
app = FastAPI(
    title="Bihand API", 
    description="One-click AI agent provisioning platform",
    lifespan=lifespan
)

# --- CORS Middleware ---
# To support allow_credentials=True, we cannot use the wildcard "*" for origins.
# Using allow_origin_regex allows reflection of origins dynamically, bypassing browser CORS blockers.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex="https?://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"
    return response

# --- Register error handlers ---
register_error_handlers(app)

# --- Include Routers ---
app.include_router(healthCheckRouter, prefix="/api/health")
app.include_router(credentialRouter, prefix="/api/credentials")
app.include_router(authRouter, prefix="/api/auth")
app.include_router(adminRouter, prefix="/api/admin")
app.include_router(instanceRouter, prefix="/api/instance")
app.include_router(fleetRouter, prefix="/api/fleets")
app.include_router(workRouter, prefix="/api/fleets")
app.include_router(agentM2MRouter, prefix="/api/internal")
app.include_router(channelWebhookRouter, prefix="/api/webhooks")
app.include_router(wsRouter, prefix="/api")
app.include_router(hermesRouter, prefix="/api")
app.include_router(architectureRouter, prefix="/api/architecture")
app.include_router(filmStudioRouter, prefix="/api/film-studio")
app.include_router(llmRouter, prefix="/api/llm")
app.include_router(tradingStudioRouter, prefix="/api/trading-studio")
app.include_router(sandboxRouter, prefix="/api/internal")

# --- Mount the static files ---
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend/dist")

# Only mount static files if the directory exists
if os.path.exists(os.path.join(FRONTEND_DIR, "assets")):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIR, "assets")), name="frontend-assets")

# Mount CSS/JS directories for vanilla setup
for folder in ["css", "js", "components"]:
    folder_path = os.path.join(FRONTEND_DIR, folder)
    if os.path.exists(folder_path):
        app.mount(f"/{folder}", StaticFiles(directory=folder_path), name=f"frontend-{folder}")

# --- Catch-All Route for SPA ---
# /admin is now handled by React Router in the catchall path

@app.get("/ide/{instance_id}")
def serve_ide_app(instance_id: str):
    from fastapp.models.instanceModel import InstanceModel
    from fastapi.responses import JSONResponse
    
    instance = InstanceModel._getById(instance_id)
    if not instance:
        return JSONResponse(status_code=404, content={"error": "Instance not found"})
        
    iteration = instance.get("iteration", "openclaw")
    
    if iteration == "hermes":
        ide_path = os.path.join(FRONTEND_DIR, "hermes_ide.html")
    else:
        ide_path = os.path.join(FRONTEND_DIR, "ide.html")
        
    if os.path.exists(ide_path):
        return FileResponse(ide_path)
    return JSONResponse(status_code=404, content={"error": f"{os.path.basename(ide_path)} not found"})

@app.get("/{catchall:path}")
def serve_frontend_app(request: Request):
    """
    Catch-all route to serve the frontend index.html.
    """
    from fastapi.responses import JSONResponse
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"})
    return JSONResponse(status_code=404, content={"error": "index.html not found"})

@app.get("/")
def serve_root_frontend():
    from fastapi.responses import JSONResponse
    index_path = os.path.join(FRONTEND_DIR, 'index.html')
    if os.path.exists(index_path):
        return FileResponse(index_path, headers={"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"})
    return JSONResponse(status_code=404, content={"message": "minerClaw API is running. Frontend not yet built."})

# --- Uvicorn Execution ---
if __name__ == "__main__":
    print("Starting Miner Claw Server with Uvicorn...")
    uvicorn.run("__main__:app", host="0.0.0.0", port=PORT, workers=NUMBER_OF_WORKERS, timeout_keep_alive=TIMEOUT_KEEP_ALIVE, log_level="debug")