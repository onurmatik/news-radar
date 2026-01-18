import type {
  ApiContentFeedResponse,
  ApiCurrentUser,
  ApiTopicCreateResponse,
  ApiTopicGroupCreateResponse,
  ApiTopicGroupListResponse,
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
    }),
  });
}

export async function updateTopic(
  uuid: string,
  payload: {
    isActive?: boolean;
    queries?: string[];
    domainAllowlist?: string[] | null;
    domainBlocklist?: string[] | null;
    languageFilter?: string[] | null;
    country?: string | null;
    searchRecencyFilter?: string | null;
  }
): Promise<ApiTopicListItem> {
  return requestJson<ApiTopicListItem>(`/api/topics/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify({
      is_active: payload.isActive,
      queries: payload.queries,
      search_domain_allowlist: payload.domainAllowlist ?? null,
      search_domain_blocklist: payload.domainBlocklist ?? null,
      search_language_filter: payload.languageFilter ?? null,
      country: payload.country ?? null,
      search_recency_filter: payload.searchRecencyFilter ?? null,
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

export async function createTopicGroup(payload: {
  name: string;
  description?: string;
  isPublic?: boolean;
}): Promise<ApiTopicGroupCreateResponse> {
  return requestJson<ApiTopicGroupCreateResponse>("/api/topics/groups", {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      description: payload.description ?? "",
      is_public: payload.isPublic ?? false,
    }),
  });
}

export async function updateTopicGroup(
  uuid: string,
  payload: {
    name?: string;
    description?: string;
    isPublic?: boolean;
  }
): Promise<void> {
  await requestJson(`/api/topics/groups/${uuid}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: payload.name,
      description: payload.description,
      is_public: payload.isPublic,
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
}): Promise<ApiContentFeedResponse> {
  const search = new URLSearchParams();
  if (params?.topicUuid) search.set("topic_uuid", params.topicUuid);
  if (params?.limit) search.set("limit", String(params.limit));
  if (params?.offset) search.set("offset", String(params.offset));
  const query = search.toString();
  return requestJson<ApiContentFeedResponse>(`/api/contents/${query ? `?${query}` : ""}`);
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
