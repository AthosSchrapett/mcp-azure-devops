# Plano de Melhorias para Boards do MCP Azure DevOps

> **Versão:** 1.0
> **Data:** 2026-05-02
> **Escopo:** Exclusivamente a área **Boards** (`src/azure/boards.ts` + tools registradas em `src/server.ts`)
> **Premissas:** Manter o stack atual (TypeScript + Zod + `node-fetch` + Basic Auth via PAT) e usar Azure DevOps REST API v7.1 sempre que possível.

---

## Resumo executivo

A implementação atual cobre o "happy path" de CRUD de work items, mas tem lacunas importantes que limitam o uso em cenários reais (sprints com muitos itens, hierarquias complexas, anexos, auditoria). As principais oportunidades são:

1. **Robustez nas leituras**: paginação, seleção de campos, tratamento de erros tipado, retry com backoff.
2. **Gestão de relacionamentos**: links arbitrários (Parent/Child/Related/Predecessor/Successor/Tested By).
3. **Histórico e colaboração**: revisões, updates incrementais e ciclo de vida completo de comentários.
4. **Anexos**: upload, listagem e download (hoje inexistente).
5. **Customização**: suporte a campos `Custom.*` e overrides de regras (`bypassRules`).
6. **Descoberta**: listar áreas, iterações, times e queries salvas — pré-requisito para criação correta de itens.

A entrega proposta está dividida em **6 fases** totalizando ~**11–14 dias** de desenvolvimento.

---

## 1. Melhorias propostas

| # | Melhoria | Prioridade | Esforço | Justificativa de valor |
|---|----------|------------|---------|------------------------|
| 1 | Paginação (`top`/`skip`) e `top` em WIQL | **Alta** | Baixo | `queryWorkItems` hoje retorna lista inteira; em projetos médios isso estoura limites e contexto do LLM. |
| 2 | Seleção de campos (`fields`) no batch via POST `/wit/workitemsbatch` | **Alta** | Baixo | Reduz payload em até 90% e permite trazer **apenas** campos relevantes. |
| 3 | Suporte a campos personalizados (`Custom.*`) em create/update | **Alta** | Baixo | Sem isso, a tool é inutilizável em organizações que customizaram o processo. |
| 4 | Tratamento de erros tipado (parse do payload `{ message, typeKey, errorCode }` da API) | **Alta** | Baixo | Hoje todo erro vira string crua; impossibilita decisões automáticas (ex.: 401 vs 404 vs validação de regra). |
| 5 | Retry com backoff exponencial para 429 / 5xx (respeita header `Retry-After`) | **Alta** | Baixo | Workflows automatizados disparam rate-limit do Azure DevOps com facilidade. |
| 6 | `linkWorkItems` (qualquer tipo: Hierarchy, Related, Successor, Tested By, Affects, etc.) | **Alta** | Médio | Hoje só é possível ligar a um Parent na criação. Bloqueia construção de mapas de dependência. |
| 7 | `removeWorkItemLink` | **Alta** | Médio | Inverso da #6, indispensável quando o LLM erra a ligação. |
| 8 | `listWorkItemRevisions` / `getWorkItemRevision` | **Média** | Médio | Auditoria, retrospectivas e investigação de mudanças. |
| 9 | `listWorkItemUpdates` (diff por revisão) | **Média** | Médio | Necessário para "quem mudou o quê e quando". |
| 10 | `listWorkItemComments` / `updateWorkItemComment` / `deleteWorkItemComment` | **Média** | Médio | O ciclo de vida de comentários hoje é write-only. |
| 11 | Anexos: `uploadAttachment`, `attachToWorkItem`, `listWorkItemAttachments`, `downloadAttachment` | **Média** | Médio-alto | Caso de uso comum: anexar logs, prints, specs em bugs/PBIs. |
| 12 | Helpers de descoberta: `listIterations`, `listAreas`, `listTeams` | **Média** | Baixo | Sem isso, o LLM precisa adivinhar paths válidos no `createWorkItem`. |
| 13 | `getMyWorkItems` (atalho para `@Me`) | **Média** | Baixo | Atalho mais usado em assistentes de produtividade. |
| 14 | `listSavedQueries` / `runSavedQuery` | **Baixa** | Médio | Permite reaproveitar queries já validadas pelo time. |
| 15 | `bulkUpdateWorkItems` (PATCH em `$batch`) | **Média** | Médio | Mover 30 PBIs de sprint hoje exige 30 chamadas. |
| 16 | `moveWorkItem` (entre projetos da mesma org) | **Baixa** | Médio | Cenário menos frequente, mas tedioso de fazer manualmente. |
| 17 | Fix: `getWorkItemsBatch` aceitar > 200 IDs (Zod limita o input, mas a função já faz chunking) | **Alta** | Trivial | Bug latente — atualmente o limite Zod neutraliza o chunking interno. |
| 18 | Fix: `addWorkItemComment` migrar de `7.1-preview.4` para `7.1` quando GA, manter fallback | **Baixa** | Trivial | Reduz risco de breaking change futuro. |
| 19 | Validação de transições de estado (cruzar com `listWorkItemTypes`) e exposição do campo `Reason` | **Média** | Médio | Algumas transições exigem `System.Reason`; hoje a tool falha silenciosamente. |
| 20 | `bypassRules` opcional no `createWorkItem`/`updateWorkItem` (para migração/import) | **Baixa** | Trivial | Permite criar itens em estados finais ou ignorar regras durante seed. |

