# O que fazer agora (plano prático)

## Resposta curta à tua pergunta

- **Como corro isto?** -> `make setup && export PATH="$PWD/bin:$PATH" && make run`
- **Como testo?** -> `make test`
- **É uma app?** -> Sim, é uma app **CLI** (terminal), não web app.

## 1) Executar localmente

```bash
make setup
export PATH="$PWD/bin:$PATH"
cc doctor
```

## 2) Exercitar o fluxo Git assistido

```bash
cc branch start 1234-login-flow
# ... editar ficheiros
cc review
cc commit feat "implement login flow"
cc sync
```

## 3) Abrir PR (quando `gh` estiver autenticado)

```bash
cc pr
```

## 4) Melhorias imediatas

- ligar `cc do`/`cc ask` ao provider de IA
- adicionar leitura de `.cc-terminal.yml`
- adicionar checks automáticos em `cc commit` (lint + testes)
- adicionar bloqueio explícito para commits em `main`
