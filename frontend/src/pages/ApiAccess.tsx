import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Copy, RefreshCcw, Sparkles, Code2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { getApiAccessState, rotateApiAccessKey } from '@/lib/api';
import type { ApiAccessState } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

type EndpointItem = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
};

const ENDPOINTS: EndpointItem[] = [
  { method: 'GET', path: '/api/auth/me', description: 'Current user and plan details' },
  { method: 'GET', path: '/api/topics/', description: 'List topics for the authenticated account' },
  { method: 'POST', path: '/api/topics/', description: 'Create a new topic' },
  { method: 'PATCH', path: '/api/topics/{topic_uuid}', description: 'Update topic settings or queries' },
  { method: 'GET', path: '/api/contents/', description: 'Fetch the news feed' },
  { method: 'GET', path: '/api/contents/items/{content_id}/detail', description: 'Get full content detail' },
  { method: 'GET', path: '/api/contents/?search=your-query', description: 'Search content by title, snippet, or URL' },
  { method: 'DELETE', path: '/api/contents/items/{content_id}', description: 'Soft-delete a content item and hide its revisions' },
  { method: 'GET', path: '/api/contents/trash', description: 'List soft-deleted content items for restore' },
  { method: 'DELETE', path: '/api/contents/trash', description: 'Permanently remove all items from trash' },
  { method: 'POST', path: '/api/contents/items/{content_id}/restore', description: 'Restore a soft-deleted content item' },
  { method: 'POST', path: '/api/executions/web-search/', description: 'Trigger a scan for a topic' },
  { method: 'GET', path: '/api/executions/{execution_id}/', description: 'Check execution status' },
];

const methodBadgeClass: Record<EndpointItem['method'], string> = {
  GET: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600',
  POST: 'border-sky-500/30 bg-sky-500/10 text-sky-600',
  PATCH: 'border-amber-500/30 bg-amber-500/10 text-amber-600',
  DELETE: 'border-rose-500/30 bg-rose-500/10 text-rose-600',
};

