const ENDPOINTS = [
  ["GET", "/api/auth/me", "Current user and plan details"],
  ["GET", "/api/topics/", "List topics for the authenticated account"],
  ["POST", "/api/topics/", "Create a new topic"],
  ["PATCH", "/api/topics/{topic_uuid}", "Update topic settings or queries"],
  ["GET", "/api/contents/", "Fetch the news feed"],
  ["GET", "/api/contents/items/{content_id}/detail", "Get full content detail"],
  ["GET", "/api/contents/?search=your-query", "Search content by title, snippet, or URL"],
  ["DELETE", "/api/contents/items/{content_id}", "Soft-delete a content item and hide its revisions"],
  ["GET", "/api/contents/trash", "List soft-deleted content items for restore"],
  ["DELETE", "/api/contents/trash", "Permanently remove all items from trash"],
  ["POST", "/api/contents/items/{content_id}/restore", "Restore a soft-deleted content item"],
  ["POST", "/api/executions/web-search/", "Trigger a scan for a topic"],
  ["GET", "/api/executions/{execution_id}/", "Check execution status"],
];

const METHOD_CLASS = {
  GET: "border-emerald-200 bg-emerald-50 text-emerald-700",
  POST: "border-sky-200 bg-sky-50 text-sky-700",
  PATCH: "border-amber-200 bg-amber-50 text-amber-700",
  DELETE: "border-red-200 bg-red-50 text-red-700",
};

