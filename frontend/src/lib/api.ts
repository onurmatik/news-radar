import type {
  ApiAccessState,
  ApiAIInteractionResponse,
  ApiContentDetailItem,
  ApiContentFeedItem,
  ApiContentFeedResponse,
  ApiCurrentUser,
  ApiExecutionDetail,
  ApiNotificationsResponse,
  ApiTopicCreateResponse,
  ApiTopicGroupCreateResponse,
  ApiTopicGroupItem,
  ApiTopicGroupListResponse,
  ApiTopicListItem,
  ApiTopicListResponse,
  ApiTopicOrganizerResponse,
  ApiTopicPreviewResponse,
  ApiTopicSuggestDomainsResponse,
  ApiTrashContentResponse,
  TopicUpdateFrequency,
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
  if (search) params.set("search", search);
  if (groupUuid) params.set("group_uuid", groupUuid);
  const query = params.toString();
  return requestJson<ApiTopicListResponse>(`/api/topics/${query ? `?${query}` : ""}`);
}

export async function organizeTopic(payload: {
  monitoringPrompt: string;
}): Promise<ApiTopicOrganizerResponse> {
  return requestJson<ApiTopicOrganizerResponse>("/api/topics/organize", {
    method: "POST",
    body: JSON.stringify({
      monitoring_prompt: payload.monitoringPrompt,
    }),
  });
}

export async function previewTopic(payload: {
  queries: string[];
  domainAllowlist?: string[] | null;
  languageFilter?: string[] | null;
  country?: string | null;
}): Promise<ApiTopicPreviewResponse> {
  return requestJson<ApiTopicPreviewResponse>("/api/topics/preview", {
    method: "POST",
    body: JSON.stringify({
      queries: payload.queries,
      search_domain_allowlist: payload.domainAllowlist ?? null,
      search_language_filter: payload.languageFilter ?? null,
      country: payload.country ?? null,
    }),
  });
}

export async function refineTopic(payload: {
  monitoringPrompt: string;
  queries: string[];
  domainAllowlist?: string[] | null;
  languageFilter?: string[] | null;
  country?: string | null;
  feedback: Array<{
    url: string;
    title?: string;
    snippet?: string;
    domain?: string;
    reaction: "up" | "down";
  }>;
}): Promise<ApiTopicOrganizerResponse> {
  return requestJson<ApiTopicOrganizerResponse>("/api/topics/refine", {
    method: "POST",
    body: JSON.stringify({
      monitoring_prompt: payload.monitoringPrompt,
      queries: payload.queries,
      search_domain_allowlist: payload.domainAllowlist ?? null,
      search_language_filter: payload.languageFilter ?? null,
      country: payload.country ?? null,
      feedback: payload.feedback,
    }),
  });
}

export async function suggestMoreDomains(payload: {
  monitoringPrompt: string;
  selectedDomains: string[];
}): Promise<ApiTopicSuggestDomainsResponse> {
  return requestJson<ApiTopicSuggestDomainsResponse>("/api/topics/suggest-domains", {
    method: "POST",
    body: JSON.stringify({
      monitoring_prompt: payload.monitoringPrompt,
      selected_domains: payload.selectedDomains,
    }),
  });
}

type TopicWritePayload = {
  monitoringPrompt: string;
  displayTitle: string;
  primaryQuery: string;
  queryVariations?: string[];
  groupUuid?: string | null;
  domainAllowlist?: string[] | null;
  languageFilter?: string[] | null;
  country?: string | null;
  updateFrequency?: TopicUpdateFrequency | null;
  autoEffectiveIntervalHours?: number | null;
  isActive?: boolean;
};

function serializeTopicPayload(payload: TopicWritePayload) {
  return {
    monitoring_prompt: payload.monitoringPrompt,
    display_title: payload.displayTitle,
    primary_query: payload.primaryQuery,
    query_variations: payload.queryVariations ?? [],
    group_uuid: payload.groupUuid ?? null,
    search_domain_allowlist: payload.domainAllowlist ?? null,
    search_language_filter: payload.languageFilter ?? null,
    country: payload.country ?? null,
    update_frequency: payload.updateFrequency ?? null,
    auto_effective_interval_hours: payload.autoEffectiveIntervalHours ?? null,
    is_active: payload.isActive,
  };
}

export async function createTopic(payload: TopicWritePayload): Promise<ApiTopicCreateResponse> {
  return requestJson<ApiTopicCreateResponse>("/api/topics/", {
    method: "POST",
    body: JSON.stringify(serializeTopicPayload(payload)),
  });
}

export async function updateTopic(
  uuid: string,
  payload: TopicWritePayload
): Promise<ApiTopicListItem> {
  return requestJson<ApiTopicListItem>(`/api/topics/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify(serializeTopicPayload(payload)),
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

export async function getTopicGroup(uuid: string): Promise<ApiTopicGroupItem> {
  return requestJson<ApiTopicGroupItem>(`/api/topics/groups/${uuid}`);
}

export async function createTopicGroup(payload: {
  name: string;
  description?: string;
}): Promise<ApiTopicGroupCreateResponse> {
  return requestJson<ApiTopicGroupCreateResponse>("/api/topics/groups", {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      description: payload.description ?? "",
    }),
  });
}

export async function updateTopicGroup(
  uuid: string,
  payload: {
    name?: string;
    description?: string;
  }
): Promise<ApiTopicGroupItem> {
  return requestJson<ApiTopicGroupItem>(`/api/topics/groups/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: payload.name,
      description: payload.description,
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
  if (params?.topicUuid) search.set("topic_uuid", params.topicUuid);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  if (params?.onlyNew) search.set("only_new", "true");
  if (params?.search?.trim()) search.set("search", params.search.trim());
  const query = search.toString();
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
