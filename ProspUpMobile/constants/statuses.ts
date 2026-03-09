export const STATUSES = [
  { key: "Pas d'actions", label: "Pas d'actions", color: "#64748b", emoji: "\ud83d\udccb" },
  { key: "Appel\u00e9", label: "Appel\u00e9", color: "#3b82f6", emoji: "\ud83d\udcde" },
  { key: "Messagerie", label: "Messagerie", color: "#8b5cf6", emoji: "\ud83d\udcac" },
  { key: "\u00c0 rappeler", label: "\u00c0 rappeler", color: "#f59e0b", emoji: "\ud83d\udd14" },
  { key: "Rendez-vous", label: "Rendez-vous", color: "#6366f1", emoji: "\ud83d\udcc5" },
  { key: "Rencontr\u00e9", label: "Rencontr\u00e9", color: "#10b981", emoji: "\ud83e\udd1d" },
  { key: "Pas int\u00e9ress\u00e9", label: "Pas int\u00e9ress\u00e9", color: "#ef4444", emoji: "\u274c" },
] as const;

export type StatusKey = (typeof STATUSES)[number]["key"];

export function getStatusColor(status: string | null | undefined): string {
  return STATUSES.find((s) => s.key === status)?.color ?? "#64748b";
}

export function getStatusEmoji(status: string | null | undefined): string {
  return STATUSES.find((s) => s.key === status)?.emoji ?? "\ud83d\udccb";
}

export function getNextStatus(current: string | null | undefined): string {
  const idx = STATUSES.findIndex((s) => s.key === current);
  return STATUSES[(idx + 1) % STATUSES.length].key;
}
