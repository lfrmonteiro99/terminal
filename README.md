# AI Dev Terminal (MVP)

Sim — isto **já é uma app**, mas em formato de **CLI de terminal** (não interface gráfica/web).

## O que é

- `bin/cc`: app CLI principal
- `Makefile`: atalhos para correr e testar
- `tests/smoke.sh`: testes de fumo automáticos

## Como correr

```bash
make setup
export PATH="$PWD/bin:$PATH"
make run
```

Também podes chamar diretamente:

```bash
PATH="$PWD/bin:$PATH" cc --help
```

## Como testar

```bash
make test
```

Isto valida:
- sintaxe do script
- help output
- diagnóstico (`cc doctor`)
- comportamento de erro (`cc commit` com tipo inválido)

## Comandos disponíveis (MVP)

- `cc doctor`
- `cc branch start <ticket-slug>`
- `cc review`
- `cc sync`
- `cc commit [type] [message...]`
- `cc pr`

## Nota importante

Este MVP é focado em Git + fluxo de terminal. A integração AI (`cc ask`, `cc do`) é o próximo passo.
