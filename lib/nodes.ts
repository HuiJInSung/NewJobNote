import { ObjectId, type WithId, type Document } from "mongodb";
import { getDb } from "./mongodb";
import type { TreeNode, NodeDetail } from "./types";

export const CATEGORY_COUNT = 7;
const OLD_NUMERALS = ["壹", "貳", "參", "肆", "伍", "陸", "柒"];

export function toId(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

export function serialize(d: WithId<Document>): TreeNode {
  return {
    id: String(d._id),
    parentId: d.parentId ? String(d.parentId) : null,
    level: d.level,
    name: d.name,
    order: d.order,
    hasNote: !!d.hasNote,
    updatedAt: new Date(d.updatedAt).toISOString(),
  };
}

export function serializeDetail(d: WithId<Document>): NodeDetail {
  return {
    ...serialize(d),
    content: d.content ?? "",
    createdAt: new Date(d.createdAt).toISOString(),
  };
}

/**
 * One-time setup: create seven blank top-level categories (numbered 一～七 in the UI).
 * Runs only once ever — after that, categories can be freely added and deleted.
 * The meta insert acts as a lock so concurrent first requests don't seed twice.
 */
export async function ensureCategories() {
  const db = await getDb();
  const meta = db.collection<{ _id: string; at: Date }>("meta");
  if (await meta.findOne({ _id: "seeded-v2" })) return;
  try {
    await meta.insertOne({ _id: "seeded-v2", at: new Date() });
  } catch (e) {
    if ((e as { code?: number })?.code === 11000) return;
    throw e;
  }
  const nodes = db.collection("nodes");
  if ((await nodes.countDocuments({ level: 1 })) > 0) {
    // migrate the old default names (第壹大類…) to blank so the user names them
    await nodes.updateMany(
      { level: 1, name: { $regex: `^第[${OLD_NUMERALS.join("")}]大類$` } },
      { $set: { name: "" }, $unset: { slot: "" } },
    );
    await nodes.updateMany({ level: 1, slot: { $exists: true } }, { $unset: { slot: "" } });
    return;
  }
  const now = new Date();
  await nodes.insertMany(
    Array.from({ length: CATEGORY_COUNT }, (_, i) => ({
      parentId: null,
      level: 1,
      name: "",
      order: i,
      content: "",
      hasNote: false,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

/** An id plus all of its descendants. */
export async function collectSubtree(rootId: ObjectId): Promise<ObjectId[]> {
  const db = await getDb();
  const nodes = db.collection("nodes");
  const all: ObjectId[] = [rootId];
  let frontier = [rootId];
  while (frontier.length) {
    const kids = await nodes.find({ parentId: { $in: frontier } }, { projection: { _id: 1 } }).toArray();
    frontier = kids.map((k) => k._id as ObjectId);
    all.push(...frontier);
  }
  return all;
}

export function noteHasContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim().length > 0;
}
