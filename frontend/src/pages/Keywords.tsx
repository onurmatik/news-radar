import React, { useState } from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { MOCK_KEYWORDS, Keyword } from '@/lib/mockData';
import { Plus, X, Tag, Search, AlertCircle, CheckCircle2 } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';

export default function Keywords() {
  const [keywords, setKeywords] = useState<Keyword[]>(MOCK_KEYWORDS);
  const [newKeyword, setNewKeyword] = useState("");
  const [category, setCategory] = useState("General");

  const addKeyword = () => {
    if (!newKeyword.trim()) return;
    const newItem: Keyword = {
      id: Math.random().toString(),
      term: newKeyword,
      category: category,
      isActive: true,
      lastSearch: null
    };
    setKeywords([newItem, ...keywords]);
    setNewKeyword("");
  };

  const removeKeyword = (id: string) => {
    setKeywords(keywords.filter(k => k.id !== id));
  };

  const toggleStatus = (id: string) => {
    setKeywords(keywords.map(k => k.id === id ? { ...k, isActive: !k.isActive } : k));
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto space-y-8">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Keyword Protocol</h2>
          <p className="text-muted-foreground mt-1">Manage monitoring targets and AI search parameters.</p>
        </div>

        <Card>
           <CardHeader>
              <CardTitle>Add New Target</CardTitle>
              <CardDescription>Configure a new topic for the AI radar to monitor.</CardDescription>
           </CardHeader>
           <CardContent>
              <div className="flex flex-col sm:flex-row gap-4">
                 <div className="flex-1">
                    <Input 
                      placeholder="Enter keyword or phrase (e.g. 'Solid State Batteries')" 
                      value={newKeyword}
                      onChange={(e) => setNewKeyword(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addKeyword()}
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
                 <Button onClick={addKeyword} className="gap-2">
                    <Plus className="h-4 w-4" /> Add
                 </Button>
              </div>
           </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
           <AnimatePresence>
           {keywords.map((keyword) => (
              <motion.div
                 key={keyword.id}
                 layout
                 initial={{ opacity: 0, scale: 0.9 }}
                 animate={{ opacity: 1, scale: 1 }}
                 exit={{ opacity: 0, scale: 0.9 }}
                 transition={{ duration: 0.2 }}
              >
                 <Card className={`relative overflow-hidden transition-all duration-200 ${!keyword.isActive ? 'opacity-60 grayscale' : 'hover:border-primary/50'}`}>
                    <div className="absolute top-2 right-2 flex gap-1">
                       <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-6 w-6 text-muted-foreground hover:text-destructive"
                          onClick={() => removeKeyword(keyword.id)}
                        >
                          <X className="h-3 w-3" />
                       </Button>
                    </div>
                    
                    <CardContent className="p-5">
                       <div className="flex items-center justify-between mb-4">
                          <Badge variant={keyword.isActive ? "default" : "secondary"} className="text-[10px]">
                             {keyword.category}
                          </Badge>
                          <div 
                             onClick={() => toggleStatus(keyword.id)}
                             className={`cursor-pointer h-2 w-2 rounded-full ${keyword.isActive ? 'bg-primary animate-pulse' : 'bg-destructive'}`}
                             title={keyword.isActive ? "Active" : "Paused"}
                          />
                       </div>
                       
                       <h3 className="font-bold text-lg mb-1">{keyword.term}</h3>
                       
                       <div className="flex items-center text-xs text-muted-foreground gap-2 mt-4">
                          <Search className="h-3 w-3" />
                          <span>Last scan: {keyword.lastSearch ? formatDistanceToNow(keyword.lastSearch, { addSuffix: true }) : 'Never'}</span>
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