export function initDeveloperAccess(context) {
  const root = document.getElementById("developer-access-root");
  if (!root) return;
  const local = {
    loading: false,
    error: null,
    accessState: null,
    copied: false,
    rotating: false,
  };

  function createdAtLabel() {
    if (!local.accessState || !local.accessState.key_created_at) return "";
    const value = new Date(local.accessState.key_created_at);
    return Number.isNaN(value.getTime()) ? "" : value.toLocaleString();
  }

  function apiKeyValue() {
    return local.accessState && local.accessState.api_key ? local.accessState.api_key : "YOUR_API_KEY";
  }

  function snippets() {
    const baseUrl = window.location.origin;
    const key = apiKeyValue();
    return {
      curl: `curl -X GET "${baseUrl}/api/topics/" \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json"`,
      python: `import requests

BASE_URL = "${baseUrl}"
API_KEY = "${key}"

response = requests.post(
    f"{BASE_URL}/api/topics/",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "monitoring_prompt": "AI chips policy",
        "display_title": "AI chips policy",
        "primary_query": "ai chips policy",
        "query_variations": ["semiconductor supply chain"],
    },
    timeout=30,
)
print(response.status_code)
print(response.json())`,
    };
  }

  function renderSignedOut() {
    root.innerHTML = `<div class="card p-6">
      <h2 class="text-xl font-semibold text-slate-900">Sign in required</h2>
      <p class="mt-1 text-sm text-slate-500">Sign in to see your API access state.</p>
      <button type="button" class="btn btn-primary mt-4" data-open-auth>Sign in</button>
    </div>${renderEndpoints()}`;
  }

  function renderEndpoints() {
    return `<div class="card p-5">
      <h2 class="text-xl font-semibold text-slate-900">Available endpoints</h2>
      <p class="mt-1 text-sm text-slate-500">Existing endpoints are available externally with your Pro API key.</p>
      <div class="mt-5 space-y-2">
        ${ENDPOINTS.map(([method, path, description]) => `<div class="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 md:flex-row md:items-center md:justify-between">
          <div class="flex items-center gap-3">
            <span class="badge ${METHOD_CLASS[method]}">${method}</span>
            <code class="text-xs text-slate-900">${context.utils.escapeHtml(path)}</code>
          </div>
          <p class="text-xs text-slate-500">${context.utils.escapeHtml(description)}</p>
        </div>`).join("")}
      </div>
    </div>`;
  }

  function render() {
    if (context.state.isAuthenticated !== true) {
      renderSignedOut();
      return;
    }
    if (local.loading) {
      root.innerHTML = '<div class="card p-6 text-sm text-slate-500">Loading API key...</div>';
      return;
    }
    const snippetsValue = snippets();
    const access = local.accessState;
    root.innerHTML = `<div class="card p-5">
      <h2 class="text-xl font-semibold text-slate-900">API key</h2>
      <p class="mt-1 text-sm text-slate-500">Use this key in <code>Authorization: Bearer &lt;API_KEY&gt;</code>.</p>
      ${local.error ? `<p class="mt-4 text-sm text-red-600">${context.utils.escapeHtml(local.error)}</p>` : ""}
      ${access && !access.is_pro ? `<div class="mt-4 space-y-3">
        <p class="text-sm text-slate-500">Upgrade to pro to get your API key.</p>
        <a class="btn btn-primary" href="/upgrade">Upgrade to Pro</a>
      </div>` : ""}
      ${access && access.is_pro ? `<div class="mt-4 space-y-4">
        <div class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <p class="text-xs font-bold uppercase tracking-widest text-slate-500">API key</p>
          <p class="mt-1 break-all font-mono text-sm text-slate-900">${context.utils.escapeHtml(access.api_key)}</p>
          ${createdAtLabel() ? `<p class="mt-2 text-xs text-slate-500">Created at ${context.utils.escapeHtml(createdAtLabel())}</p>` : ""}
        </div>
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" class="btn btn-outline" data-action="copy-key">${local.copied ? "Copied" : "Copy key"}</button>
          <button type="button" class="btn btn-primary" data-action="rotate-key" ${local.rotating ? "disabled" : ""}>${local.rotating ? "Regenerating..." : "Regenerate key"}</button>
        </div>
      </div>` : ""}
    </div>
    ${renderEndpoints()}
    <div class="grid gap-6 lg:grid-cols-2">
      <div class="card p-5">
        <h2 class="text-xl font-semibold text-slate-900">cURL example</h2>
        <p class="mt-1 text-sm text-slate-500">Read topics using your API key.</p>
        <pre class="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-900"><code>${context.utils.escapeHtml(snippetsValue.curl)}</code></pre>
      </div>
      <div class="card p-5">
        <h2 class="text-xl font-semibold text-slate-900">Python example</h2>
        <p class="mt-1 text-sm text-slate-500">Create a topic using requests.</p>
        <pre class="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-900"><code>${context.utils.escapeHtml(snippetsValue.python)}</code></pre>
      </div>
    </div>`;
  }

  async function load() {
    if (context.state.isAuthenticated !== true) {
      render();
      return;
    }
    local.loading = true;
    local.error = null;
    render();
    try {
      local.accessState = await context.api.getApiAccessState();
    } catch (error) {
      local.accessState = null;
      local.error = error instanceof Error ? error.message : "Unable to load API access details.";
    } finally {
      local.loading = false;
      render();
    }
  }

  async function rotateKey() {
    local.rotating = true;
    local.error = null;
    render();
    try {
      const payload = await context.api.rotateApiAccessKey();
      local.accessState = {
        is_pro: true,
        api_key: payload.api_key,
        key_created_at: payload.key_created_at,
      };
      local.copied = false;
    } catch (error) {
      local.error = error instanceof Error ? error.message : "Unable to rotate API key.";
    } finally {
      local.rotating = false;
      render();
    }
  }

  root.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-action]");
    if (!action) return;
    if (action.dataset.action === "copy-key" && local.accessState && local.accessState.api_key) {
      try {
        await navigator.clipboard.writeText(local.accessState.api_key);
        local.copied = true;
        render();
        window.setTimeout(() => {
          local.copied = false;
          render();
        }, 1500);
      } catch {
        local.copied = false;
      }
    }
    if (action.dataset.action === "rotate-key") {
      rotateKey();
    }
  });

  context.subscribe(load);
  load();
}
