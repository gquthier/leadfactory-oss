export interface ScrapeJobOptions {
  maxResults: number;
  enrichEmails: boolean;
}

export interface ScrapeJob {
  id: string;
  client_id: string;
  source: string;
  input_url: string;
  input_options: ScrapeJobOptions;
  apify_run_id: string | null;
  apify_dataset_id: string | null;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress_pct: number;
  results_count: number;
  cost_usd: number | null;
  csv_storage_path: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface CreateJobRequest {
  url: string;
  maxResults?: number;
  enrichEmails?: boolean;
}
