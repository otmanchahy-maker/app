import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { Platform } from "react-native";

import { authMe, authSession, authLogout, setAuthToken } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = "coach_session_token";

export type User = {
  user_id: string;
  email: string;
  name?: string;
  picture?: string;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function extractSessionId(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const processed = useRef<Set<string>>(new Set());

  const processSessionId = useCallback(async (sid: string) => {
    if (processed.current.has(sid)) return;
    processed.current.add(sid);
    const res = await authSession(sid);
    await storage.secureSet(TOKEN_KEY, res.session_token);
    setAuthToken(res.session_token);
    setUser(res.user);
  }, []);

  useEffect(() => {
    let sub: { remove: () => void } | undefined;

    (async () => {
      try {
        if (Platform.OS === "web") {
          const sid = extractSessionId(window.location.href);
          if (sid) {
            try {
              await processSessionId(sid);
              const url = new URL(window.location.href);
              url.hash = "";
              url.searchParams.delete("session_id");
              window.history.replaceState(window.history.state, "", url.toString());
            } catch (e) {
              console.log("web session exchange failed", e);
            }
          }
        } else {
          sub = Linking.addEventListener("url", (ev) => {
            const sid = extractSessionId(ev.url);
            if (sid) processSessionId(sid).catch((e) => console.log("hot link exchange failed", e));
          });
          const initial = await Linking.getInitialURL();
          const sid = extractSessionId(initial);
          if (sid) {
            try {
              await processSessionId(sid);
            } catch (e) {
              console.log("initial url exchange failed", e);
            }
          }
        }

        const token = await storage.secureGet<string>(TOKEN_KEY, "");
        if (token) {
          setAuthToken(token);
          try {
            const me = await authMe();
            setUser(me.user);
          } catch {
            await storage.secureRemove(TOKEN_KEY);
            setAuthToken(null);
            setUser(null);
          }
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => sub?.remove();
  }, [processSessionId]);

  const login = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web" ? window.location.origin + "/" : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === "web") {
      window.location.href = authUrl;
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type === "success" && result.url) {
      const sid = extractSessionId(result.url);
      if (sid) {
        await processSessionId(sid);
        return;
      }
    }
    // Fallbacks (Android often returns dismiss with no URL)
    const initial = await Linking.getInitialURL();
    const sid = extractSessionId(initial);
    if (sid) await processSessionId(sid);
  }, [processSessionId]);

  const logout = useCallback(async () => {
    try {
      await authLogout();
    } catch {}
    await storage.secureRemove(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
    processed.current.clear();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
