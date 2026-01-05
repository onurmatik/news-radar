import React, { useState, useEffect } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { MOCK_NEWS, NewsItem } from '@/lib/mockData';
import { RefreshCw, ExternalLink, Clock, Share2, Sparkles, Filter, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

export default function Dashboard() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    // Simulate loading initial data
    setLoading(true);
    const timer = setTimeout(() => {
      setNews(MOCK_NEWS);
      setLoading(false);
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const handleRefresh = () => {
    setLoading(true);
    setTimeout(() => {
      // Simulate adding a new item
      const newItem: NewsItem = {
         id: Math.random().toString(),
         title: "Real-time Analysis: Market Shift Detected",
         summary: "AI radar picked up significant movement in renewable energy sector stocks following the latest policy announcement.",
         source: "MarketWatch",
         timestamp: new Date(),
         relevanceScore: 99,
         keywords: ["Renewable Energy", "Business"],
         category: "business",
         url: "#"
      };
      setNews(prev => [newItem, ...prev]);
      setLoading(false);
    }, 1500);
  };

  const filteredNews = filter === "all" ? news : news.filter(item => item.category === filter);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-8">
        
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Intelligence Feed</h2>
            <p className="text-muted-foreground mt-1">Real-time agenda monitoring and AI analysis.</p>
          </div>
          <div className="flex items-center gap-2">
             <div className="bg-card border border-border rounded-lg p-1 flex items-center">
                {['all', 'technology', 'business', 'science'].map(f => (
                   <button
                     key={f}
                     onClick={() => setFilter(f)}
                     className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors ${filter === f ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                   >
                     {f}
                   </button>
                ))}
             </div>
             <Button 
               onClick={handleRefresh} 
               disabled={loading}
               size="sm"
               className={`gap-2 ${loading ? 'opacity-80' : ''}`}
             >
               <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
               {loading ? 'Scanning...' : 'Scan Now'}
             </Button>
          </div>
        </div>

        {/* Stats / Hero Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
           <Card className="bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
              <CardContent className="p-6">
                 <div className="flex justify-between items-start mb-2">
                    <p className="text-sm font-medium text-muted-foreground">Active Keywords</p>
                    <Sparkles className="h-4 w-4 text-primary" />
                 </div>
                 <h3 className="text-3xl font-bold text-primary">12</h3>
                 <p className="text-xs text-muted-foreground mt-1">3 new added this week</p>
              </CardContent>
           </Card>
           <Card>
              <CardContent className="p-6">
                 <div className="flex justify-between items-start mb-2">
                    <p className="text-sm font-medium text-muted-foreground">Articles Analyzed</p>
                    <div className="h-4 w-4 rounded-full bg-blue-500/20 text-blue-500 flex items-center justify-center text-[10px]">24h</div>
                 </div>
                 <h3 className="text-3xl font-bold">843</h3>
                 <p className="text-xs text-muted-foreground mt-1">+12% from yesterday</p>
              </CardContent>
           </Card>
           <Card>
              <CardContent className="p-6">
                 <div className="flex justify-between items-start mb-2">
                    <p className="text-sm font-medium text-muted-foreground">Avg. Relevance</p>
                    <div className="h-4 w-4 rounded-full bg-emerald-500/20 text-emerald-500 flex items-center justify-center text-[10px]">%</div>
                 </div>
                 <h3 className="text-3xl font-bold">92%</h3>
                 <p className="text-xs text-muted-foreground mt-1">High signal-to-noise ratio</p>
              </CardContent>
           </Card>
        </div>

        {/* News Feed */}
        <div className="space-y-4">
          <AnimatePresence mode="popLayout">
            {filteredNews.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
              >
                <Card className="group hover:shadow-md transition-all duration-300 hover:border-primary/50 overflow-hidden relative">
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                    item.relevanceScore > 90 ? 'bg-primary' : 
                    item.relevanceScore > 80 ? 'bg-blue-500' : 'bg-gray-500'
                  }`}></div>
                  
                  <div className="flex flex-col sm:flex-row sm:items-start p-6 gap-4">
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider text-muted-foreground border-muted-foreground/30">
                          {item.source}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                        </span>
                        {item.relevanceScore > 90 && (
                          <Badge variant="default" className="text-[10px] h-5 bg-primary/10 text-primary hover:bg-primary/20 border-none shadow-none">
                            High Priority
                          </Badge>
                        )}
                      </div>
                      
                      <h3 className="text-lg font-semibold leading-tight group-hover:text-primary transition-colors cursor-pointer">
                        {item.title}
                      </h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                        {item.summary}
                      </p>
                      
                      <div className="flex items-center gap-2 pt-2 flex-wrap">
                        {item.keywords.map(k => (
                          <Badge key={k} variant="secondary" className="text-[10px] font-normal bg-muted/50">
                            #{k}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex sm:flex-col gap-2 mt-4 sm:mt-0 items-center justify-center sm:border-l sm:pl-4 border-border/50 min-w-[80px]">
                        <div className="text-center">
                           <div className={`text-xl font-bold ${
                              item.relevanceScore > 90 ? 'text-primary' : 'text-foreground'
                           }`}>
                              {item.relevanceScore}
                           </div>
                           <div className="text-[10px] text-muted-foreground uppercase">Score</div>
                        </div>
                        
                        <div className="flex gap-2 sm:mt-2">
                           <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                              <Share2 className="h-4 w-4" />
                           </Button>
                           <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-primary">
                              <ExternalLink className="h-4 w-4" />
                           </Button>
                        </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {filteredNews.length === 0 && !loading && (
             <div className="text-center py-20 text-muted-foreground">
                <p>No intelligence gathered for this filter.</p>
                <Button variant="link" onClick={() => setFilter("all")}>Clear filters</Button>
             </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
