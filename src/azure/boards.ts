import fetch from "node-fetch";
import { AzureDevOpsConfig, getAuthHeader } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkItem {
    id: number;
    rev: number;
    fields: Record<string, unknown>;
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiBase(config: AzureDevOpsConfig): string {
    return `https://dev.azure.com/${config.organization}/${config.project}/_apis`;
}

function headers(config: AzureDevOpsConfig, contentType = "application/json") {
    return {
        Authorization: getAuthHeader(config),
        "Content-Type": contentType,
    };
}

function sanitizeError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return "An unexpected error occurred while communicating with Azure DevOps.";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieves a single work item by its ID.
 */
export async function getWorkItem(
    config: AzureDevOpsConfig,
    id: number
): Promise<WorkItem> {
    const url = `${apiBase(config)}/wit/workitems/${id}?api-version=7.1`;

    const response = await fetch(url, {
        method: "GET",
        headers: headers(config),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to get work item ${id}: ${sanitizeError(await response.text().catch(() => "unknown error"))}`
        );
    }

    return (await response.json()) as WorkItem;
}

/**
 * Executes a WIQL query and returns matching work item references.
 */
export async function queryWorkItems(
    config: AzureDevOpsConfig,
    wiql: string
): Promise<WorkItemQueryResult> {
    const url = `${apiBase(config)}/wit/wiql?api-version=7.1`;

    const response = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({ query: wiql }),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to query work items: ${sanitizeError(await response.text().catch(() => "unknown error"))}`
        );
    }

    return (await response.json()) as WorkItemQueryResult;
}

/**
 * Updates the state of a work item (e.g. "Active", "Closed").
 */
export async function updateWorkItemState(
    config: AzureDevOpsConfig,
    id: number,
    state: string
): Promise<WorkItem> {
    const url = `${apiBase(config)}/wit/workitems/${id}?api-version=7.1`;

    const body = [
        {
            op: "replace",
            path: "/fields/System.State",
            value: state,
        },
    ];

    const response = await fetch(url, {
        method: "PATCH",
        headers: headers(config, "application/json-patch+json"),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to update work item ${id} state to "${state}": ${sanitizeError(await response.text().catch(() => "unknown error"))}`
        );
    }

    return (await response.json()) as WorkItem;
}

/**
 * Adds a comment to a work item.
 */
export async function addWorkItemComment(
    config: AzureDevOpsConfig,
    id: number,
    comment: string
): Promise<WorkItemComment> {
    const url = `${apiBase(config)}/wit/workitems/${id}/comments?api-version=7.1-preview.4`;

    const response = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({ text: comment }),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to add comment to work item ${id}: ${sanitizeError(await response.text().catch(() => "unknown error"))}`
        );
    }

    return (await response.json()) as WorkItemComment;
}
