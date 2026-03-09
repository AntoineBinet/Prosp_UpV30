import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import type { DataResponse, Prospect, Company } from "../services/types";

const PAGE_SIZE = 30;

export function useProspects() {
  return useInfiniteQuery({
    queryKey: ["prospects"],
    queryFn: ({ pageParam = 1 }) =>
      api.get<DataResponse>(
        `/api/data?page=${pageParam}&limit=${PAGE_SIZE}&lazy=1`
      ),
    getNextPageParam: (lastPage) => {
      const p = lastPage.pagination;
      if (!p || p.page >= p.pages) return undefined;
      return p.page + 1;
    },
    initialPageParam: 1,
    staleTime: 60_000,
  });
}

export function useAllCompanies() {
  const query = useProspects();
  const companies: Company[] = [];
  const seen = new Set<number>();
  for (const page of query.data?.pages ?? []) {
    for (const c of page.companies ?? []) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        companies.push(c);
      }
    }
  }
  return companies;
}

export function useSaveProspect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      prospects?: Partial<Prospect>[];
      companies?: Partial<Company>[];
    }) => api.post<{ ok: boolean }>("/api/save", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["focus"] });
    },
  });
}

export function useMarkDone() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      id: number;
      note?: string;
      nextAction?: string;
      nextFollowUp?: string;
      lastContact?: string;
    }) => api.post<{ ok: boolean }>("/api/prospect/mark_done", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["prospects"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["focus"] });
    },
  });
}
