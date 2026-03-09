import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import type { FocusItem } from "../services/types";

export function useFocus() {
  return useQuery({
    queryKey: ["focus"],
    queryFn: () =>
      api.get<{ ok: boolean; items: FocusItem[] }>("/api/focus_queue"),
    select: (res) => res.items,
    staleTime: 60_000,
  });
}

export interface FocusSection {
  title: string;
  emoji: string;
  color: string;
  data: FocusItem[];
}

export function groupFocusItems(items: FocusItem[]): FocusSection[] {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const endOfWeek = (() => {
    const d = new Date();
    d.setDate(d.getDate() + (7 - d.getDay()));
    return d.toISOString().slice(0, 10);
  })();

  const groups: Record<string, FocusItem[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
  };

  for (const item of items) {
    const nf = item.nextFollowUp ?? "";
    if (nf < today) groups.overdue.push(item);
    else if (nf === today) groups.today.push(item);
    else if (nf === tomorrow) groups.tomorrow.push(item);
    else if (nf <= endOfWeek) groups.week.push(item);
    else groups.later.push(item);
  }

  const sections: FocusSection[] = [];
  if (groups.overdue.length)
    sections.push({ title: "En retard", emoji: "\u26d4", color: "#ef4444", data: groups.overdue });
  if (groups.today.length)
    sections.push({ title: "Aujourd'hui", emoji: "\ud83d\udccc", color: "#f59e0b", data: groups.today });
  if (groups.tomorrow.length)
    sections.push({ title: "Demain", emoji: "\ud83d\udd58", color: "#3b82f6", data: groups.tomorrow });
  if (groups.week.length)
    sections.push({ title: "Cette semaine", emoji: "\ud83d\udcc5", color: "#8b5cf6", data: groups.week });
  if (groups.later.length)
    sections.push({ title: "Plus tard", emoji: "\ud83d\uddd3\ufe0f", color: "#64748b", data: groups.later });

  return sections;
}
