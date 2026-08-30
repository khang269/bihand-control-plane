import { useEffect, useState } from 'react';
import api from './api';

// localStorage Cache keys
const CACHE_KEY_PREFIX = 'avatar-url-cache-';
const SESSION_CACHE_LIFETIME_MS = 50 * 60 * 1000; // 50 minutes (signed GCS URLs expire in 1 hour)

// Layer 2 Session Memory cache: holds GCS signed URLs in-memory
const sessionVerifiedHashes = new Set<string>();
const sessionThumbUrls: Record<string, string> = {};
const sessionGlbUrls: Record<string, string> = {};

// In-flight request de-duplication registry
const inFlightRequests: Record<string, Promise<{ thumbnail: string; glb: string }>> = {};

export interface UseAvatarResult {
  thumbnailSrc: string | null;
  glbSrc: string | null;
  isLoading: boolean;
}

interface CacheEntry {
  thumbnail: string;
  glb: string;
  expiresAt: number;
}

export function useAvatar(hash: string | null | undefined): UseAvatarResult {
  const [thumbnailSrc, setThumbnailSrc] = useState<string | null>(
    (hash && sessionThumbUrls[hash]) || null
  );
  const [glbSrc, setGlbSrc] = useState<string | null>(
    (hash && sessionGlbUrls[hash]) || null
  );
  const [isLoading, setIsLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!hash) {
      setThumbnailSrc(null);
      setGlbSrc(null);
      setIsLoading(false);
      return;
    }

    const h = hash as string;
    let isMounted = true;

    // Set initial values from session cache if available (very important for rendering without lag)
    if (sessionThumbUrls[h]) {
      setThumbnailSrc(sessionThumbUrls[h]);
    }
    if (sessionGlbUrls[h]) {
      setGlbSrc(sessionGlbUrls[h]);
    }

    // Helper to get from localStorage
    function getCachedUrls(): CacheEntry | null {
      try {
        const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${h}`);
        if (!raw) return null;
        const entry: CacheEntry = JSON.parse(raw);
        if (Date.now() > entry.expiresAt) {
          localStorage.removeItem(`${CACHE_KEY_PREFIX}${h}`);
          return null;
        }
        return entry;
      } catch (e) {
        return null;
      }
    }

    // Helper to save to localStorage
    function setCachedUrls(thumbnail: string, glb: string) {
      try {
        const entry: CacheEntry = {
          thumbnail,
          glb,
          expiresAt: Date.now() + SESSION_CACHE_LIFETIME_MS
        };
        localStorage.setItem(`${CACHE_KEY_PREFIX}${h}`, JSON.stringify(entry));
      } catch (e) {
        // Fallback for storage limits
      }
    }

    async function loadAvatar() {
      // 1. Check in-memory session cache first (super high-speed)
      if (sessionVerifiedHashes.has(h) && sessionThumbUrls[h]) {
        if (isMounted) {
          setThumbnailSrc(sessionThumbUrls[h]);
          setGlbSrc(sessionGlbUrls[h] || null);
          setIsLoading(false);
        }
        return;
      }

      // 2. Check local/session storage cache
      const cached = getCachedUrls();
      if (cached) {
        sessionThumbUrls[h] = cached.thumbnail;
        sessionGlbUrls[h] = cached.glb;
        sessionVerifiedHashes.add(h);

        if (isMounted) {
          setThumbnailSrc(cached.thumbnail);
          setGlbSrc(cached.glb);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        // De-duplicate concurrent requests for the same hash
        if (!inFlightRequests[h]) {
          inFlightRequests[h] = api.get(`/avatar/signed-urls/${h}`).then(res => {
            return {
              thumbnail: res.data.thumbnail,
              glb: res.data.glb
            };
          });
        }

        const urls = await inFlightRequests[h];

        // Store GCS signed URLs in the session cache and localstorage
        sessionThumbUrls[h] = urls.thumbnail;
        sessionGlbUrls[h] = urls.glb;
        sessionVerifiedHashes.add(h);
        setCachedUrls(urls.thumbnail, urls.glb);

        if (isMounted) {
          setThumbnailSrc(urls.thumbnail);
          setGlbSrc(urls.glb);
        }
      } catch (err) {
        console.error('Failed to get GCS signed URLs:', err);
        // Fallback to backend redirect proxy if backend call fails
        if (isMounted) {
          setThumbnailSrc(`/api/avatar/thumbnail/${h}`);
          setGlbSrc(`/api/avatar/glb/${h}`);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
        delete inFlightRequests[h];
      }
    }

    loadAvatar();

    return () => {
      isMounted = false;
    };
  }, [hash]);

  return { thumbnailSrc, glbSrc, isLoading };
}
