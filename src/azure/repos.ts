import fetch from "node-fetch";
import { AzureDevOpsConfig, getAuthHeader } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PullRequest {
    pullRequestId: number;
    title: string;
    description: string;
    status: string;
    sourceRefName: string;
    targetRefName: string;
    createdBy: { displayName: string; uniqueName: string };
    creationDate: string;
    url: string;
}

export interface CreatePullRequestInput {
    repositoryId: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
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

function normalizeBranchRef(branch: string): string {
    return branch.startsWith("refs/heads/") ? branch : `refs/heads/${branch}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a new Pull Request in the specified repository.
 */
export async function createPullRequest(
    config: AzureDevOpsConfig,
    input: CreatePullRequestInput
): Promise<PullRequest> {
    const url = `${apiBase(config)}/git/repositories/${input.repositoryId}/pullrequests?api-version=7.1`;

    const body = {
        sourceRefName: normalizeBranchRef(input.sourceBranch),
        targetRefName: normalizeBranchRef(input.targetBranch),
        title: input.title,
        description: input.description,
    };

    const response = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to create pull request: ${sanitizeError(await response.text().catch(() => "unknown error"))}`
        );
    }

    return (await response.json()) as PullRequest;
}

/**
 * Links an existing Pull Request to a Work Item using an ArtifactLink.
 */
export async function linkPullRequestToWorkItem(
    config: AzureDevOpsConfig,
    pullRequestId: number,
    workItemId: number
): Promise<unknown> {
    const artifactUri = `vstfs:///Git/PullRequestId/${config.project}%2F${pullRequestId}`;

    const url = `${apiBase(config)}/wit/workitems/${workItemId}?api-version=7.1`;

    const body = [
        {
            op: "add",
            path: "/relations/-",
            value: {
                rel: "ArtifactLink",
                url: artifactUri,
                attributes: {
                    name: "Pull Request",
                },
            },
        },
    ];

    const response = await fetch(url, {
        method: "PATCH",
        headers: headers(config, "application/json-patch+json"),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to link PR #${pullRequestId} to work item #${workItemId}: ${sanitizeError(await response.text().catch(() => "unknown error"))}`
        );
    }

    return await response.json();
}
