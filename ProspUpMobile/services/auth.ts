import * as SecureStore from "expo-secure-store";
import { API_BASE_URL } from "../constants/config";
import type { AuthTokens } from "./types";

const KEYS = {
  ACCESS: "prospup_jwt_access",
  REFRESH: "prospup_jwt_refresh",
  USER: "prospup_jwt_user",
} as const;

export async function login(
  username: string,
  password: string,
  device?: string
): Promise<AuthTokens> {
  const res = await fetch(`${API_BASE_URL}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, device }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Erreur de connexion");
  await SecureStore.setItemAsync(KEYS.ACCESS, data.access_token);
  await SecureStore.setItemAsync(KEYS.REFRESH, data.refresh_token);
  await SecureStore.setItemAsync(KEYS.USER, JSON.stringify(data.user));
  return data as AuthTokens;
}

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync(KEYS.REFRESH);
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    const data = await res.json();
    if (!data.ok) {
      await clearTokens();
      return null;
    }
    await SecureStore.setItemAsync(KEYS.ACCESS, data.access_token);
    return data.access_token;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(KEYS.REFRESH);
  if (refreshToken) {
    try {
      await fetch(`${API_BASE_URL}/api/auth/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      // Best effort — token will expire anyway
    }
  }
  await clearTokens();
}

async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(KEYS.ACCESS);
  await SecureStore.deleteItemAsync(KEYS.REFRESH);
  await SecureStore.deleteItemAsync(KEYS.USER);
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEYS.ACCESS);
}

export async function getStoredUser(): Promise<{
  id: number;
  role: string;
  name: string;
} | null> {
  const raw = await SecureStore.getItemAsync(KEYS.USER);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function hasTokens(): Promise<boolean> {
  const access = await SecureStore.getItemAsync(KEYS.ACCESS);
  return !!access;
}
