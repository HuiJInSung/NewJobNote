export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "伺服器錯誤", 500);
  }
}
