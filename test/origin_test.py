#!/usr/bin/env python3
"""Same-origin checks for /ws (no WASM)."""

from __future__ import annotations

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402


class _H:
    def __init__(self, origin: str | None = None, host: str = "127.0.0.1:8001") -> None:
        self.headers: dict[str, str] = {"Host": host}
        if origin is not None:
            self.headers["Origin"] = origin


class OriginTests(unittest.TestCase):
    def test_missing_origin_allowed(self) -> None:
        self.assertTrue(server.origin_allowed(_H()))

    def test_same_host(self) -> None:
        self.assertTrue(server.origin_allowed(_H("http://127.0.0.1:8001")))

    def test_loopback_alias(self) -> None:
        self.assertTrue(server.origin_allowed(_H("http://localhost:8001")))
        self.assertTrue(
            server.origin_allowed(_H("http://127.0.0.1:8001", host="localhost:8001"))
        )

    def test_cross_origin_rejected(self) -> None:
        self.assertFalse(server.origin_allowed(_H("http://evil.example")))

    def test_null_origin_rejected(self) -> None:
        self.assertFalse(server.origin_allowed(_H("null")))

    def test_https_same_host(self) -> None:
        self.assertTrue(server.origin_allowed(_H("https://127.0.0.1")))


if __name__ == "__main__":
    unittest.main()