---

## 2. Fases e tarefas

### Fase 1 — Robustez nas leituras e tratamento de erros
**Objetivo:** Tornar a camada existente production-ready antes de adicionar superfície nova.
**Estimativa:** 2–3 dias (16–24h)

- [ ] **(Tool: `queryWorkItems`)** Adicionar parâmetros `top` e `skip`.
  - WIQL não suporta `OFFSET` nativamente — implementar paginação no lado do cliente cortando o array `workItems` antes do `getWorkItemsBatch`.
  - Aceitar também `top` no header `?$top=` da API (`/wit/wiql`).
  - Atualizar Zod schema em `server.ts` (`top`: `z.number().int().min(1).max(1000).optional()`, `skip`: `z.number().int().min(0).optional()`).
- [ ] **(Tool: `getWorkItemsBatch`)** Migrar para `POST /_apis/wit/workitemsbatch?api-version=7.1` com body `{ ids, fields, $expand, errorPolicy: "omit" }`.
  - Adicionar parâmetro opcional `fields: string[]` para projeção (ex.: `["System.Title","System.State"]`).
  - Remover o `.max(200)` do schema Zod — manter apenas no chunking interno.
- [ ] **(Helper novo)** Criar `src/azure/http.ts` com `azureFetch(url, init, { retries=3, baseDelayMs=500 })`:
  - Parse do erro Azure DevOps: `{ "message": "...", "typeKey": "...", "errorCode": 0 }`.
  - Lança `AzureDevOpsError` com `status`, `typeKey`, `errorCode`, `message`.
  - Retry exponencial em `429` (lendo `Retry-After`) e `5xx`.
- [ ] **(Refactor)** Substituir todos os `fetch(...)` em `boards.ts` por `azureFetch(...)`.
- [ ] **(Tool: `createWorkItem` / `updateWorkItem`)** Adicionar parâmetro `customFields: Record<string, string | number | boolean>` que vira patches `/fields/<chave>`.
- [ ] **(Tool: `createWorkItem` / `updateWorkItem`)** Adicionar `bypassRules?: boolean` que injeta `?bypassRules=true` na URL.
- [ ] Build (`npm run build`) e smoke-test manual contra um projeto de DEV.

#### Exemplo de uso — paginação
```jsonc
// input
{
  "wiql": "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType]='Bug' ORDER BY [System.ChangedDate] DESC",
  "top": 25,
  "skip": 50,
  "fetchDetails": true
}
// output (resumido)
{ "workItems": [ { "id": 12345, "fields": { "System.Title": "...", "System.State": "Active" } }, ... ] }
```

#### Exemplo de uso — campos personalizados
```jsonc
{
  "type": "Bug",
  "title": "Falha no checkout em iOS 17",
  "customFields": {
    "Custom.Severity": "Critical",
    "Custom.AffectedClient": "RetailCo"
  }
}
```

