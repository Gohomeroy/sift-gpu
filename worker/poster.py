"""Stage 7: Social media posting — upload clips to connected platforms.

Polls for queued clip_posts, downloads the clip from Supabase storage,
and uploads to TikTok / YouTube / Instagram via their APIs.
"""

from __future__ import annotations

import json
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

import requests

import config


# ── Platform uploaders ──────────────────────────────────────────────────


def _upload_tiktok(
    video_path: Path,
    caption: str,
    access_token: str,
) -> dict[str, Any]:
    """Upload a video to TikTok via Video Kit API.

    Returns {"ok": True, "post_id": "...", "url": "..."} or
    {"ok": False, "error": "..."}.
    """
    # Step 1: Initialize upload.
    init_res = requests.post(
        "https://open.tiktokapis.com/v2/post/publish/video/init/",
        headers={"Authorization": f"Bearer {access_token}"},
        data={
            "post_info": json.dumps({
                "title": caption[:150],
                "privacy_level": "PUBLIC_TO_EVERYONE",
                "disable_duet": "false",
                "disable_comment": "false",
                "disable_stitch": "false",
            }),
            "source_info": "FILE_UPLOAD",
            "video_size": str(video_path.stat().st_size),
        },
        timeout=30,
    )
    init_data = init_res.json()

    if init_data.get("error", {}).get("code") != "ok":
        return {"ok": False, "error": init_data.get("error", {}).get("message", "init failed")}

    upload_url = init_data["data"].get("upload_url")
    publish_id = init_data["data"].get("publish_id")
    if not upload_url:
        return {"ok": False, "error": "No upload URL returned"}

    # Step 2: Upload the video file.
    with open(video_path, "rb") as f:
        upload_res = requests.put(
            upload_url,
            headers={
                "Content-Type": "video/mp4",
                "Content-Range": f"bytes 0-{video_path.stat().st_size - 1}/{video_path.stat().st_size}",
            },
            data=f,
            timeout=300,
        )

    if upload_res.status_code not in (200, 201):
        return {"ok": False, "error": f"Upload failed: {upload_res.status_code}"}

    # Step 3: Poll for processing completion.
    for _ in range(60):
        time.sleep(5)
        status_res = requests.get(
            f"https://open.tiktokapis.com/v2/post/publish/status/fetch/",
            headers={"Authorization": f"Bearer {access_token}"},
            data={"publish_id": publish_id},
            timeout=15,
        )
        status_data = status_res.json()
        status = status_data.get("data", {}).get("status")
        if status == "PUBLISH_COMPLETE":
            return {
                "ok": True,
                "post_id": publish_id,
                "url": f"https://www.tiktok.com/@/video/{publish_id}",
            }
        if status == "FAILED":
            return {"ok": False, "error": "TikTok processing failed"}

    return {"ok": False, "error": "TikTok processing timed out"}


def _upload_youtube(
    video_path: Path,
    caption: str,
    access_token: str,
) -> dict[str, Any]:
    """Upload a video to YouTube via Data API v3.

    Returns {"ok": True, "post_id": "...", "url": "..."} or
    {"ok": False, "error": "..."}.
    """
    # YouTube requires resumable upload.
    metadata = {
        "snippet": {
            "title": caption[:100] if caption else "SIFT clip",
            "description": caption,
            "tags": ["shorts", "fyp", "viral"],
            "categoryId": "22",  # People & Blogs
        },
        "status": {
            "privacyStatus": "public",
            "selfDeclaredMadeForKids": False,
        },
    }

    # Step 1: Init resumable upload.
    init_res = requests.post(
        "https://www.googleapis.com/upload/youtube/v3/videos"
        "?uploadType=resumable&part=snippet,status",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": str(video_path.stat().st_size),
        },
        json=metadata,
        timeout=30,
    )

    if init_res.status_code != 200:
        return {"ok": False, "error": f"YouTube init failed: {init_res.status_code}"}

    upload_url = init_res.headers.get("Location")
    if not upload_url:
        return {"ok": False, "error": "No upload URL returned"}

    # Step 2: Upload the video.
    with open(video_path, "rb") as f:
        upload_res = requests.put(
            upload_url,
            headers={
                "Content-Type": "video/mp4",
                "Content-Length": str(video_path.stat().st_size),
            },
            data=f,
            timeout=600,
        )

    if upload_res.status_code not in (200, 201):
        return {"ok": False, "error": f"YouTube upload failed: {upload_res.status_code}"}

    result = upload_res.json()
    video_id = result.get("id")
    if not video_id:
        return {"ok": False, "error": "No video ID returned"}

    return {
        "ok": True,
        "post_id": video_id,
        "url": f"https://youtube.com/shorts/{video_id}",
    }


