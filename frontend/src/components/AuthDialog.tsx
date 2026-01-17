/**
 * AuthDialog Component.
 * Provides a magic link sign-in / sign-up experience.
 */
import React, { useState } from 'react';
import { Mail, ArrowRight, Loader2, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestMagicLink } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';

interface AuthDialogProps {
  trigger?: React.ReactNode;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AuthDialog({ trigger, isOpen, onOpenChange }: AuthDialogProps) {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!email) return;

    setIsLoading(true);
    setError(null);
    try {
      const redirectUrl = typeof window === 'undefined' ? undefined : window.location.href;
      await requestMagicLink(email, redirectUrl);
      setIsSent(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to send magic link.";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    setIsSent(false);
    setEmail('');
    setError(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-[400px] p-0 overflow-hidden border-border bg-background shadow-2xl">
        <div className="relative h-2 bg-primary">
          <div className="absolute inset-0 bg-gradient-to-r from-primary via-primary/80 to-primary animate-pulse" />
        </div>

        <div className="p-8">
          <AnimatePresence mode="wait">
            {!isSent ? (
              <motion.div
                key="input"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <DialogHeader className="space-y-3">
                  <div className="flex justify-center mb-2">
                    <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                      <Sparkles className="h-6 w-6" />
                    </div>
                  </div>
                  <DialogTitle className="text-2xl font-bold text-center tracking-tight">
                    Welcome to NewsRadar
                  </DialogTitle>
                  <DialogDescription className="text-center text-muted-foreground">
                    Enter your email to receive a magic sign-in link. No password required.
                  </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="email"
                      className="text-xs font-bold uppercase tracking-wider text-muted-foreground"
                    >
                      Email Address
                    </Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="name@example.com"
                        className="pl-10 h-12 bg-muted/30 border-border/50 focus-visible:ring-primary"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        required
                        disabled={isLoading}
                      />
                    </div>
                  </div>
                  {error && (
                    <p className="text-xs text-destructive text-center">{error}</p>
                  )}
                  <Button
                    type="submit"
                    className="w-full h-12 text-sm font-bold uppercase tracking-widest group relative overflow-hidden"
                    disabled={isLoading || !email}
                  >
                    {isLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="flex items-center gap-2">
                        Send Magic Link
                        <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                      </span>
                    )}
                  </Button>
                </form>

                <p className="text-[10px] text-center text-muted-foreground/60 leading-relaxed">
                  By signing in, you agree to our{" "}
                  <span className="underline cursor-pointer hover:text-primary">Terms of Service</span>{" "}
                  and{" "}
                  <span className="underline cursor-pointer hover:text-primary">Privacy Policy</span>.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="py-6 space-y-6 text-center"
              >
                <div className="flex justify-center">
                  <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center text-primary relative">
                    <Mail className="h-10 w-10" />
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2, type: 'spring' }}
                      className="absolute -top-1 -right-1 h-6 w-6 bg-primary rounded-full border-4 border-background flex items-center justify-center"
                    >
                      <div className="h-1.5 w-1.5 bg-background rounded-full animate-ping" />
                    </motion.div>
                  </div>
                </div>

                <div className="space-y-2">
                  <h3 className="text-xl font-bold tracking-tight">Check your inbox</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed max-w-[280px] mx-auto">
                    We&apos;ve sent a magic link to{" "}
                    <span className="font-semibold text-foreground">{email}</span>. Click the link
                    to sign in instantly.
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    variant="outline"
                    onClick={handleReset}
                    className="h-10 text-xs font-bold uppercase tracking-widest border-border hover:bg-muted"
                  >
                    Back to sign in
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}
