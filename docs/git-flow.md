# Fluxo Git Completo e Intuitivo (Opção 3)

Fluxo recomendado para combinar produtividade com segurança.

## 1. Convenções

- Branch principal protegida: `main`.
- Prefixos:
  - `feature/<ticket>-<slug>`
  - `fix/<ticket>-<slug>`
  - `chore/<ticket>-<slug>`
  - `refactor/<ticket>-<slug>`
- Commits em conventional commits:
  - `feat: ...`
  - `fix: ...`
  - `chore: ...`
  - `refactor: ...`

## 2. Sequência operacional

### Passo A — Criar branch de trabalho

Comando alvo:
```bash
cc branch start 1234-login-flow
```

A CLI deve:
1. Validar se a árvore está limpa.
2. Atualizar refs remotas (`git fetch --all --prune`).
3. Criar branch a partir de `main` atualizada.

### Passo B — Implementar com assistência AI

Comando alvo:
```bash
cc do "Implementar validação de sessão e testes"
```

A CLI deve:
1. Gerar plano breve.
2. Aplicar alterações em lotes pequenos.
3. Mostrar diff resumido por ficheiro.

### Passo C — Revisão local de alterações

Comando alvo:
```bash
cc review
```

A CLI deve devolver:
- Resumo técnico do diff.
- Pontos de risco (breaking changes, segurança, migrações).
- Sugestões de testes adicionais.

### Passo D — Validar qualidade

Comando alvo:
```bash
cc test
```

A CLI deve correr (na ordem):
1. lint
2. type-check
3. testes

Se falhar, a CLI recomenda correção assistida (`cc do "corrigir erros de teste"`).

### Passo E — Commit assistido

Comando alvo:
```bash
cc commit
```

A CLI deve:
1. Verificar checks mínimos.
2. Gerar mensagem de commit pelo diff.
3. Mostrar preview e pedir confirmação.
4. Executar commit.

### Passo F — Sincronizar com remoto

Comando alvo:
```bash
cc sync
```

A CLI deve:
1. `git fetch`.
2. `git rebase origin/main`.
3. Assistir resolução de conflitos (resumo + próximos comandos).

### Passo G — Abrir PR

Comando alvo:
```bash
cc pr
```

A CLI deve gerar automaticamente:
- título
- resumo
- motivação
- como testar
- riscos/rollback

E executar `gh pr create` com o conteúdo.

## 3. Guardrails de segurança

- Bloquear commit/push para `main` por defeito.
- Proibir `push --force` sem flag explícita `--allow-force`.
- Abort automático se houver ficheiros com conflito não resolvido.
- Aviso alto se mudar ficheiros sensíveis (`infra/`, `migrations/`, `auth/`).

## 4. UX de comandos (respostas curtas e úteis)

A CLI deve sempre responder com:
1. O que fez.
2. O estado atual (`branch`, `ahead/behind`, `working tree`).
3. Próximo comando recomendado.

Exemplo:
```text
✅ Branch criada: feature/1234-login-flow
ℹ️ Estado: clean, 0 commits ahead
➡️ Próximo passo: cc do "..."
```

## 5. Métricas de sucesso do fluxo

- Tempo médio branch -> PR.
- Percentagem de PRs aprovadas sem mudanças grandes.
- Taxa de falhas em CI por PR.
- Número de reversões pós-merge.

## 6. Checklist de adoção em equipa

- [ ] Definir convenção de branch.
- [ ] Definir comandos de lint/type-check/test por projeto.
- [ ] Ativar branch protection no remoto.
- [ ] Adotar template de PR padrão.
- [ ] Treinar equipa em `cc review`, `cc commit`, `cc pr`.
