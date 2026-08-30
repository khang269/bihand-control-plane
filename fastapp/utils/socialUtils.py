import logging
import requests
import mimetypes
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List

logger = logging.getLogger(__name__)

def _collect_media(image_url: Optional[str] = None, video_url: Optional[str] = None, media_urls: Optional[List[str]] = None) -> List[Dict[str, str]]:
    collected = []
    if image_url:
        collected.append({"url": image_url, "type": "image"})
    if video_url:
        collected.append({"url": video_url, "type": "video"})
    if media_urls:
        for m in media_urls:
            if not m or not isinstance(m, str):
                continue
            # Deduplicate
            if any(c["url"] == m for c in collected):
                continue
            # Simple extension guess
            if any(ext in m.lower() for ext in ['.mp4', '.mov', '.avi', '.m4v', '.mkv']):
                collected.append({"url": m, "type": "video"})
            elif any(ext in m.lower() for ext in ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.zip', '.csv']):
                collected.append({"url": m, "type": "document"})
            else:
                collected.append({"url": m, "type": "image"})
    return collected

def post_to_reddit(creds: Dict[str, Any], text: str, image_url: Optional[str] = None, video_url: Optional[str] = None, media_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Posts text and media to Reddit.
    Credentials: { "client_id": "...", "client_secret": "...", "username": "...", "password": "...", "user_agent": "...", "subreddit": "..." }
    """
    client_id = creds.get("client_id")
    client_secret = creds.get("client_secret")
    username = creds.get("username")
    password = creds.get("password")
    user_agent = creds.get("user_agent") or f"BihandAgent/1.0 by /u/{username or 'unknown'}"
    subreddit = creds.get("subreddit") or (f"u_{username}" if username else "test")
    
    if not client_id or not client_secret or not username or not password:
        return {"success": False, "error": "Missing Reddit credentials (client_id, client_secret, username, password)"}
        
    try:
        # Step 1: Authenticate to get OAuth2 access token
        auth = requests.auth.HTTPBasicAuth(client_id, client_secret)
        headers = {"User-Agent": user_agent}
        data = {
            "grant_type": "password",
            "username": username,
            "password": password
        }
        
        token_resp = requests.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=auth,
            data=data,
            headers=headers,
            timeout=15
        )
        if token_resp.status_code >= 400:
            return {"success": False, "error": f"Reddit auth failed: {token_resp.text}"}
            
        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            return {"success": False, "error": f"Failed to retrieve access token from Reddit: {token_resp.text}"}
            
        # Step 2: Submit the post
        # Extract title from the first line or first few characters
        first_line = text.split('\n')[0].strip() if text else ""
        title = creds.get("title") or (first_line[:80] + ("..." if len(first_line) > 80 else "")) or "Autonomous Agent Update"
        
        # Format the markdown with media attachments
        media = _collect_media(image_url, video_url, media_urls)
        body = text
        if media:
            body += "\n\n---"
            for m in media:
                if m["type"] == "video":
                    body += f"\n\n🎥 [Watch Video Clip]({m['url']})"
                else:
                    body += f"\n\n🖼️ ![Image Attachment]({m['url']})"
                    
        submit_headers = {
            "Authorization": f"Bearer {access_token}",
            "User-Agent": user_agent
        }
        submit_data = {
            "sr": subreddit,
            "title": title,
            "kind": "self",
            "text": body
        }
        
        submit_resp = requests.post(
            "https://oauth.reddit.com/api/submit",
            headers=submit_headers,
            data=submit_data,
            timeout=15
        )
        if submit_resp.status_code >= 400:
            return {"success": False, "error": f"Reddit submission failed: {submit_resp.text}"}
            
        return {"success": True, "result": submit_resp.json()}
    except Exception as e:
        return {"success": False, "error": str(e)}

def post_to_facebook(creds: Dict[str, Any], text: str, image_url: Optional[str] = None, video_url: Optional[str] = None, media_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Posts text, images, and video clips to a Facebook Page.
    Credentials: { "page_id": "...", "access_token": "..." }
    """
    page_id = creds.get("page_id")
    access_token = creds.get("access_token") or creds.get("apiKey")
    
    if not page_id or not access_token:
        return {"success": False, "error": "Missing Facebook page_id or access_token"}
        
    try:
        media_all = _collect_media(image_url, video_url, media_urls)
        
        # Keep only visual types (images/videos) for publishing to the Facebook Page visual feed.
        # Any document or PDF files in media_urls are safely filtered out of the visual upload arrays
        # (as the agent is responsible for deciding and formatting their links inside the post text directly).
        media = [item for item in media_all if item["type"] in ("image", "video")]
        
        # Case 1: Simple text only post
        if not media:
            url = f"https://graph.facebook.com/v20.0/{page_id}/feed"
            post_resp = requests.post(
                url,
                json={"message": text, "access_token": access_token},
                timeout=15
            )
            if post_resp.status_code >= 400:
                return {"success": False, "error": f"Failed to post to Facebook Page: {post_resp.text}"}
            return {"success": True, "result": post_resp.json()}
            
        # Case 2: Exactly one photo
        if len(media) == 1 and media[0]["type"] == "image":
            url = f"https://graph.facebook.com/v20.0/{page_id}/photos"
            post_resp = requests.post(
                url,
                json={"url": media[0]["url"], "caption": text, "access_token": access_token},
                timeout=15
            )
            if post_resp.status_code >= 400:
                return {"success": False, "error": f"Failed to post photo to Facebook: {post_resp.text}"}
            return {"success": True, "result": post_resp.json()}
            
        # Case 3: Exactly one video
        if len(media) == 1 and media[0]["type"] == "video":
            url = f"https://graph.facebook.com/v20.0/{page_id}/videos"
            post_resp = requests.post(
                url,
                json={"file_url": media[0]["url"], "description": text, "access_token": access_token},
                timeout=15
            )
            if post_resp.status_code >= 400:
                return {"success": False, "error": f"Failed to post video to Facebook: {post_resp.text}"}
            return {"success": True, "result": post_resp.json()}
            
        # Case 4: Multiple/Mixed media attachments (unpublished uploads first, then bulk publish)
        attached_media = []
        for item in media:
            if item["type"] == "video":
                upload_url = f"https://graph.facebook.com/v20.0/{page_id}/videos"
                payload = {"file_url": item["url"], "published": False, "access_token": access_token}
            else:
                upload_url = f"https://graph.facebook.com/v20.0/{page_id}/photos"
                payload = {"url": item["url"], "published": False, "access_token": access_token}
                
            resp = requests.post(upload_url, json=payload, timeout=20)
            if resp.status_code >= 400:
                return {"success": False, "error": f"Failed to upload media item: {resp.text}"}
                
            media_id = resp.json().get("id")
            if media_id:
                attached_media.append({"media_fbid": str(media_id)})
                
        # Publish bulk post
        feed_url = f"https://graph.facebook.com/v20.0/{page_id}/feed"
        feed_resp = requests.post(
            feed_url,
            json={
                "message": text,
                "attached_media": attached_media,
                "access_token": access_token
            },
            timeout=15
        )
        if feed_resp.status_code >= 400:
            return {"success": False, "error": f"Failed to publish multi-media post to Facebook feed: {feed_resp.text}"}
            
        return {"success": True, "result": feed_resp.json()}
    except Exception as e:
        return {"success": False, "error": str(e)}

def post_to_instagram(creds: Dict[str, Any], text: str, image_url: Optional[str] = None, video_url: Optional[str] = None, media_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Posts content to Instagram Business account (Supports single image, single video, or carousel).
    Credentials: { "instagram_business_id": "...", "access_token": "..." }
    """
    ig_id = creds.get("instagram_business_id") or creds.get("instagram_actor_id")
    access_token = creds.get("access_token") or creds.get("apiKey")
    
    if not ig_id or not access_token:
        return {"success": False, "error": "Missing Instagram Business ID or access_token"}
        
    try:
        media_all = _collect_media(image_url, video_url, media_urls)
        
        # Keep only visual types (images/videos) for publishing to Instagram.
        # Any document or PDF files in media_urls are safely filtered out of the visual upload arrays
        # (as the agent is responsible for deciding and formatting their links inside the post text directly).
        media = [item for item in media_all if item["type"] in ("image", "video")]
        
        # Instagram requires at least one media item. Default to a placeholder if none exists.
        if not media:
            media = [{"url": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800", "type": "image"}]
            
        # Case 1: Single image
        if len(media) == 1 and media[0]["type"] == "image":
            init_resp = requests.post(
                f"https://graph.facebook.com/v20.0/{ig_id}/media",
                json={"image_url": media[0]["url"], "caption": text, "access_token": access_token},
                timeout=15
            )
            if init_resp.status_code >= 400:
                return {"success": False, "error": f"Instagram image container creation failed: {init_resp.text}"}
            creation_id = init_resp.json().get("id")
            
        # Case 2: Single video
        elif len(media) == 1 and media[0]["type"] == "video":
            init_resp = requests.post(
                f"https://graph.facebook.com/v20.0/{ig_id}/media",
                json={"video_url": media[0]["url"], "media_type": "VIDEO", "caption": text, "access_token": access_token},
                timeout=20
            )
            if init_resp.status_code >= 400:
                return {"success": False, "error": f"Instagram video container creation failed: {init_resp.text}"}
            creation_id = init_resp.json().get("id")
            
        # Case 3: Multiple items (Carousel of up to 10 items)
        else:
            children_ids = []
            for item in media[:10]: # Instagram limit is 10 items
                if item["type"] == "video":
                    payload = {"video_url": item["url"], "media_type": "VIDEO", "is_carousel_item": True, "access_token": access_token}
                else:
                    payload = {"image_url": item["url"], "is_carousel_item": True, "access_token": access_token}
                    
                item_resp = requests.post(
                    f"https://graph.facebook.com/v20.0/{ig_id}/media",
                    json=payload,
                    timeout=20
                )
                if item_resp.status_code >= 400:
                    return {"success": False, "error": f"Instagram carousel item creation failed: {item_resp.text}"}
                child_id = item_resp.json().get("id")
                if child_id:
                    children_ids.append(child_id)
                    
            # Create Carousel container
            carousel_resp = requests.post(
                f"https://graph.facebook.com/v20.0/{ig_id}/media",
                json={
                    "media_type": "CAROUSEL",
                    "children": children_ids,
                    "caption": text,
                    "access_token": access_token
                },
                timeout=15
            )
            if carousel_resp.status_code >= 400:
                return {"success": False, "error": f"Instagram carousel container creation failed: {carousel_resp.text}"}
            creation_id = carousel_resp.json().get("id")
            
        # Step 2: Publish container
        pub_resp = requests.post(
            f"https://graph.facebook.com/v20.0/{ig_id}/media_publish",
            json={"creation_id": creation_id, "access_token": access_token},
            timeout=15
        )
        if pub_resp.status_code >= 400:
            return {"success": False, "error": f"Instagram publish failed: {pub_resp.text}"}
            
        return {"success": True, "result": pub_resp.json()}
    except Exception as e:
        return {"success": False, "error": str(e)}

def post_to_threads(creds: Dict[str, Any], text: str, image_url: Optional[str] = None, video_url: Optional[str] = None, media_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Posts text threads to Instagram Threads.
    Credentials: { "threads_user_id": "...", "access_token": "..." }
    """
    threads_id = creds.get("threads_user_id")
    access_token = creds.get("access_token") or creds.get("apiKey")
    
    if not threads_id or not access_token:
        return {"success": False, "error": "Missing Threads threads_user_id or access_token"}
        
    try:
        # Step 1: Create media container
        init_resp = requests.post(
            f"https://graph.threads.net/v1.0/{threads_id}/threads",
            json={"media_type": "TEXT", "text": text, "access_token": access_token},
            timeout=15
        )
        if init_resp.status_code >= 400:
            return {"success": False, "error": f"Threads container creation failed: {init_resp.text}"}
            
        creation_id = init_resp.json().get("id")
        
        # Step 2: Publish
        pub_resp = requests.post(
            f"https://graph.threads.net/v1.0/{threads_id}/threads_publish",
            json={"creation_id": creation_id, "access_token": access_token},
            timeout=15
        )
        if pub_resp.status_code >= 400:
            return {"success": False, "error": f"Threads publish failed: {pub_resp.text}"}
            
        return {"success": True, "result": pub_resp.json()}
    except Exception as e:
        return {"success": False, "error": str(e)}

def post_to_linkedin(creds: Dict[str, Any], text: str, image_url: Optional[str] = None, video_url: Optional[str] = None, media_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Posts text updates to LinkedIn.
    Credentials: { "author_id": "urn:li:person:abcdef", "access_token": "..." }
    """
    author = creds.get("author_id") or "urn:li:person:unknown"
    access_token = creds.get("access_token") or creds.get("apiKey")
    
    if not access_token:
        return {"success": False, "error": "Missing LinkedIn access token"}
        
    try:
        # Respect the agent's decided text content and do not perform any automatic formatting or link appending
        media = _collect_media(image_url, video_url, media_urls)
        # Retrieve actual author URN if not present
        if author == "urn:li:person:unknown":
            me_resp = requests.get(
                "https://api.linkedin.com/v2/me",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10
            )
            if me_resp.status_code < 400:
                author = f"urn:li:person:{me_resp.json().get('id')}"
                
        payload = {
            "author": author,
            "commentary": text,
            "visibility": "PUBLIC",
            "distribution": {
                "feedDistribution": "MAIN_FEED",
                "targetEntities": []
            },
            "lifecycleState": "PUBLISHED"
        }
        
        post_resp = requests.post(
            "https://api.linkedin.com/v2/posts",
            headers={
                "Authorization": f"Bearer {access_token}",
                "X-Restli-Protocol-Version": "2.0.0",
                "Content-Type": "application/json"
            },
            json=payload,
            timeout=15
        )
        if post_resp.status_code >= 400:
            return {"success": False, "error": f"LinkedIn posting failed: {post_resp.text}"}
            
        return {"success": True, "result": post_resp.headers.get("x-restli-id", "success")}
    except Exception as e:
        return {"success": False, "error": str(e)}

def get_media_type_and_category(url: str):
    mime_type, _ = mimetypes.guess_type(url)
    if not mime_type:
        if any(ext in url.lower() for ext in ['.mp4', '.mov', '.avi', '.m4v', '.mkv']):
            mime_type = 'video/mp4'
        elif any(ext in url.lower() for ext in ['.gif']):
            mime_type = 'image/gif'
        else:
            mime_type = 'image/jpeg'
            
    if mime_type.startswith('video/'):
        return mime_type, 'tweet_video'
    elif mime_type == 'image/gif':
        return mime_type, 'tweet_gif'
    else:
        return mime_type, 'tweet_image'

def upload_media_to_x(auth, media_url: str) -> Optional[str]:
    try:
        resp = requests.get(media_url, timeout=30)
        if resp.status_code >= 400:
            logger.error(f"Failed to download media from {media_url}: {resp.status_code}")
            return None
        media_data = resp.content
        total_bytes = len(media_data)
        
        mime_type, media_category = get_media_type_and_category(media_url)
        
        # Step 1: INIT
        init_data = {
            "command": "INIT",
            "total_bytes": str(total_bytes),
            "media_type": mime_type,
            "media_category": media_category
        }
        init_resp = requests.post(
            "https://upload.twitter.com/1.1/media/upload.json",
            auth=auth,
            data=init_data,
            timeout=15
        )
        if init_resp.status_code >= 400:
            logger.error(f"X Media INIT failed: {init_resp.text}")
            return None
            
        media_id = init_resp.json().get("media_id_string")
        if not media_id:
            return None
            
        # Step 2: APPEND
        chunk_size = 1024 * 1024
        segment_index = 0
        for i in range(0, total_bytes, chunk_size):
            chunk = media_data[i:i + chunk_size]
            append_data = {
                "command": "APPEND",
                "media_id": media_id,
                "segment_index": str(segment_index)
            }
            files = {
                "media": chunk
            }
            append_resp = requests.post(
                "https://upload.twitter.com/1.1/media/upload.json",
                auth=auth,
                data=append_data,
                files=files,
                timeout=30
            )
            if append_resp.status_code >= 400:
                logger.error(f"X Media APPEND failed at segment {segment_index}: {append_resp.text}")
                return None
            segment_index += 1
            
        # Step 3: FINALIZE
        finalize_data = {
            "command": "FINALIZE",
            "media_id": media_id
        }
        finalize_resp = requests.post(
            "https://upload.twitter.com/1.1/media/upload.json",
            auth=auth,
            data=finalize_data,
            timeout=15
        )
        if finalize_resp.status_code >= 400:
            logger.error(f"X Media FINALIZE failed: {finalize_resp.text}")
            return None
            
        # Step 4: STATUS check for videos
        if media_category == 'tweet_video':
            import time
            for _ in range(12):
                status_resp = requests.get(
                    "https://upload.twitter.com/1.1/media/upload.json",
                    auth=auth,
                    params={"command": "STATUS", "media_id": media_id},
                    timeout=10
                )
                if status_resp.status_code < 400:
                    status_data = status_resp.json()
                    processing_info = status_data.get("processing_info", {})
                    state = processing_info.get("state")
                    if state == "succeeded":
                        break
                    elif state == "failed":
                        logger.error(f"X Media processing failed: {status_data}")
                        return None
                    check_after_secs = processing_info.get("check_after_secs", 5)
                    time.sleep(check_after_secs)
                else:
                    logger.error(f"X Media STATUS check failed: {status_resp.text}")
                    break
                    
        return media_id
    except Exception as e:
        logger.error(f"Exception during X media upload: {e}")
        return None

def post_to_x(creds: Dict[str, Any], text: str, image_url: Optional[str] = None, video_url: Optional[str] = None, media_urls: Optional[List[str]] = None) -> Dict[str, Any]:
    """
    Posts status and media to X (Twitter) using OAuth 1.0a or API Key (v2).
    Credentials: { "consumer_key": "...", "consumer_secret": "...", "access_token": "...", "access_token_secret": "..." }
    """
    from requests_oauthlib import OAuth1
    
    ck = creds.get("consumer_key")
    cs = creds.get("consumer_secret")
    at = creds.get("access_token")
    ats = creds.get("access_token_secret")
    
    if not ck or not cs or not at or not ats:
        return {"success": False, "error": "Missing X OAuth keys (consumer_key, consumer_secret, access_token, access_token_secret)"}
        
    try:
        auth = OAuth1(ck, cs, at, ats)
        media_all = _collect_media(image_url, video_url, media_urls)
        
        # Keep only visual types (images/videos) for publishing to X.
        # Any document or PDF files in media_urls are safely filtered out of the visual upload arrays
        # (as the agent is responsible for deciding and formatting their links inside the post text directly).
        media = [item for item in media_all if item["type"] in ("image", "video")]
        
        payload = {"text": text}
        if media:
            media_ids = []
            for item in media[:4]: # X limits standard tweets to 4 photos, or 1 GIF/video
                media_id = upload_media_to_x(auth, item["url"])
                if media_id:
                    media_ids.append(media_id)
            if media_ids:
                payload["media"] = {"media_ids": media_ids}
                
        resp = requests.post(
            "https://api.twitter.com/2/tweets",
            auth=auth,
            json=payload,
            timeout=20
        )
        if resp.status_code >= 400:
            return {"success": False, "error": f"X posting failed: {resp.text}"}
            
        return {"success": True, "result": resp.json()}
    except Exception as e:
        return {"success": False, "error": str(e)}

def post_messenger_reply(creds: Dict[str, Any], recipient_id: str, text: str) -> Dict[str, Any]:
    """
    Sends a direct reply to a specific customer thread via the Messenger Send API.
    Distinct from post_to_facebook (which publishes to the Page's public feed) - this sends
    a private message to one person and requires the recipient's PSID (page-scoped ID) from
    the inbound webhook event, not a page_id-only credential.
    Credentials: { "page_id": "...", "access_token": "..." }
    """
    access_token = creds.get("access_token") or creds.get("apiKey")
    if not access_token:
        return {"success": False, "error": "Missing Facebook Page access_token"}
    if not recipient_id:
        return {"success": False, "error": "Missing Messenger recipient_id (PSID)"}

    try:
        url = "https://graph.facebook.com/v20.0/me/messages"
        resp = requests.post(
            url,
            json={
                "recipient": {"id": recipient_id},
                "message": {"text": text},
                "messaging_type": "RESPONSE",
                "access_token": access_token,
            },
            timeout=15,
        )
        if resp.status_code >= 400:
            return {"success": False, "error": f"Messenger reply failed: {resp.text}"}
        return {"success": True, "result": resp.json()}
    except Exception as e:
        return {"success": False, "error": str(e)}


def post_zalo_reply(creds: Dict[str, Any], recipient_id: str, text: str) -> Dict[str, Any]:
    """
    Sends a direct reply to a specific customer thread via the Zalo OA Send Message API.
    Credentials: { "oa_id": "...", "access_token": "..." }

    NOTE: Zalo's OA send-message endpoint/schema and interaction-window rules should be
    verified against current Zalo OA API docs before this goes live in production - written
    against the general v3.0 customer-service-message shape, not confirmed against a live
    test send in this session.
    """
    access_token = creds.get("access_token") or creds.get("apiKey")
    if not access_token:
        return {"success": False, "error": "Missing Zalo OA access_token"}
    if not recipient_id:
        return {"success": False, "error": "Missing Zalo recipient user_id"}

    try:
        url = "https://openapi.zalo.me/v3.0/oa/message/cs"
        resp = requests.post(
            url,
            headers={"access_token": access_token, "Content-Type": "application/json"},
            json={
                "recipient": {"user_id": recipient_id},
                "message": {"text": text},
            },
            timeout=15,
        )
        if resp.status_code >= 400:
            return {"success": False, "error": f"Zalo reply failed: {resp.text}"}
        result = resp.json()
        if isinstance(result, dict) and result.get("error", 0) not in (0, None):
            return {"success": False, "error": f"Zalo reply failed: {result}"}
        return {"success": True, "result": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


def post_to_social(
    platform: str,
    creds: Dict[str, Any],
    text: str,
    image_url: Optional[str] = None,
    video_url: Optional[str] = None,
    media_urls: Optional[List[str]] = None
) -> Dict[str, Any]:
    """
    Universal social media posting router.
    """
    p_lower = platform.lower()
    if p_lower == "reddit":
        return post_to_reddit(creds, text, image_url, video_url, media_urls)
    elif p_lower == "facebook":
        return post_to_facebook(creds, text, image_url, video_url, media_urls)
    elif p_lower == "instagram":
        return post_to_instagram(creds, text, image_url, video_url, media_urls)
    elif p_lower == "threads":
        return post_to_threads(creds, text, image_url, video_url, media_urls)
    elif p_lower == "linkedin":
        return post_to_linkedin(creds, text, image_url, video_url, media_urls)
    elif p_lower == "x" or p_lower == "twitter":
        return post_to_x(creds, text, image_url, video_url, media_urls)
    else:
        return {"success": False, "error": f"Unsupported platform: {platform}"}
