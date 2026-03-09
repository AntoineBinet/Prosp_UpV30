import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import type { DashboardData } from "../services/types";

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: () =>
      api.get<{ ok: boolean; data: DashboardData }>("/api/dashboard"),
    select: (res) => res.data,
    staleTime: 60_000,
  });
}
