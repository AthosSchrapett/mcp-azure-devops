# mcp-azure-devops

MCP Server para integração com **Azure DevOps** — expõe ferramentas para **Boards**, **Repos (Pull Requests)** e **Pipelines** via Model Context Protocol.

---

## 🚀 Pré-requisitos

| Requisito | Versão mínima |
|-----------|---------------|
| Node.js   | 20+           |
| npm       | 9+            |

Você também precisa de um **Personal Access Token (PAT)** do Azure DevOps com permissões de leitura/escrita para Work Items, Code e Build.

---

## 📦 Instalação

```bash
git clone <repo-url> mcp-azure-devops
cd mcp-azure-devops
npm install
npm run build
```

---

## ⚙️ Configuração

1. Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

2. Preencha as variáveis no `.env`:

```dotenv
AZURE_ORG=sua-organizacao
AZURE_PROJECT=seu-projeto
AZURE_PAT=seu-personal-access-token
```

> **⚠️ Nunca versione o arquivo `.env`.** Ele já está listado no `.gitignore`.

### Como gerar o PAT

1. Acesse `https://dev.azure.com/{sua-org}/_usersSettings/tokens`
2. Clique em **New Token**
3. Selecione as permissões necessárias:
   - **Work Items**: Read & Write
   - **Code**: Read & Write
   - **Build**: Read
4. Copie o token gerado e cole em `AZURE_PAT`

---

## ▶️ Uso

### Executar diretamente

```bash
npm start
```

O servidor escuta em **stdio** (stdin/stdout) conforme o protocolo MCP.

### Desenvolvimento

```bash
npm run dev
```

Compila e executa em um único comando.

---

## 🔌 Registrar como MCP Server

Adicione a seguinte entrada no arquivo de configuração do seu cliente MCP (ex: `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "azure-devops": {
      "command": "node",
      "args": ["caminho/para/mcp-azure-devops/dist/server.js"],
      "env": {
        "AZURE_ORG": "sua-organizacao",
        "AZURE_PROJECT": "seu-projeto",
        "AZURE_PAT": "seu-personal-access-token"
      }
    }
  }
}
```

> Alternativamente, se as variáveis já estiverem definidas no `.env` do projeto, basta omitir o campo `env`.

---

## 🧰 Ferramentas Disponíveis

### Boards

| Ferramenta             | Descrição                                     |
|------------------------|-----------------------------------------------|
| `getWorkItem`          | Busca um work item pelo ID                    |
| `queryWorkItems`       | Executa uma consulta WIQL                     |
| `updateWorkItemState`  | Atualiza o estado de um work item             |
| `addWorkItemComment`   | Adiciona um comentário a um work item         |

### Repos

| Ferramenta                   | Descrição                                       |
|------------------------------|--------------------------------------------------|
| `createPullRequest`          | Cria um Pull Request                             |
| `linkPullRequestToWorkItem`  | Vincula um Pull Request a um Work Item           |

### Pipelines

| Ferramenta           | Descrição                                          |
|----------------------|-----------------------------------------------------|
| `getPipelineStatus`  | Retorna o status da execução mais recente do pipeline |

---

## 🗂 Estrutura do Projeto

```
mcp-azure-devops/
├── src/
│   ├── server.ts              # Entrypoint MCP (registra tools, inicia stdio)
│   ├── config.ts              # Carrega env vars + autenticação
│   └── azure/
│       ├── boards.ts          # Chamadas HTTP — Work Items
│       ├── repos.ts           # Chamadas HTTP — Pull Requests
│       └── pipelines.ts       # Chamadas HTTP — Pipelines
├── package.json
├── tsconfig.json
├── .env.example
└── README.md
```

---

## 📄 Licença

MIT
