// Google Identity Services (GIS) helpers — free, no Firebase Auth required.
// Uses ID token (JWT) returned by GIS One Tap / button.

export type GoogleUser = {
  email: string;
  name: string;
  picture?: string;
  sub: string;
  exp: number;
};

const STORAGE_KEY = "gis_user";

export function decodeIdToken(token: string): GoogleUser | null {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    const p = JSON.parse(json);
    if (!p.email || !p.sub) return null;
    return {
      email: p.email,
      name: p.name || p.email,
      picture: p.picture,
      sub: p.sub,
      exp: p.exp || 0,
    };
  } catch {
    return null;
  }
}

export function getStoredUser(): GoogleUser | null {
  if (typeof window === "undefined") return null;
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (!s) return null;
    const u = JSON.parse(s) as GoogleUser;
    // Token expired
    if (u.exp && Math.floor(Date.now() / 1000) > u.exp) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return u;
  } catch {
    return null;
  }
}

export function setStoredUser(u: GoogleUser | null) {
  if (typeof window === "undefined") return;
  if (u) localStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  else localStorage.removeItem(STORAGE_KEY);
}

// Minimal ambient typing for window.google.accounts.id
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (resp: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            hd?: string;
            ux_mode?: string;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: Record<string, unknown>
          ) => void;
          prompt: () => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}
