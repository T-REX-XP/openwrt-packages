#!/usr/bin/env python3
"""afterFileEdit: ucode -c on *.uc when the host has ucode."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj) + "\n")


def main() -> None:
    try:
        payload = json.load(sys.stdin)
    except Exception:
        emit({})
        return

    path = str(payload.get("file_path") or "")
    if not path.endswith(".uc"):
        emit({})
        return

    ucode = shutil.which("ucode")
    if not ucode:
        emit(
            {
                "additional_context": (
                    f"Host has no ucode; skipped ucode -c for {path}. "
                    "On the router: scp to /tmp, run `ucode -c /tmp/"
                    f"{Path(path).name}` (exit 0), then copy to "
                    "/usr/share/rpcd/ucode/ and restart rpcd. "
                    "OpenWrt 25.x: apk not opkg; native ucode rpcd "
                    "(ucode-mod-uci, ucode-mod-fs, rpcd-mod-ucode)."
                )
            }
        )
        return

    proc = subprocess.run(
        [ucode, "-c", path],
        capture_output=True,
        text=True,
    )
    if proc.returncode == 0:
        emit({})
        return

    err = (proc.stderr or proc.stdout or "ucode -c failed").strip()
    emit(
        {
            "additional_context": (
                f"ucode -c failed for {path} (exit {proc.returncode}):\n{err}\n"
                "Fix syntax before installing under /usr/share/rpcd/ucode/."
            )
        }
    )


if __name__ == "__main__":
    main()