---

### Fase 2 — Gestão de links entre work items
**Estimativa:** 2 dias (12–16h)

- [ ] **(Service)** Em `boards.ts`, adicionar:
  - `linkWorkItems(config, sourceId, targetId, linkType, comment?)` — PATCH em `/wit/workitems/{sourceId}` adicionando `/relations/-`.
  - `removeWorkItemLink(config, workItemId, relationIndex)` — PATCH com `op: "remove"` em `/relations/{index}` (precisa de `If-Match` com `rev`).
  - `listWorkItemRelations(config, id)` — usa `getWorkItem` com `expand=Relations` e devolve só `relations`.
- [ ] **(Tipos)** Definir `LinkType` como union string (`"System.LinkTypes.Hierarchy-Forward" | "...-Reverse" | "System.LinkTypes.Related" | "System.LinkTypes.Dependency-Predecessor" | "...-Successor" | "Microsoft.VSTS.Common.TestedBy-Forward" | "...-Reverse" | "Microsoft.VSTS.Common.Affects-Forward" | "...-Reverse"`).
- [ ] **(Tool: `linkWorkItems`)** Registrar em `server.ts` com Zod:
  ```ts
  {
    sourceId: z.number().int().positive(),
    targetId: z.number().int().positive(),
    linkType: z.enum([...]).describe("Tipo de link (ex.: Parent = Hierarchy-Reverse)"),
    comment: z.string().optional()
  }
  ```
- [ ] **(Tool: `removeWorkItemLink`)** Idem, exigindo `workItemId` + `relationIndex`.
- [ ] **(Tool: `listWorkItemRelations`)** Apenas wrapper de `getWorkItem(expand=Relations)` retornando array com `index`, `rel`, `targetId` (extraído da URL).
- [ ] Atualizar `createWorkItem` para aceitar `links: { type, targetId }[]` (não só `parentId`).

#### Exemplo de uso
```jsonc
// linkWorkItems
{ "sourceId": 4321, "targetId": 4322, "linkType": "System.LinkTypes.Dependency-Predecessor", "comment": "Bloqueia entrega da Sprint 7" }
```

---

### Fase 3 — Histórico, revisões e ciclo completo de comentários
**Estimativa:** 1,5–2 dias (10–14h)

- [ ] **(Service)** Adicionar:
  - `listWorkItemRevisions(config, id, top?, skip?)` — `GET /wit/workitems/{id}/revisions`.
  - `getWorkItemRevision(config, id, revNumber)` — `GET /wit/workitems/{id}/revisions/{rev}`.
  - `listWorkItemUpdates(config, id, top?, skip?)` — `GET /wit/workitems/{id}/updates` (mostra **diffs** por update, mais útil que revisões cheias).
  - `listWorkItemComments(config, id, top?, continuationToken?)` — `GET /wit/workitems/{id}/comments?api-version=7.1-preview.4`.
  - `updateWorkItemComment(config, id, commentId, text)` — PATCH no mesmo endpoint.
  - `deleteWorkItemComment(config, id, commentId)` — DELETE.
- [ ] **(Tools)** Registrar 5 novas tools com Zod e descrições claras.
- [ ] Padronizar `continuationToken` como string opcional para comentários (a API usa cursor, não offset).

#### Exemplo de uso — histórico compacto
```jsonc
// listWorkItemUpdates
{ "id": 4321, "top": 10 }
// output (resumido)
[
  { "rev": 7, "revisedBy": "athos@...", "revisedDate": "2026-04-30T13:02:00Z", "fields": { "System.State": { "oldValue": "Active", "newValue": "Resolved" } } }
]
```

---

### Fase 4 — Anexos
**Estimativa:** 2–3 dias (16–24h)

