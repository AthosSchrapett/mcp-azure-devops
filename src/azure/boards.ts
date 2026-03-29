import fetch from "node-fetch";
import { AzureDevOpsConfig, getAuthHeader } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkItem {
    id: number;
    rev: number;
    fields: Record<string, unknown>;
    relations?: { rel: string; url: string; attributes?: Record<string, unknown> }[];
    url: string;
}

export interface WorkItemQueryResult {
    workItems: { id: number; url: string }[];
}

export interface WorkItemComment {
    id: number;
    text: string;
    createdDate: string;
}

export interface WorkItemTypeInfo {
    name: string;
    description: string;
    states: { name: string; category: string }[];
    fieldInstances: { referenceName: string; name: string; helpText?: string }[];
}

export interface CreateWorkItemInput {
    type: string;
    title: string;
    description?: string;
    acceptanceCriteria?: string;
    state?: string;
    tags?: string;
    priority?: number;
    storyPoints?: number;
    iterationPath?: string;
    areaPath?: string;
    assignedTo?: string;
    parentId?: number;
}

export interface UpdateWorkItemInput {
    title?: string;
    description?: string;
    acceptanceCriteria?: string;
    state?: string;
    tags?: string;
    priority?: number;
    storyPoints?: number;
    iterationPath?: string;
    areaPath?: string;
    assignedTo?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiBase(config: AzureDevOpsConfig, project?: string): string {
    const proj = project || config.project;
    return `https://dev.azure.com/${config.organization}/${proj}/_apis`;
}

function orgApiBase(config: AzureDevOpsConfig): string {
    return `https://dev.azure.com/${config.organization}/_apis`;
}

function headers(config: AzureDevOpsConfig, contentType = "application/json") {
    return {
        Authorization: getAuthHeader(config),
        "Content-Type": contentType,
    };
}

async function getErrorText(response: { text: () => Promise<string> }): Promise<string> {
    try {
        return await response.text();
    } catch {
        return "unknown error";
    }
}

// ---------------------------------------------------------------------------
// Public API — Read
// ---------------------------------------------------------------------------

/**
 * Retrieves a single work item by its ID, optionally expanding relations.
 */
export async function getWorkItem(
    config: AzureDevOpsConfig,
    id: number,
    expand?: string
): Promise<WorkItem> {
    const expandParam = expand ? `&$expand=${expand}` : "";
    const url = `${orgApiBase(config)}/wit/workitems/${id}?api-version=7.1${expandParam}`;

    const response = await fetch(url, {
        method: "GET",
        headers: headers(config),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to get work item ${id}: ${await getErrorText(response)}`
        );
    }

    return (await response.json()) as WorkItem;
}

/**
 * Retrieves multiple work items by their IDs in a single batch request.
 */
export async function getWorkItemsBatch(
    config: AzureDevOpsConfig,
    ids: number[],
    expand?: string
): Promise<WorkItem[]> {
    if (ids.length === 0) return [];

    const results: WorkItem[] = [];
    // Azure DevOps limits batch requests to 200 IDs at a time
    for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const expandParam = expand ? `&$expand=${expand}` : "";
        const url = `${orgApiBase(config)}/wit/workitems?ids=${chunk.join(",")}&api-version=7.1${expandParam}`;

        const response = await fetch(url, {
            method: "GET",
            headers: headers(config),
        });

        if (!response.ok) {
            throw new Error(
                `Failed to get work items batch: ${await getErrorText(response)}`
            );
        }

        const data = (await response.json()) as { value: WorkItem[] };
        results.push(...data.value);
    }

    return results;
}

/**
 * Executes a WIQL query and returns matching work item references.
 * When fetchDetails is true, also fetches the full work item details.
 */
export async function queryWorkItems(
    config: AzureDevOpsConfig,
    wiql: string,
    fetchDetails = false
): Promise<WorkItemQueryResult | { workItems: WorkItem[] }> {
    const url = `${apiBase(config)}/wit/wiql?api-version=7.1`;

    const response = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({ query: wiql }),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to query work items: ${await getErrorText(response)}`
        );
    }

    const queryResult = (await response.json()) as WorkItemQueryResult;

    if (!fetchDetails || !queryResult.workItems || queryResult.workItems.length === 0) {
        return queryResult;
    }

    const ids = queryResult.workItems.map((wi) => wi.id);
    const items = await getWorkItemsBatch(config, ids);
    return { workItems: items };
}

/**
 * Lists available work item types and their valid states for the project.
 */
export async function listWorkItemTypes(
    config: AzureDevOpsConfig,
    project?: string
): Promise<WorkItemTypeInfo[]> {
    const url = `${apiBase(config, project)}/wit/workitemtypes?api-version=7.1`;

    const response = await fetch(url, {
        method: "GET",
        headers: headers(config),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to list work item types: ${await getErrorText(response)}`
        );
    }

    const data = (await response.json()) as { value: WorkItemTypeInfo[] };
    return data.value;
}

// ---------------------------------------------------------------------------
// Public API — Write
// ---------------------------------------------------------------------------

/**
 * Creates a new work item with the given fields and optional parent link.
 */
export async function createWorkItem(
    config: AzureDevOpsConfig,
    input: CreateWorkItemInput,
    project?: string
): Promise<WorkItem> {
    const encodedType = encodeURIComponent(input.type);
    const url = `${apiBase(config, project)}/wit/workitems/$${encodedType}?api-version=7.1`;

    const patch: { op: string; path: string; value?: unknown }[] = [];

    // Required field
    patch.push({ op: "add", path: "/fields/System.Title", value: input.title });

    // Optional fields
    const optionalFields: [string, unknown][] = [
        ["/fields/System.Description", input.description],
        ["/fields/Microsoft.VSTS.Common.AcceptanceCriteria", input.acceptanceCriteria],
        ["/fields/System.State", input.state],
        ["/fields/System.Tags", input.tags],
        ["/fields/Microsoft.VSTS.Common.Priority", input.priority],
        ["/fields/Microsoft.VSTS.Scheduling.StoryPoints", input.storyPoints],
        ["/fields/System.IterationPath", input.iterationPath],
        ["/fields/System.AreaPath", input.areaPath],
        ["/fields/System.AssignedTo", input.assignedTo],
    ];

    for (const [path, value] of optionalFields) {
        if (value !== undefined && value !== null && value !== "") {
            patch.push({ op: "add", path, value });
        }
    }

    // Parent link
    if (input.parentId) {
        patch.push({
            op: "add",
            path: "/relations/-",
            value: {
                rel: "System.LinkTypes.Hierarchy-Reverse",
                url: `https://dev.azure.com/${config.organization}/_apis/wit/workitems/${input.parentId}`,
                attributes: { comment: "Parent link" },
            },
        });
    }

    const response = await fetch(url, {
        method: "POST",
        headers: headers(config, "application/json-patch+json"),
        body: JSON.stringify(patch),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to create work item "${input.title}": ${await getErrorText(response)}`
        );
    }

    return (await response.json()) as WorkItem;
}

/**
 * Updates one or more fields of an existing work item.
 */
export async function updateWorkItem(
    config: AzureDevOpsConfig,
    id: number,
    updates: UpdateWorkItemInput
): Promise<WorkItem> {
    const url = `${orgApiBase(config)}/wit/workitems/${id}?api-version=7.1`;

    const fieldMap: [string, unknown][] = [
        ["/fields/System.Title", updates.title],
        ["/fields/System.Description", updates.description],
        ["/fields/Microsoft.VSTS.Common.AcceptanceCriteria", updates.acceptanceCriteria],
        ["/fields/System.State", updates.state],
        ["/fields/System.Tags", updates.tags],
        ["/fields/Microsoft.VSTS.Common.Priority", updates.priority],
        ["/fields/Microsoft.VSTS.Scheduling.StoryPoints", updates.storyPoints],
        ["/fields/System.IterationPath", updates.iterationPath],
        ["/fields/System.AreaPath", updates.areaPath],
        ["/fields/System.AssignedTo", updates.assignedTo],
    ];

    const patch: { op: string; path: string; value: unknown }[] = [];
    for (const [path, value] of fieldMap) {
        if (value !== undefined && value !== null) {
            patch.push({ op: "replace", path, value });
        }
    }

    if (patch.length === 0) {
        throw new Error("No fields to update. Provide at least one field.");
    }

    const response = await fetch(url, {
        method: "PATCH",
        headers: headers(config, "application/json-patch+json"),
        body: JSON.stringify(patch),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to update work item ${id}: ${await getErrorText(response)}`
        );
    }

    return (await response.json()) as WorkItem;
}

