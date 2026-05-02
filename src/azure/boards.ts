import { AzureDevOpsConfig, getAuthHeader } from "../config.js";
import { azureFetch } from "./http.js";

const COMMENTS_API_VERSION = "7.1-preview.4";

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

export interface WorkItemCommentList {
    totalCount: number;
    count: number;
    comments: WorkItemComment[];
    continuationToken?: string;
}

export interface WorkItemTypeInfo {
    name: string;
    description: string;
    states: { name: string; category: string }[];
    fieldInstances: { referenceName: string; name: string; helpText?: string }[];
}

export type FriendlyLinkType =
    | "Parent"
    | "Child"
    | "Related"
    | "Predecessor"
    | "Successor"
    | "TestedBy"
    | "Tests"
    | "Affects"
    | "AffectedBy";

const LINK_TYPE_MAP: Record<FriendlyLinkType, string> = {
    Parent: "System.LinkTypes.Hierarchy-Reverse",
    Child: "System.LinkTypes.Hierarchy-Forward",
    Related: "System.LinkTypes.Related",
    Predecessor: "System.LinkTypes.Dependency-Reverse",
    Successor: "System.LinkTypes.Dependency-Forward",
    TestedBy: "Microsoft.VSTS.Common.TestedBy-Forward",
    Tests: "Microsoft.VSTS.Common.TestedBy-Reverse",
    Affects: "Microsoft.VSTS.Common.Affects-Forward",
    AffectedBy: "Microsoft.VSTS.Common.Affects-Reverse",
};

export interface WorkItemLink {
    type: FriendlyLinkType;
    targetId: number;
    comment?: string;
}

export interface WorkItemRelation {
    index: number;
    rel: string;
    url: string;
    targetId: number | null;
    attributes?: Record<string, unknown>;
}

export interface WorkItemAttachment {
    index: number;
    url: string;
    id: string;
    name?: string;
    comment?: string;
}

export interface AttachmentRef {
    id: string;
    url: string;
}

export interface DownloadResult {
    contentBase64: string;
    mimeType: string;
    sizeBytes: number;
}

export interface IterationInfo {
    id: string;
    name: string;
    path: string;
    attributes?: {
        startDate?: string;
        finishDate?: string;
        timeFrame?: string;
    };
}

export interface AreaNode {
    id: number;
    identifier: string;
    name: string;
    structureType: string;
    hasChildren: boolean;
    children?: AreaNode[];
    path: string;
}

export interface TeamInfo {
    id: string;
    name: string;
    description: string;
    url: string;
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
    links?: WorkItemLink[];
    customFields?: Record<string, string | number | boolean>;
    bypassRules?: boolean;
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
    customFields?: Record<string, string | number | boolean>;
    bypassRules?: boolean;
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

function authHeaders(config: AzureDevOpsConfig, contentType = "application/json") {
    return {
        Authorization: getAuthHeader(config),
        "Content-Type": contentType,
    };
}

function extractWorkItemId(url: string): number | null {
    const match = url.match(/\/workitems\/(\d+)$/i);
    return match ? parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Public API — Read
// ---------------------------------------------------------------------------

export async function getWorkItem(
    config: AzureDevOpsConfig,
    id: number,
    expand?: string
): Promise<WorkItem> {
    const expandParam = expand ? `&$expand=${expand}` : "";
    const url = `${orgApiBase(config)}/wit/workitems/${id}?api-version=7.1${expandParam}`;
    const response = await azureFetch(url, { method: "GET", headers: authHeaders(config) });
    return (await response.json()) as WorkItem;
}

export async function getWorkItemsBatch(
    config: AzureDevOpsConfig,
    ids: number[],
    expand?: string,
    fields?: string[]
): Promise<WorkItem[]> {
    if (ids.length === 0) return [];

    const results: WorkItem[] = [];
    for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const url = `${orgApiBase(config)}/wit/workitemsbatch?api-version=7.1`;

        const body: Record<string, unknown> = {
            ids: chunk,
            errorPolicy: "omit",
        };
        if (expand) body["$expand"] = expand;
        if (fields && fields.length > 0) body["fields"] = fields;

        const response = await azureFetch(url, {
            method: "POST",
            headers: authHeaders(config),
            body: JSON.stringify(body),
        });

        const data = (await response.json()) as { value: WorkItem[] };
        results.push(...data.value);
    }

    return results;
}

export async function queryWorkItems(
    config: AzureDevOpsConfig,
    wiql: string,
    fetchDetails = false,
    top?: number,
    skip?: number
): Promise<WorkItemQueryResult | { workItems: WorkItem[] }> {
    let url = `${apiBase(config)}/wit/wiql?api-version=7.1`;
    if (top !== undefined && (skip === undefined || skip === 0)) {
        url += `&$top=${top}`;
    }

    const response = await azureFetch(url, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify({ query: wiql }),
    });