- [ ] **(Service)** Adicionar:
  - `uploadAttachment(config, fileName, contentBase64 | Buffer, areaPath?)` — `POST /wit/attachments?fileName=...&uploadType=simple`. Retorna `{ id, url }`.
  - `attachToWorkItem(config, workItemId, attachmentUrl, comment?)` — PATCH `add` em `/relations/-` com `rel: "AttachedFile"`.
  - `listWorkItemAttachments(config, id)` — wrapper sobre `getWorkItem(expand=Relations)` filtrando `rel === "AttachedFile"`.
  - `downloadAttachment(config, attachmentId)` — `GET /wit/attachments/{id}` com header `Accept: application/octet-stream`. Retorna `Buffer` + `contentType`.
- [ ] **(Tools)** Registrar 4 tools.
  - Para `uploadAttachment` aceitar `contentBase64: z.string()` (o MCP transporta texto; binário cru não cabe).
  - `downloadAttachment` retorna `{ contentBase64, mimeType, sizeBytes }` para o LLM decidir.
- [ ] **(Risco)** Validar limite de payload do MCP stdio — para anexos > ~5MB, retornar **somente metadados + URL assinada** ao invés do conteúdo.

#### Exemplo de uso
```jsonc
// 1) upload
{ "fileName": "stack-trace.txt", "contentBase64": "U3RhY2sgdHJhY2UuLi4=" }
// → { "id": "abc-123", "url": "https://dev.azure.com/.../_apis/wit/attachments/abc-123" }

// 2) attach
{ "workItemId": 4321, "attachmentUrl": "https://dev.azure.com/.../attachments/abc-123", "comment": "Stack trace do crash" }
```

---

### Fase 5 — Helpers de descoberta e atalhos
**Estimativa:** 1 dia (6–8h)

- [ ] **(Service + Tools)** Adicionar tools de leitura simples:
  - `listIterations(config, team?)` — `GET /{project}/{team}/_apis/work/teamsettings/iterations?api-version=7.1`. Default: `@currentIteration` + futuras.
  - `listAreas(config, depth=2)` — `GET /wit/classificationnodes/areas?$depth=N`.
  - `listTeams(config)` — `GET /_apis/projects/{project}/teams`.
  - `getMyWorkItems(config, types?, states?)` — atalho que monta WIQL com `[System.AssignedTo] = @Me` e delega para `queryWorkItems`.
- [ ] **(Tool: `listWorkItemTypes`)** Adicionar parâmetro `includeFields: boolean` para devolver `fieldInstances` (hoje é dropado pelo `simplified` em `server.ts:128–132`). Útil para o LLM descobrir campos válidos antes de criar.

#### Exemplo de uso
```jsonc
// getMyWorkItems
{ "types": ["Task","Bug"], "states": ["Active","New"] }
```

---

### Fase 6 — Operações em lote e movimentação
**Estimativa:** 2 dias (12–16h)

- [ ] **(Service)** `bulkUpdateWorkItems(config, updates: { id, patch }[])`:
  - Usa `POST /_apis/wit/$batch?api-version=7.1` com array de operações HTTP em JSON.
  - Reaproveita o builder de patch de `updateWorkItem`.
- [ ] **(Service)** `bulkCreateWorkItems(config, items: CreateWorkItemInput[])` — mesma estratégia.
- [ ] **(Service)** `moveWorkItem(config, id, targetProject, targetAreaPath?, targetIterationPath?)`:
  - PATCH em `/wit/workitems/{id}` alterando `System.TeamProject`, `System.AreaPath`, `System.IterationPath`.
- [ ] **(Tools)** Registrar 3 tools, com cap defensivo (`max(50)` no array de `bulkUpdate` para evitar timeouts e estouro de payload do MCP).

#### Exemplo de uso
```jsonc
// bulkUpdateWorkItems — fechar 5 PBIs de uma sprint
{
  "updates": [
    { "id": 101, "fields": { "state": "Done" } },
    { "id": 102, "fields": { "state": "Done", "tags": "MVP; Sprint7-Closed" } }
  ]
}
```

---

## 3. Estimativa de esforço total

