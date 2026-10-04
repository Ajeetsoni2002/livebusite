import type { Envelope } from "./types";
export function readSnapshot<T>(
  saved: Record<string, any>,
  path: string,
  params: Record<string, unknown> = {},
): Envelope<T> {
  const [kind, key, action] = path.slice(1).split("/");
  let data: any = saved[kind];
  if (kind === "search") {
    const query = String(params.q || "").toLowerCase();
    data = [
      ...saved.subjects,
      ...[...(saved.papers || []), ...(saved.notes || [])].map((item: any) => ({
        _id: item._id,
        name: item.title,
        code: item.year ? String(item.year) : "",
        slug: item.slug,
      })),
    ]
      .filter((s: any) => `${s.name} ${s.code}`.toLowerCase().includes(query))
      .slice(0, 8);
  } else if (kind === "papers" && action === "related") {
    const paper = (saved.papers || []).find(
      (item: any) => item._id === key || item.slug === key,
    );
    data = paper
      ? saved.papers
          .filter(
            (item: any) =>
              item._id !== paper._id &&
              item.offerings.some((offering: any) =>
                paper.offerings.some((own: any) => own._id === offering._id),
              ),
          )
          .slice(0, 8)
      : [];
  } else if (key) {
    data = (data || []).find((p: any) => p._id === key || p.slug === key);
    if (!data) throw new Error("Saved resource unavailable");
  } else if (kind === "papers" || kind === "notes") {
    data = (data || [])
      .filter((p: any) => !params.year || p.year === Number(params.year))
      .filter((p: any) => !params.examType || p.examType === params.examType)
      .filter(
        (p: any) =>
          !params.q ||
          `${p.title} ${(p.tags || []).join(" ")} ${p.year || ""} ${p.offerings.map((o: any) => `${o.subject.name} ${o.subject.code}`).join(" ")}`
            .toLowerCase()
            .includes(String(params.q).toLowerCase()),
      )
      .filter((p: any) =>
        ["branch", "subject", "semester", "offering"].every(
          (f) =>
            !params[f] ||
            p.offerings.some((o: any) =>
              f === "offering" ? o._id === params[f] : o[f]?._id === params[f],
            ),
        ),
      );
    data.sort(
      params.sort === "downloads"
        ? (a: any, b: any) => b.downloads - a.downloads
        : (a: any, b: any) => (b.year || 0) - (a.year || 0),
    );
    const total = data.length,
      page = Number(params.page || 1),
      limit = Number(params.limit || 20);
    return {
      data: data.slice((page - 1) * limit, page * limit) as T,
      meta: { total, page, pages: Math.ceil(total / limit) },
      saved: true,
    };
  }
  if (data === undefined) throw new Error("Saved resource unavailable");
  return { data, saved: true };
}
