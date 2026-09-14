import { Router } from "express";
import { db, hedgeSettingsTable, hedgeBetTypeCapsTable, betTypesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { requireAuth, requireRole } from "../middleware/auth";
import { loadHedgePolicy } from "../lib/hedge-policy";

const router = Router();
const adminOnly = [requireAuth, requireRole("director", "administrator")] as const;

/** A share of something, entered as a percentage and stored as a fraction. */
const fraction = z.number().min(0).max(10);
const cash = z.number().min(0).max(99_999_999);

/**
 * The thresholds that decide which lines must be laid off at the NLA, plus
 * every bet type with its own ceiling where one is set. Bet types without a
 * ceiling are returned too, so the screen can offer to add one.
 */
router.get("/settings/hedge", ...adminOnly, async (_req, res) => {
  const policy = await loadHedgePolicy();

  const betTypes = await db
    .select({
      id: betTypesTable.id,
      name: betTypesTable.name,
      code: betTypesTable.code,
      payoutMultiplier: betTypesTable.payoutMultiplier,
      isActive: betTypesTable.isActive,
    })
    .from(betTypesTable)
    .orderBy(betTypesTable.name);

  res.json({
    policy,
    betTypes: betTypes.map((b) => ({
      ...b,
      multiplier: parseFloat(b.payoutMultiplier) || 0,
      maxLiability: policy.capsByBetType[b.id] ?? null,
    })),
  });
});

router.put("/settings/hedge", ...adminOnly, async (req, res) => {
  const parse = z
    .object({
      hugeWinThreshold: cash,
      mediumCoveragePct: fraction,
      highCoveragePct: fraction,
      criticalCoveragePct: fraction,
      hedgeCoveragePct: fraction,
      minHedgeStake: cash,
      hedgeHighCoverage: z.boolean(),
    })
    .safeParse(req.body);

  if (!parse.success) {
    res.status(400).json({ error: "Invalid thresholds", issues: parse.error.issues });
    return;
  }

  const d = parse.data;
  // A band that sits below the one beneath it would make severity meaningless.
  if (!(d.mediumCoveragePct <= d.highCoveragePct && d.highCoveragePct <= d.criticalCoveragePct)) {
    res.status(400).json({
      error: "Thresholds must rise: medium must not exceed high, and high must not exceed critical",
    });
    return;
  }

  const values = {
    hugeWinThreshold: String(d.hugeWinThreshold),
    mediumCoveragePct: String(d.mediumCoveragePct),
    highCoveragePct: String(d.highCoveragePct),
    criticalCoveragePct: String(d.criticalCoveragePct),
    hedgeCoveragePct: String(d.hedgeCoveragePct),
    minHedgeStake: String(d.minHedgeStake),
    hedgeHighCoverage: d.hedgeHighCoverage,
    updatedBy: req.user!.userId,
    updatedAt: new Date(),
  };

  const [existing] = await db.select({ id: hedgeSettingsTable.id }).from(hedgeSettingsTable).limit(1);
  if (existing) {
    await db.update(hedgeSettingsTable).set(values).where(eq(hedgeSettingsTable.id, existing.id));
  } else {
    await db.insert(hedgeSettingsTable).values(values);
  }

  res.json(await loadHedgePolicy());
});

/** Set or clear one bet type's own ceiling. A null amount removes it. */
router.put("/settings/hedge/caps/:betTypeId", ...adminOnly, async (req, res) => {
  const betTypeId = req.params["betTypeId"] as string;
  const parse = z.object({ maxLiability: cash.nullable() }).safeParse(req.body);

  if (!parse.success) {
    res.status(400).json({ error: "Invalid cap", issues: parse.error.issues });
    return;
  }

  const [betType] = await db
    .select({ id: betTypesTable.id })
    .from(betTypesTable)
    .where(eq(betTypesTable.id, betTypeId))
    .limit(1);

  if (!betType) {
    res.status(404).json({ error: "Bet type not found" });
    return;
  }

  const amount = parse.data.maxLiability;
  if (amount === null || amount === 0) {
    await db.delete(hedgeBetTypeCapsTable).where(eq(hedgeBetTypeCapsTable.betTypeId, betTypeId));
  } else {
    await db
      .insert(hedgeBetTypeCapsTable)
      .values({ betTypeId, maxLiability: String(amount), updatedBy: req.user!.userId })
      .onConflictDoUpdate({
        target: hedgeBetTypeCapsTable.betTypeId,
        set: { maxLiability: String(amount), updatedBy: req.user!.userId, updatedAt: new Date() },
      });
  }

  res.json(await loadHedgePolicy());
});

export default router;
