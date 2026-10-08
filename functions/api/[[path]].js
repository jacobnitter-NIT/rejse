// Cloudflare Pages Function: stores receipt details in D1 and files in R2.
// Needs bindings DB (D1), BUCKET (R2) and the secret SYNC_KEY.
export async function onRequest(ctx) {
  try { return await handle(ctx); }
  catch (e) { return new Response('Server error: ' + e.message, { status: 500 }); }
}

async function handle({ request, env, params }) {
  const enc = new TextEncoder();
  const a = enc.encode(request.headers.get('Authorization') || '');
  const b = enc.encode('Bearer ' + (env.SYNC_KEY || ''));
  if (!env.SYNC_KEY || a.length !== b.length || !crypto.subtle.timingSafeEqual(a, b))
    return new Response('Unauthorized', { status: 401 });

  const [kind, id] = params.path || [];
  const url = new URL(request.url), m = request.method;
  const J = (d, s = 200) => Response.json(d, { status: s });
  const okId = /^[\w-]{8,64}$/.test(id || '');

  if (kind === 'receipts' && !id && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT id,data,updated,deleted FROM receipts').all();
    return J(results.map(r => ({ id: r.id, updated: r.updated, deleted: !!r.deleted, data: JSON.parse(r.data) })));
  }
  if (kind === 'receipts' && okId) {
    if (m === 'PUT') {
      const d = await request.json(), u = +d.updated || Date.now();
      await env.DB.prepare('INSERT INTO receipts(id,data,updated,deleted) VALUES(?1,?2,?3,0) ON CONFLICT(id) DO UPDATE SET data=?2,updated=?3,deleted=0 WHERE ?3>receipts.updated')
        .bind(id, JSON.stringify({ ...d, id }), u).run();
      return J({ ok: 1 });
    }
    if (m === 'DELETE') {
      await env.DB.prepare("INSERT INTO receipts(id,data,updated,deleted) VALUES(?1,'{}',?2,1) ON CONFLICT(id) DO UPDATE SET data='{}',updated=?2,deleted=1")
        .bind(id, Date.now()).run();
      await env.BUCKET.delete([id + '/blob', id + '/thumb']);
      return J({ ok: 1 });
    }
  }
  if (kind === 'files' && okId) {
    const k = url.searchParams.get('k');
    if (k !== 'blob' && k !== 'thumb') return J({ error: 'bad k' }, 400);
    if (m === 'PUT') {
      await env.BUCKET.put(id + '/' + k, await request.arrayBuffer(),
        { httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' } });
      return J({ ok: 1 });
    }
    if (m === 'GET') {
      const o = await env.BUCKET.get(id + '/' + k);
      if (!o) return new Response('Not found', { status: 404 });
      return new Response(o.body, { headers: { 'Content-Type': o.httpMetadata?.contentType || 'application/octet-stream' } });
    }
  }
  return new Response('Not found', { status: 404 });
}
