export interface Prospect {
  id: number;
  name: string;
  company_id: number;
  fonction?: string | null;
  telephone?: string | null;
  email?: string | null;
  linkedin?: string | null;
  pertinence?: string | null;
  statut?: string | null;
  lastContact?: string | null;
  nextFollowUp?: string | null;
  priority?: number | null;
  notes?: string | null;
  callNotes?: CallNote[] | null;
  tags?: string[] | null;
  nextAction?: string | null;
  pushEmailSentAt?: string | null;
  pushLinkedInSentAt?: string | null;
  photo_url?: string | null;
  fixedMetier?: string | null;
  rdvDate?: string | null;
  is_contact?: number;
}

export interface CallNote {
  date: string;
  content: string;
}

export interface Company {
  id: number;
  groupe: string;
  site: string;
  phone?: string | null;
  notes?: string | null;
  tags?: string[] | null;
}

export interface DashboardData {
  today: {
    date: string;
    contacts: number;
    notes: number;
    push_total: number;
    push_email: number;
    push_linkedin: number;
  };
  week: {
    start: string;
    end: string;
    contacts: number;
    notes: number;
    push_total: number;
    push_email: number;
    push_linkedin: number;
    days: Array<{ date: string; contacts: number; notes: number; push: number }>;
  };
  prev_week: {
    contacts: number;
    notes: number;
    push_total: number;
  };
  pipeline: {
    total: number;
    rdv: number;
    overdue: number;
    due_today: number;
    statuts: Record<string, number>;
  };
  goals?: {
    daily?: { rdv: number; push: number; items: any[] };
    weekly?: { rdv: number; push: number; items: any[] };
  };
  feed: {
    notes: Array<{
      prospect_id: number;
      prospect_name: string;
      content: string;
      date: string;
    }>;
    push: Array<{
      prospect_id: number;
      channel: string;
      subject: string;
      to_email: string;
      createdAt: string;
    }>;
  };
  overdue_list: Array<{
    id: number;
    name: string;
    nextFollowUp: string;
    statut: string;
    company_id: number;
  }>;
  upcoming_rdv: Array<{
    id: number;
    name: string;
    rdvDate: string;
    statut: string;
  }>;
}

export interface FocusItem extends Prospect {
  company_groupe?: string | null;
  company_site?: string | null;
}

export interface TimelineEvent {
  type: "call_note" | "event" | "push";
  date: string;
  title: string;
  content: string;
  meta?: Record<string, any> | null;
}

export interface AuthTokens {
  ok: boolean;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: { id: number; role: string; name: string };
}

export interface SearchResults {
  prospects: (Prospect & { company_groupe?: string; company_site?: string })[];
  companies: Company[];
  candidates: any[];
  pushLogs: any[];
  counts: {
    prospects: number;
    companies: number;
    pushLogs: number;
    candidates: number;
  };
}

export interface DataResponse {
  companies: Company[];
  prospects: Prospect[];
  maxProspectId: number;
  maxCompanyId: number;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}
