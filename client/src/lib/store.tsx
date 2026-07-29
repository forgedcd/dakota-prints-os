import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { get, post, setToken } from './api';

// ------------------------------------------------------------------- auth
type User = { id: number; name: string; email: string; role: string };
type AuthCtx = { user: User | null; loading: boolean; signIn: (e: string, p: string) => Promise<void>; signOut: () => Promise<void> };
const Auth = createContext<AuthCtx>({ user: null, loading: true, signIn: async () => {}, signOut: async () => {} });
export const useAuth = () => useContext(Auth);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    get('/api/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);
  const value = useMemo<AuthCtx>(() => ({
    user, loading,
    async signIn(email, password) {
      const r = await post('/api/auth/login', { email, password });
      setToken(r.token);
      setUser(r.user);
    },
    async signOut() {
      try { await post('/api/auth/logout'); } catch {}
      setToken(null);
      setUser(null);
    },
  }), [user, loading]);
  return <Auth.Provider value={value}>{children}</Auth.Provider>;
}
