// Cloudflare Pages Function: /uploads/*
// 用于直接从 Cloudflare KV 中读取并返回上传的图片资源

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon'
};

function getMime(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

export async function onRequest(context) {
  const { request, params, env } = context;
  const filename = Array.isArray(params.filename) ? params.filename.join('/') : (params.filename || '');
  
  if (!filename) {
    return new Response('Not Found', { status: 404 });
  }

  const kv = env.NAV_KV || env.KV;
  let fileBuffer = null;
  let contentType = getMime(filename);

  if (kv) {
    try {
      const result = await kv.getWithMetadata(`upload:${filename}`, { type: 'arrayBuffer' });
      if (result && result.value) {
        fileBuffer = result.value;
        if (result.metadata && result.metadata.contentType) {
          contentType = result.metadata.contentType;
        }
      }
    } catch (e) {
      console.error('Failed to get file from KV:', e);
    }
  }

  // 开发环境内存回退
  if (!fileBuffer && globalThis.__MEM_KV) {
    const memItem = globalThis.__MEM_KV.get(`upload:${filename}`);
    if (memItem) {
      fileBuffer = memItem.data;
      contentType = memItem.contentType || contentType;
    }
  }

  if (fileBuffer) {
    return new Response(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }

  // 如果请求的是 default-favicon.png 且 KV 中没有，重定向到静态 public/default-favicon.png
  if (filename === 'default-favicon.png') {
    return Response.redirect(new URL('/default-favicon.png', request.url), 302);
  }

  return new Response('File Not Found', { status: 404 });
}
