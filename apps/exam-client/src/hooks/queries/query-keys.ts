export const queryKeys = {
  results: {
    all: ["results"] as const,
    list: () => [...queryKeys.results.all, "list"] as const,
    detail: (examId: number) =>
      [...queryKeys.results.all, "detail", examId] as const,
  },
  support: {
    all: ["support"] as const,
    list: () => [...queryKeys.support.all, "list"] as const,
    detail: (ticketId: string) =>
      [...queryKeys.support.all, "detail", ticketId] as const,
  },
};
