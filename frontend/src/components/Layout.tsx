import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, Radio, Settings, Search, PlusCircle, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SidebarProps {
  children: React.ReactNode;
}

export function Layout({ children }: SidebarProps) {
  const location = useLocation();

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Radio, label: 'Keywords', path: '/keywords' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 hidden md:flex flex-col">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-primary">
             <Radio className="h-5 w-5 animate-pulse" />
             <div className="absolute inset-0 rounded-full ring-1 ring-primary/50 animate-ping opacity-20 duration-1000"></div>
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">NewsRadar</h1>
            <p className="text-xs text-muted-foreground font-mono">v1.0.0-beta</p>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <div className="mb-4">
            <p className="px-4 text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">Menu</p>
            {navItems.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-all duration-200",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
            ))}
          </div>

          <div>
             <div className="flex items-center justify-between px-4 mb-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Scans</p>
                <Badge variant="outline" className="text-[10px] h-4 px-1">Live</Badge>
             </div>
             
             <div className="space-y-1 px-2">
                {["AI Models", "Fusion Tech", "Web3 Markets"].map((tag, i) => (
                   <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground/80 hover:text-foreground hover:bg-muted/50 rounded cursor-pointer group">
                      <div className={`h-1.5 w-1.5 rounded-full ${i === 0 ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-gray-600 group-hover:bg-gray-400'}`}></div>
                      <span className="truncate">{tag}</span>
                   </div>
                ))}
             </div>
          </div>
        </nav>

        <div className="p-4 border-t border-border bg-card/30">
          <div className="flex items-center gap-3 p-2 rounded-lg bg-muted/50 border border-border/50">
            <div className="h-8 w-8 rounded bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-xs font-bold text-white">
              AI
            </div>
            <div className="overflow-hidden">
              <p className="text-sm font-medium truncate">Pro Plan</p>
              <p className="text-xs text-muted-foreground truncate">1,240 credits left</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <header className="h-16 border-b border-border bg-background/80 backdrop-blur-sm flex items-center justify-between px-6 z-10">
           <div className="md:hidden flex items-center gap-2 font-bold text-lg">
             <Radio className="h-5 w-5 text-primary" /> NewsRadar
           </div>
           
           <div className="hidden md:flex items-center gap-4 flex-1 max-w-xl">
              <div className="relative w-full">
                 <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                 <input 
                   type="text" 
                   placeholder="Quick search..." 
                   className="w-full bg-muted/40 border-none rounded-md py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                 />
              </div>
           </div>

           <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" className="hidden sm:flex gap-2">
                 <PlusCircle className="h-4 w-4" />
                 <span>Add Keyword</span>
              </Button>
              <Button variant="ghost" size="icon" className="relative">
                 <Bell className="h-5 w-5" />
                 <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-destructive border-2 border-background"></span>
              </Button>
           </div>
        </header>
        
        <div className="flex-1 overflow-auto p-4 md:p-6 lg:p-8 bg-muted/10">
          {children}
        </div>
      </main>
    </div>
  );
}
