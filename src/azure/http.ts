import fetch from "node-fetch";
import type { RequestInit } from "node-fetch";

export class AzureDevOpsError extends Error {
    constructor(
        public readonly status: number,
        public readonly typeKey: string,
        public readonly errorCode: number,
        message: string
    ) {
        super(message);
        this.name = "AzureDevOpsError";
    }
}

interface RetryOptions {
    retries?: number;
    baseDelayMs?: number;
}

export async function azureFetch(
    url: string,
    init: RequestInit,
    { retries = 3, baseDelayMs = 500 }: RetryOptions = {}
): Promise<import("node-fetch").Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        const response = await fetch(url, init);

        if (response.ok) return response;

        const errorText = await response.text().catch(() => "");
        let message = errorText;
        let typeKey = "";
        let errorCode = 0;

        try {
            const parsed = JSON.parse(errorText) as {
                message?: string;
                typeKey?: string;
                errorCode?: number;
            };
            if (parsed.message) message = parsed.message;
            if (parsed.typeKey) typeKey = parsed.typeKey;
            if (typeof parsed.errorCode === "number") errorCode = parsed.errorCode;
        } catch {
            // keep raw errorText
        }

        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
            let delay = baseDelayMs * Math.pow(2, attempt);
            const retryAfter = response.headers.get("Retry-After");
            if (retryAfter) {
                const ms = parseFloat(retryAfter) * 1000;
                if (!isNaN(ms)) delay = ms;
            }
            await new Promise<void>((resolve) => setTimeout(resolve, delay));
            continue;
        }

        throw new AzureDevOpsError(response.status, typeKey, errorCode, message);
    }

    throw new AzureDevOpsError(0, "", 0, "Max retries exceeded");
}
