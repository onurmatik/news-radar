import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { useAuthDialog } from '@/components/AuthDialogContext';
import { createProCheckoutSession } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function UpgradeToPro() {
  const [searchParams] = useSearchParams();
  const { isAuthenticated, currentUser, openAuthDialog } = useAuthDialog();
  const [submittingPlan, setSubmittingPlan] = useState<'monthly' | 'yearly' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkoutState = searchParams.get('checkout');

  const startCheckout = async (plan: 'monthly' | 'yearly') => {
    if (!isAuthenticated) {
      openAuthDialog();
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }

    setSubmittingPlan(plan);
    setError(null);
    const baseUrl = window.location.origin;

    try {
      const result = await createProCheckoutSession({
        plan,
        successUrl: `${baseUrl}/upgrade?checkout=success`,
        cancelUrl: `${baseUrl}/upgrade?checkout=cancelled`,
      });
      window.location.assign(result.checkout_url);
    } catch (checkoutError) {
      const message =
        checkoutError instanceof Error
          ? checkoutError.message
          : 'Unable to start checkout right now.';
      setError(message);
      setSubmittingPlan(null);
    }
  };

  const alreadyPro = currentUser?.is_pro === true;

  return (
    <Layout>
      <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6 lg:p-10">
        <div className="space-y-3">
          <Badge className="inline-flex items-center gap-1.5 border-primary/25 bg-primary/10 text-primary hover:bg-primary/10">
            <Sparkles className="h-3.5 w-3.5" />
            Pro membership
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Upgrade to Pro</h1>
          <p className="max-w-2xl text-sm text-muted-foreground md:text-base">
            Unlimited access to radar monitoring and AI analysis for your entire workflow.
            Fair use limits may apply to protect platform stability for all users.
          </p>
        </div>

        {checkoutState === 'success' && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-center gap-2 p-4 text-sm text-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Payment received. Your Pro membership is being activated.
            </CardContent>
          </Card>
        )}

        {checkoutState === 'cancelled' && (
          <Card className="border-border/70 bg-muted/40">
            <CardContent className="p-4 text-sm text-muted-foreground">
              Checkout was cancelled. You can restart anytime.
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {alreadyPro ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardHeader>
              <CardTitle>You are already Pro</CardTitle>
              <CardDescription>
                Active plan: {currentUser?.pro_plan === 'yearly' ? 'Yearly' : 'Monthly'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border-border/70 bg-card/70">
              <CardHeader>
                <CardTitle>Pro Monthly</CardTitle>
                <CardDescription>$20 / month</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="text-3xl font-bold tracking-tight">$20</div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Unlimited access to topics and feeds</li>
                  <li>Advanced AI responses</li>
                  <li>Priority updates and notifications</li>
                </ul>
                <Button
                  className="w-full"
                  onClick={() => void startCheckout('monthly')}
                  disabled={submittingPlan !== null}
                >
                  {submittingPlan === 'monthly' ? 'Redirecting...' : 'Choose monthly'}
                </Button>
              </CardContent>
            </Card>

            <Card className="border-primary/40 bg-card/70 shadow-sm shadow-primary/10">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <CardTitle>Pro Yearly</CardTitle>
                  <Badge className="border-primary/30 bg-primary/15 text-primary hover:bg-primary/15">
                    Best value
                  </Badge>
                </div>
                <CardDescription>$200 / year</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="text-3xl font-bold tracking-tight">$200</div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Everything in monthly plan</li>
                  <li>Pay less than 12 monthly renewals</li>
                  <li>Unlimited access (fair use limits may apply)</li>
                </ul>
                <Button
                  className="w-full"
                  onClick={() => void startCheckout('yearly')}
                  disabled={submittingPlan !== null}
                >
                  {submittingPlan === 'yearly' ? 'Redirecting...' : 'Choose yearly'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </Layout>
  );
}
