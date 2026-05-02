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

export interface SetRepositoryPermissionsInput {
    repositoryId: string;
    descriptor: string;
    allowBitmask: number;
    denyBitmask?: number;
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

/**
 * Gets the current user's identity descriptor.
 */
export async function getCurrentUserDescriptor(config: AzureDevOpsConfig): Promise<string> {
    const url = `https://vssps.dev.azure.com/${config.organization}/_apis/identities?searchFilter=General&filterValue=${encodeURIComponent(config.organization)}&api-version=7.0`;
    
    // In many cases, searching by the org name or an empty filter with 'Me' profile is better.
    // However, for this implementation, we'll try to get the descriptor of the PAT holder.
    // A more reliable way if search fails is to use the Profile API first.
    
    const response = await fetch(url, {
        method: "GET",
        headers: headers(config),
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch identity: ${await response.text()}`);
    }

    const data = await response.json() as any;
    if (data.value && data.value.length > 0) {
        // Return the first one that matches the expected pattern for a user
        return data.value[0].descriptor;
    }

    throw new Error("No identity descriptor found for the current PAT.");
}

/**
 * Sets permissions for a repository.
 */
export async function setRepositoryPermissions(
    config: AzureDevOpsConfig,
    input: SetRepositoryPermissionsInput
): Promise<void> {
    const namespaceId = "2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87"; // Git Repositories
    const url = `https://dev.azure.com/${config.organization}/_apis/securitynamespaces/${namespaceId}/permissions?api-version=7.0`;

    const token = `repoV2/${config.project}/${input.repositoryId}`;
    
    const body = {
        token: token,
        merge: true,
        accessControlEntries: [
            {
                descriptor: input.descriptor,
                allow: input.allowBitmask,
                deny: input.denyBitmask || 0
            }
        ]
    };

    const response = await fetch(url, {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error(`Failed to set permissions: ${await response.text()}`);
    }
}
