import os
import logging
import httpx
from fastapi import APIRouter, HTTPException, Depends, Response
from fastapi.responses import RedirectResponse
from fastapi.responses import StreamingResponse
from typing import List, Dict, Optional
from pydantic import BaseModel

from fastapp.controllers.authController import get_current_user

logger = logging.getLogger(__name__)

avatarRouter = APIRouter(tags=["3D Avatar / Sticker Service"])

STICKER_TOOL_BASE_URL = os.environ.get("STICKER_TOOL_BASE_URL", "").rstrip("/")  # optional external sticker-gen service, not included in this repo

AVATAR_LIBRARY = [
    {
        "hash": "620c0ba96c81d71ecf07747aef679105",
        "title": "Corporate Executive (Male)",
        "description": "A sharp-dressed, realistic Caucasian male figure in a professional navy/charcoal suit, white dress shirt, and tie."
    },
    {
        "hash": "caf5c8dff44e17c9b22809bd2c7a77ea",
        "title": "Stylized Corporate Worker (Female)",
        "description": "A stylish, stylized female character base mesh in a neutral pose, suitable for developers and team members."
    },
    {
        "hash": "99d68008c17ea62c9c497582b58dc8b3",
        "title": "Autonomous Agent Bot",
        "description": "A friendly, stylized robot avatar featuring a smooth, light blue and white palette. Ideal for virtual agent roles."
    },
    {
        "hash": "501abdec4a83907457845bcb3ab65a40",
        "title": "Security & Guard Officer",
        "description": "Depicted in a compelling police officer uniform render, embodying security, quality assurance, and organizational discipline."
    },
    {
        "hash": "eb83485103d58cf2e2e4f7c8eae0946a",
        "title": "Construction Builder",
        "description": "A LEGO-style construction worker minifigure, perfect for builders, infra engineers, and general developers."
    },
    {
        "hash": "c7d4c6988fd0c8db40b1d823f07ae50d",
        "title": "Vi (Young Zaunite)",
        "description": "A spirited and protective older sister to Powder, living in the Undercity. Known for her fighting skills and loyalty to her family and friends."
    },
    {
        "hash": "40dbf4fb6d0598e7ad85bce7790bb85d",
        "title": "Vi (Piltover Enforcer)",
        "description": "After being imprisoned, she returns as an ally to Caitlyn, fighting crime in both Piltover and Zaun. She is known for her powerful gauntlets and her unwavering determination to protect those she cares about."
    },
    {
        "hash": "6b9b06eaa1b127eced0221b1dcd4ac08",
        "title": "Powder (Young Zaunite)",
        "description": "Vi's younger sister, a gifted but insecure inventor who struggles with self-doubt and accidental destruction. She yearns to be useful to her family."
    },
    {
        "hash": "3b5aacee114b63215652e6698b281751",
        "title": "Jinx",
        "description": "The transformed Powder, a highly unstable, chaotic, and dangerous criminal and enforcer for Silco. She is obsessed with explosives, causing mayhem, and struggles with her past and a fractured psyche."
    },
    {
        "hash": "2684be83086c15b3845ee8036086a5b1",
        "title": "Caitlyn Kiramman (Young Piltover Heiress)",
        "description": "A determined and intelligent young woman from a wealthy Piltover family, aspiring to be an Enforcer despite her parents' wishes, driven by a strong sense of justice."
    },
    {
        "hash": "ad1256c9e05a652a57b26dd7feec6132",
        "title": "Caitlyn Kiramman (Piltover Enforcer)",
        "description": "A skilled marksman who becomes an Enforcer, dedicated to justice and investigating the crime in Zaun, often partnering with Vi. She seeks to uncover the truth behind the Undercity's unrest."
    },
    {
        "hash": "e96f7487c2898b921b2df9f2184799dd",
        "title": "Viktor (Young Zaunite Scientist)",
        "description": "A brilliant and ambitious scientist from Zaun, working alongside Jayce to develop hextech. He is driven by a desire to overcome his physical ailments and improve the lives of Zaunites."
    },
    {
        "hash": "75880708a21ff0d4238e2b02bab682f6",
        "title": "Viktor (Augmented Scientist)",
        "description": "After struggling with his deteriorating health, he begins to experiment with forbidden hextech augmentation on himself, leading to a darker path and significant physical changes as he seeks to transcend human limitations."
    },
    {
        "hash": "4fafebb402baef320e4e7329278a0920",
        "title": "Mel Medarda (Piltover Councilor)",
        "description": "An ambitious and politically astute Councilor from Piltover, originally from Noxus, who manipulates events to her advantage and mentors Jayce. She is a master strategist and negotiator."
    },
    {
        "hash": "536d88c2dee3897a7946b277766fb8c0",
        "title": "Ekko (Leader of the Firelights)",
        "description": "A charismatic and skilled leader of the Firelights, a group dedicated to protecting Zaun from Silco's influence. He uses his Z-Drive to manipulate time in combat."
    },
    {
        "hash": "8503f69fc352dbf26d415cf7047eabdc",
        "title": "Heimerdinger (Venerable Councilor)",
        "description": "A brilliant and ancient Yordle professor and a founding member of the Piltover Council, deeply traditional and wary of rapid technological advancement, often clashing with Jayce."
    },
    {
        "hash": "07374c212e96b5405500c44d60aa10b5",
        "title": "Sevika",
        "description": "Silco's loyal and formidable enforcer, known for her enhanced arm and unwavering dedication to her boss. She is a powerful fighter and a key figure in Zaun's underworld."
    },
    {
        "hash": "84b2eecadf4e6642be3343bbcf470a9e",
        "title": "Marcus (Piltover Enforcer/Sheriff)",
        "description": "A corrupt Piltover Enforcer who becomes Sheriff, secretly working with Silco. He is driven by fear and ambition, often making morally questionable decisions."
    },
    {
        "hash": "29b05cc51ff9adf4c9c57c5c71c7b124",
        "title": "Ambessa Medarda (Noxian Warlord)",
        "description": "Mel Medarda's powerful and imposing mother, a warlord from Noxus who visits Piltover seeking alliances and resources. She is a pragmatic and ruthless leader."
    }
]

