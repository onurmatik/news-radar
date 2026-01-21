import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { useTopics } from '@/components/TopicsContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createBookmark, deleteBookmark, getContentDetail } from '@/lib/api';
import type { ApiContentDetailItem } from '@/lib/types';
import { ArrowLeft, Clock, ExternalLink, Share2, Star } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ContentFullDetail() {
  const { contentId } = useParams();
  const navigate = useNavigate();
  const { isAuthenticated, openAuthDialog } = useAuthDialog();
  const { setSelectedGroupId, setSelectedTopicUuid } = useTopicGroup();
  const { topics } = useTopics();
  const [item, setItem] = useState<ApiContentDetailItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  const numericId = useMemo(() => {
    if (!contentId) return null;
    const parsed = Number.parseInt(contentId, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }, [contentId]);

  useEffect(() => {
    if (isAuthenticated === false) {
      setItem(null);
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated !== true) return;
    if (!numericId) {
      setError("Invalid content ID.");
      return;
    }
    setLoading(true);
    setError(null);
    getContentDetail(numericId)
      .then((response) => {
        setItem(response);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : "Unable to load content.";
        setError(message);
        setItem(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isAuthenticated, numericId]);

  useEffect(() => {
    if (!item) return;
    setSelectedTopicUuid(item.topic_uuid);
    const match = topics.find((topic) => topic.uuid === item.topic_uuid);
    if (match?.groupUuid) {
      setSelectedGroupId(match.groupUuid);
    }
  }, [item, setSelectedGroupId, setSelectedTopicUuid, topics]);

  const topicLabel = useMemo(() => {
    if (!item) return "";
    const match = topics.find((topic) => topic.uuid === item.topic_uuid);
    return match?.term || item.topic_queries?.[0] || "Topic";
  }, [item, topics]);

  const buildShareUrl = (contentId: number) => {
    if (typeof window === "undefined") {
      return `#/content/${contentId}/full`;
    }
    return `${window.location.origin}${window.location.pathname}#/content/${contentId}/full`;
  };

  const handleShare = (contentId: number) => {
    const url = buildShareUrl(contentId);
    setShareUrl(url);
    setShareStatus(null);
    setShareDialogOpen(true);
  };

  const handleCopyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareStatus("Link copied to clipboard.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to copy the link.";
      setShareStatus(message);
    }
  };

  const toggleBookmark = async () => {
    if (!item) return;
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    const nextValue = !item.is_bookmarked;
    setItem((prev) => (prev ? { ...prev, is_bookmarked: nextValue } : prev));
    try {
      if (nextValue) {
        await createBookmark(item.id);
      } else {
        await deleteBookmark(item.id);
      }
    } catch (error) {
      setItem((prev) => (prev ? { ...prev, is_bookmarked: item.is_bookmarked } : prev));
      const message =
        error instanceof Error ? error.message : "Unable to update bookmark.";
      setError(message);
    }
  };

  const handleBack = () => {
    if (item) {
      setSelectedTopicUuid(item.topic_uuid);
      const match = topics.find((topic) => topic.uuid === item.topic_uuid);
      if (match?.groupUuid) {
        setSelectedGroupId(match.groupUuid);
      }
    }
    navigate('/');
  };

  return (
    <Layout>
      <div className="mx-auto space-y-6 p-4 md:p-6 lg:p-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Link
            to="/"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
          >
            Intelligence feed
          </Link>
        </div>

        {isAuthenticated === false && (
          <Card className="border border-border/60 bg-card/40">
            <CardContent className="space-y-3 p-6">
              <p className="text-sm text-muted-foreground">
                Sign in to view this content detail.
              </p>
              <Button onClick={openAuthDialog} size="sm">
                Sign in
              </Button>
            </CardContent>
          </Card>
        )}

        {isAuthenticated && (
          <>
            {loading && (
              <Card className="border border-border/60 bg-card/40">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  Loading content detail...
                </CardContent>
              </Card>
            )}

            {error && !loading && (
              <Card className="border border-border/60 bg-card/40">
                <CardContent className="p-6 text-sm text-destructive">
                  {error}
                </CardContent>
              </Card>
            )}

            {item && !loading && (
              <Card className="border border-border/60 bg-card/40">
                <CardContent className="space-y-5 p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge className="text-[9px] font-medium border-border/50 text-muted-foreground bg-light hover:bg-muted">
                        {item.source || "Unknown"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-medium">
                        <Clock className="h-3 w-3" />
                        {formatDistanceToNow(
                          new Date(item.published_at || item.created_at),
                          { addSuffix: true }
                        )}
                      </span>
                      <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                        {topicLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        className={`h-8 w-8 rounded-full transition-colors hover:bg-emerald-500/10 ${item.is_bookmarked ? 'text-yellow-500 bg-yellow-500/10' : 'text-muted-foreground hover:text-foreground'}`}
                        onClick={() => void toggleBookmark()}
                      >
                        <Star className={`h-3.5 w-3.5 ${item.is_bookmarked ? 'fill-current' : ''}`} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-emerald-500/10"
                        onClick={() => handleShare(item.id)}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-emerald-500/10"
                        asChild
                      >
                        <a href={item.url} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h2 className="text-2xl font-bold leading-tight text-foreground">
                      {item.title || item.url}
                    </h2>
                    <ReactMarkdown
                      className="text-sm text-muted-foreground leading-relaxed space-y-4"
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ node, ...props }) => (
                          <h1 className="text-xl font-semibold text-foreground" {...props} />
                        ),
                        h2: ({ node, ...props }) => (
                          <h2 className="text-lg font-semibold text-foreground" {...props} />
                        ),
                        h3: ({ node, ...props }) => (
                          <h3 className="text-base font-semibold text-foreground" {...props} />
                        ),
                        p: ({ node, ...props }) => (
                          <p className="text-sm text-muted-foreground leading-relaxed" {...props} />
                        ),
                        a: ({ node, ...props }) => (
                          <a
                            className="text-primary underline-offset-4 hover:underline"
                            target="_blank"
                            rel="noreferrer"
                            {...props}
                          />
                        ),
                        ul: ({ node, ...props }) => (
                          <ul className="list-disc list-inside space-y-2" {...props} />
                        ),
                        ol: ({ node, ...props }) => (
                          <ol className="list-decimal list-inside space-y-2" {...props} />
                        ),
                        li: ({ node, ...props }) => (
                          <li className="text-sm text-muted-foreground" {...props} />
                        ),
                        blockquote: ({ node, ...props }) => (
                          <blockquote
                            className="border-l-2 border-border pl-4 text-muted-foreground italic"
                            {...props}
                          />
                        ),
                        code: ({ node, ...props }) => (
                          <code
                            className="rounded bg-muted px-1 py-0.5 text-[12px] text-foreground"
                            {...props}
                          />
                        ),
                        pre: ({ node, ...props }) => (
                          <pre
                            className="rounded-lg border border-border/60 bg-muted/40 p-4 overflow-auto text-[12px]"
                            {...props}
                          />
                        ),
                      }}
                    >
                      {item.content || item.summary || "Content not available."}
                    </ReactMarkdown>
                  </div>

                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>

      <Dialog open={shareDialogOpen} onOpenChange={setShareDialogOpen}>
        <DialogContent className="sm:max-w-[520px] border-border bg-background">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl font-semibold">Share content</DialogTitle>
            <DialogDescription>
              Copy the link to the full content detail view.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-border/60 bg-muted/40 px-3 py-2 text-xs font-mono text-foreground break-all">
              {shareUrl || "Select a content item to share."}
            </div>
            {shareStatus && (
              <p className="text-xs text-muted-foreground">{shareStatus}</p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => void handleCopyShare()} disabled={!shareUrl}>
              Copy link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
