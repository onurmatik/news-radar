import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getCurrentUser, logout } from '@/lib/api';
import type { ApiCurrentUser } from '@/lib/types';

export type AuthDialogContextValue = {
  isAuthenticated: boolean | null;
  currentUser: ApiCurrentUser | null;
  authDialogOpen: boolean;
  openAuthDialog: () => void;
  setAuthDialogOpen: (open: boolean) => void;
  refreshAuth: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthDialogContext = createContext<AuthDialogContextValue | null>(null);

export function AuthDialogProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [currentUser, setCurrentUser] = useState<ApiCurrentUser | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);

  const openAuthDialog = useCallback(() => {
    setAuthDialogOpen(true);
  }, []);

  const refreshAuth = useCallback(async () => {
    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
      setIsAuthenticated(true);
    } catch {
      setCurrentUser(null);
      setIsAuthenticated(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await logout();
    } finally {
      setCurrentUser(null);
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  return (
    <AuthDialogContext.Provider
      value={{
        isAuthenticated,
        currentUser,
        authDialogOpen,
        openAuthDialog,
        setAuthDialogOpen,
        refreshAuth,
        signOut,
      }}
    >
      {children}
    </AuthDialogContext.Provider>
  );
}

export function useAuthDialog() {
  const context = useContext(AuthDialogContext);
  if (!context) {
    throw new Error('useAuthDialog must be used within AuthDialogProvider.');
  }
  return context;
}