    const queryResult = (await response.json()) as WorkItemQueryResult;

    let items = queryResult.workItems ?? [];

    if (skip && skip > 0) {
        items = items.slice(skip);
    }
    if (top !== undefined && (skip ?? 0) > 0) {
        items = items.slice(0, top);
    }

    if (!fetchDetails || items.length === 0) {
        return { workItems: items };
    }

    const ids = items.map((wi) => wi.id);
    const details = await getWorkItemsBatch(config, ids);
    return { workItems: details };
}

export async function listWorkItemTypes(
    config: AzureDevOpsConfig,
    project?: string
): Promise<WorkItemTypeInfo[]> {
    const url = `${apiBase(config, project)}/wit/workitemtypes?api-version=7.1`;
    const response = await azureFetch(url, { method: "GET", headers: authHeaders(config) });
    const data = (await response.json()) as { value: WorkItemTypeInfo[] };
    return data.value;
}

// ---------------------------------------------------------------------------
// Public API — Links
// ---------------------------------------------------------------------------

export async function listWorkItemRelations(
    config: AzureDevOpsConfig,
    id: number
): Promise<WorkItemRelation[]> {
    const item = await getWorkItem(config, id, "Relations");
    if (!item.relations) return [];

    return item.relations.map((rel, index) => ({
        index,
        rel: rel.rel,
        url: rel.url,
        targetId: extractWorkItemId(rel.url),
        attributes: rel.attributes,
    }));
}

export async function linkWorkItems(
    config: AzureDevOpsConfig,
    sourceId: number,
    targetId: number,
    linkType: FriendlyLinkType,
    comment?: string
): Promise<WorkItem> {
    const url = `${orgApiBase(config)}/wit/workitems/${sourceId}?api-version=7.1`;
    const targetUrl = `${orgApiBase(config)}/wit/workitems/${targetId}`;

    const patch = [
        {
            op: "add",
            path: "/relations/-",
            value: {
                rel: LINK_TYPE_MAP[linkType],
                url: targetUrl,
                attributes: comment ? { comment } : {},
            },
        },
    ];

    const response = await azureFetch(url, {
        method: "PATCH",
        headers: authHeaders(config, "application/json-patch+json"),
        body: JSON.stringify(patch),
    });

    return (await response.json()) as WorkItem;
}

export async function removeWorkItemLink(
    config: AzureDevOpsConfig,
    workItemId: number,
    relationIndex: number
): Promise<WorkItem> {
    const url = `${orgApiBase(config)}/wit/workitems/${workItemId}?api-version=7.1`;

    const patch = [
        {
            op: "remove",
            path: `/relations/${relationIndex}`,
        },
    ];

    const response = await azureFetch(url, {
        method: "PATCH",
        headers: authHeaders(config, "application/json-patch+json"),
        body: JSON.stringify(patch),
    });

    return (await response.json()) as WorkItem;
}

// ---------------------------------------------------------------------------
// Public API — Write
// ---------------------------------------------------------------------------

