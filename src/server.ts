import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig, AzureDevOpsConfig } from "./config.js";

// Azure service modules
import {
    getWorkItem,
    getWorkItemsBatch,
    queryWorkItems,
    createWorkItem,
    updateWorkItem,
    updateWorkItemState,
    deleteWorkItem,
    addWorkItemComment,
    listWorkItemTypes,
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
    version: "2.0.0",
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
// Boards Tools — Read
// ---------------------------------------------------------------------------

server.tool(
    "getWorkItem",
    "Retrieves a single Azure DevOps work item by its ID. Optionally expands relations to see parent/child links.",
    {
        id: z.number().int().positive().describe("The work item ID"),
        expand: z.enum(["None", "Relations", "Fields", "Links", "All"]).optional().describe("Optional expansion (e.g. 'Relations' to see parent/child links)"),
    },
    async ({ id, expand }) => {
        try {
            const result = await getWorkItem(config, id, expand);
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "getWorkItemsBatch",
    "Retrieves multiple Azure DevOps work items by their IDs in a single batch request. More efficient than calling getWorkItem multiple times.",
    {
        ids: z.array(z.number().int().positive()).min(1).max(200).describe("Array of work item IDs to retrieve"),
        expand: z.enum(["None", "Relations", "Fields", "Links", "All"]).optional().describe("Optional expansion"),
    },
    async ({ ids, expand }) => {
        try {
            const result = await getWorkItemsBatch(config, ids, expand);
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "queryWorkItems",
    "Executes a WIQL query against Azure Boards and returns matching work items. Set fetchDetails to true to get full item data instead of just IDs.",
    {
        wiql: z.string().min(1).describe("The WIQL query string"),
        fetchDetails: z.boolean().optional().describe("When true, returns full work item details instead of just IDs"),
    },
    async ({ wiql, fetchDetails }) => {
        try {
            const result = await queryWorkItems(config, wiql, fetchDetails ?? false);
            return jsonContent(result);
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "listWorkItemTypes",
    "Lists all available work item types (Epic, Feature, PBI, Task, Bug, Impediment, etc.) and their valid states for the project.",
    {},
    async () => {
        try {
            const result = await listWorkItemTypes(config);
            // Return a simplified view for readability
            const simplified = result.map((t) => ({
                name: t.name,
                description: t.description,
                states: t.states?.map((s) => s.name) ?? [],
            }));
            return jsonContent(simplified);
        } catch (err) {
            return errorContent(err);
        }
    }
);

// ---------------------------------------------------------------------------
// Boards Tools — Write
// ---------------------------------------------------------------------------

server.tool(
    "createWorkItem",
    "Creates a new work item (Epic, Feature, Product Backlog Item, Task, Bug, Impediment, etc.) in Azure DevOps with the given fields. Optionally links to a parent by ID.",
    {
        type: z.string().min(1).describe("Work item type (e.g. 'Epic', 'Feature', 'Product Backlog Item', 'Task', 'Bug', 'Impediment')"),
        title: z.string().min(1).describe("Title of the work item"),
        description: z.string().optional().describe("HTML or plain text description"),
        acceptanceCriteria: z.string().optional().describe("Acceptance criteria (for PBIs)"),
        state: z.string().optional().describe("Initial state (e.g. 'New', 'Open'). Must be valid for the type."),
        tags: z.string().optional().describe("Semicolon-separated tags (e.g. 'MVP; Auth; Backend')"),
        priority: z.number().int().min(1).max(4).optional().describe("Priority (1=highest, 4=lowest)"),
        storyPoints: z.number().optional().describe("Story points (for PBIs)"),
        iterationPath: z.string().optional().describe("Iteration path (e.g. 'Arenar\\\\Sprint 1')"),
        areaPath: z.string().optional().describe("Area path"),
        assignedTo: z.string().optional().describe("Display name or email of the assignee"),
        parentId: z.number().int().positive().optional().describe("ID of the parent work item to link to"),
    },
    async (input) => {
        try {
            const result = await createWorkItem(config, input);
            return jsonContent({ id: result.id, title: result.fields["System.Title"], url: result.url });
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "updateWorkItem",
    "Updates one or more fields of an existing work item. Only provide the fields you want to change.",
    {
        id: z.number().int().positive().describe("The work item ID to update"),
        title: z.string().optional().describe("New title"),
        description: z.string().optional().describe("New description"),
        acceptanceCriteria: z.string().optional().describe("New acceptance criteria"),
        state: z.string().optional().describe("New state (e.g. 'Active', 'Closed', 'Done')"),
        tags: z.string().optional().describe("New tags (semicolon-separated, replaces all existing tags)"),
        priority: z.number().int().min(1).max(4).optional().describe("New priority"),
        storyPoints: z.number().optional().describe("New story points"),
        iterationPath: z.string().optional().describe("New iteration path"),
        areaPath: z.string().optional().describe("New area path"),
        assignedTo: z.string().optional().describe("New assignee (display name or email)"),
    },
    async ({ id, ...updates }) => {
        try {
            const result = await updateWorkItem(config, id, updates);
            return jsonContent({ id: result.id, rev: result.rev, title: result.fields["System.Title"], state: result.fields["System.State"] });
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "updateWorkItemState",
    "Updates the state of an Azure DevOps work item (e.g. Active, Closed, Resolved). Shortcut for updateWorkItem with only state.",
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
    "deleteWorkItem",
    "Deletes a work item from Azure DevOps. By default moves to recycle bin; set destroy=true to permanently delete.",
    {
        id: z.number().int().positive().describe("The work item ID to delete"),
        destroy: z.boolean().optional().describe("When true, permanently destroys the item (cannot be recovered). Default: false (recycle bin)."),
    },
    async ({ id, destroy }) => {
        try {
            const result = await deleteWorkItem(config, id, destroy ?? false);
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
    console.error("[mcp-azure-devops] Server v2.0.0 started and listening on stdio.");
}

main().catch((err) => {
    console.error("[mcp-azure-devops] Fatal error:", (err as Error).message);
    process.exit(1);
});
