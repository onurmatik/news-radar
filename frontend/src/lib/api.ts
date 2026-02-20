import type {
  ApiContentDetailItem,
  ApiContentFeedItem,
  ApiContentFeedResponse,
  ApiCurrentUser,
  ApiExecutionDetail,
  ApiAIInteractionResponse,
  ApiAccessState,
  ApiNotificationsResponse,
  ApiTrashContentResponse,
  ApiTopicCreateResponse,
  ApiSharedGroupCloneResponse,
  ApiSharedTopicCloneResponse,
  ApiTopicGroupCreateResponse,
  ApiTopicGroupItem,
  ApiTopicGroupListResponse,
  ApiTopicListItem,
  ApiTopicListResponse,
} from "@/lib/types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

function getCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && method !== "GET") {
    headers.set("Content-Type", "application/json");
  }
  if (!SAFE_METHODS.has(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      headers.set("X-CSRFToken", csrfToken);
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    let message = response.statusText;
    if (isJson) {
      try {
        const payload = await response.json();
        if (payload?.detail) {
          message = payload.detail;
        }
      } catch {
        // ignore JSON parsing errors
      }
    } else {
      message = "Expected JSON response. Check API base URL or proxy settings.";
    }
    throw new Error(message);
  }

  if (!isJson) {
    throw new Error("Expected JSON response. Check API base URL or proxy settings.");
  }
  return response.json() as Promise<T>;
}

export async function listTopics(
  search?: string,
  groupUuid?: string | null
): Promise<ApiTopicListResponse> {
  const params = new URLSearchParams();
  if (search) {
    params.set("search", search);
  }
  if (groupUuid) {
    params.set("group_uuid", groupUuid);
  }
  const query = params.toString();
  return requestJson<ApiTopicListResponse>(`/api/topics/${query ? `?${query}` : ""}`);
}

export async function createTopic(
  queries: string[],
  options?: {
    groupUuid?: string | null;
    domainAllowlist?: string[] | null;
    domainBlocklist?: string[] | null;
    languageFilter?: string[] | null;
    country?: string | null;
    updateFrequency?: "day" | "week" | "manual" | null;
    additionalQueriesMode?: "auto" | "manual" | null;
  }
): Promise<ApiTopicCreateResponse> {
  return requestJson<ApiTopicCreateResponse>("/api/topics/", {
    method: "POST",
    body: JSON.stringify({
      queries,
      group_uuid: options?.groupUuid ?? null,
      search_domain_allowlist: options?.domainAllowlist ?? null,
      search_domain_blocklist: options?.domainBlocklist ?? null,
      search_language_filter: options?.languageFilter ?? null,
      country: options?.country ?? null,
      update_frequency: options?.updateFrequency ?? null,
      additional_queries_mode: options?.additionalQueriesMode ?? null,
    }),
  });
}

