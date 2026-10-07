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
          `${p.title} ${(p.tags || []).join(" ")} ${p.year || ""} ${p.offerings.map((o: any) => `${o.subject.name} ${o.subject.code} ${o.branch?.code || ""} ${o.branch?.name || ""}`).join(" ")}`
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
    // Mirrors the API sort orders so the saved library behaves the same offline.
    const time = (p: any) => Date.parse(p.createdAt || "") || 0;
    const orders: Record<string, (a: any, b: any) => number> = {
      oldest: (a, b) => time(a) - time(b),
      downloads: (a, b) => b.downloads - a.downloads,
      views: (a, b) => (b.views || 0) - (a.views || 0),
      "year-desc": (a, b) => (b.year || 0) - (a.year || 0),
      "year-asc": (a, b) => (a.year || 0) - (b.year || 0),
      title: (a, b) => String(a.title).localeCompare(String(b.title)),
    };
    data.sort(
      orders[String(params.sort)] || ((a: any, b: any) => time(b) - time(a)),
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
