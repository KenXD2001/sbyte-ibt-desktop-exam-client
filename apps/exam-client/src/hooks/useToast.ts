import { toast } from 'sonner';

export function useToast() {
  return {
    showToast: (message: string, title?: string) => toast(message, { description: title }),
    showSuccess: (message: string, title?: string) => toast.success(message, { description: title }),
    showError: (message: string, title?: string) => toast.error(message, { description: title }),
    showWarning: (message: string, title?: string) => toast.warning(message, { description: title }),
    showInfo: (message: string, title?: string) => toast.info(message, { description: title }),
  };
}

export { toast };