export async function updateTopic(
  uuid: string,
  payload: {
    isActive?: boolean;
    queries?: string[];
    groupUuid?: string | null;
    domainAllowlist?: string[] | null;
    domainBlocklist?: string[] | null;
    languageFilter?: string[] | null;
    country?: string | null;
    updateFrequency?: "day" | "week" | "manual" | null;
    additionalQueriesMode?: "auto" | "manual" | null;
  }
): Promise<ApiTopicListItem> {
  return requestJson<ApiTopicListItem>(`/api/topics/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify({
      is_active: payload.isActive,
      queries: payload.queries,
      group_uuid: payload.groupUuid,
      search_domain_allowlist: payload.domainAllowlist ?? null,
      search_domain_blocklist: payload.domainBlocklist ?? null,
      search_language_filter: payload.languageFilter ?? null,
      country: payload.country ?? null,
      update_frequency: payload.updateFrequency ?? null,
      additional_queries_mode: payload.additionalQueriesMode ?? null,
    }),
  });
}

export async function deleteTopic(uuid: string): Promise<void> {
  await requestJson(`/api/topics/${uuid}`, {
    method: "DELETE",
  });
}

export async function listTopicGroups(): Promise<ApiTopicGroupListResponse> {
  return requestJson<ApiTopicGroupListResponse>("/api/topics/groups");
}

export async function getSharedTopic(uuid: string): Promise<ApiTopicListItem> {
  return requestJson<ApiTopicListItem>(`/api/topics/shared/topics/${uuid}`);
}

export async function getSharedTopicGroup(uuid: string): Promise<ApiTopicGroupItem> {
  return requestJson<ApiTopicGroupItem>(
    `/api/topics/shared/groups/${uuid}`
  );
}

export async function listSharedTopicsByGroup(groupUuid: string): Promise<ApiTopicListResponse> {
  return requestJson<ApiTopicListResponse>(`/api/topics/shared/groups/${groupUuid}/topics`);
}

export async function cloneSharedTopic(topicUuid: string): Promise<ApiSharedTopicCloneResponse> {
  return requestJson<ApiSharedTopicCloneResponse>(`/api/topics/shared/topics/${topicUuid}/clone`, {
    method: "POST",
  });
}

export async function cloneSharedTopicGroup(groupUuid: string): Promise<ApiSharedGroupCloneResponse> {
  return requestJson<ApiSharedGroupCloneResponse>(`/api/topics/shared/groups/${groupUuid}/clone`, {
    method: "POST",
  });
}

export async function createTopicGroup(payload: {
  name: string;
  description?: string;
  isPublic?: boolean;
  defaultUpdateFrequency?: "day" | "week" | "manual" | null;
  defaultLanguageFilter?: string[] | null;
  defaultCountry?: string | null;
}): Promise<ApiTopicGroupCreateResponse> {
  return requestJson<ApiTopicGroupCreateResponse>("/api/topics/groups", {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      description: payload.description ?? "",
      is_public: payload.isPublic ?? false,
      default_update_frequency: payload.defaultUpdateFrequency ?? null,
      default_search_language_filter: payload.defaultLanguageFilter ?? null,
      default_country: payload.defaultCountry ?? null,
    }),
  });
}

export async function updateTopicGroup(
  uuid: string,
  payload: {
    name?: string;
    description?: string;
    isPublic?: boolean;
    defaultUpdateFrequency?: "day" | "week" | "manual" | null;
    defaultLanguageFilter?: string[] | null;
    defaultCountry?: string | null;
  }
): Promise<void> {
  await requestJson(`/api/topics/groups/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: payload.name,
      description: payload.description,
      is_public: payload.isPublic,
      default_update_frequency: payload.defaultUpdateFrequency ?? null,
      default_search_language_filter: payload.defaultLanguageFilter ?? null,
      default_country: payload.defaultCountry ?? null,
    }),
  });
}

export async function deleteTopicGroup(uuid: string): Promise<void> {
  await requestJson(`/api/topics/groups/${uuid}`, {
    method: "DELETE",
  });
}

export async function listContentFeed(params?: {
  topicUuid?: string;
  limit?: number;
  offset?: number;
  onlyNew?: boolean;
  search?: string;
}): Promise<ApiContentFeedResponse> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  if (params?.onlyNew) search.set("only_new", "true");
  if (params?.search?.trim()) search.set("search", params.search.trim());
  const query = search.toString();
  if (params?.topicUuid) {
    return requestJson<ApiContentFeedResponse>(
      `/api/contents/topics/${params.topicUuid}${query ? `?${query}` : ""}`
    );
  }
  return requestJson<ApiContentFeedResponse>(`/api/contents/${query ? `?${query}` : ""}`);
}

export async function listContentByGroup(
  groupUuid: string,
  params?: {
    limit?: number;
    offset?: number;
    onlyNew?: boolean;
    search?: string;
  }
): Promise<ApiContentFeedResponse> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  if (params?.onlyNew) search.set("only_new", "true");
  if (params?.search?.trim()) search.set("search", params.search.trim());
  const query = search.toString();
  return requestJson<ApiContentFeedResponse>(
    `/api/contents/groups/${groupUuid}${query ? `?${query}` : ""}`
  );
}

export async function listSharedContentByTopic(
  topicUuid: string,
  params?: {
    limit?: number;
    offset?: number;
    search?: string;
  }
): Promise<ApiContentFeedResponse> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  if (params?.search?.trim()) search.set("search", params.search.trim());
  const query = search.toString();
  return requestJson<ApiContentFeedResponse>(
    `/api/contents/shared/topics/${topicUuid}${query ? `?${query}` : ""}`
  );
}

