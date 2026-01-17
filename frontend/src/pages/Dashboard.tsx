import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createBookmark, deleteBookmark, listContentFeed } from '@/lib/api';
import type { ApiContentFeedItem, NewsItem } from '@/lib/types';
import { RefreshCw, ExternalLink, Clock, Share2, Sparkles, Filter, Star } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Dashboard component serving as the main interface.
 * 
 * Displays:
 * - Intelligence feed of captured content.
 * - Global scanning controls.
 * - Categorized filtering of the news radar.
 */
export default function Dashboard() {
  const { isAuthenticated, openAuthDialog } = useAuthDialog();
  const { selectedGroupName } = useTopicGroup();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  const getSourceLabel = (item: ApiContentFeedItem) => {
    if (item.source) return item.source;
    try {
      return new URL(item.url).hostname.replace(/^www\./, "");
    } catch {
      return "Unknown";
    }
  };

  const normalizeScore = (score: number | null) => {
    if (score === null || Number.isNaN(score)) return 0;
    if (score <= 1) return Math.round(score * 100);
    return Math.round(score);
  };

  const mapNewsItem = (item: ApiContentFeedItem): NewsItem => {
    const keywords = item.topic_queries?.length ? item.topic_queries : ["radar"];
    const timestamp = new Date(item.published_at || item.created_at);
    const safeTimestamp = Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
    return {
      id: item.id,
      title: item.title || item.url,
      summary: item.summary || "Summary not available.",
      source: getSourceLabel(item),
      timestamp: safeTimestamp,
      relevanceScore: normalizeScore(item.relevance_score),
      keywords,
      category: "general",
      url: item.url,
      isBookmarked: item.is_bookmarked,
    };
  };

  const loadFeed = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listContentFeed();
      setNews(response.items.map(mapNewsItem));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load feed.";
      setError(message);
      setNews([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      void loadFeed();
    } else if (isAuthenticated === false) {
      setNews([]);
      setLoading(false);
    }
  }, [isAuthenticated]);

  const handleRefresh = () => {
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    void loadFeed();
  };

  const toggleBookmark = async (item: NewsItem) => {
    const nextValue = !item.isBookmarked;
    setNews((prev) =>
      prev.map((entry) =>
        entry.id === item.id ? { ...entry, isBookmarked: nextValue } : entry
      )
    );
    try {
      if (nextValue) {
        await createBookmark(item.id);
      } else {
        await deleteBookmark(item.id);
      }
    } catch (error) {
      setNews((prev) =>
        prev.map((entry) =>
          entry.id === item.id ? { ...entry, isBookmarked: item.isBookmarked } : entry
        )
      );
      const message = error instanceof Error ? error.message : "Unable to update bookmark.";
      setError(message);
    }
  };

  const filteredNews = filter === "all" ? news : news.filter(item => item.category === filter);

  return (
    <Layout>
      <div className="mx-auto space-y-8 p-4 md:p-6 lg:p-10">
        
        {/* Dashboard Header Area */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-border/50 pb-8">
          <div>
            <h2 className="text-4xl font-extrabold tracking-tight text-foreground">
              {selectedGroupName}
            </h2>
            {error && (
              <p className="text-sm text-destructive mt-3">{error}</p>
            )}
          </div>
          
          <div className="flex flex-col sm:flex-row items-center gap-3">
             <Button 
               onClick={handleRefresh} 
               disabled={loading}
               size="sm"
               className={`h-10 rounded-full px-6 bg-foreground text-background hover:bg-foreground/90 transition-all ${loading ? 'opacity-80' : ''}`}
             >
               <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
               {loading ? 'Scanning...' : 'Scan Now'}
             </Button>
          </div>
        </div>

        {/* Content Feed */}
        <div className="space-y-6">
          <AnimatePresence mode="popLayout">
            {filteredNews.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.4, delay: index * 0.05, ease: "easeOut" }}
              >
                <Card className="group border-none bg-card/40 backdrop-blur-sm hover:bg-card/60 transition-all duration-300 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                     <Sparkles className="h-4 w-4 text-primary/40" />
                  </div>
                  
                  <div className="flex flex-col sm:flex-row p-6 gap-6">
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="text-[10px] font-bold text-primary uppercase tracking-tighter bg-primary/10 px-2 py-0.5 rounded">
                          {item.source}
                        </span>
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1.5 font-medium">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                        </span>
                        <div className="h-1 w-1 rounded-full bg-border"></div>
                        <span className="text-[11px] text-muted-foreground/60 lowercase italic">
                          captured from {item.keywords[0]}
                        </span>
                      </div>
                      
                      <h3 className="text-xl font-bold leading-tight group-hover:text-primary transition-colors cursor-pointer decoration-primary/30 decoration-2 underline-offset-4 hover:underline">
                        {item.title}
                      </h3>
                      <p className="text-[13px] text-muted-foreground leading-relaxed line-clamp-2">
                        {item.summary}
                      </p>
                      
                      <div className="flex items-center justify-between pt-2">
                        <div className="flex items-center gap-2">
                          {item.keywords.map(k => (
                            <Badge key={k} variant="outline" className="text-[9px] font-medium border-border/50 text-muted-foreground hover:bg-muted">
                              #{k}
                            </Badge>
                          ))}
                        </div>
                        
                        <div className="flex items-center gap-1">
                           <Button 
                             size="icon" 
                             variant="ghost" 
                             className={`h-8 w-8 rounded-full transition-colors ${item.isBookmarked ? 'text-yellow-500 bg-yellow-500/10 hover:bg-yellow-500/20' : 'text-muted-foreground hover:text-foreground'}`}
                             onClick={() => toggleBookmark(item)}
                           >
                              <Star className={`h-3.5 w-3.5 ${item.isBookmarked ? 'fill-current' : ''}`} />
                           </Button>
                           <Button size="icon" variant="ghost" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground">
                              <Share2 className="h-3.5 w-3.5" />
                           </Button>
                           <Button
                             variant="ghost"
                             size="sm"
                             className="h-8 text-[11px] font-bold text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-full px-3"
                             asChild
                           >
                             <a href={item.url} target="_blank" rel="noreferrer">
                               SOURCE <ExternalLink className="h-3 w-3 ml-1.5" />
                             </a>
                           </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {filteredNews.length === 0 && !loading && (
             <div className="text-center py-24 border border-dashed border-border/50 rounded-2xl bg-muted/5">
                <div className="flex justify-center mb-4">
                   <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                      <Filter className="h-6 w-6 text-muted-foreground/40" />
                   </div>
                </div>
                <h4 className="text-lg font-bold">No signals found</h4>
                <p className="text-sm text-muted-foreground mt-1 mb-6">Adjust your filters or trigger a manual scan.</p>
                <Button variant="outline" size="sm" onClick={() => setFilter("all")} className="rounded-full">
                   Clear all filters
                </Button>
             </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
