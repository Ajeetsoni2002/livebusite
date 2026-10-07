import {
  Branch,
  Note,
  Paper,
  Program,
  Semester,
  Subject,
  SubjectOffering,
} from "./models.js";
import { HttpError } from "../lib/http.js";

/*
 * The B.Tech scheme as used by BUIT: semesters 1–2 share BE-101…105 / BE-201…205 across
 * every branch; semesters 3–8 use <BRANCH>-<sem>01…05 for each branch. Setup is
 * idempotent: it only adds what is missing, renames the old CSE-1xx/2xx first-year
 * subjects to BE codes (keeping their URL slug and old code as an alias) and merges any
 * other branch-prefixed first-year duplicates into them.
 */
export const STANDARD_BRANCHES: [code: string, name: string, slug: string][] = [
  ["CSE", "Computer Science and Engineering", "cse"],
  ["IT", "Information Technology", "it"],
  ["ECE", "Electronics and Communications Engineering", "ece"],
  ["ME", "Mechanical Engineering", "mechanical"],
  ["EE", "Electrical Engineering", "electrical"],
  ["CE", "Civil Engineering", "civil"],
];
const FIRST_YEAR: Record<string, string> = {
  "BE-101": "Engineering Mathematics-I",
  "BE-102": "Engineering Chemistry",
  "BE-103": "Technical English",
  "BE-104": "Basic Mechanical Engineering",
  "BE-105": "Basic Electronics Engineering",
  "BE-201": "Engineering Physics",
  "BE-202": "Basic Electrical Engineering",
  "BE-203": "Fundamentals of Computer Programming",
  "BE-204": "Basic Civil Engineering & Engineering Mechanics",
  "BE-205": "Engineering Graphics & CAD",
};

type Plan = {
  program: string;
  branches: string[];
  semesters: number[];
  subjects: string[];
  renamed: { from: string; to: string }[];
  merged: { from: string; to: string }[];
  offerings: number;
  /** Papers/notes of first-year subjects that become visible in every branch. */
  shared: number;
};

// First-year subjects are common to every branch.
export const isCommonCode = (code?: string) => /^BE-[12]0\d$/i.test(code || "");

/**
 * A paper filed under one branch's BE-xxx offering also belongs to the same subject and
 * semester in every other branch, so all students find it.
 */
export async function withSharedOfferings(ids: unknown[]) {
  const chosen: any[] = await SubjectOffering.find({ _id: { $in: ids } })
    .populate("subject", "code")
    .lean();
  const common = chosen.filter((o) => isCommonCode(o.subject?.code));
  if (!common.length) return ids.map(String);
  const siblings = await SubjectOffering.find({
    $or: common.map((o) => ({ subject: o.subject._id, semester: o.semester })),
  })
    .select("_id")
    .lean();
  return [
    ...new Set([...ids.map(String), ...siblings.map((s) => String(s._id))]),
  ];
}

const norm = (code: string) => code.toUpperCase().replace(/\s+/g, "");

