import fetch from "node-fetch";
import { AzureDevOpsConfig, getAuthHeader } from "../config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineRun {
    id: number;
    name: string;
    state: string;
    result: string;
    createdDate: string;
    finishedDate: string | null;
    url: string;
    pipeline: {
        id: number;
        name: string;
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function apiBase(config: AzureDevOpsConfig): string {
    return `https://dev.azure.com/${config.organization}/${config.project}/_apis`;
}

function headers(config: AzureDevOpsConfig) {
    return {
        Authorization: getAuthHeader(config),
        "Content-Type": "application/json",
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
 * Gets the most recent run (status) of a pipeline.
 */
export async function getPipelineStatus(
    config: AzureDevOpsConfig,
    pipelineId: number
): Promise<PipelineRun> {
    // Fetch the latest run for the given pipeline
    const url = `${apiBase(config)}/pipelines/${pipelineId}/runs?api-version=7.1&$top=1`;

    const response = await fetch(url, {
        method: "GET",
        headers: headers(config),
    });

    if (!response.ok) {
        throw new Error(
            `Failed to get pipeline status for pipeline ${pipelineId}: ${sanitizeError(await response.text().catch(() => "unknown error"))}`
        );
    }

    const data = (await response.json()) as { value: PipelineRun[] };

    if (!data.value || data.value.length === 0) {
        throw new Error(
            `No runs found for pipeline ${pipelineId}. The pipeline may not have been triggered yet.`
        );
    }

    return data.value[0];
}
