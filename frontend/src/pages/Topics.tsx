import React, { useState } from 'react';
import { Layout } from '@/components/Layout';
import { useTopicGroup } from '@/components/TopicGroupContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { createTopic, deleteTopic, listTopics, updateTopic } from '@/lib/api';
import type { ApiTopicListItem, TopicItem } from '@/lib/types';
import { Plus, X, Search, PlusCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

export default function Topics() {
  const { selectedGroupName } = useTopicGroup();
  const [topics, setTopics] = useState<TopicItem[]>([]);
  const [queries, setQueries] = useState<string[]>([""]);
  const [domainInput, setDomainInput] = useState("");
  const [domainMode, setDomainMode] = useState<"allow" | "block">("allow");
  const [languageInput, setLanguageInput] = useState("");
  const [country, setCountry] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toTopicItem = (topic: ApiTopicListItem): TopicItem => ({
    id: topic.id,
    uuid: topic.uuid,
    term: topic.queries?.[0] || "Untitled",
    category: "General",
    isActive: topic.is_active,
    lastSearch: topic.last_fetched_at ? new Date(topic.last_fetched_at) : null,
    hasNewItems: topic.content_source_count > 0,
    groupUuid: topic.group_uuid,
    groupName: topic.group_name,
  });

  const loadTopics = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listTopics();
      setTopics(response.topics.map(toTopicItem));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to load topics.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void loadTopics();
  }, []);

  const updateQuery = (index: number, value: string) => {
    setQueries((prev) => prev.map((query, i) => (i === index ? value : query)));
  };

  const addQueryField = () => {
    setQueries((prev) => [...prev, ""]);
  };

  const removeQueryField = (index: number) => {
    setQueries((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const parseCommaList = (value: string) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);

  const addTopic = async () => {
    const normalizedQueries = queries.map((query) => query.trim()).filter(Boolean);
    if (!normalizedQueries.length) return;
    setError(null);
    try {
      const domainList = parseCommaList(domainInput);
      const languageList = parseCommaList(languageInput);
      const response = await createTopic(normalizedQueries, {
        domainAllowlist: domainMode === "allow" ? domainList : null,
        domainBlocklist: domainMode === "block" ? domainList : null,
        languageFilter: languageList,
        country: country ? country : null,
      });
      const created = toTopicItem(response.topic);
      setTopics((prev) => [created, ...prev]);
      setQueries([""]);
      setDomainInput("");
      setLanguageInput("");
      setCountry("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to add topic.";
      setError(message);
    }
  };

  const removeTopic = async (topic: TopicItem) => {
    setError(null);
    try {
      await deleteTopic(topic.uuid);
      setTopics((prev) => prev.filter((item) => item.id !== topic.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to remove topic.";
      setError(message);
    }
  };

  const toggleStatus = async (topic: TopicItem) => {
    const nextValue = !topic.isActive;
    setTopics((prev) =>
      prev.map((item) => (item.id === topic.id ? { ...item, isActive: nextValue } : item))
    );
    try {
      await updateTopic(topic.uuid, nextValue);
    } catch (err) {
      setTopics((prev) =>
        prev.map((item) => (item.id === topic.id ? { ...item, isActive: topic.isActive } : item))
      );
      const message = err instanceof Error ? err.message : "Unable to update topic.";
      setError(message);
    }
  };

  return (
    <Layout>
      <div className="mx-auto space-y-8 p-4 md:p-6 lg:p-10">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">{selectedGroupName}</h2>
          <p className="text-muted-foreground mt-1">Manage monitoring targets and AI search parameters.</p>
        </div>

        <Card>
           <CardHeader>
              <CardTitle>Add New Topic</CardTitle>
              <CardDescription>Configure a new topic for the AI radar to monitor.</CardDescription>
           </CardHeader>
           <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-foreground">Queries</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={addQueryField}
                    type="button"
                  >
                    <PlusCircle className="h-4 w-4" />
                    Add another
                  </Button>
                </div>
                <div className="space-y-3">
                  {queries.map((query, index) => (
                    <div key={index} className="flex items-center gap-3">
                      <Input
                        placeholder="Enter a topic query"
                        value={query}
                        onChange={(e) => updateQuery(index, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void addTopic()}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-muted-foreground hover:text-destructive"
                        onClick={() => removeQueryField(index)}
                        type="button"
                        disabled={queries.length === 1}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-border/60 pt-6 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-widest text-muted-foreground/70">
                    Advanced options
                  </span>
                  <div className="h-px flex-1 bg-border/60" />
                </div>
                <div className="grid gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Domains
                      </label>
                      <Input
                        placeholder="example.com, news.site"
                        value={domainInput}
                        onChange={(e) => setDomainInput(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Domain mode
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={domainMode}
                        onChange={(e) => setDomainMode(e.target.value as "allow" | "block")}
                      >
                        <option value="allow">Restrict to domains</option>
                        <option value="block">Exclude domains</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Languages
                      </label>
                      <Input
                        placeholder="en, fr, de"
                        value={languageInput}
                        onChange={(e) => setLanguageInput(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Country
                      </label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                      >
                        <option value="">All countries</option>
                        <option value="AU">Australia</option>
                        <option value="BR">Brazil</option>
                        <option value="CA">Canada</option>
                        <option value="CN">China</option>
                        <option value="FR">France</option>
                        <option value="DE">Germany</option>
                        <option value="IN">India</option>
                        <option value="IE">Ireland</option>
                        <option value="IL">Israel</option>
                        <option value="IT">Italy</option>
                        <option value="JP">Japan</option>
                        <option value="MX">Mexico</option>
                        <option value="NL">Netherlands</option>
                        <option value="NZ">New Zealand</option>
                        <option value="NO">Norway</option>
                        <option value="PL">Poland</option>
                        <option value="SG">Singapore</option>
                        <option value="ZA">South Africa</option>
                        <option value="ES">Spain</option>
                        <option value="SE">Sweden</option>
                        <option value="CH">Switzerland</option>
                        <option value="TR">Turkey</option>
                        <option value="AE">United Arab Emirates</option>
                        <option value="GB">United Kingdom</option>
                        <option value="US">United States</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => void addTopic()} className="gap-2" disabled={loading}>
                  <Plus className="h-4 w-4" /> Add
                </Button>
              </div>
           </CardContent>
        </Card>
        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           <AnimatePresence>
           {topics.map((topic) => (
              <motion.div
                 key={topic.id}
                 layout
                 initial={{ opacity: 0, scale: 0.9 }}
                 animate={{ opacity: 1, scale: 1 }}
                 exit={{ opacity: 0, scale: 0.9 }}
                 transition={{ duration: 0.2 }}
              >
                 <Card className={`relative overflow-hidden transition-all duration-200 ${!topic.isActive ? 'opacity-60 grayscale' : 'hover:border-primary/50'}`}>
                    <div className="absolute top-2 right-2 flex gap-1">
                       <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => void removeTopic(topic)}
                        >
                          <X className="h-3 w-3" />
                       </Button>
                    </div>
                    
                    <CardContent className="p-5">
                       <div className="flex items-center justify-between mb-4">
                          <Badge variant={topic.isActive ? "default" : "secondary"} className="text-[10px]">
                             {topic.category}
                          </Badge>
                          <div 
                             onClick={() => void toggleStatus(topic)}
                             className={`cursor-pointer h-2 w-2 rounded-full ${topic.isActive ? 'bg-primary animate-pulse' : 'bg-destructive'}`}
                             title={topic.isActive ? "Active" : "Paused"}
                          />
                       </div>
                       
                       <h3 className="font-bold text-lg mb-1">{topic.term}</h3>
                       
                       <div className="flex items-center text-xs text-muted-foreground gap-2 mt-4">
                          <Search className="h-3 w-3" />
                          <span>Last scan: {topic.lastSearch ? formatDistanceToNow(topic.lastSearch, { addSuffix: true }) : 'Never'}</span>
                       </div>
                    </CardContent>
                 </Card>
              </motion.div>
           ))}
           </AnimatePresence>
        </div>
      </div>
    </Layout>
  );
}