export async function createWorkItem(
    config: AzureDevOpsConfig,
    input: CreateWorkItemInput,
    project?: string
): Promise<WorkItem> {
    const encodedType = encodeURIComponent(input.type);
    const bypassParam = input.bypassRules ? "&bypassRules=true" : "";
    const url = `${apiBase(config, project)}/wit/workitems/$${encodedType}?api-version=7.1${bypassParam}`;

    const patch: { op: string; path: string; value?: unknown }[] = [];

    patch.push({ op: "add", path: "/fields/System.Title", value: input.title });

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

    if (input.customFields) {
        for (const [key, value] of Object.entries(input.customFields)) {
            patch.push({ op: "add", path: `/fields/${key}`, value });
        }
    }

    if (input.parentId) {
        patch.push({
            op: "add",
            path: "/relations/-",
            value: {
                rel: "System.LinkTypes.Hierarchy-Reverse",
                url: `${orgApiBase(config)}/wit/workitems/${input.parentId}`,
                attributes: { comment: "Parent link" },
            },
        });
    }

    if (input.links) {
        for (const link of input.links) {
            patch.push({
                op: "add",
                path: "/relations/-",
                value: {
                    rel: LINK_TYPE_MAP[link.type],
                    url: `${orgApiBase(config)}/wit/workitems/${link.targetId}`,
                    attributes: link.comment ? { comment: link.comment } : {},
                },
            });
        }
    }

    const response = await azureFetch(url, {
        method: "POST",
        headers: authHeaders(config, "application/json-patch+json"),
        body: JSON.stringify(patch),
    });

    return (await response.json()) as WorkItem;
}

export async function updateWorkItem(
    config: AzureDevOpsConfig,
    id: number,
    updates: UpdateWorkItemInput
): Promise<WorkItem> {
    const bypassParam = updates.bypassRules ? "&bypassRules=true" : "";
    const url = `${orgApiBase(config)}/wit/workitems/${id}?api-version=7.1${bypassParam}`;

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

    if (updates.customFields) {
        for (const [key, value] of Object.entries(updates.customFields)) {
            patch.push({ op: "replace", path: `/fields/${key}`, value });
        }
    }

    if (patch.length === 0) {
        throw new Error("No fields to update. Provide at least one field.");
    }

    const response = await azureFetch(url, {
        method: "PATCH",
        headers: authHeaders(config, "application/json-patch+json"),
        body: JSON.stringify(patch),
    });

    return (await response.json()) as WorkItem;
}

export async function updateWorkItemState(
    config: AzureDevOpsConfig,
    id: number,
    state: string
): Promise<WorkItem> {
    return updateWorkItem(config, id, { state });
}

export async function deleteWorkItem(
    config: AzureDevOpsConfig,
    id: number,
    destroy = false
): Promise<{ id: number; deleted: boolean }> {
    const url = `${orgApiBase(config)}/wit/workitems/${id}?destroy=${destroy}&api-version=7.1`;
    await azureFetch(url, { method: "DELETE", headers: authHeaders(config) });
    return { id, deleted: true };
}

export async function addWorkItemComment(
    config: AzureDevOpsConfig,
    id: number,
    comment: string
): Promise<WorkItemComment> {
    const url = `${orgApiBase(config)}/wit/workitems/${id}/comments?api-version=${COMMENTS_API_VERSION}`;
    const response = await azureFetch(url, {
        method: "POST",
        headers: authHeaders(config),
        body: JSON.stringify({ text: comment }),
    });
    return (await response.json()) as WorkItemComment;
}

// ---------------------------------------------------------------------------
// Public API — History & Comments
// ---------------------------------------------------------------------------

export async function listWorkItemRevisions(
    config: AzureDevOpsConfig,
    id: number,
    top?: number,
    skip?: number
): Promise<unknown[]> {
    let url = `${orgApiBase(config)}/wit/workitems/${id}/revisions?api-version=7.1`;
    if (top !== undefined) url += `&$top=${top}`;
    if (skip !== undefined) url += `&$skip=${skip}`;

    const response = await azureFetch(url, { method: "GET", headers: authHeaders(config) });
    const data = (await response.json()) as { value: unknown[] };
    return data.value;
}

export async function getWorkItemRevision(
    config: AzureDevOpsConfig,
    id: number,
    revisionNumber: number
): Promise<WorkItem> {
    const url = `${orgApiBase(config)}/wit/workitems/${id}/revisions/${revisionNumber}?api-version=7.1`;
    const response = await azureFetch(url, { method: "GET", headers: authHeaders(config) });
    return (await response.json()) as WorkItem;
}

export async function listWorkItemUpdates(
    config: AzureDevOpsConfig,
    id: number,
    top?: number,
    skip?: number
): Promise<unknown[]> {
    let url = `${orgApiBase(config)}/wit/workitems/${id}/updates?api-version=7.1`;
    if (top !== undefined) url += `&$top=${top}`;
    if (skip !== undefined) url += `&$skip=${skip}`;

    const response = await azureFetch(url, { method: "GET", headers: authHeaders(config) });
    const data = (await response.json()) as { value: unknown[] };
    return data.value;
}

