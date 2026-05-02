# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build   # Compile TypeScript to dist/
npm start       # Run compiled server (dist/server.js)
npm run dev     # Build + run in one step
```

No test runner or linter is configured.

## Environment Setup

Create a `.env` file at the project root (see `.env.example`):

```
AZURE_ORG=your-organization
AZURE_PROJECT=your-project
AZURE_PAT=your-personal-access-token
```

Config is loaded via `src/config.ts` on startup; the server exits with code 1 if any variable is missing.

## Architecture

This is an **MCP (Model Context Protocol) server** that exposes Azure DevOps as tools for AI assistants. It communicates over stdio (stdin/stdout) using `StdioServerTransport`.

```
src/
├── server.ts        # Entry point — registers all 33 tools, starts stdio transport
├── config.ts        # Loads .env, builds base URLs, generates Basic Auth header
└── azure/
    ├── boards.ts    # Work items: CRUD, batch fetch, WIQL, links, history, comments, attachments, discovery, bulk ops
    ├── http.ts      # azureFetch helper with retry/backoff and typed AzureDevOpsError
    ├── repos.ts     # Pull requests: create, link to work items, permissions
    └── pipelines.ts # Pipelines: latest run status
```

### Tool registration pattern (`server.ts`)

Each tool is registered with a name, description, and Zod schema, then delegates to a function in the relevant `azure/` module. Results are returned as MCP content objects via `jsonContent()` / `errorContent()` helpers.

### Service layer pattern (`azure/*.ts`)

Each module:
- Defines TypeScript interfaces for API shapes
- Builds Azure DevOps REST API v7.1 URLs from config (org/project-scoped)
- Makes HTTP requests via `azureFetch` (retry on 429/5xx, typed errors) using Basic Auth (base64-encoded PAT)
- Returns typed data or throws `AzureDevOpsError` with `status`, `typeKey`, `errorCode`, `message`

### Tool categories

| Category | Tools |
|---|---|
| Boards (read) | `getWorkItem`, `getWorkItemsBatch` (field projection, chunked), `queryWorkItems` (WIQL + pagination), `listWorkItemTypes` (+ `includeFields`), `getMyWorkItems` |
| Boards (write) | `createWorkItem` (+ `customFields`, `bypassRules`, `links[]`), `updateWorkItem` (+ `customFields`, `bypassRules`), `updateWorkItemState`, `deleteWorkItem`, `addWorkItemComment` |
| Boards (bulk) | `bulkCreateWorkItems` (max 50), `bulkUpdateWorkItems` (max 50), `moveWorkItem` |
| Boards (links) | `listWorkItemRelations`, `linkWorkItems` (friendly link types), `removeWorkItemLink` |
| Boards (history) | `listWorkItemRevisions`, `getWorkItemRevision`, `listWorkItemUpdates` |
| Boards (comments) | `listWorkItemComments`, `updateWorkItemComment`, `deleteWorkItemComment` |
| Boards (attachments) | `uploadAttachment`, `attachToWorkItem`, `listWorkItemAttachments`, `downloadAttachment` |
| Boards (discovery) | `listIterations`, `listAreas`, `listTeams` |
| Repos | `createPullRequest`, `linkPullRequestToWorkItem` |
| Pipelines | `getPipelineStatus` |

### Adding a new tool

1. Implement the function in the appropriate `src/azure/*.ts` module
2. Register it in `src/server.ts` with a Zod parameter schema
3. Run `npm run build` to compile
