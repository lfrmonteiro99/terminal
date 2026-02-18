# CC Desktop (Interface gráfica nativa para OS)

Agora tens uma app **gráfica nativa** (desktop), sem browser.

## Componentes

- `bin/cc`: CLI com operações Git assistidas.
- `ui/app.py`: app desktop Tkinter (janela nativa no OS).
- `Makefile`: atalhos de execução.
- `tests/smoke.sh`: smoke tests da CLI.
- `tests/ui_smoke.py`: smoke test da app desktop.

## Como correr a app gráfica

```bash
make setup
make desktop
```

Abre uma janela nativa com ações:

- Doctor
- Review
- Sync
- PR
- branch start
- commit

## Como correr no terminal (CLI)

```bash
make run
make doctor
```

## Como testar

```bash
make test
make ui-test
```
