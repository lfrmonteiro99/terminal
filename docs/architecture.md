# AI Dev Terminal — Arquitetura Técnica (Opção 2)

Este documento define uma arquitetura prática para um terminal unificado que combina:
- Operações com Claude Code por comandos simples.
- Fluxos Git intuitivos e seguros.

## 1. Objetivos de produto

- Permitir execução de tarefas de engenharia via comandos curtos (`cc ...`).
- Preservar segurança e previsibilidade em operações destrutivas.
- Integrar com Git de forma assistida e auditável.
- Evitar dependência de UI externa para operações comuns.

## 2. Abordagem recomendada

Implementar uma **CLI robusta** (Node.js ou Python), com wrappers para ferramentas existentes.

### Porque não apenas scripts shell?
Scripts shell funcionam para MVP, mas escalam mal para:
- Estado de sessão.
- Logs estruturados.
- Parsing robusto de flags.
- Plugins/comandos compostos.

### Stack sugerida

- **CLI**: Node.js + TypeScript (ou Python + Typer).
- **Config**: arquivo local (`.cc-terminal.yml`) + defaults globais.
- **Execução**: subprocess com timeout e captura de stdout/stderr.
- **Persistência leve**:
  - `~/.cc-terminal/sessions/` (logs por execução)
  - `~/.cc-terminal/profiles/` (perfis por projeto)
- **Integrações**:
  - Git local (`git`)
  - GitHub CLI (`gh`) para PR
  - Claude Code via comando/API local conforme disponibilidade

## 3. Camadas do sistema

### 3.1 Interface de comandos

Exemplos:
- `cc ask "pergunta"`
- `cc plan "objetivo"`
- `cc do "objetivo"`
- `cc review`
- `cc commit`
- `cc pr`

Responsabilidades:
- Validar input do utilizador.
- Carregar perfil/projeto.
- Encaminhar para orquestrador.

### 3.2 Orquestrador

Responsável por converter intenção em plano executável:
1. Coletar contexto do repositório.
2. Invocar Claude para plano/execução/revisão.
3. Executar verificações (lint/test/type-check).
4. Preparar resumo de alterações e próximos passos.

### 3.3 Adaptadores de tooling

- `gitAdapter`: branch status, diff, commit, rebase, push.
- `testAdapter`: detetar e correr comandos de teste.
- `prAdapter`: criar PR via `gh`.
- `aiAdapter`: enviar prompts e receber respostas em formato estruturado.

## 4. Modos de autonomia

Definir três modos claros para reduzir risco:

- `suggest`: apenas recomenda comandos/mudanças.
- `apply`: altera ficheiros localmente, sem commit automático.
- `full`: altera + valida + propõe commit/PR.

**Regra**: operações destrutivas (`reset --hard`, delete branch, force push) exigem confirmação explícita.

## 5. Guardrails obrigatórios

- Bloquear operações diretas em `main`/`master` por defeito.
- Exigir árvore limpa para comandos críticos (`cc commit`, `cc sync`).
- Executar checks mínimos antes de commit:
  - lint
  - testes rápidos
  - type-check (quando aplicável)
- Verificar secrets antes de commit (`gitleaks`/`trufflehog` opcional).

## 6. Estrutura de configuração

Exemplo de `.cc-terminal.yml`:

```yaml
project:
  default_branch: main
  protected_branches: [main, master]
  test_command: npm test -- --runInBand
  lint_command: npm run lint
  typecheck_command: npm run typecheck
ai:
  mode: apply
  max_files_per_run: 20
  require_plan_before_apply: true
git:
  branch_prefixes: [feature, fix, chore, refactor]
  commit_convention: conventional
  require_issue_reference: false
```

## 7. Observabilidade e auditoria

Cada execução deve gerar artefacto com:
- comando invocado
- timestamp
- prompt enviado ao Claude
- comandos shell executados
- código de saída
- ficheiros alterados

Formato recomendado: JSONL por sessão para facilitar parsing.

## 8. Roadmap técnico

### Fase 1 (MVP)
- CLI base + `cc ask`, `cc plan`, `cc do`.
- Integração Git simples (`status`, `diff`, `commit` assistido).

### Fase 2 (Confiabilidade)
- Modos `suggest/apply/full`.
- Guardrails de branch + checks automáticos.

### Fase 3 (Integração GitHub)
- `cc pr` com template automático.
- Classificação de risco e checklist de validação.

### Fase 4 (UX avançada)
- TUI opcional no terminal.
- Perfis por stack (Node, Python, Go).
