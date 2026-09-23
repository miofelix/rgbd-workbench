from __future__ import annotations

import hashlib
import secrets
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import Request
from fastapi.responses import RedirectResponse

COOKIE_NAME = "rgbd_session"
TOKEN_QUERY_NAME = "token"


class SessionAuth:
    def __init__(self, token: str | None = None) -> None:
        self.raw_token = token or secrets.token_urlsafe(32)
        self.token_hash = hashlib.sha256(self.raw_token.encode("utf-8")).digest()
        self.session_cookie = secrets.token_urlsafe(32)
        self.cookie_hash = hashlib.sha256(self.session_cookie.encode("utf-8")).digest()

    def _matches(self, supplied: str, expected_hash: bytes) -> bool:
        supplied_hash = hashlib.sha256(supplied.encode("utf-8")).digest()
        return secrets.compare_digest(supplied_hash, expected_hash)

    def valid_query_token(self, token: str | None) -> bool:
        return token is not None and self._matches(token, self.token_hash)

    def valid_cookie(self, cookie: str | None) -> bool:
        return cookie is not None and self._matches(cookie, self.cookie_hash)

    def exchange(self, request: Request) -> RedirectResponse | None:
        token = request.query_params.get(TOKEN_QUERY_NAME)
        if not self.valid_query_token(token):
            return None
        parts = urlsplit(str(request.url))
        filtered = [
            (key, value) for key, value in parse_qsl(parts.query) if key != TOKEN_QUERY_NAME
        ]
        location = urlunsplit(
            (parts.scheme, parts.netloc, parts.path, urlencode(filtered), parts.fragment)
        )
        response = RedirectResponse(url=location, status_code=303)
        response.set_cookie(
            COOKIE_NAME,
            self.session_cookie,
            httponly=True,
            samesite="strict",
            secure=False,
            path="/",
        )
        return response