@avatarRouter.get("/library", summary="Get 3D avatar libraries (existing hashes)")
async def get_avatar_library(auth_payload: dict = Depends(get_current_user)):
    """Return the available 3D humanoid avatar models with titles and descriptions."""
    return {"library": AVATAR_LIBRARY}

@avatarRouter.get("/get/{hash}", summary="Get 3D avatar metadata details (proxied)")
async def get_avatar_details(hash: str):
    """Retrieve full sticker/avatar metadata including updatedDate from the sticker service."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(f"{STICKER_TOOL_BASE_URL}/api/3d-sticker/get/{hash}")
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to get avatar details")
            return resp.json()
        except Exception as e:
            logger.error(f"Error getting avatar details for {hash}: {e}")
            raise HTTPException(status_code=500, detail=str(e))

@avatarRouter.get("/signed-urls/{hash}", summary="Get GCS signed URLs for thumbnail and GLB")
async def get_avatar_signed_urls(hash: str):
    """Fetch the GCS signed URLs directly from the sticker tool so the frontend can download them directly."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(f"{STICKER_TOOL_BASE_URL}/api/3d-sticker/download/signed-url/glb/{hash}")
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to get avatar signed URLs")
            
            data = resp.json()
            signed_urls = data.get("signedUrls", {})
            return {
                "thumbnail": signed_urls.get("thumbnail"),
                "glb": signed_urls.get("glb")
            }
        except Exception as e:
            logger.error(f"Error getting signed URLs for {hash}: {e}")
            raise HTTPException(status_code=500, detail=str(e))

@avatarRouter.get("/thumbnail/{hash}", summary="Get 3D avatar thumbnail (redirected)")
async def get_avatar_thumbnail(hash: str):
    """Redirect to GCS signed URL directly."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(f"{STICKER_TOOL_BASE_URL}/api/3d-sticker/download/signed-url/glb/{hash}")
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to get avatar signed URLs")
            
            data = resp.json()
            thumbnail_url = data.get("signedUrls", {}).get("thumbnail")
            if not thumbnail_url:
                raise HTTPException(status_code=404, detail="Avatar thumbnail URL not found")
            return RedirectResponse(url=thumbnail_url, status_code=307)
        except Exception as e:
            logger.error(f"Error redirecting thumbnail for {hash}: {e}")
            raise HTTPException(status_code=500, detail=str(e))

@avatarRouter.get("/glb/{hash}", summary="Get 3D GLB model binary (redirected)")
async def get_avatar_glb(hash: str):
    """Redirect to GCS signed URL directly."""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(f"{STICKER_TOOL_BASE_URL}/api/3d-sticker/download/signed-url/glb/{hash}")
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail="Failed to get avatar signed URLs")
            
            data = resp.json()
            glb_url = data.get("signedUrls", {}).get("glb")
            if not glb_url:
                raise HTTPException(status_code=404, detail="GLB model URL not found")
            return RedirectResponse(url=glb_url, status_code=307)
        except Exception as e:
            logger.error(f"Error redirecting GLB for {hash}: {e}")
            raise HTTPException(status_code=500, detail=str(e))
