export const Colors = {
  dark: {
    background: "#0f172a",
    surface: "#1e293b",
    surfaceHover: "#334155",
    text: "#f8fafc",
    textSecondary: "#94a3b8",
    accent: "#3b82f6",
    border: "rgba(255,255,255,0.08)",
    success: "#10b981",
    error: "#ef4444",
    warning: "#f59e0b",
    info: "#3b82f6",
  },
  light: {
    background: "#f8fafc",
    surface: "#ffffff",
    surfaceHover: "#f1f5f9",
    text: "#0f172a",
    textSecondary: "#64748b",
    accent: "#3b82f6",
    border: "rgba(0,0,0,0.08)",
    success: "#10b981",
    error: "#ef4444",
    warning: "#f59e0b",
    info: "#3b82f6",
  },
} as const;

export type ThemeColors = (typeof Colors)["dark"];