/**
 * Updates the state of a work item (e.g. "Active", "Closed").
 * Kept for backward compatibility — delegates to updateWorkItem.
 */
export async function updateWorkItemState(
    config: AzureDevOpsConfig,
    id: number,
    state: string
): Promise<WorkItem> {
    return updateWorkItem(config, id, { state });
}

/**
 * Deletes a work item. When destroy is true, permanently removes it;
 * otherwise moves it to the recycle bin.
 */
export async function deleteWorkItem(
    config: AzureDevOpsConfig,
    id: number,
    destroy = false
): Promise<{ id: number; deleted: boolean }> {
    const url = `${orgApiBase(config)}/wit/workitems/${id}?destroy=${destroy}&api-version=7.1`;

    const response = await fetch(url, {
        method: "DELETE",
        headers: headers(config),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to delete work item ${id}: ${await getErrorText(response)}`
        );
    }

    return { id, deleted: true };
}

/**
 * Adds a comment to a work item.
 */
export async function addWorkItemComment(
    config: AzureDevOpsConfig,
    id: number,
    comment: string
): Promise<WorkItemComment> {
    const url = `${orgApiBase(config)}/wit/workitems/${id}/comments?api-version=7.1-preview.4`;

    const response = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({ text: comment }),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to add comment to work item ${id}: ${await getErrorText(response)}`
        );
    }

    return (await response.json()) as WorkItemComment;
}
