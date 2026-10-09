import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { candidateExamApi } from "@/services/api";
import { queryKeys } from "./query-keys";

export function useSupportTickets() {
  return useQuery({
    queryKey: queryKeys.support.list(),
    queryFn: () => candidateExamApi.getTickets(),
    refetchInterval: 60000,
  });
}

export function useSupportTicketDetail(ticketId: string | null) {
  return useQuery({
    queryKey: queryKeys.support.detail(ticketId ?? ""),
    queryFn: () => candidateExamApi.getTicketDetail(ticketId!),
    enabled: !!ticketId,
  });
}

export function useUploadFile() {
  return useMutation({
    mutationFn: (file: File) => candidateExamApi.uploadFile(file),
  });
}

export function useCreateSupportTicket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      subject: string;
      description: string;
      category: string;
      priority: string;
      examId?: number;
      attachments?: { fileName: string; fileSize: number; fileType: string; fileUrl: string }[];
    }) => candidateExamApi.createTicket(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.support.all });
    },
  });
}

export function useAddSupportMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      content,
      attachments,
    }: {
      ticketId: string;
      content: string;
      attachments?: { fileName: string; fileSize: number; fileType: string; fileUrl: string }[];
    }) => candidateExamApi.addMessage(ticketId, content, attachments),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.support.detail(variables.ticketId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.support.all });
    },
  });
}