def _upload_instagram(
    video_path: Path,
    caption: str,
    access_token: str,
) -> dict[str, Any]:
    """Upload a video to Instagram via Graph API (Reels).

    Returns {"ok": True, "post_id": "...", "url": "..."} or
    {"ok": False, "error": "..."}.
    """
    # Step 1: Create media container.
    container_res = requests.post(
        "https://graph.facebook.com/v19.0/me/media",
        data={
            "media_type": "REELS",
            "video_url": "",  # We need a public URL — use signed URL from storage.
            "caption": caption,
            "access_token": access_token,
        },
        timeout=30,
    )
    container_data = container_res.json()

    if container_data.get("error"):
        return {"ok": False, "error": container_data["error"].get("message", "container creation failed")}

    container_id = container_data.get("id")
    if not container_id:
        return {"ok": False, "error": "No container ID returned"}

    # Step 2: Wait for processing.
    for _ in range(120):
        time.sleep(5)
        status_res = requests.get(
            f"https://graph.facebook.com/v19.0/{container_id}",
            params={"fields": "status_code", "access_token": access_token},
            timeout=15,
        )
        status_data = status_res.json()
        status = status_data.get("status_code")
        if status == "FINISHED":
            break
        if status == "ERROR":
            return {"ok": False, "error": "Instagram processing failed"}

    # Step 3: Publish.
    publish_res = requests.post(
        "https://graph.facebook.com/v19.0/me/media_publish",
        data={
            "creation_id": container_id,
            "access_token": access_token,
        },
        timeout=30,
    )
    publish_data = publish_res.json()

    if publish_data.get("error"):
        return {"ok": False, "error": publish_data["error"].get("message", "publish failed")}

    media_id = publish_data.get("id")
    return {
        "ok": True,
        "post_id": media_id,
        "url": f"https://www.instagram.com/reel/{media_id}",
    }


# ── Token refresh ───────────────────────────────────────────────────────


def _refresh_youtube_token(refresh_token: str) -> dict[str, Any] | None:
    """Refresh an expired YouTube/Google access token."""
    try:
        res = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": config.GOOGLE_CLIENT_ID,
                "client_secret": config.GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=15,
        )
        data = res.json()
        if data.get("access_token"):
            return {
                "access_token": data["access_token"],
                "expires_in": data.get("expires_in", 3600),
            }
    except Exception:
        pass
    return None


# ── Public API ──────────────────────────────────────────────────────────


def post_clip(post: dict[str, Any], clip_path: Path) -> dict[str, Any]:
    """Post a clip to the specified platform.

    Returns {"ok": True/False, "post_id": ..., "url": ..., "error": ...}.
    """
    platform = post.get("platform", "")
    caption = post.get("caption") or ""
    hashtags = post.get("hashtags") or []

    # Append hashtags to caption.
    if hashtags:
        tag_str = " ".join(
            t if t.startswith("#") else f"#{t}" for t in hashtags
        )
        caption = f"{caption}\n\n{tag_str}".strip()

    account = post.get("account", {})
    access_token = account.get("oauth_access_token", "")

    if not access_token:
        return {"ok": False, "error": "No access token for this account"}

    # Refresh YouTube tokens if expired.
    if platform == "youtube" and account.get("oauth_refresh_token"):
        expires_at = account.get("oauth_expires_at")
        if expires_at:
            from datetime import datetime, timezone
            exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if exp < datetime.now(timezone.utc):
                refreshed = _refresh_youtube_token(account["oauth_refresh_token"])
                if refreshed:
                    access_token = refreshed["access_token"]
                    # Update token in DB.
                    import supabase_client as db
                    db.update_account_token(account["id"], access_token)

    if platform == "tiktok":
        return _upload_tiktok(clip_path, caption, access_token)
    elif platform == "youtube":
        return _upload_youtube(clip_path, caption, access_token)
    elif platform == "instagram":
        return _upload_instagram(clip_path, caption, access_token)
    else:
        return {"ok": False, "error": f"Unsupported platform: {platform}"}
