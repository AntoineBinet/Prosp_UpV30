import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  login as authLogin,
  logout as authLogout,
  getStoredUser,
  hasTokens,
} from "../services/auth";
import { apiFetch, setSessionExpiredHandler } from "../services/api";

interface User {
  id: number;
  role: string;
  name: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  signIn: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const signOut = useCallback(async () => {
    await authLogout();
    setUser(null);
  }, []);

  // Register session expired handler
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
    });
  }, []);

  // Check for existing session on mount
  useEffect(() => {
    (async () => {
      try {
        const hasToken = await hasTokens();
        if (!hasToken) {
          setIsLoading(false);
          return;
        }
        // Validate token by calling /api/auth/me
        const stored = await getStoredUser();
        if (stored) {
          try {
            const me = await apiFetch<{ ok: boolean; id: number; role: string; display_name: string; username: string }>("/api/auth/me");
            if (me.ok !== false) {
              setUser({
                id: me.id ?? stored.id,
                role: me.role ?? stored.role,
                name: me.display_name ?? me.username ?? stored.name,
              });
            }
          } catch {
            // Token expired or invalid — try refresh happened inside apiFetch
            // If still stored, use cached user
            const recheck = await getStoredUser();
            if (recheck) setUser(recheck);
          }
        }
      } catch {
        // No valid session
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await authLogin(username, password);
    setUser(result.user);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        signIn,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
