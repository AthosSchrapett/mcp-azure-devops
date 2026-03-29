# MCP Azure DevOps Server

Um servidor MCP (Model Context Protocol) para integração com o Azure DevOps, oferecendo acesso a Boards, Repos e Pipelines.

## Ferramentas Disponíveis

### 📋 Boards — Leitura

| Ferramenta | Descrição |
|---|---|
| `getWorkItem` | Recupera um work item pelo ID, com opção de expandir relações (parent/child) |
| `getWorkItemsBatch` | Recupera múltiplos work items por IDs em uma única requisição (até 200) |
| `queryWorkItems` | Executa uma WIQL query, com opção de retornar dados completos (`fetchDetails`) |
| `listWorkItemTypes` | Lista todos os tipos de work items e seus estados válidos no projeto |

### 📋 Boards — Escrita

| Ferramenta | Descrição |
|---|---|
| `createWorkItem` | Cria um work item (Epic, Feature, PBI, Task, Bug, Impediment) com campos completos e link de pai opcional |
| `updateWorkItem` | Atualiza campos arbitrários de um work item (título, descrição, tags, state, prioridade, etc.) |
| `updateWorkItemState` | Atalho para alterar apenas o estado de um work item |
| `deleteWorkItem` | Deleta um work item (lixeira ou destruição permanente) |
| `addWorkItemComment` | Adiciona um comentário a um work item |

### 🔀 Repos

| Ferramenta | Descrição |
|---|---|
| `createPullRequest` | Cria um Pull Request em um repositório do Azure DevOps |
| `linkPullRequestToWorkItem` | Vincula um PR existente a um Work Item |

### 🚀 Pipelines

| Ferramenta | Descrição |
|---|---|
| `getPipelineStatus` | Obtém o status da última execução de um pipeline |

## Configuração

Variáveis de ambiente obrigatórias:

```env
AZURE_ORG=athosschrapett
AZURE_PROJECT=Arenar
AZURE_PAT=<seu-personal-access-token>
```

## Uso via MCP Config

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "node",
      "args": ["path/to/dist/server.js"],
      "env": {
        "AZURE_ORG": "sua-organizacao",
        "AZURE_PROJECT": "seu-projeto",
        "AZURE_PAT": "seu-personal-access-token"
      }
    }
  }
}
```

## Build

```bash
npm install
npm run build
```

## Changelog

### v2.0.0
- **Novo:** `createWorkItem` — cria work items com todos os campos (título, descrição, AC, tags, prioridade, story points, iteração, área, assignee, parent link)
- **Novo:** `updateWorkItem` — atualiza campos arbitrários de um work item
- **Novo:** `deleteWorkItem` — deleta work items (lixeira ou permanente)
- **Novo:** `listWorkItemTypes` — lista tipos e estados válidos
- **Novo:** `getWorkItemsBatch` — recupera múltiplos work items por IDs em batch
- **Melhorado:** `queryWorkItems` — novo parâmetro `fetchDetails` para retornar dados completos
- **Melhorado:** `getWorkItem` — novo parâmetro `expand` para ver relações/links
- **Fix:** Config padrão atualizado para projeto `Arenar`
- **Fix:** Uso de org-level API para operações que não dependem de project scope
