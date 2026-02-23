import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig, AzureDevOpsConfig } from "./config.js";

// Azure service modules
import {
    getWorkItem,
    queryWorkItems,
    updateWorkItemState,
    addWorkItemComment,
} from "./azure/boards.js";
import {
    createPullRequest,
    linkPullRequestToWorkItem,
} from "./azure/repos.js";
import { getPipelineStatus } from "./azure/pipelines.js";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

let config: AzureDevOpsConfig;

try {
    config = loadConfig();
} catch (err) {
    console.error(
        `[mcp-azure-devops] Configuration error: ${(err as Error).message}`
    );
    process.exit(1);
}

const server = new McpServer({
    name: "mcp-azure-devops",
    version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Tool helpers
// ---------------------------------------------------------------------------

function errorContent(error: unknown): { content: { type: "text"; text: string }[] } {
    const message =
        error instanceof Error
            ? error.message
            : "An unexpected error occurred.";
    return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

function jsonContent(data: unknown): { content: { type: "text"; text: string }[] } {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
}

// ---------------------------------------------------------------------------
// Boards Tools
// ---------------------------------------------------------------------------

server.tool(
    "getWorkItem",
    "Retrieves a single Azure DevOps work item by its ID.",
    { id: z.number().int().positive().describe("The work item ID") },
    async ({ id }) => {
        try {
            const result = await getWorkItem(config, id);
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "queryWorkItems",
    "Executes a WIQL query against Azure Boards and returns matching work items.",
    { wiql: z.string().min(1).describe("The WIQL query string") },
    async ({ wiql }) => {
        try {
            const result = await queryWorkItems(config, wiql);
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "updateWorkItemState",
    "Updates the state of an Azure DevOps work item (e.g. Active, Closed, Resolved).",
    {
        id: z.number().int().positive().describe("The work item ID"),
        state: z.string().min(1).describe("The new state value"),
    },
    async ({ id, state }) => {
        try {
            const result = await updateWorkItemState(config, id, state);
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "addWorkItemComment",
    "Adds a comment to an Azure DevOps work item.",
    {
        id: z.number().int().positive().describe("The work item ID"),
        comment: z.string().min(1).describe("The comment text to add"),
    },
    async ({ id, comment }) => {
        try {
            const result = await addWorkItemComment(config, id, comment);
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

// ---------------------------------------------------------------------------
// Repos Tools
// ---------------------------------------------------------------------------

server.tool(
    "createPullRequest",
    "Creates a new Pull Request in an Azure DevOps Git repository.",
    {
        repositoryId: z.string().min(1).describe("The repository ID or name"),
        sourceBranch: z.string().min(1).describe("Source branch name"),
        targetBranch: z.string().min(1).describe("Target branch name"),
        title: z.string().min(1).describe("Pull request title"),
        description: z.string().describe("Pull request description"),
    },
    async ({ repositoryId, sourceBranch, targetBranch, title, description }) => {
        try {
            const result = await createPullRequest(config, {
                repositoryId,
                sourceBranch,
                targetBranch,
                title,
                description,
            });
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "linkPullRequestToWorkItem",
    "Links an existing Pull Request to a Work Item in Azure DevOps.",
    {
        pullRequestId: z.number().int().positive().describe("The pull request ID"),
        workItemId: z.number().int().positive().describe("The work item ID to link to"),
    },
    async ({ pullRequestId, workItemId }) => {
        try {
            const result = await linkPullRequestToWorkItem(
                config,
                pullRequestId,
                workItemId
            );
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

// ---------------------------------------------------------------------------
// Pipelines Tools
// ---------------------------------------------------------------------------

server.tool(
    "getPipelineStatus",
    "Gets the latest run status of an Azure DevOps pipeline.",
    {
        pipelineId: z.number().int().positive().describe("The pipeline ID"),
    },
    async ({ pipelineId }) => {
        try {
            const result = await getPipelineStatus(config, pipelineId);
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[mcp-azure-devops] Server started and listening on stdio.");
}

main().catch((err) => {
    console.error("[mcp-azure-devops] Fatal error:", (err as Error).message);
    process.exit(1);
});