| Fase | Itens | Estimativa | Acumulado |
|------|-------|------------|-----------|
| 1 — Robustez & erros | 1, 2, 3, 4, 5, 17, 20 | 16–24h | ~3 dias |
| 2 — Links | 6, 7 | 12–16h | ~5 dias |
| 3 — Histórico & comentários | 8, 9, 10, 18 | 10–14h | ~7 dias |
| 4 — Anexos | 11 | 16–24h | ~10 dias |
| 5 — Descoberta & atalhos | 12, 13 | 6–8h | ~11 dias |
| 6 — Bulk & move | 15, 16 | 12–16h | ~13 dias |
| **Total** | **20 itens** | **72–102h** | **~11–14 dias úteis** |

> **Recomendação:** Entregar Fases 1–3 como **MVP de produção** (≈7 dias). Fases 4–6 podem ser agendadas conforme demanda real dos usuários.

---

## 4. Riscos e mitigação

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| **Payload MCP estourado** ao trazer muitos work items com todos os campos | Alta | Médio | Tornar `fields` (projeção) **obrigatório** quando `top > 50`. Limitar `getWorkItemsBatch` a 200 IDs por chamada já é nativo da API. |
| **Rate limit do Azure DevOps (TSTUs)** em queries grandes ou bulk | Média | Alto | Helper `azureFetch` com retry e respeito a `Retry-After`. Documentar no README os limites por org. |
| **Anexos binários grandes** estouram stdio do MCP | Média | Alto | `downloadAttachment` retorna metadados + URL temporária por padrão; conteúdo só se `inline: true` e `< 1MB`. |
| **Campos personalizados** com nomes inválidos quebram o PATCH inteiro | Média | Médio | Validar prefixo `Custom.` ou `<ProcessName>.` no Zod e devolver erro amigável antes de chamar a API. |
| **Transições de estado inválidas** (faltando `Reason`) falham com mensagem genérica | Alta | Baixo | Já endereçado pela melhoria #19 — pré-validar contra `listWorkItemTypes` cacheado. |
| **`Hierarchy-Reverse` x `Hierarchy-Forward`** confunde modelos LLM | Alta | Baixo | Expor enum amigável (`"Parent" | "Child" | "Related" | ...`) e mapear internamente para os reference names da API. |
| **Permissões de PAT insuficientes** para anexos / bulk | Média | Médio | Documentar escopos mínimos no README (`vso.work_full`, `vso.work_write`). Tratar 401/403 com mensagem específica. |
| **Quebra de retrocompatibilidade** ao alterar `getWorkItemsBatch` (POST vs GET) | Baixa | Médio | Manter assinatura externa; mudar só implementação. Tools existentes não veem diferença. |
| **API preview de comentários** (`7.1-preview.4`) muda antes do GA | Baixa | Baixo | Centralizar versão da API em constante (`COMMENTS_API_VERSION`) — troca em um único ponto. |
| **WIQL limitado a ~20.000 IDs por response** | Baixa | Médio | Documentar; sugerir filtros mais restritos ou paginação por `[System.ChangedDate]`. |

---

## 5. Critérios de aceite por fase

Para cada fase considerar concluída, o desenvolvedor deve:

1. ✅ Implementar a função em `src/azure/boards.ts` (ou novo módulo se aplicável).
2. ✅ Registrar a(s) tool(s) em `src/server.ts` com schema Zod descritivo (descrições legíveis para o LLM).
3. ✅ Rodar `npm run build` sem erros de tipo.
4. ✅ Smoke-test manual contra projeto Azure DevOps de DEV cobrindo: happy path, erro 404 (item inexistente), erro 401 (PAT inválido), erro de validação (campo obrigatório).
5. ✅ Atualizar `CLAUDE.md` (seção "Tool categories") com as novas tools.
6. ✅ Atualizar `README.md` com exemplos de uso das tools novas/alteradas.

---

## 6. Próximos passos sugeridos

1. **Revisar este plano** com o time e priorizar entre Fase 4 (Anexos) e Fase 6 (Bulk) — ambas têm prioridade média e podem ser trocadas conforme uso real.
2. **Abrir uma branch `feature/boards-phase-1`** e iniciar pelas melhorias #4 e #5 (helper `azureFetch`), pois desbloqueiam todas as outras.
3. **Criar issues no Azure Boards** (dogfooding!) para cada item das tabelas de fases 1–3.
