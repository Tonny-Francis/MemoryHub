export type IngestionSource = 'gitlab' | 'discord' | 'trello';

export interface IngestItem {
  id: string;
  source: IngestionSource;
  projectSlug: string;
  title: string;
  body: string;
  url?: string;
  author?: string;
  createdAt: string;
}