export async function listWorkItemComments(
    config: AzureDevOpsConfig,
    id: number,
    top?: number,
    continuationToken?: string
): Promise<WorkItemCommentList> {
    let url = `${orgApiBase(config)}/wit/workitems/${id}/comments?api-version=${COMMENTS_API_VERSION}`;
    if (top !== undefined) url += `&$top=${top}`;
    if (continuationToken) url += `&continuationToken=${encodeURIComponent(continuationToken)}`;

    const response = await azureFetch(url, { method: "GET", headers: authHeaders(config) });
    return (await response.json()) as WorkItemCommentList;
}

export async function updateWorkItemComment(
    config: AzureDevOpsConfig,
    id: number,
    commentId: number,
    text: string
): Promise<WorkItemComment> {
    const url = `${orgApiBase(config)}/wit/workitems/${id}/comments/${commentId}?api-version=${COMMENTS_API_VERSION}`;
    const response = await azureFetch(url, {
        method: "PATCH",
        headers: authHeaders(config),
        body: JSON.stringify({ text }),
    });
    return (await response.json()) as WorkItemComment;
}

export async function deleteWorkItemComment(
    config: AzureDevOpsConfig,
    id: number,
    commentId: number
): Promise<void> {
    const url = `${orgApiBase(config)}/wit/workitems/${id}/comments/${commentId}?api-version=${COMMENTS_API_VERSION}`;
    await azureFetch(url, { method: "DELETE", headers: authHeaders(config) });
}

// ---------------------------------------------------------------------------
// Public API — Attachments
// ---------------------------------------------------------------------------

export async function uploadAttachment(
    config: AzureDevOpsConfig,
    fileName: string,
    contentBase64: string
): Promise<AttachmentRef> {
    const url = `${orgApiBase(config)}/wit/attachments?fileName=${encodeURIComponent(fileName)}&uploadType=simple&api-version=7.1`;
    const buffer = Buffer.from(contentBase64, "base64");

    const response = await azureFetch(url, {
        method: "POST",
        headers: authHeaders(config, "application/octet-stream"),
        body: buffer,
    });

    return (await response.json()) as AttachmentRef;
}

export async function attachToWorkItem(
    config: AzureDevOpsConfig,
    workItemId: number,
    attachmentUrl: string,
    comment?: string
): Promise<WorkItem> {
    const url = `${orgApiBase(config)}/wit/workitems/${workItemId}?api-version=7.1`;

    const patch = [
        {
            op: "add",
            path: "/relations/-",
            value: {
                rel: "AttachedFile",
                url: attachmentUrl,
                attributes: comment ? { comment } : {},
            },
        },
    ];

    const response = await azureFetch(url, {
        method: "PATCH",
        headers: authHeaders(config, "application/json-patch+json"),
        body: JSON.stringify(patch),
    });

    return (await response.json()) as WorkItem;
}

export async function listWorkItemAttachments(
    config: AzureDevOpsConfig,
    id: number
): Promise<WorkItemAttachment[]> {
    const item = await getWorkItem(config, id, "Relations");
    if (!item.relations) return [];

    return item.relations
        .map((rel, index) => ({ rel, index }))
        .filter(({ rel }) => rel.rel === "AttachedFile")
        .map(({ rel, index }) => {
            const attrs = rel.attributes ?? {};
            const urlParts = rel.url.split("/");
            const id = urlParts[urlParts.length - 1];
            return {
                index,
                url: rel.url,
                id,
                name: attrs["name"] as string | undefined,
                comment: attrs["comment"] as string | undefined,
            };
        });
}

