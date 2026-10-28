import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { HttpError, identifier, ok } from "../lib/http.js";
import { audit, AuthRequest } from "./auth.js";
import { Note, Paper, Payout, User } from "./models.js";

/** Rupees paid for every approved (published) paper or note a contributor uploads. */
export const RATE_PER_UPLOAD = 10;

type Tally = { approved: number; pending: number };
const blank = (): { papers: Tally; notes: Tally; paid: number } => ({
  papers: { approved: 0, pending: 0 },
  notes: { approved: 0, pending: 0 },
  paid: 0,
});

/** Approved/pending upload counts and payments per contributor, in three queries. */
async function tallies(ids: mongoose.Types.ObjectId[]) {
  const live = { author: { $in: ids }, deletedAt: null };
  const count = (model: typeof Paper) =>
    model.aggregate([
      { $match: { ...live, status: { $in: ["published", "pending"] } } },
      {
        $group: {
          _id: "$author",
          approved: {
            $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] },
          },
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
        },
      },
    ]);
  const [papers, notes, paid] = await Promise.all([
    count(Paper),
    count(Note),
    Payout.aggregate([
      { $match: { contributor: { $in: ids } } },
      { $group: { _id: "$contributor", total: { $sum: "$amount" } } },
    ]),
  ]);
  const map = new Map(ids.map((id) => [String(id), blank()]));
  for (const row of papers)
    map.get(String(row._id))!.papers = {
      approved: row.approved,
      pending: row.pending,
    };
  for (const row of notes)
    map.get(String(row._id))!.notes = {
      approved: row.approved,
      pending: row.pending,
    };
  for (const row of paid) map.get(String(row._id))!.paid = row.total;
  return map;
}
function summary(t: ReturnType<typeof blank>) {
  const approved = t.papers.approved + t.notes.approved,
    pending = t.papers.pending + t.notes.pending,
    earned = approved * RATE_PER_UPLOAD;
  return {
    rate: RATE_PER_UPLOAD,
    papers: t.papers,
    notes: t.notes,
    approved,
    pending,
    earned,
    pendingValue: pending * RATE_PER_UPLOAD,
    paid: t.paid,
    due: Math.max(0, earned - t.paid),
  };
}
export async function earningsOf(userId: string) {
  const id = new mongoose.Types.ObjectId(userId);
  return summary((await tallies([id])).get(userId)!);
}

export const earningsRouter = Router();
earningsRouter.get("/earnings", async (req: AuthRequest, res) => {
  const userId = String(req.user._id);
  const [totals, payouts] = await Promise.all([
    earningsOf(userId),
    Payout.find({ contributor: userId })
      .sort({ createdAt: -1 })
      .limit(50)
      .select("amount note createdAt")
      .lean(),
  ]);
  ok(res, { ...totals, payouts });
});

export const earningsAdminRouter = Router();
earningsAdminRouter.get("/earnings", async (_req, res) => {
  const users = await User.find({ role: "contributor" })
    .select("name email active")
    .sort({ name: 1 })
    .lean();
  const map = await tallies(users.map((u) => u._id));
  const rows = users
    .map((u) => ({ ...u, ...summary(map.get(String(u._id))!) }))
    .sort((a, b) => b.due - a.due || b.earned - a.earned);
  ok(res, {
    rate: RATE_PER_UPLOAD,
    rows,
    totals: {
      earned: rows.reduce((n, r) => n + r.earned, 0),
      paid: rows.reduce((n, r) => n + r.paid, 0),
      due: rows.reduce((n, r) => n + r.due, 0),
    },
  });
});
earningsAdminRouter.get("/earnings/:id/payouts", async (req, res) => {
  const id = identifier(req.params.id);
  ok(
    res,
    await Payout.find({ contributor: id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("paidBy", "name")
      .lean(),
  );
});
earningsAdminRouter.post(
  "/earnings/:id/payouts",
  async (req: AuthRequest, res) => {
    const id = identifier(req.params.id);
    const input = z
      .object({
        amount: z.number().int().min(1).max(1_000_000).optional(),
        note: z.string().trim().max(200).optional(),
      })
      .strict()
      .parse(req.body);
    const user = await User.findOne({ _id: id, role: "contributor" }).lean();
    if (!user) throw new HttpError(404, "Contributor not found");
    const { due } = await earningsOf(id);
    const amount = input.amount ?? due;
    if (amount < 1)
      throw new HttpError(400, "Nothing is due for this contributor");
    if (amount > due)
      throw new HttpError(400, `Only ₹${due} is due for this contributor`);
    const payout = await Payout.create({
      contributor: id,
      amount,
      note: input.note || undefined,
      paidBy: req.user._id,
    });
    await audit(req, "payout-create", `users/${id}`, { amount });
    res.status(201);
    ok(res, { payout, ...(await earningsOf(id)) });
  },
);