export async function standardSubjects(
  apply: boolean,
  merge: (from: string, to: string) => Promise<void>,
): Promise<Plan> {
  const program: any =
    (await Program.findOne({ slug: "btech" })) ||
    (await Program.findOne().sort({ order: 1, _id: 1 }));
  if (!program) throw new HttpError(400, "Create the B.Tech program first.");
  const plan: Plan = {
    program: program.name,
    branches: [],
    semesters: [],
    subjects: [],
    renamed: [],
    merged: [],
    offerings: 0,
    shared: 0,
  };
  const branchCodes = STANDARD_BRANCHES.map(([code]) => code);

  // Branches
  const existingBranches: any[] = await Branch.find({ program: program._id });
  const branches = new Map<string, any>();
  for (const [index, [code, name, slug]] of STANDARD_BRANCHES.entries()) {
    let branch = existingBranches.find((b) => norm(b.code || "") === code);
    if (!branch) {
      plan.branches.push(code);
      if (apply) {
        const taken = existingBranches.some((b) => b.slug === slug);
        branch = await Branch.create({
          name,
          code,
          slug: taken ? `${slug}-${code.toLowerCase()}` : slug,
          program: program._id,
          order: index,
        });
      }
    }
    branches.set(code, branch);
  }

  // Semesters 1–8
  const existingSemesters: any[] = await Semester.find({
    program: program._id,
  });
  const semesters = new Map<number, any>();
  for (let number = 1; number <= 8; number++) {
    let semester = existingSemesters.find((s) => s.number === number);
    if (!semester) {
      plan.semesters.push(number);
      if (apply)
        semester = await Semester.create({
          name: `Semester ${number}`,
          slug: `sem-${number}`,
          number,
          program: program._id,
          order: number,
        });
    }
    semesters.set(number, semester);
  }

  // Subjects
  const wanted: { code: string; semester: number; branches: string[] }[] = [];
  for (const semester of [1, 2])
    for (let k = 1; k <= 5; k++)
      wanted.push({
        code: `BE-${semester}0${k}`,
        semester,
        branches: branchCodes,
      });
  for (let semester = 3; semester <= 8; semester++)
    for (const branch of branchCodes)
      for (let k = 1; k <= 5; k++)
        wanted.push({
          code: `${branch}-${semester}0${k}`,
          semester,
          branches: [branch],
        });

  const allSubjects: any[] = await Subject.find();
  const byCode = new Map(
    allSubjects.filter((s) => s.active !== false).map((s) => [norm(s.code), s]),
  );
  const slugs = new Set(allSubjects.map((s) => s.slug));
  const freeSlug = (base: string) => {
    let slug = base,
      n = 2;
    while (slugs.has(slug)) slug = `${base}-${n++}`;
    slugs.add(slug);
    return slug;
  };
  const toCreate: any[] = [];
  // Offerings of merged duplicates move to the surviving subject.
  const mergedInto = new Map<string, string>();
  for (const item of wanted) {
    let subject = byCode.get(item.code);
    if (item.semester <= 2) {
      // Earlier imports used branch prefixes for common first-year subjects.
      const suffix = item.code.slice(3);
      const variants = branchCodes
        .map((b) => byCode.get(`${b}-${suffix}`))
        .filter(Boolean);
      if (!subject && variants.length) {
        subject = variants.shift();
        plan.renamed.push({ from: subject.code, to: item.code });
        if (apply) {
          subject.aliases = [
            ...new Set([...(subject.aliases || []), subject.code]),
          ];
          subject.code = item.code;
          await subject.save();
        }
        byCode.set(item.code, subject);
      }
      for (const duplicate of variants) {
        if (!subject || String(duplicate._id) === String(subject._id)) continue;
        plan.merged.push({ from: duplicate.code, to: item.code });
        mergedInto.set(String(duplicate._id), String(subject._id));
        if (apply) await merge(String(duplicate._id), String(subject._id));
      }
    }
    if (!subject) {
      plan.subjects.push(item.code);
      subject = {
        _id: undefined,
        name: FIRST_YEAR[item.code] || item.code,
        code: item.code,
        slug: freeSlug(item.code.toLowerCase()),
        verified: false,
      };
      toCreate.push(subject);
      byCode.set(item.code, subject);
    }
  }
  if (apply && toCreate.length) {
    const created = await Subject.insertMany(
      toCreate.map(({ _id: _skip, ...data }) => data),
    );
    for (const doc of created) byCode.set(norm(doc.code), doc);
  }

  // Offerings (subject × branch × semester)
  const existingOfferings = new Set(
    (await SubjectOffering.find({ program: program._id }).lean()).map(
      (o: any) =>
        `${mergedInto.get(String(o.subject)) || o.subject}|${o.branch}|${o.semester}|${o.scheme || ""}`,
    ),
  );
  const offerings: any[] = [];
  for (const item of wanted) {
    const subject = byCode.get(item.code);
    const semester = semesters.get(item.semester);
    for (const code of item.branches) {
      const branch = branches.get(code);
      if (
        subject?._id &&
        branch &&
        semester &&
        existingOfferings.has(`${subject._id}|${branch._id}|${semester._id}|`)
      )
        continue;
      plan.offerings++;
      if (apply)
        offerings.push({
          subject: subject._id,
          branch: branch._id,
          semester: semester._id,
          program: program._id,
          scheme: "",
        });
    }
  }
  if (apply && offerings.length)
    await SubjectOffering.insertMany(offerings, { ordered: false });
  // Existing first-year papers/notes: link them to every branch's offering.
  const commonIds = [...byCode.entries()]
    .filter(([code, subject]) => isCommonCode(code) && subject?._id)
    .map(([, subject]) => subject._id);
  const commonOfferings: any[] = await SubjectOffering.find({
    subject: { $in: commonIds },
    program: program._id,
  }).lean();
  const groups = new Map<string, string[]>();
  const keyOf = new Map<string, string>();
  for (const o of commonOfferings) {
    const key = `${o.subject}|${o.semester}`;
    keyOf.set(String(o._id), key);
    groups.set(key, [...(groups.get(key) || []), String(o._id)]);
  }
  for (const model of [Paper, Note] as any[]) {
    const items: any[] = await model
      .find({ offerings: { $in: commonOfferings.map((o) => o._id) } })
      .select("offerings")
      .lean();
    for (const item of items) {
      const have = new Set(item.offerings.map(String));
      const missing = new Set<string>();
      for (const id of have) {
        const key = keyOf.get(id as string);
        if (!key) continue;
        for (const sibling of groups.get(key) || [])
          if (!have.has(sibling)) missing.add(sibling);
        // In a dry run, links still to be created also count.
        if (!apply && (groups.get(key)?.length || 0) < branches.size)
          missing.add(`planned:${key}`);
      }
      if (!missing.size) continue;
      plan.shared++;
      if (apply)
        await model.updateOne(
          { _id: item._id },
          { $addToSet: { offerings: { $each: [...missing] } } },
        );
    }
  }
  return plan;
}
