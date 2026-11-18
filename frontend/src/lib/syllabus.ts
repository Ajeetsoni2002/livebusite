import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type SyllabusOffering = {
  _id: string;
  program: { _id: string; name: string; slug: string };
  branch: {
    _id: string;
    name: string;
    code?: string;
    slug: string;
    order?: number;
  };
  semester: { _id: string; name: string; number: number };
};
export type SyllabusEntry = {
  _id: string;
  slug: string;
  subtitle?: string;
  credits?: { L?: number; T?: number; P?: number; total?: number };
  markdown?: string;
  published?: boolean;
  updatedAt: string;
  subject: { _id: string; name: string; code: string; slug: string };
  offerings: SyllabusOffering[];
};

/** Every published syllabus (without the text), for the index and subject-page links. */
export function useSyllabusList(enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["syllabus"],
    queryFn: async () =>
      (await api.get("/syllabus")).data.data as SyllabusEntry[],
    staleTime: 5 * 60_000,
  });
}
export const subjectPagePath = (o: SyllabusOffering, subjectSlug: string) =>
  `/subjects/${o.program.slug}/${o.branch.slug}/sem-${o.semester.number}/${subjectSlug}`;
