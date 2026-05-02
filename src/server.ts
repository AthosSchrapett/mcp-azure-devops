import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig, AzureDevOpsConfig } from "./config.js";

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
    linkWorkItems,
    removeWorkItemLink,
    listWorkItemRelations,
    listWorkItemRevisions,
    getWorkItemRevision,
    listWorkItemUpdates,
    listWorkItemComments,
    updateWorkItemComment,
    deleteWorkItemComment,
    uploadAttachment,
    attachToWorkItem,
    listWorkItemAttachments,
    downloadAttachment,
    listIterations,
    listAreas,
    listTeams,
    getMyWorkItems,
    bulkUpdateWorkItems,
    bulkCreateWorkItems,
    moveWorkItem,
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
    version: "3.0.0",
});

// ---------------------------------------------------------------------------
// Tool helpers
// ---------------------------------------------------------------------------

function errorContent(error: unknown): { content: { type: "text"; text: string }[] } {
    const message =
        error instanceof Error ? error.message : "An unexpected error occurred.";
    return { content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

function jsonContent(data: unknown): { content: { type: "text"; text: string }[] } {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
}

// ---------------------------------------------------------------------------
// Boards — Read
// ---------------------------------------------------------------------------

server.tool(
    "getWorkItem",
    "Retrieves a single Azure DevOps work item by its ID. Optionally expands relations to see parent/child links.",
    {
        id: z.number().int().positive().describe("The work item ID"),
        expand: z
            .enum(["None", "Relations", "Fields", "Links", "All"])
            .optional()
            .describe("Optional expansion (e.g. 'Relations' to see parent/child links)"),
    },
    async ({ id, expand }) => {
        try {
            return jsonContent(await getWorkItem(config, id, expand));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "getWorkItemsBatch",
    "Retrieves multiple Azure DevOps work items by their IDs. Supports field projection to reduce payload size.",
    {
        ids: z
            .array(z.number().int().positive())
            .min(1)
            .describe("Array of work item IDs to retrieve (internally chunked at 200)"),
        fields: z
            .array(z.string())
            .optional()
            .describe("Field projection to reduce payload (e.g. ['System.Title', 'System.State'])"),
        expand: z
            .enum(["None", "Relations", "Fields", "Links", "All"])
            .optional()
            .describe("Optional expansion"),
    },
    async ({ ids, fields, expand }) => {
        try {
            return jsonContent(await getWorkItemsBatch(config, ids, expand, fields));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "queryWorkItems",
    "Executes a WIQL query against Azure Boards. Set fetchDetails=true to get full item data. Use top/skip for pagination.",
    {
        wiql: z.string().min(1).describe("The WIQL query string"),
        fetchDetails: z
            .boolean()
            .optional()
            .describe("When true, returns full work item details instead of just IDs"),
        top: z
            .number()
            .int()
            .min(1)
            .max(1000)
            .optional()
            .describe("Maximum number of items to return (passed as $top to WIQL endpoint)"),
        skip: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe("Number of items to skip from the result (client-side)"),
    },
    async ({ wiql, fetchDetails, top, skip }) => {
        try {
            return jsonContent(await queryWorkItems(config, wiql, fetchDetails ?? false, top, skip));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "listWorkItemTypes",
    "Lists all available work item types and their valid states. Set includeFields=true to also get field definitions.",
    {
        includeFields: z
            .boolean()
            .optional()
            .describe("When true, includes field definitions for each type (useful for discovering custom fields)"),
    },
    async ({ includeFields }) => {
        try {
            const result = await listWorkItemTypes(config);
            if (includeFields) {
                return jsonContent(result);
            }
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

server.tool(
    "getMyWorkItems",
    "Retrieves work items assigned to the current user (@Me). Optionally filter by type and state.",
    {
        types: z
            .array(z.string())
            .optional()
            .describe("Filter by work item types (e.g. ['Task', 'Bug'])"),
        states: z
            .array(z.string())
            .optional()
            .describe("Filter by states (e.g. ['Active', 'New'])"),
        top: z
            .number()
            .int()
            .min(1)
            .max(200)
            .optional()
            .describe("Maximum number of items to return (default: all)"),
    },
    async ({ types, states, top }) => {
        try {
            return jsonContent(await getMyWorkItems(config, types, states, top));
        } catch (err) {
            return errorContent(err);
        }
    }
);

// ---------------------------------------------------------------------------
// Boards — Write
// ---------------------------------------------------------------------------

server.tool(
    "createWorkItem",
    "Creates a new work item in Azure DevOps. Supports parent link, additional links, and custom fields.",
    {
        type: z
            .string()
            .min(1)
            .describe("Work item type (e.g. 'Epic', 'Feature', 'Product Backlog Item', 'Task', 'Bug')"),
        title: z.string().min(1).describe("Title of the work item"),
        description: z.string().optional().describe("HTML or plain text description"),
        acceptanceCriteria: z.string().optional().describe("Acceptance criteria (for PBIs)"),
        state: z
            .string()
            .optional()
            .describe("Initial state (e.g. 'New', 'Open'). Must be valid for the type."),
        tags: z.string().optional().describe("Semicolon-separated tags (e.g. 'MVP; Auth; Backend')"),
        priority: z.number().int().min(1).max(4).optional().describe("Priority (1=highest, 4=lowest)"),
        storyPoints: z.number().optional().describe("Story points (for PBIs)"),
        iterationPath: z.string().optional().describe("Iteration path (e.g. 'MyProject\\\\Sprint 1')"),
        areaPath: z.string().optional().describe("Area path"),
        assignedTo: z.string().optional().describe("Display name or email of the assignee"),
        parentId: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("ID of the parent work item to link to"),
        links: z
            .array(
                z.object({
                    type: z.enum([
                        "Parent", "Child", "Related",
                        "Predecessor", "Successor",
                        "TestedBy", "Tests",
                        "Affects", "AffectedBy",
                    ]),
                    targetId: z.number().int().positive(),
                    comment: z.string().optional(),
                })
            )
            .optional()
            .describe("Additional links to create (beyond parentId)"),
        customFields: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
            .optional()
            .describe("Custom or process-specific fields (e.g. { 'Custom.Severity': 'Critical' })"),
        bypassRules: z
            .boolean()
            .optional()
            .describe("When true, bypasses work item rules (useful for import/migration)"),
    },
    async (input) => {
        try {
            const result = await createWorkItem(config, input as Parameters<typeof createWorkItem>[1]);
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
        customFields: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
            .optional()
            .describe("Custom or process-specific fields to update"),
        bypassRules: z
            .boolean()
            .optional()
            .describe("When true, bypasses work item rules"),
    },
    async ({ id, ...updates }) => {
        try {
            const result = await updateWorkItem(config, id, updates as Parameters<typeof updateWorkItem>[2]);
            return jsonContent({
                id: result.id,
                rev: result.rev,
                title: result.fields["System.Title"],
                state: result.fields["System.State"],
            });
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
            return jsonContent(await updateWorkItemState(config, id, state));
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
        destroy: z
            .boolean()
            .optional()
            .describe("When true, permanently destroys the item. Default: false (recycle bin)."),
    },
    async ({ id, destroy }) => {
        try {
            return jsonContent(await deleteWorkItem(config, id, destroy ?? false));
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
            return jsonContent(await addWorkItemComment(config, id, comment));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "bulkUpdateWorkItems",
    "Updates multiple Azure DevOps work items in a single operation (max 50). Each item specifies its ID and the fields to change.",
    {
        updates: z
            .array(
                z.object({
                    id: z.number().int().positive().describe("Work item ID"),
                    title: z.string().optional(),
                    description: z.string().optional(),
                    acceptanceCriteria: z.string().optional(),
                    state: z.string().optional(),
                    tags: z.string().optional(),
                    priority: z.number().int().min(1).max(4).optional(),
                    storyPoints: z.number().optional(),
                    iterationPath: z.string().optional(),
                    areaPath: z.string().optional(),
                    assignedTo: z.string().optional(),
                    customFields: z
                        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
                        .optional(),
                })
            )
            .min(1)
            .max(50)
            .describe("Array of work items to update (max 50)"),
    },
    async ({ updates }) => {
        try {
            const results = await bulkUpdateWorkItems(config, updates as Parameters<typeof bulkUpdateWorkItems>[1]);
            return jsonContent(
                results.map((r) => ({
                    id: r.id,
                    rev: r.rev,
                    title: r.fields["System.Title"],
                    state: r.fields["System.State"],
                }))
            );
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "bulkCreateWorkItems",
    "Creates multiple work items in a single operation (max 50).",
    {
        items: z
            .array(
                z.object({
                    type: z.string().min(1),
                    title: z.string().min(1),
                    description: z.string().optional(),
                    acceptanceCriteria: z.string().optional(),
                    state: z.string().optional(),
                    tags: z.string().optional(),
                    priority: z.number().int().min(1).max(4).optional(),
                    storyPoints: z.number().optional(),
                    iterationPath: z.string().optional(),
                    areaPath: z.string().optional(),
                    assignedTo: z.string().optional(),
                    parentId: z.number().int().positive().optional(),
                    customFields: z
                        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
                        .optional(),
                })
            )
            .min(1)
            .max(50)
            .describe("Array of work items to create (max 50)"),
    },
    async ({ items }) => {
        try {
            const results = await bulkCreateWorkItems(config, items as Parameters<typeof bulkCreateWorkItems>[1]);
            return jsonContent(
                results.map((r) => ({ id: r.id, title: r.fields["System.Title"], url: r.url }))
            );
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "moveWorkItem",
    "Moves a work item to a different project within the same Azure DevOps organization.",
    {
        id: z.number().int().positive().describe("The work item ID to move"),
        targetProject: z.string().min(1).describe("Target project name"),
        targetAreaPath: z
            .string()
            .optional()
            .describe("Target area path in the new project (defaults to project root)"),
        targetIterationPath: z
            .string()
            .optional()
            .describe("Target iteration path in the new project"),
    },
    async ({ id, targetProject, targetAreaPath, targetIterationPath }) => {
        try {
            const result = await moveWorkItem(config, id, targetProject, targetAreaPath, targetIterationPath);
            return jsonContent({
                id: result.id,
                project: result.fields["System.TeamProject"],
                areaPath: result.fields["System.AreaPath"],
                iterationPath: result.fields["System.IterationPath"],
            });
        } catch (err) {
            return errorContent(err);
        }
    }
);

// ---------------------------------------------------------------------------
// Boards — Links
// ---------------------------------------------------------------------------

server.tool(
    "listWorkItemRelations",
    "Lists all relations (parent, child, related, attachments, etc.) of a work item with their indexes.",
    {
        id: z.number().int().positive().describe("The work item ID"),
    },
    async ({ id }) => {
        try {
            return jsonContent(await listWorkItemRelations(config, id));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "linkWorkItems",
    "Links two Azure DevOps work items with a specified relationship. Parent=target is parent of source, Predecessor=target must complete before source.",
    {
        sourceId: z.number().int().positive().describe("ID of the source work item"),
        targetId: z.number().int().positive().describe("ID of the target work item"),
        linkType: z
            .enum([
                "Parent", "Child", "Related",
                "Predecessor", "Successor",
                "TestedBy", "Tests",
                "Affects", "AffectedBy",
            ])
            .describe("Relationship type"),
        comment: z.string().optional().describe("Optional comment for the link"),
    },
    async ({ sourceId, targetId, linkType, comment }) => {
        try {
            const result = await linkWorkItems(config, sourceId, targetId, linkType, comment);
            return jsonContent({ id: result.id, rev: result.rev });
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "removeWorkItemLink",
    "Removes a relation link from a work item by its zero-based index. Use listWorkItemRelations to find the index.",
    {
        workItemId: z.number().int().positive().describe("ID of the work item"),
        relationIndex: z
            .number()
            .int()
            .min(0)
            .describe("Zero-based index of the relation to remove"),
    },
    async ({ workItemId, relationIndex }) => {
        try {
            const result = await removeWorkItemLink(config, workItemId, relationIndex);
            return jsonContent({ id: result.id, rev: result.rev });
        } catch (err) {
            return errorContent(err);
        }
    }
);

// ---------------------------------------------------------------------------
// Boards — History & Comments
// ---------------------------------------------------------------------------

server.tool(
    "listWorkItemRevisions",
    "Lists historical revisions of an Azure DevOps work item (full snapshots).",
    {
        id: z.number().int().positive().describe("The work item ID"),
        top: z.number().int().min(1).max(200).optional().describe("Maximum revisions to return"),
        skip: z.number().int().min(0).optional().describe("Number of revisions to skip"),
    },
    async ({ id, top, skip }) => {
        try {
            return jsonContent(await listWorkItemRevisions(config, id, top, skip));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "getWorkItemRevision",
    "Gets a specific historical revision snapshot of an Azure DevOps work item.",
    {
        id: z.number().int().positive().describe("The work item ID"),
        revisionNumber: z.number().int().positive().describe("The revision number to retrieve"),
    },
    async ({ id, revisionNumber }) => {
        try {
            return jsonContent(await getWorkItemRevision(config, id, revisionNumber));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "listWorkItemUpdates",
    "Lists field-level diffs for a work item, showing what changed, by whom, and when.",
    {
        id: z.number().int().positive().describe("The work item ID"),
        top: z.number().int().min(1).max(200).optional().describe("Maximum updates to return"),
        skip: z.number().int().min(0).optional().describe("Number of updates to skip"),
    },
    async ({ id, top, skip }) => {
        try {
            return jsonContent(await listWorkItemUpdates(config, id, top, skip));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "listWorkItemComments",
    "Lists comments on an Azure DevOps work item. Use continuationToken for pagination.",
    {
        id: z.number().int().positive().describe("The work item ID"),
        top: z.number().int().min(1).max(200).optional().describe("Maximum comments to return"),
        continuationToken: z
            .string()
            .optional()
            .describe("Token from a previous response for cursor-based pagination"),
    },
    async ({ id, top, continuationToken }) => {
        try {
            return jsonContent(await listWorkItemComments(config, id, top, continuationToken));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "updateWorkItemComment",
    "Updates the text of an existing comment on an Azure DevOps work item.",
    {
        id: z.number().int().positive().describe("The work item ID"),
        commentId: z.number().int().positive().describe("The comment ID to update"),
        text: z.string().min(1).describe("The new comment text"),
    },
    async ({ id, commentId, text }) => {
        try {
            return jsonContent(await updateWorkItemComment(config, id, commentId, text));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "deleteWorkItemComment",
    "Deletes a comment from an Azure DevOps work item.",
    {
        id: z.number().int().positive().describe("The work item ID"),
        commentId: z.number().int().positive().describe("The comment ID to delete"),
    },
    async ({ id, commentId }) => {
        try {
            await deleteWorkItemComment(config, id, commentId);
            return jsonContent({ deleted: true, commentId });
        } catch (err) {
            return errorContent(err);
        }
    }
);

// ---------------------------------------------------------------------------
// Boards — Attachments
// ---------------------------------------------------------------------------

server.tool(
    "uploadAttachment",
    "Uploads a file to Azure DevOps as an attachment. Returns a URL to use with attachToWorkItem.",
    {
        fileName: z.string().min(1).describe("File name (e.g. 'screenshot.png', 'stack-trace.txt')"),
        contentBase64: z.string().min(1).describe("File content encoded as base64"),
    },
    async ({ fileName, contentBase64 }) => {
        try {
            return jsonContent(await uploadAttachment(config, fileName, contentBase64));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "attachToWorkItem",
    "Links an uploaded attachment to a work item. First upload with uploadAttachment, then link here.",
    {
        workItemId: z.number().int().positive().describe("The work item ID"),
        attachmentUrl: z.string().min(1).describe("The URL returned by uploadAttachment"),
        comment: z.string().optional().describe("Optional description of the attachment"),
    },
    async ({ workItemId, attachmentUrl, comment }) => {
        try {
            const result = await attachToWorkItem(config, workItemId, attachmentUrl, comment);
            return jsonContent({ id: result.id, rev: result.rev });
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "listWorkItemAttachments",
    "Lists all file attachments on an Azure DevOps work item.",
    {
        id: z.number().int().positive().describe("The work item ID"),
    },
    async ({ id }) => {
        try {
            return jsonContent(await listWorkItemAttachments(config, id));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "downloadAttachment",
    "Downloads an attachment from Azure DevOps and returns it as base64-encoded content.",
    {
        attachmentId: z
            .string()
            .min(1)
            .describe("The attachment GUID (from the id field in listWorkItemAttachments)"),
    },
    async ({ attachmentId }) => {
        try {
            return jsonContent(await downloadAttachment(config, attachmentId));
        } catch (err) {
            return errorContent(err);
        }
    }
);

// ---------------------------------------------------------------------------
// Boards — Discovery
// ---------------------------------------------------------------------------

server.tool(
    "listIterations",
    "Lists sprint iterations for the Azure DevOps project. Use timeframe to filter to current/past/future sprints.",
    {
        team: z
            .string()
            .optional()
            .describe("Team name (default: project default team)"),
        timeframe: z
            .enum(["past", "current", "future"])
            .optional()
            .describe("Filter iterations by timeframe"),
    },
    async ({ team, timeframe }) => {
        try {
            return jsonContent(await listIterations(config, team, timeframe));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "listAreas",
    "Lists area paths (classification nodes) for the Azure DevOps project as a tree.",
    {
        depth: z
            .number()
            .int()
            .min(1)
            .max(10)
            .optional()
            .describe("Tree depth to retrieve (default: 2)"),
    },
    async ({ depth }) => {
        try {
            return jsonContent(await listAreas(config, depth ?? 2));
        } catch (err) {
            return errorContent(err);
        }
    }
);

server.tool(
    "listTeams",
    "Lists all teams in the Azure DevOps project.",
    {},
    async () => {
        try {
            return jsonContent(await listTeams(config));
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
            return jsonContent(
                await createPullRequest(config, { repositoryId, sourceBranch, targetBranch, title, description })
            );
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
            return jsonContent(await linkPullRequestToWorkItem(config, pullRequestId, workItemId));
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
            return jsonContent(await getPipelineStatus(config, pipelineId));
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
    console.error("[mcp-azure-devops] Server v3.0.0 started and listening on stdio.");
}

main().catch((err) => {
    console.error("[mcp-azure-devops] Fatal error:", (err as Error).message);
    process.exit(1);
});
