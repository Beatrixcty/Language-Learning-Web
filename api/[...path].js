/* global process, Buffer */

const SAFE_RESPONSE_HEADERS = ['content-type', 'cache-control', 'location']

export default async function handler(request, response) {
  const backendUrl = process.env.BEALINGO_BACKEND_URL
  const proxySecret = process.env.PRIVATE_PROXY_SECRET

  if (!backendUrl || !proxySecret) {
    return response.status(503).json({ error: 'BeaLingo deployment is not configured' })
  }

  // Vercel's catch-all query shape differs between runtimes. Derive the
  // upstream path from the actual request URL so `/api/health` always maps to
  // the backend's `/api/health`, rather than accidentally duplicating `api`.
  const requestUrl = new URL(request.url, 'https://bealingo.local')
  const path = requestUrl.pathname.replace(/^\/api\/?/, '')
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(request.query)) {
    if (key === 'path') continue
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item)
  }
  const queryString = query.toString()
  const target = `${backendUrl.replace(/\/$/, '')}/api/${path}${queryString ? `?${queryString}` : ''}`

  const headers = {
    'x-bealingo-proxy-secret': proxySecret,
    'x-bealingo-client-ip': String(request.headers['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown').split(',')[0],
  }
  if (request.headers['content-type']) headers['content-type'] = request.headers['content-type']

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? JSON.stringify(request.body ?? {}) : undefined,
    redirect: 'manual',
  })

  for (const header of SAFE_RESPONSE_HEADERS) {
    const value = upstream.headers.get(header)
    if (value) response.setHeader(header, value)
  }
  return response.status(upstream.status).send(Buffer.from(await upstream.arrayBuffer()))
}
