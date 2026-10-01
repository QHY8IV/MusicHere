import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken, setUnauthorizedHandler, type User } from './api';

const KEY = 'musichere.session.v1';

interface AuthState {
  /** 正在读取本地保存的登录态 */
  loading: boolean;
  user: User | null;
  register: (nickname: string) => Promise<void>;
  rename: (nickname: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const clear = useCallback(async () => {
    setToken(null);
    setUser(null);
    await AsyncStorage.removeItem(KEY).catch(() => {});
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => void clear());
    return () => setUnauthorizedHandler(null);
  }, [clear]);

  // 启动时恢复登录态，并向服务端确认 token 仍然有效
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEY);
        if (!saved) return;
        const { token } = JSON.parse(saved) as { token: string };
        setToken(token);
        const me = await api.me();
        if (!cancelled) setUser(me.user);
      } catch (err) {
        // 401 已由全局处理器清理；网络错误时保持未登录，让用户重试
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const register = useCallback(async (nickname: string) => {
    const res = await api.guest(nickname);
    setToken(res.token);
    await AsyncStorage.setItem(KEY, JSON.stringify({ token: res.token })).catch(() => {});
    setUser(res.user);
  }, []);

  const rename = useCallback(async (nickname: string) => {
    const res = await api.rename(nickname);
    setUser(res.user);
  }, []);

  const value = useMemo(
    () => ({ loading, user, register, rename, logout: clear }),
    [loading, user, register, rename, clear],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
