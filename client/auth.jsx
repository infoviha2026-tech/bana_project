import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js';
import { useLang } from './i18n.jsx';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUserState] = useState(null);
  const [ready, setReady] = useState(false);
  const { setLang } = useLang();

  const setUser = (u) => {
    setUserState(u);
    if (u?.language && (u.role === 'student' || u.role === 'donor')) setLang(u.language);
  };

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setUserState(null); });
    if (!getToken()) { setReady(true); return; }
    api.get('/auth/me').then((r) => setUser(r.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Returns { user } when signed in, or { challenge } when a 2-step code is needed */
  const login = async (identifier, password) => {
    const r = await api.post('/auth/login', { identifier, password });
    if (r.twoFactorRequired) return { challenge: r.challenge };
    setToken(r.token);
    setUser(r.user);
    return { user: r.user };
  };
  const completeTwoFactor = async (challenge, code) => {
    const r = await api.post('/auth/login/2fa', { challenge, code });
    setToken(r.token);
    setUser(r.user);
    return r.user;
  };
  const logout = () => { setToken(null); setUserState(null); };
  const refresh = () => api.get('/auth/me').then((r) => setUserState(r.user));

  return <AuthCtx.Provider value={{ user, ready, login, completeTwoFactor, logout, refresh }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
export const isAdmin = (u) => u && (u.role === 'admin' || u.role === 'super_admin');
