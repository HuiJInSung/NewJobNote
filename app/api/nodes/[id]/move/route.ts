import { getDb } from "@/lib/mongodb";
import { toId } from "@/lib/nodes";
import { handle, jsonError } from "@/lib/http";

/** Swap a node with its previous / next sibling and renumber the siblings. */
export async function POST(request: Request, ctx: RouteContext<"/api/nodes/[id]/move">) {
  return handle(async () => {
    const id = toId((await ctx.params).id);
    if (!id) return jsonError("無效的 id");
    const body = await request.json().catch(() => null);
    const dir = body?.dir === "up" ? -1 : body?.dir === "down" ? 1 : 0;
    if (!dir) return jsonError("dir 必須是 up 或 down");

    const db = await getDb();
    const nodes = db.collection("nodes");
    const me = await nodes.findOne({ _id: id }, { projection: { parentId: 1 } });
    if (!me) return jsonError("找不到這個節點", 404);
    const siblings = await nodes
      .find({ parentId: me.parentId ?? null }, { projection: { _id: 1 } })
      .sort({ order: 1, createdAt: 1 })
      .toArray();
    const idx = siblings.findIndex((s) => String(s._id) === String(id));
    const target = idx + dir;
    if (target >= 0 && target < siblings.length) {
      [siblings[idx], siblings[target]] = [siblings[target], siblings[idx]];
      await nodes.bulkWrite(
        siblings.map((s, i) => ({ updateOne: { filter: { _id: s._id }, update: { $set: { order: i } } } })),
      );
    }
    return Response.json({ order: siblings.map((s) => String(s._id)) });
  });
}
