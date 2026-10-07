export interface Entity {
  _id: string;
  name: string;
  slug: string;
  code?: string;
  number?: number;
  program?: string;
  semester?: number;
}
export interface Offering {
  _id: string;
  subject: Entity;
  branch: Entity;
  semester: Entity;
  program: Entity;
}
export interface ContentItem {
  _id: string;
  title: string;
  slug: string;
  year?: number;
  session?: string;
  examType?: string;
  offerings: Offering[];
  tags?: string[];
  downloads: number;
  views: number;
  createdAt?: string;
  updatedAt?: string;
  credit?: string;
  author?: { name: string };
  format?: string;
  markdown?: string;
  unit?: string;
  topic?: string;
  status?: string;
  rejectionReason?: string;
  metadataNeedsReview?: boolean;
  featured?: boolean;
  hasThumbnail?: boolean;
  /** Storage keys served by the Pages /files route without the API. */
  publicFile?: string;
  thumbKey?: string;
  provenance?: { conflicts: string[] };
  deletedAt?: string;
}
export interface Envelope<T> {
  data: T;
  meta?: { total: number; page: number; pages: number };
  saved?: boolean;
}
export const paperPath = (p: ContentItem) => {
  const o = p.offerings[0];
  return o
    ? `/papers/${o.program.slug}/${o.branch.slug}/sem-${o.semester.number}/${o.subject.slug}/${p.year || "unknown"}/${p.slug}`
    : `/paper/${p.slug}`;
};
export const contentPath = (p: ContentItem, kind = "papers") =>
  kind === "notes" ? `/notes/${p.slug}` : paperPath(p);
