import { getDb } from "@/lib/mongodb";
import { serialize, toId } from "@/lib/nodes";
import { handle, jsonError } from "@/lib/http";

/** Create a node. Without parentId it becomes a top-level category (大類). */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await request.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) return jsonError("名稱不可空白");

    const db = await getDb();
    const nodes = db.collection("nodes");

    let parentId = null;
    let level = 1;
    if (body?.parentId != null) {
      parentId = typeof body.parentId === "string" ? toId(body.parentId) : null;
      if (!parentId) return jsonError("無效的上層分類");
      const parent = await nodes.findOne({ _id: parentId }, { projection: { level: 1 } });
      if (!parent) return jsonError("找不到上層分類", 404);
      if (parent.level >= 3) return jsonError("小分類之下不能再新增分類");
      level = parent.level + 1;
    }

    const last = await nodes.find({ parentId }).sort({ order: -1 }).limit(1).next();
    const now = new Date();
    const doc = {
      parentId,
      level,
      name,
      order: last ? last.order + 1 : 0,
      content: "",
      hasNote: false,
      createdAt: now,
      updatedAt: now,
    };
    const res = await nodes.insertOne(doc);
    return Response.json({ node: serialize({ _id: res.insertedId, ...doc }) }, { status: 201 });
  });
}