export async function downloadAttachment(
    config: AzureDevOpsConfig,
    attachmentId: string
): Promise<DownloadResult> {
    const url = `${orgApiBase(config)}/wit/attachments/${attachmentId}?api-version=7.1`;

    const response = await azureFetch(url, {
        method: "GET",
        headers: {
            Authorization: getAuthHeader(config),
            Accept: "application/octet-stream",
        },
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    const mimeType = response.headers.get("Content-Type") ?? "application/octet-stream";

    return {
        contentBase64: buffer.toString("base64"),
        mimeType,
        sizeBytes: buffer.length,
    };
}

// ---------------------------------------------------------------------------
// Public API — Discovery
// ---------------------------------------------------------------------------

export async function listIterations(
    config: AzureDevOpsConfig,
    team?: string,
    timeframe?: string
): Promise<IterationInfo[]> {
    const teamSegment = team ? encodeURIComponent(team) : encodeURIComponent(config.project);
    let url = `https://dev.azure.com/${config.organization}/${encodeURIComponent(config.project)}/${teamSegment}/_apis/work/teamsettings/iterations?api-version=7.1`;
    if (timeframe) url += `&$timeframe=${timeframe}`;

    const response = await azureFetch(url, { method: "GET", headers: authHeaders(config) });
    const data = (await response.json()) as { value: IterationInfo[] };
    return data.value;
}

export async function listAreas(
    config: AzureDevOpsConfig,
    depth = 2
): Promise<AreaNode> {
    const url = `${apiBase(config)}/wit/classificationnodes/areas?$depth=${depth}&api-version=7.1`;
    const response = await azureFetch(url, { method: "GET", headers: authHeaders(config) });
    return (await response.json()) as AreaNode;
}

export async function listTeams(
    config: AzureDevOpsConfig
): Promise<TeamInfo[]> {
    const url = `https://dev.azure.com/${config.organization}/_apis/projects/${encodeURIComponent(config.project)}/teams?api-version=7.1`;
    const response = await azureFetch(url, { method: "GET", headers: authHeaders(config) });
    const data = (await response.json()) as { value: TeamInfo[] };
    return data.value;
}

export async function getMyWorkItems(
    config: AzureDevOpsConfig,
    types?: string[],
    states?: string[],
    top?: number
): Promise<{ workItems: WorkItem[] }> {
    let conditions = "[System.AssignedTo] = @Me";

    if (types && types.length > 0) {
        const list = types.map((t) => `'${t}'`).join(", ");
        conditions += ` AND [System.WorkItemType] IN (${list})`;
    }
    if (states && states.length > 0) {
        const list = states.map((s) => `'${s}'`).join(", ");
        conditions += ` AND [System.State] IN (${list})`;
    }

    const wiql = `SELECT [System.Id] FROM WorkItems WHERE ${conditions} ORDER BY [System.ChangedDate] DESC`;
    const result = await queryWorkItems(config, wiql, true, top);
    return result as { workItems: WorkItem[] };
}

// ---------------------------------------------------------------------------
// Public API — Bulk operations
// ---------------------------------------------------------------------------

export async function bulkUpdateWorkItems(
    config: AzureDevOpsConfig,
    updates: Array<{ id: number } & UpdateWorkItemInput>
): Promise<WorkItem[]> {
    const results: WorkItem[] = [];
    for (const { id, ...fields } of updates) {
        const result = await updateWorkItem(config, id, fields);
        results.push(result);
    }
    return results;
}

export async function bulkCreateWorkItems(
    config: AzureDevOpsConfig,
    items: CreateWorkItemInput[],
    project?: string
): Promise<WorkItem[]> {
    const results: WorkItem[] = [];
    for (const item of items) {
        const result = await createWorkItem(config, item, project);
        results.push(result);
    }
    return results;
}

export async function moveWorkItem(
    config: AzureDevOpsConfig,
    id: number,
    targetProject: string,
    targetAreaPath?: string,
    targetIterationPath?: string
): Promise<WorkItem> {
    const url = `${orgApiBase(config)}/wit/workitems/${id}?bypassRules=true&api-version=7.1`;

    const patch: { op: string; path: string; value: unknown }[] = [
        { op: "replace", path: "/fields/System.TeamProject", value: targetProject },
    ];

    if (targetAreaPath) {
        patch.push({ op: "replace", path: "/fields/System.AreaPath", value: targetAreaPath });
    }
    if (targetIterationPath) {
        patch.push({ op: "replace", path: "/fields/System.IterationPath", value: targetIterationPath });
    }

    const response = await azureFetch(url, {
        method: "PATCH",
        headers: authHeaders(config, "application/json-patch+json"),
        body: JSON.stringify(patch),
    });

    return (await response.json()) as WorkItem;
}
