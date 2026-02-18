#!/usr/bin/env python3
"""Native desktop GUI for cc CLI (no browser required)."""

from __future__ import annotations

import os
import queue
import shlex
import subprocess
import threading
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CC_BIN = ROOT / "bin" / "cc"

try:
    import tkinter as tk
    from tkinter import ttk
except ModuleNotFoundError:
    tk = None  # type: ignore[assignment]
    ttk = None  # type: ignore[assignment]


def tkinter_available() -> bool:
    return tk is not None and ttk is not None


def missing_tkinter_message() -> str:
    return """\
❌ O módulo tkinter não está instalado nesta instalação de Python.

Para usar a interface gráfica nativa, instala as dependências do sistema:

- Debian/Ubuntu: sudo apt-get update && sudo apt-get install -y python3-tk
- Fedora/RHEL:   sudo dnf install -y python3-tkinter
- Arch Linux:    sudo pacman -S tk
- macOS (python.org): reinstalar Python com Tcl/Tk incluído

Depois corre novamente: make desktop
"""


class CCDesktopApp:
    def __init__(self, root: Any) -> None:
        self.root = root
        self.root.title("CC Desktop")
        self.root.geometry("900x620")

        self._running = False
        self._queue: queue.Queue[tuple[str, str]] = queue.Queue()

        self.branch_var = tk.StringVar(value="1234-minha-feature")
        self.commit_type_var = tk.StringVar(value="chore")
        self.commit_msg_var = tk.StringVar(value="update files")

        self._build_ui()
        self._poll_queue()

    def _build_ui(self) -> None:
        container = ttk.Frame(self.root, padding=12)
        container.pack(fill=tk.BOTH, expand=True)

        ttk.Label(
            container,
            text="CC Desktop — interface gráfica nativa (OS)",
            font=("TkDefaultFont", 12, "bold"),
        ).pack(anchor=tk.W, pady=(0, 8))

        quick = ttk.LabelFrame(container, text="Ações rápidas")
        quick.pack(fill=tk.X, pady=(0, 8))
        for label, args in [
            ("Doctor", ["doctor"]),
            ("Review", ["review"]),
            ("Sync", ["sync"]),
            ("PR", ["pr"]),
        ]:
            ttk.Button(quick, text=label, command=lambda a=args: self.run_cc(a)).pack(
                side=tk.LEFT, padx=6, pady=6
            )

        branch = ttk.LabelFrame(container, text="Criar branch")
        branch.pack(fill=tk.X, pady=(0, 8))
        ttk.Entry(branch, textvariable=self.branch_var).pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=6, pady=6
        )
        ttk.Button(
            branch,
            text="branch start",
            command=lambda: self.run_cc(["branch", "start", self.branch_var.get().strip()]),
        ).pack(side=tk.LEFT, padx=6, pady=6)

        commit = ttk.LabelFrame(container, text="Commit")
        commit.pack(fill=tk.X, pady=(0, 8))
        ttk.Label(commit, text="Tipo").pack(side=tk.LEFT, padx=(6, 4), pady=6)
        ttk.Combobox(
            commit,
            textvariable=self.commit_type_var,
            values=["feat", "fix", "chore", "refactor", "docs", "test", "perf"],
            state="readonly",
            width=10,
        ).pack(side=tk.LEFT, pady=6)
        ttk.Label(commit, text="Mensagem").pack(side=tk.LEFT, padx=(10, 4), pady=6)
        ttk.Entry(commit, textvariable=self.commit_msg_var).pack(
            side=tk.LEFT, fill=tk.X, expand=True, pady=6
        )
        ttk.Button(
            commit,
            text="commit",
            command=lambda: self.run_cc(
                ["commit", self.commit_type_var.get().strip(), self.commit_msg_var.get().strip()]
            ),
        ).pack(side=tk.LEFT, padx=6, pady=6)

        output_wrap = ttk.LabelFrame(container, text="Output")
        output_wrap.pack(fill=tk.BOTH, expand=True)
        self.output = tk.Text(output_wrap, wrap=tk.WORD, height=24)
        self.output.pack(fill=tk.BOTH, expand=True, padx=6, pady=6)
        self.output.insert(tk.END, "Pronto. Escolhe uma ação.\n")

    def run_cc(self, args: list[str]) -> None:
        if self._running:
            self._append("⚠️ Já existe um comando em execução.\n")
            return
        if not args or any(not item for item in args):
            self._append("❌ Argumentos inválidos.\n")
            return

        self._running = True
        threading.Thread(target=self._worker, args=(args,), daemon=True).start()

    def _worker(self, args: list[str]) -> None:
        cmd = [str(CC_BIN), *args]
        env = os.environ.copy()
        env["PATH"] = f"{ROOT / 'bin'}:{env.get('PATH', '')}"

        try:
            self._queue.put(("append", f"\n$ {' '.join(shlex.quote(c) for c in cmd)}\n"))
            result = subprocess.run(
                cmd,
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
                timeout=180,
                env=env,
            )
            if result.stdout:
                self._queue.put(("append", result.stdout))
            if result.stderr:
                self._queue.put(("append", result.stderr))
            self._queue.put(("append", f"\n(exit={result.returncode})\n"))
        except subprocess.TimeoutExpired:
            self._queue.put(("append", "\n❌ Timeout: comando demorou demasiado.\n"))
        finally:
            self._queue.put(("done", ""))

    def _append(self, text: str) -> None:
        self.output.insert(tk.END, text)
        self.output.see(tk.END)

    def _poll_queue(self) -> None:
        try:
            while True:
                kind, payload = self._queue.get_nowait()
                if kind == "append":
                    self._append(payload)
                elif kind == "done":
                    self._running = False
        except queue.Empty:
            pass
        self.root.after(120, self._poll_queue)


def main() -> int:
    if not tkinter_available():
        print(missing_tkinter_message())
        return 1

    try:
        root = tk.Tk()
    except Exception as exc:
        print("❌ Não foi possível abrir a janela desktop:")
        print(f"   {exc}")
        print("\nSe estiver em servidor/WSL/container sem ambiente gráfico, corre no teu desktop local ou configura DISPLAY.")
        return 1

    _app = CCDesktopApp(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
