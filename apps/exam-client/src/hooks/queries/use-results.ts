import { useQuery } from "@tanstack/react-query";

import { candidateExamApi } from "@/services/api";
import { queryKeys } from "./query-keys";

/**
 * Fetches the candidate's "My Results" list. The server only exposes scores
 * for exams whose result has been published by an admin; attempted-but-ungraded
 * exams arrive with `resultStatus: "awaiting_result"` and a null `result`.
 *
 * Refetches on mount and every 60s so a freshly published result reflects
 * without a manual refresh, matching industrial-standard polling for
 * admin-gated data.
 */
export function useMyResults() {
  return useQuery({
    queryKey: queryKeys.results.list(),
    queryFn: () => candidateExamApi.getMyResults(),
    refetchInterval: 60000,
  });
}

export function useMyResultDetail(examId: number | null) {
  return useQuery({
    queryKey: queryKeys.results.detail(examId ?? 0),
    queryFn: () => candidateExamApi.getMyResultDetail(examId!),
    enabled: examId != null && examId > 0,
  });
}
