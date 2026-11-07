const sorts = new Set(["recommended", "newest", "most-views", "most-likes"]);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/scripts") return new Response(null, { status: 404 });
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });

    const q = (url.searchParams.get("q") ?? "").trim();
    const page = url.searchParams.get("page") ?? "1";
    const sort = url.searchParams.get("sort") ?? "recommended";
    if (q.length > 100 || !/^[1-9]\d{0,2}$/.test(page) || Number(page) > 200 || !sorts.has(sort)) {
      return new Response("Invalid script search.", { status: 400 });
    }
    if (!env.RSCRIPTS_API_KEY) return new Response("Service unavailable.", { status: 503 });

    const upstream = new URL("https://api.rscripts.net/v1/scripts");
    upstream.search = new URLSearchParams({ page, sort, limit: "20", includeScript: "true" }).toString();
    if (q) upstream.searchParams.set("q", q);
    try {
      const result = await fetch(upstream, {
        headers: { Authorization: `Bearer ${env.RSCRIPTS_API_KEY}` },
        redirect: "manual",

      });
      if (!result.ok) return new Response(`Script service returned HTTP ${result.status}.`, { status: result.status === 429 ? 429 : 502 });
      const { success, data, meta } = await result.json() as { success: boolean; data: unknown[]; meta: { totalPages: number } };
      if (!success || !Array.isArray(data) || !Number.isInteger(meta?.totalPages)) {
        return new Response("Invalid script service response.", { status: 502 });
      }
      return Response.json({ success, data, meta: { totalPages: meta.totalPages } });
    } catch {
      return new Response("Script service unavailable.", { status: 502 });
    }
  },
} satisfies ExportedHandler<{ RSCRIPTS_API_KEY: string }>;