export default function ApiAccess() {
  const { isAuthenticated, openAuthDialog } = useAuthDialog();
  const [accessState, setAccessState] = useState<ApiAccessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  const baseUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
  const apiKeyValue = accessState?.api_key || 'YOUR_API_KEY';
  const createdAtLabel = useMemo(() => {
    if (!accessState?.key_created_at) return null;
    const value = new Date(accessState.key_created_at);
    if (Number.isNaN(value.getTime())) return null;
    return value.toLocaleString();
  }, [accessState?.key_created_at]);

  const curlSnippet = useMemo(
    () =>
      `curl -X GET "${baseUrl}/api/topics/" \\
  -H "Authorization: Bearer ${apiKeyValue}" \\
  -H "Content-Type: application/json"`,
    [apiKeyValue, baseUrl]
  );

  const pythonSnippet = useMemo(
    () =>
      `import requests

BASE_URL = "${baseUrl}"
API_KEY = "${apiKeyValue}"

response = requests.post(
    f"{BASE_URL}/api/topics/",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={"queries": ["ai chips policy", "semiconductor supply chain"]},
    timeout=30,
)
print(response.status_code)
print(response.json())`,
    [apiKeyValue, baseUrl]
  );

  useEffect(() => {
    if (isAuthenticated === null) return;
    if (!isAuthenticated) {
      setLoading(false);
      setAccessState(null);
      setError(null);
      return;
    }

    let isCancelled = false;
    const loadApiAccess = async () => {
      setLoading(true);
      setError(null);
      try {
        const payload = await getApiAccessState();
        if (!isCancelled) {
          setAccessState(payload);
        }
      } catch (requestError) {
        if (!isCancelled) {
          const message =
            requestError instanceof Error
              ? requestError.message
              : 'Unable to load API access details.';
          setError(message);
          setAccessState(null);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    };

    void loadApiAccess();
    return () => {
      isCancelled = true;
    };
  }, [isAuthenticated]);

  const copyKey = async () => {
    if (!accessState?.api_key || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(accessState.api_key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const rotateKey = async () => {
    setRotating(true);
    setError(null);
    try {
      const payload = await rotateApiAccessKey();
      setAccessState({
        is_pro: true,
        api_key: payload.api_key,
        key_created_at: payload.key_created_at,
      });
      setCopied(false);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : 'Unable to rotate API key.';
      setError(message);
    } finally {
      setRotating(false);
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-6 lg:p-10">
        <div className="space-y-3">
          <Badge className="inline-flex items-center gap-1.5 border-primary/25 bg-primary/10 text-primary hover:bg-primary/10">
            <Code2 className="h-3.5 w-3.5" />
            Developer API
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">API Access</h1>
          <p className="max-w-3xl text-sm text-muted-foreground md:text-base">
            Use your API key to access NewsRadar endpoints from external tools and scripts.
          </p>
        </div>

        {!isAuthenticated && (
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>Sign in required</CardTitle>
              <CardDescription>Sign in to see your API access state.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={openAuthDialog}>Sign in</Button>
            </CardContent>
          </Card>
        )}

        {isAuthenticated && (
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <CardTitle>API key</CardTitle>
              </div>
              <CardDescription>
                Use this key in `Authorization: Bearer &lt;API_KEY&gt;`.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading && <p className="text-sm text-muted-foreground">Loading API key...</p>}

              {!loading && error && (
                <p className="text-sm text-destructive">{error}</p>
              )}

              {!loading && !error && accessState && !accessState.is_pro && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Upgrade to pro to get your API key
                  </p>
                  <Button asChild>
                    <Link to="/upgrade" className="inline-flex items-center gap-2">
                      <Sparkles className="h-4 w-4" />
                      Upgrade to Pro
                    </Link>
                  </Button>
                </div>
              )}

              {!loading && !error && accessState?.is_pro && (
                <div className="space-y-4">
                  <div className="rounded-lg border border-border/70 bg-muted/30 px-4 py-3">
                    <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                      API key
                    </p>
                    <p className="mt-1 break-all font-mono text-sm text-foreground">
                      {accessState.api_key}
                    </p>
                    {createdAtLabel && (
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        Created at {createdAtLabel}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button variant="outline" onClick={() => void copyKey()}>
                      <Copy className="mr-2 h-4 w-4" />
                      {copied ? 'Copied' : 'Copy key'}
                    </Button>
                    <Button onClick={() => void rotateKey()} disabled={rotating}>
                      <RefreshCcw className="mr-2 h-4 w-4" />
                      {rotating ? 'Regenerating...' : 'Regenerate key'}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="border-border/70 bg-card/70">
          <CardHeader>
            <CardTitle>Available endpoints</CardTitle>
            <CardDescription>
              Existing endpoints are available externally with your Pro API key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {ENDPOINTS.map((endpoint) => (
              <div
                key={`${endpoint.method}-${endpoint.path}`}
                className="flex flex-col gap-2 rounded-lg border border-border/70 bg-background/80 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex items-center gap-3">
                  <Badge className={methodBadgeClass[endpoint.method]}>{endpoint.method}</Badge>
                  <code className="text-xs text-foreground">{endpoint.path}</code>
                </div>
                <p className="text-xs text-muted-foreground">{endpoint.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>cURL example</CardTitle>
              <CardDescription>Read topics using your API key.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/30 p-4 text-xs text-foreground">
                <code>{curlSnippet}</code>
              </pre>
            </CardContent>
          </Card>

          <Card className="border-border/70 bg-card/70">
            <CardHeader>
              <CardTitle>Python example</CardTitle>
              <CardDescription>Create a topic using `requests`.</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-lg border border-border/70 bg-muted/30 p-4 text-xs text-foreground">
                <code>{pythonSnippet}</code>
              </pre>
            </CardContent>
          </Card>
        </div>
      </div>
    </Layout>
  );
}
