#!/usr/bin/env python3
"""Native desktop GUI for cc CLI (no browser required)."""

from __future__ import annotations

import os
import queue
import shlex
import subprocess
import threading
import tkinter as tk
from pathlib import Path
from tkinter import ttk

ROOT = Path(__file__).resolve().parents[1]
CC_BIN = ROOT / "bin" / "cc"


class CCDesktopApp:
    def __init__(self, root: tk.Tk) -> None:
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


def main() -> None:
    root = tk.Tk()
    _app = CCDesktopApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
