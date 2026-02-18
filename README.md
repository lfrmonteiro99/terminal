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

## Erros comuns no `make desktop`

### 1) `No module named 'tkinter'`

Instala o pacote do sistema operativo para Tk:

- Debian/Ubuntu: `sudo apt-get update && sudo apt-get install -y python3-tk`
- Fedora/RHEL: `sudo dnf install -y python3-tkinter`
- Arch Linux: `sudo pacman -S tk`

### 2) `no $DISPLAY environment variable`

Estás num ambiente sem sessão gráfica (ex.: container/SSH headless/WSL sem X server). Corre a app no teu desktop local, ou configura `DISPLAY` com um servidor gráfico.

Depois executa novamente:

```bash
make desktop
```

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
