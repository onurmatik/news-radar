import React, { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MOCK_TOPICS, Topic } from '@/lib/mockData';
import { Plus, X, Search } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

export default function Topics() {
  const [topics, setTopics] = useState<Topic[]>(MOCK_TOPICS);
  const [newTopic, setNewTopic] = useState("");
  const [category, setCategory] = useState("General");

  const addTopic = () => {
    if (!newTopic.trim()) return;
    const newItem: Topic = {
      id: Math.random().toString(),
      term: newTopic,
      category: category,
      isActive: true,
      lastSearch: null
    };
    setTopics([newItem, ...topics]);
    setNewTopic("");
  };

  const removeTopic = (id: string) => {
    setTopics(topics.filter(t => t.id !== id));
  };

  const toggleStatus = (id: string) => {
    setTopics(topics.map(t => t.id === id ? { ...t, isActive: !t.isActive } : t));
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Topic Protocol</h2>
          <p className="text-muted-foreground mt-1">Manage monitoring targets and AI search parameters.</p>
        </div>

        <Card>
           <CardHeader>
              <CardTitle>Add New Topic</CardTitle>
              <CardDescription>Configure a new topic for the AI radar to monitor.</CardDescription>
           </CardHeader>
           <CardContent>
              <div className="flex flex-col sm:flex-row gap-4">
                 <div className="flex-1">
                    <Input 
                      placeholder="Enter topic or phrase (e.g. 'Solid State Batteries')" 
                      value={newTopic}
                      onChange={(e) => setNewTopic(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addTopic()}
                    />
                 </div>
                 <div className="w-full sm:w-48">
                    <select 
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                       <option>Technology</option>
                       <option>Business</option>
                       <option>Science</option>
                       <option>Politics</option>
                       <option>Environment</option>
                       <option>General</option>
                    </select>
                 </div>
                 <Button onClick={addTopic} className="gap-2">
                    <Plus className="h-4 w-4" /> Add
                 </Button>
              </div>
           </CardContent>
        </Card>

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
                          onClick={() => removeTopic(topic.id)}
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
                             onClick={() => toggleStatus(topic.id)}
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
