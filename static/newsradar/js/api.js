const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function requestJson(path, options = {}) {
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

  const response = await fetch(path, {
    ...options,
    method,
    headers,
    credentials: "include",
  });

  if (response.status === 204) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    let message = response.statusText || "Request failed.";
    if (isJson) {
      try {
        const payload = await response.json();
        if (payload && payload.detail) {
          message = payload.detail;
        }
      } catch {
        // Leave the HTTP status text in place.
      }
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (!isJson) {
    throw new Error("Expected JSON response.");
  }
  return response.json();
}

function withQuery(path, params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "" || value === false) {
      return;
    }
    search.set(key, String(value));
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function serializeTopicPayload(payload) {
  return {
    monitoring_prompt: payload.monitoringPrompt,
    display_title: payload.displayTitle,
    primary_query: payload.primaryQuery,
    query_variations: payload.queryVariations || [],
    group_uuid: payload.groupUuid || null,
    search_domain_allowlist: payload.domainAllowlist || null,
    search_language_filter: payload.languageFilter || null,
    country: payload.country || null,
    update_frequency: payload.updateFrequency || null,
    auto_effective_interval_hours: payload.autoEffectiveIntervalHours || null,
    is_active: payload.isActive,
  };
}

export const api = {
  requestJson,

  getCurrentUser() {
    return requestJson("/api/auth/me");
  },

  logout() {
    return requestJson("/api/auth/logout", { method: "POST" });
  },

  requestMagicLink(email, redirectUrl) {
    return requestJson("/api/auth/magic-link", {
      method: "POST",
      body: JSON.stringify({
        email,
        redirect_url: redirectUrl || null,
      }),
    });
  },

  listTopics({ search, groupUuid, includeInactive } = {}) {
    return requestJson(withQuery("/api/topics/", {
      search,
      group_uuid: groupUuid,
      include_inactive: includeInactive ? "true" : undefined,
    }));
  },

  organizeTopic(payload) {
    return requestJson("/api/topics/organize", {
      method: "POST",
      body: JSON.stringify({
        monitoring_prompt: payload.monitoringPrompt,
      }),
    });
  },

  previewTopic(payload) {
    return requestJson("/api/topics/preview", {
      method: "POST",
      body: JSON.stringify({
        queries: payload.queries,
        search_domain_allowlist: payload.domainAllowlist || null,
        search_language_filter: payload.languageFilter || null,
        country: payload.country || null,
      }),
    });
  },

  refineTopic(payload) {
    return requestJson("/api/topics/refine", {
      method: "POST",
      body: JSON.stringify({
        monitoring_prompt: payload.monitoringPrompt,
        queries: payload.queries,
        search_domain_allowlist: payload.domainAllowlist || null,
        search_language_filter: payload.languageFilter || null,
        country: payload.country || null,
        feedback: payload.feedback,
      }),
    });
  },

  suggestMoreDomains(payload) {
    return requestJson("/api/topics/suggest-domains", {
      method: "POST",
      body: JSON.stringify({
        monitoring_prompt: payload.monitoringPrompt,
        selected_domains: payload.selectedDomains,
      }),
    });
  },

  createTopic(payload) {
    return requestJson("/api/topics/", {
      method: "POST",
      body: JSON.stringify(serializeTopicPayload(payload)),
    });
  },

  createTopics(payload) {
    return requestJson("/api/topics/bulk", {
      method: "POST",
      body: JSON.stringify({
        topics: (payload.topics || []).map(serializeTopicPayload),
      }),
    });
  },

  updateTopic(uuid, payload) {
    return requestJson(`/api/topics/${uuid}`, {
      method: "PATCH",
      body: JSON.stringify(serializeTopicPayload(payload)),
    });
  },

  deleteTopic(uuid) {
    return requestJson(`/api/topics/${uuid}`, { method: "DELETE" });
  },

  listTopicGroups(params = {}) {
    return requestJson(withQuery("/api/topics/groups", {
      include_inactive: params.includeInactive ? "true" : undefined,
    }));
  },

  createTopicGroup(payload) {
    return requestJson("/api/topics/groups", {
      method: "POST",
      body: JSON.stringify({
        name: payload.name,
        description: payload.description || "",
      }),
    });
  },

  updateTopicGroup(uuid, payload) {
    return requestJson(`/api/topics/groups/${uuid}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: payload.name,
        description: payload.description,
        is_active: payload.isActive,
      }),
    });
  },

  deleteTopicGroup(uuid) {
    return requestJson(`/api/topics/groups/${uuid}`, { method: "DELETE" });
  },

  listContentFeed(params = {}) {
    return requestJson(withQuery("/api/contents/", {
      topic_uuid: params.topicUuid,
      limit: params.limit,
      offset: params.offset,
      only_new: params.onlyNew ? "true" : undefined,
      search: params.search,
    }));
  },

  listContentByGroup(groupUuid, params = {}) {
    return requestJson(withQuery(`/api/contents/groups/${groupUuid}`, {
      limit: params.limit,
      offset: params.offset,
      only_new: params.onlyNew ? "true" : undefined,
      search: params.search,
    }));
  },

  getContentDetail(contentId) {
    return requestJson(`/api/contents/items/${contentId}/detail`);
  },

  deleteContentItem(contentId) {
    return requestJson(`/api/contents/items/${contentId}`, { method: "DELETE" });
  },

  requestContentAIResponse(payload) {
    return requestJson("/api/contents/ai/respond", {
      method: "POST",
      body: JSON.stringify({
        content_ids: payload.contentIds,
        instruction: payload.instruction,
        model: payload.model || null,
      }),
    });
  },

  createBookmark(contentId) {
    return requestJson("/api/contents/bookmarks", {
      method: "POST",
      body: JSON.stringify({ content_id: contentId }),
    });
  },

  deleteBookmark(contentId) {
    return requestJson(`/api/contents/bookmarks/${contentId}`, { method: "DELETE" });
  },

  runTopicScan(topicUuid) {
    return requestJson("/api/executions/web-search/", {
      method: "POST",
      body: JSON.stringify({
        topic_uuid: topicUuid,
        initiator: "user",
      }),
    });
  },

  getExecution(executionId) {
    return requestJson(`/api/executions/${executionId}/`);
  },

  createProCheckoutSession(payload) {
    return requestJson("/api/auth/billing/checkout", {
      method: "POST",
      body: JSON.stringify({
        plan: payload.plan,
        success_url: payload.successUrl || null,
        cancel_url: payload.cancelUrl || null,
      }),
    });
  },

  getApiAccessState() {
    return requestJson("/api/auth/api-access");
  },

  rotateApiAccessKey() {
    return requestJson("/api/auth/api-access/rotate", { method: "POST" });
  },
};
