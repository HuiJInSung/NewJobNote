import { getDb } from "@/lib/mongodb";
import { toId } from "@/lib/nodes";
import { handle, jsonError } from "@/lib/http";

/**
 * Reorder a node among its siblings and renumber them.
 * Body: `{ dir: "up" | "down" }` to swap with a neighbour, or `{ index: n }` to move it to position n
 * (0-based, clamped) — used by drag-and-drop.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/nodes/[id]/move">) {
  return handle(async () => {
    const id = toId((await ctx.params).id);
    if (!id) return jsonError("無效的 id");
    const body = await request.json().catch(() => null);
    const dir = body?.dir === "up" ? -1 : body?.dir === "down" ? 1 : 0;
    const index = Number.isInteger(body?.index) ? (body.index as number) : null;
    if (!dir && index === null) return jsonError("需要 dir（up / down）或 index");

    const db = await getDb();
    const nodes = db.collection("nodes");
    const me = await nodes.findOne({ _id: id }, { projection: { parentId: 1 } });
    if (!me) return jsonError("找不到這個節點", 404);
    const siblings = await nodes
      .find({ parentId: me.parentId ?? null }, { projection: { _id: 1 } })
      .sort({ order: 1, createdAt: 1 })
      .toArray();
    const idx = siblings.findIndex((s) => String(s._id) === String(id));
    const target = index !== null ? Math.max(0, Math.min(siblings.length - 1, index)) : idx + dir;
    if (target >= 0 && target < siblings.length && target !== idx) {
      const [moved] = siblings.splice(idx, 1);
      siblings.splice(target, 0, moved);
      await nodes.bulkWrite(
        siblings.map((s, i) => ({ updateOne: { filter: { _id: s._id }, update: { $set: { order: i } } } })),
      );
    }
    return Response.json({ order: siblings.map((s) => String(s._id)) });
  });
}