export async function listSharedContentByGroup(
  groupUuid: string,
  params?: {
    limit?: number;
    offset?: number;
    search?: string;
  }
): Promise<ApiContentFeedResponse> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  if (params?.search?.trim()) search.set("search", params.search.trim());
  const query = search.toString();
  return requestJson<ApiContentFeedResponse>(
    `/api/contents/shared/groups/${groupUuid}${query ? `?${query}` : ""}`
  );
}

export async function getContentItem(contentId: number): Promise<ApiContentFeedItem> {
  return requestJson<ApiContentFeedItem>(`/api/contents/items/${contentId}`);
}

export async function getContentDetail(contentId: number): Promise<ApiContentDetailItem> {
  return requestJson<ApiContentDetailItem>(`/api/contents/items/${contentId}/detail`);
}

export async function deleteContentItem(contentId: number): Promise<void> {
  await requestJson(`/api/contents/items/${contentId}`, {
    method: "DELETE",
  });
}

export async function restoreContentItem(contentId: number): Promise<void> {
  await requestJson(`/api/contents/items/${contentId}/restore`, {
    method: "POST",
  });
}

export async function listTrashContent(params?: {
  limit?: number;
  offset?: number;
}): Promise<ApiTrashContentResponse> {
  const search = new URLSearchParams();
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const query = search.toString();
  return requestJson<ApiTrashContentResponse>(`/api/contents/trash${query ? `?${query}` : ""}`);
}

export async function emptyTrashContent(): Promise<void> {
  await requestJson("/api/contents/trash", {
    method: "DELETE",
  });
}

export async function requestContentAIResponse(payload: {
  contentIds: number[];
  instruction: string;
  model?: string | null;
}): Promise<ApiAIInteractionResponse> {
  return requestJson<ApiAIInteractionResponse>("/api/contents/ai/respond", {
    method: "POST",
    body: JSON.stringify({
      content_ids: payload.contentIds,
      instruction: payload.instruction,
      model: payload.model ?? null,
    }),
  });
}

export async function runTopicScan(topicUuid: string): Promise<{
  execution_id: number;
  task_id: string;
}> {
  return requestJson("/api/executions/web-search/", {
    method: "POST",
    body: JSON.stringify({
      topic_uuid: topicUuid,
      initiator: "user",
    }),
  });
}

export async function getExecution(executionId: number): Promise<ApiExecutionDetail> {
  return requestJson<ApiExecutionDetail>(`/api/executions/${executionId}/`);
}

export async function createBookmark(contentId: number): Promise<void> {
  await requestJson("/api/contents/bookmarks", {
    method: "POST",
    body: JSON.stringify({ content_id: contentId }),
  });
}

export async function deleteBookmark(contentId: number): Promise<void> {
  await requestJson(`/api/contents/bookmarks/${contentId}`, {
    method: "DELETE",
  });
}

export async function getCurrentUser(): Promise<ApiCurrentUser> {
  return requestJson<ApiCurrentUser>("/api/auth/me");
}

export async function getApiAccessState(): Promise<ApiAccessState> {
  return requestJson<ApiAccessState>("/api/auth/api-access");
}

export async function rotateApiAccessKey(): Promise<{
  api_key: string;
  key_created_at: string;
}> {
  return requestJson("/api/auth/api-access/rotate", {
    method: "POST",
  });
}

export async function createProCheckoutSession(payload: {
  plan: "monthly" | "yearly";
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{ checkout_url: string }> {
  return requestJson<{ checkout_url: string }>("/api/auth/billing/checkout", {
    method: "POST",
    body: JSON.stringify({
      plan: payload.plan,
      success_url: payload.successUrl ?? null,
      cancel_url: payload.cancelUrl ?? null,
    }),
  });
}

export async function getNotifications(): Promise<ApiNotificationsResponse> {
  return requestJson<ApiNotificationsResponse>("/api/contents/notifications");
}

export async function logout(): Promise<void> {
  await requestJson("/api/auth/logout", {
    method: "POST",
  });
}

export async function requestMagicLink(
  email: string,
  redirectUrl?: string
): Promise<{ sent: boolean }> {
  return requestJson<{ sent: boolean }>("/api/auth/magic-link", {
    method: "POST",
    body: JSON.stringify({
      email,
      redirect_url: redirectUrl ?? null,
    }),
  });
}
