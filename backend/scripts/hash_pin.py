"""CLI helper to hash a PIN for SITESNAP_PIN_HASH.

Usage:
    python -m backend.scripts.hash_pin
    (or inside the container)
    docker compose run --rm sitesnap python -m backend.scripts.hash_pin
"""
from __future__ import annotations

import getpass
import sys

from backend.app.auth import hash_pin


def main() -> int:
    print("SiteSnap PIN hasher")
    print("-------------------")
    pin = getpass.getpass("Enter a PIN (>= 4 chars): ")
    if len(pin) < 4:
        print("PIN too short.", file=sys.stderr)
        return 1
    pin2 = getpass.getpass("Confirm PIN: ")
    if pin != pin2:
        print("PINs do not match.", file=sys.stderr)
        return 1
    h = hash_pin(pin)
    print()
    print("Add this to your config/.env:")
    print(f"SITESNAP_PIN_HASH={h}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
