import { connection } from "next/server";
import { getDb } from "@/lib/mongodb";
import { collectSubtree, serializeDetail, toId } from "@/lib/nodes";
import { handle, jsonError } from "@/lib/http";

/**
 * Notes to export, with their content.
 * `?root=<id>` → that top-level category and everything under it; `?root=all` → every category.
 */
export async function GET(request: Request) {
  await connection();
  return handle(async () => {
    const root = new URL(request.url).searchParams.get("root") ?? "all";
    const db = await getDb();
    const nodes = db.collection("nodes");
    let filter = {};
    if (root !== "all") {
      const id = toId(root);
      if (!id) return jsonError("無效的 id");
      const top = await nodes.findOne({ _id: id, level: 1 }, { projection: { _id: 1 } });
      if (!top) return jsonError("找不到這個大類", 404);
      filter = { _id: { $in: await collectSubtree(id) } };
    }
    const docs = await nodes.find(filter).sort({ level: 1, order: 1, createdAt: 1 }).toArray();
    return Response.json({ nodes: docs.map(serializeDetail) });
  });
}
