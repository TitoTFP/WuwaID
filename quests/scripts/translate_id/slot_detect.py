"""Detect server-side parallelism (n_parallel) from a running llama-server.

Queries `GET {base_url}/slots` (a llama.cpp admin endpoint) and counts the
slot entries. On any error (404 on older versions, timeout, non-JSON), logs
a warning and returns a fallback default.
"""
from __future__ import annotations

import logging

import httpx

log = logging.getLogger(__name__)


async def detect_n_parallel(
    base_url: str,
    *,
    default: int = 4,
    timeout: float = 5.0,
) -> int:
    """Return the server's `n_parallel` slot count.

    Queries `GET {base_url}/slots` and returns `len(slots)`. If the request
    fails for any reason (404 on non-llama-server backends, timeout, malformed
    JSON), logs a warning and returns `default`.
    """
    url = base_url.rstrip("/") + "/slots"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                log.warning(
                    "/slots returned status %d; using default np=%d",
                    resp.status_code, default,
                )
                return default
            data = resp.json()
    except (httpx.HTTPError, OSError, ValueError) as e:
        log.warning("Could not detect n_parallel from %s: %s; using default np=%d", url, e, default)
        return default

    if not isinstance(data, list):
        log.warning("/slots response is not a list (got %s); using default np=%d", type(data).__name__, default)
        return default

    count = len(data)
    if count <= 0:
        log.warning("/slots returned empty list; using default np=%d", default)
        return default

    log.info("Detected server n_parallel=%d from %s", count, url)
    return count
