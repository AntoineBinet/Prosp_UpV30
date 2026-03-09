import { API_BASE_URL } from "../constants/config";
import { getAccessToken, refreshAccessToken, logout } from "./auth";

let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

export async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let token = await getAccessToken();

  const doFetch = async (t: string | null): Promise<Response> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    };
    if (t) headers["Authorization"] = `Bearer ${t}`;
    return fetch(`${API_BASE_URL}${path}`, { ...options, headers });
  };

  let res = await doFetch(token);

  // Auto-refresh on token expiration
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.error === "token_expired") {
      const newToken = await refreshAccessToken();
      if (!newToken) {
        await logout();
        onSessionExpired?.();
        throw new Error("Session expir\u00e9e");
      }
      res = await doFetch(newToken);
    } else {
      await logout();
      onSessionExpired?.();
      throw new Error("Non authentifi\u00e9");
    }
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: `Erreur ${res.status}` }));
    throw new Error(data.error || `Erreur ${res.status}`);
  }

  return res.json();
}

// Convenience wrappers
export const api = {
  get: <T = any>(path: string) => apiFetch<T>(path),
  post: <T = any>(path: string, body: any) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }),
  put: <T = any>(path: string, body: any) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  delete: <T = any>(path: string, body?: any) =>
    apiFetch<T>(path, {
      method: "DELETE",
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
};
