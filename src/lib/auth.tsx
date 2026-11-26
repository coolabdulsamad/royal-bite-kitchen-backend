import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { trpc } from "@/providers/trpc";
import { getCachedUser, getToken, saveCachedUser, saveToken } from "./apiAuth";
import type { StaffRole } from "@contracts/roles";
import type { PermissionMap } from "@contracts/permissions";

export interface SessionUser {
  id: number;
  staffCode: string;
  name: string;
  username: string;
  role: StaffRole;
  /** Effective permission map from auth.me / login (absent on stale cache). */
  permissions?: PermissionMap;
}

export type AuthStatus = "anon" | "loading" | "authed";

interface AuthValue {
  status: AuthStatus;
  user: SessionUser | null;
  login: (token: string, user: SessionUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getToken());

  const me = trpc.auth.me.useQuery(undefined, {
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });

  // Invalid/expired token → clear the session completely.
  useEffect(() => {
    if (me.isError) {
      saveToken(null);
      saveCachedUser(null);
      setToken(null);
    }
  }, [me.isError]);

  const login = useCallback((newToken: string, user: SessionUser) => {
    saveToken(newToken);
    saveCachedUser(user);
    setToken(newToken);
  }, []);

  const logout = useCallback(() => {
    saveToken(null);
    saveCachedUser(null);
    setToken(null);
  }, []);

  const value = useMemo<AuthValue>(() => {
    if (!token) {
      return { status: "anon", user: null, login, logout };
    }
    if (me.isError) {
      return { status: "anon", user: null, login, logout };
    }
    const user = (me.data as SessionUser | undefined) ?? getCachedUser<SessionUser>();
    if (me.isLoading && !user) {
      return { status: "loading", user: null, login, logout };
    }
    return { status: "authed", user, login, logout };
  }, [token, me.data, me.isLoading, me.isError, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
