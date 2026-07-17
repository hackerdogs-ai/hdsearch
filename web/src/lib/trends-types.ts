// Shared trends page shapes (server + client).

export interface TrendArticle {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  source?: string;
  publishedAt?: string;
}

export interface TrendSection {
  id: string;
  label: string;
  items: TrendArticle[];
}

export interface TrendsPageData {
  sections: TrendSection[];
  windowHours: number;
  generatedAt: string;
  cached?: boolean;
}
