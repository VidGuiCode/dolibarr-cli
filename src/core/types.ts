export type OutputFormat = "table" | "json" | "csv";

export interface GlobalOptions {
  output?: OutputFormat;
  json?: boolean;
}

export interface PaginationOptions {
  limit?: number;
  page?: number;
}

export interface SortOptions {
  sort?: string;
  order?: "ASC" | "DESC";
}

export interface DolibarrConfig {
  baseUrl: string;
  apiKey: string;
}
