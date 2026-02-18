#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import pathlib
import os
import sys


def main() -> int:
    root = pathlib.Path(__file__).resolve().parents[1]
    app_file = root / "ui" / "app.py"

    spec = importlib.util.spec_from_file_location("cc_ui", app_file)
    if spec is None or spec.loader is None:
        print("failed to load ui/app.py")
        return 1

    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    if not hasattr(module, "CCDesktopApp") or not hasattr(module, "main"):
        print("desktop app symbols missing")
        return 1

    if sys.platform.startswith("linux") and not os.environ.get("DISPLAY"):
        print("warning: no DISPLAY set; skipping runtime window check")
        return 0

    import tkinter as tk

    root_tk = tk.Tk()
    root_tk.withdraw()
    app = module.CCDesktopApp(root_tk)
    assert app is not None
    root_tk.destroy()

    print("desktop ui smoke ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
