import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import type { SearchResults } from "../services/types";

export function useSearch(query: string) {
  return useQuery({
    queryKey: ["search", query],
    queryFn: () =>
      api.get<SearchResults>(
        `/api/search?q=${encodeURIComponent(query)}&limit=15`
      ),
    enabled: query.length >= 2,
    staleTime: 30_000,
  });
}
