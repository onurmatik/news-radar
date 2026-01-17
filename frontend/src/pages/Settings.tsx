import React from 'react';
import { Layout } from '@/components/Layout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch'; // Will need to create this or use checkbox styled
import { Save, Bell, Shield, Database, Cpu, Mail } from 'lucide-react';

export default function Settings() {
  return (
    <Layout>
      <div className="mx-auto space-y-8 p-4 md:p-6 lg:p-10">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">System Configuration</h2>
          <p className="text-muted-foreground mt-1">Adjust radar sensitivity and notification preferences.</p>
        </div>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-primary" />
                <CardTitle>AI Model Configuration</CardTitle>
              </div>
              <CardDescription>Configure the AI engine used for analyzing news relevance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Model Selection</label>
                  <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                    <option>GPT-4 Turbo (Recommended)</option>
                    <option>Claude 3 Opus</option>
                    <option>Claude 3 Sonnet</option>
                    <option>Local LLM (Ollama)</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Relevance Threshold</label>
                  <div className="flex items-center gap-4">
                    <Input type="range" className="w-full" min="0" max="100" defaultValue="75" />
                    <span className="text-sm font-mono bg-muted px-2 py-1 rounded">75%</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                <CardTitle>Notifications</CardTitle>
              </div>
              <CardDescription>Manage how and when you receive alerts.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                <div className="space-y-0.5">
                  <h4 className="text-sm font-medium">High Relevance Alerts</h4>
                  <p className="text-xs text-muted-foreground">Notify only when score is &gt; 90%</p>
                </div>
                <div className="h-6 w-11 bg-primary rounded-full relative cursor-pointer">
                  <div className="absolute right-1 top-1 h-4 w-4 bg-white rounded-full shadow-sm"></div>
                </div>
              </div>
              
              <div className="flex items-center justify-between p-3 border rounded-lg bg-muted/20">
                <div className="space-y-0.5">
                  <h4 className="text-sm font-medium">Daily Digest</h4>
                  <p className="text-xs text-muted-foreground">Receive a summary email at 8:00 AM</p>
                </div>
                <div className="h-6 w-11 bg-muted rounded-full relative cursor-pointer">
                   <div className="absolute left-1 top-1 h-4 w-4 bg-white rounded-full shadow-sm"></div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <CardTitle>Data Retention</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
               <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted-foreground mb-2">Automatically archive news items older than:</p>
                  <div className="flex gap-2">
                     <Button variant="outline" size="sm" className="bg-primary/10 border-primary text-primary">30 Days</Button>
                     <Button variant="outline" size="sm">60 Days</Button>
                     <Button variant="outline" size="sm">90 Days</Button>
                     <Button variant="outline" size="sm">Forever</Button>
                  </div>
               </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-4">
             <Button variant="outline">Reset to Defaults</Button>
             <Button className="gap-2">
                <Save className="h-4 w-4" /> Save Changes
             </Button>
          </div>
        </div>
      </div>
    </Layout>
  );
}
