import dotenv from "dotenv";

dotenv.config();

export interface AzureDevOpsConfig {
    organization: string;
    project: string;
    pat: string;
    baseUrl: string;
}

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `Missing required environment variable: ${name}. ` +
            `Please set it in your .env file or system environment.`
        );
    }
    return value;
}

export function loadConfig(): AzureDevOpsConfig {
    const organization = requireEnv("AZURE_ORG");
    const project = requireEnv("AZURE_PROJECT");
    const pat = requireEnv("AZURE_PAT");

    return {
        organization,
        project,
        pat,
        baseUrl: `https://dev.azure.com/${organization}/${project}`,
    };
}

/**
 * Returns the Basic Auth header value for Azure DevOps REST API calls.
 * Uses the PAT encoded as base64 with an empty username.
 */
export function getAuthHeader(config: AzureDevOpsConfig): string {
    const token = Buffer.from(`:${config.pat}`).toString("base64");
    return `Basic ${token}`;
}
