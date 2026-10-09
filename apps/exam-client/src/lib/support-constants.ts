export const TICKET_CATEGORIES = [
  'Technical Issue',
  'Exam Issue',
  'Administrative',
  'Account Issue',
  'Other',
] as const;

export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_STATUSES = ['open', 'in-progress', 'resolved', 'closed'] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high'] as const;

export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_ROLES = ['CANDIDATE', 'ADMIN'] as const;

export type TicketRole = (typeof TICKET_ROLES)[number];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: 'Open',
  'in-progress': 'In Progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const STATUS_VARIANTS: Record<TicketStatus, "warning" | "info" | "success" | "secondary"> = {
  open: 'warning',
  'in-progress': 'info',
  resolved: 'success',
  closed: 'secondary',
};

export const PRIORITY_VARIANTS: Record<TicketPriority, "destructive" | "warning" | "secondary"> = {
  high: 'destructive',
  medium: 'warning',
  low: 'secondary',
};
