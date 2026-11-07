// Cloudflare Pages Function: /api/*
// 现代化全功能 API 引擎，基于 Cloudflare KV 实现持久化存储

import { initialMenus, initialCards, initialFriends, initialAds } from '../seedData.js';

// ==================== CORS 配置 ====================
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json;charset=utf-8',
      ...corsHeaders
    }
  });
}

function error(message, status = 400) {
  return json({ error: message, message }, status);
}

// ==================== Web Crypto 认证与加密 ====================
function base64UrlEncode(data) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

async function hashPassword(password, salt) {
  if (!salt) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    salt = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const saltBuffer = new Uint8Array(salt.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );
  const hashHex = Array.from(new Uint8Array(derivedBits))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return `pbkdf2$${salt}$${hashHex}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith('pbkdf2$')) {
    const parts = storedHash.split('$');
    if (parts.length !== 3) return false;
    const salt = parts[1];
    const calculated = await hashPassword(password, salt);
    return calculated === storedHash;
  }
  // 兼容纯文本（开发/导入模式）
  return password === storedHash;
}

async function createJWT(payload, secret, expiresInSeconds = 7200) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));

  return `${data}.${encodedSignature}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const data = `${headerB64}.${payloadB64}`;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    let sigStr = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
    while (sigStr.length % 4) sigStr += '=';
    const sigBinary = atob(sigStr);
    const sigBytes = new Uint8Array(sigBinary.length);
    for (let i = 0; i < sigBinary.length; i++) {
      sigBytes[i] = sigBinary.charCodeAt(i);
    }

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;

    const payload = JSON.parse(base64UrlDecode(payloadB64));
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
      return null;
    }
    return payload;
  } catch (e) {
    return null;
  }
}

// ==================== 时间与客户端 IP ====================
function getClientIp(request) {
  return request.headers.get('cf-connecting-ip') ||
         request.headers.get('x-real-ip') ||
         request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
         '127.0.0.1';
}

function getShanghaiTime() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

// ==================== Cloudflare KV 存储抽象 ====================
class KVStorage {
  constructor(env) {
    this.kv = env.NAV_KV || env.KV;
    if (!globalThis.__MEM_KV) globalThis.__MEM_KV = new Map();
    this.mem = globalThis.__MEM_KV;
  }

  async get(key) {
    if (this.kv) {
      return await this.kv.get(key, 'json');
    }
    const val = this.mem.get(key);
    return val ? JSON.parse(val) : null;
  }

  async put(key, value) {
    const str = JSON.stringify(value);
    if (this.kv) {
      await this.kv.put(key, str);
    }
    this.mem.set(key, str);
  }

  async putRaw(key, buffer, metadata) {
    if (this.kv) {
      await this.kv.put(key, buffer, { metadata });
    }
    this.mem.set(key, { data: buffer, contentType: metadata?.contentType });
  }

  async getRaw(key) {
    if (this.kv) {
      return await this.kv.getWithMetadata(key, { type: 'arrayBuffer' });
    }
    const memItem = this.mem.get(key);
    if (memItem) {
      return { value: memItem.data, metadata: { contentType: memItem.contentType } };
    }
    return null;
  }
}

// 确保 KV 自动初始化（首次部署即开即用）
async function ensureInitialized(storage, env) {
  let menus = await storage.get('nav:menus');
  if (!menus || !Array.isArray(menus) || menus.length === 0) {
    const defaultUser = env.ADMIN_USERNAME || 'admin';
    const defaultPass = env.ADMIN_PASSWORD || '123456';
    const passwordHash = await hashPassword(defaultPass);

    await storage.put('nav:menus', initialMenus);
    await storage.put('nav:cards', initialCards);
    await storage.put('nav:friends', initialFriends);
    await storage.put('nav:ads', initialAds);
    await storage.put('nav:users', [
      {
        id: 1,
        username: defaultUser,
        password: passwordHash,
        last_login_time: null,
        last_login_ip: null
      }
    ]);
    await storage.put('nav:meta', {
      nextMenuId: 100,
      nextSubMenuId: 100,
      nextCardId: 200,
      nextFriendId: 100,
      nextAdId: 100
    });
  }
}

// 认证中间件检查
async function authenticate(request, env) {
  const auth = request.headers.get('Authorization') || request.headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return null;
  }
  const token = auth.slice(7).trim();
  const secret = env.JWT_SECRET || 'nav-item-jwt-secret-2024-secure-key';
  return await verifyJWT(token, secret);
}

// ==================== 主请求处理函数 ====================
export async function onRequest(context) {
  const { request, params, env } = context;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  // 1. 处理 OPTIONS 预检请求
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const storage = new KVStorage(env);
  await ensureInitialized(storage, env);

  // 解析路由路径
  // 例如 /api/menus/1 -> route = ['menus', '1']
  const route = Array.isArray(params.route) ? params.route : (params.route ? [params.route] : []);
  const path = route.join('/');

  // ----------------------------------------------------
  // 登录接口: POST /api/login
  // ----------------------------------------------------
  if (path === 'login' && method === 'POST') {
    try {
      const body = await request.json();
      const { username, password } = body;
      const users = await storage.get('nav:users') || [];
      const user = users.find(u => u.username === username);

      if (!user) {
        return error('用户名或密码错误', 401);
      }

      const isValid = await verifyPassword(password, user.password);
      if (!isValid) {
        return error('用户名或密码错误', 401);
      }

      const lastLoginTime = user.last_login_time;
      const lastLoginIp = user.last_login_ip;

      user.last_login_time = getShanghaiTime();
      user.last_login_ip = getClientIp(request);
      await storage.put('nav:users', users);

      const secret = env.JWT_SECRET || 'nav-item-jwt-secret-2024-secure-key';
      const token = await createJWT({ id: user.id, username: user.username }, secret, 7200);

      return json({ token, lastLoginTime, lastLoginIp });
    } catch (e) {
      return error(e.message || '登录失败', 500);
    }
  }

  // ----------------------------------------------------
  // 菜单接口: /api/menus
  // ----------------------------------------------------
  // 1) GET /api/menus
  if (path === 'menus' && method === 'GET') {
    const menus = await storage.get('nav:menus') || [];
    menus.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    menus.forEach(m => {
      if (Array.isArray(m.subMenus)) {
        m.subMenus.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
      } else {
        m.subMenus = [];
      }
    });

    const page = url.searchParams.get('page');
    const pageSize = url.searchParams.get('pageSize');
    if (page || pageSize) {
      const pageNum = parseInt(page) || 1;
      const size = parseInt(pageSize) || 10;
      const offset = (pageNum - 1) * size;
      return json({
        total: menus.length,
        page: pageNum,
        pageSize: size,
        data: menus.slice(offset, offset + size)
      });
    }
    return json(menus);
  }

  // 2) GET /api/menus/:id/submenus
  if (route.length === 3 && route[0] === 'menus' && route[2] === 'submenus' && method === 'GET') {
    const parentId = Number(route[1]);
    const menus = await storage.get('nav:menus') || [];
    const menu = menus.find(m => Number(m.id) === parentId);
    const subMenus = menu?.subMenus || [];
    subMenus.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    return json(subMenus);
  }

  // 3) POST /api/menus/:id/submenus (添加子菜单)
  if (route.length === 3 && route[0] === 'menus' && route[2] === 'submenus' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const parentId = Number(route[1]);
    const body = await request.json();
    const { name, order } = body;

    const menus = await storage.get('nav:menus') || [];
    const menu = menus.find(m => Number(m.id) === parentId);
    if (!menu) return error('父菜单不存在', 404);

    const meta = await storage.get('nav:meta') || { nextSubMenuId: 100 };
    const newSubId = meta.nextSubMenuId || (Date.now() % 1000000);
    meta.nextSubMenuId = newSubId + 1;

    if (!Array.isArray(menu.subMenus)) menu.subMenus = [];
    menu.subMenus.push({
      id: newSubId,
      parent_id: parentId,
      name,
      order: Number(order) || 0
    });

    await storage.put('nav:menus', menus);
    await storage.put('nav:meta', meta);
    return json({ id: newSubId });
  }

  // 4) PUT /api/menus/submenus/:id (修改子菜单)
  if (route.length === 3 && route[0] === 'menus' && route[1] === 'submenus' && method === 'PUT') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const subMenuId = Number(route[2]);
    const body = await request.json();
    const { name, order } = body;

    const menus = await storage.get('nav:menus') || [];
    let updated = false;
    for (const menu of menus) {
      if (Array.isArray(menu.subMenus)) {
        const sub = menu.subMenus.find(s => Number(s.id) === subMenuId);
        if (sub) {
          sub.name = name;
          sub.order = Number(order) || 0;
          updated = true;
          break;
        }
      }
    }

    if (updated) {
      await storage.put('nav:menus', menus);
      return json({ changed: 1 });
    }
    return error('子菜单不存在', 404);
  }

  // 5) DELETE /api/menus/submenus/:id (删除子菜单)
  if (route.length === 3 && route[0] === 'menus' && route[1] === 'submenus' && method === 'DELETE') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const subMenuId = Number(route[2]);
    const menus = await storage.get('nav:menus') || [];
    let deleted = false;
    for (const menu of menus) {
      if (Array.isArray(menu.subMenus)) {
        const idx = menu.subMenus.findIndex(s => Number(s.id) === subMenuId);
        if (idx !== -1) {
          menu.subMenus.splice(idx, 1);
          deleted = true;
          break;
        }
      }
    }

    if (deleted) {
      await storage.put('nav:menus', menus);
      // 级联删除该子菜单下的卡片
      const cards = await storage.get('nav:cards') || [];
      const filteredCards = cards.filter(c => Number(c.sub_menu_id) !== subMenuId);
      if (cards.length !== filteredCards.length) {
        await storage.put('nav:cards', filteredCards);
      }
      return json({ deleted: 1 });
    }
    return error('子菜单不存在', 404);
  }

  // 6) POST /api/menus (新增主菜单)
  if (path === 'menus' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const body = await request.json();
    const { name, order } = body;
    const menus = await storage.get('nav:menus') || [];
    const meta = await storage.get('nav:meta') || { nextMenuId: 100 };

    const newId = meta.nextMenuId || (Math.max(0, ...menus.map(m => m.id)) + 1);
    meta.nextMenuId = newId + 1;

    menus.push({
      id: newId,
      name,
      order: Number(order) || 0,
      subMenus: []
    });

    await storage.put('nav:menus', menus);
    await storage.put('nav:meta', meta);
    return json({ id: newId });
  }

  // 7) PUT /api/menus/:id (修改主菜单)
  if (route.length === 2 && route[0] === 'menus' && method === 'PUT') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const menuId = Number(route[1]);
    const body = await request.json();
    const { name, order } = body;

    const menus = await storage.get('nav:menus') || [];
    const menu = menus.find(m => Number(m.id) === menuId);
    if (!menu) return error('菜单不存在', 404);

    menu.name = name;
    menu.order = Number(order) || 0;
    await storage.put('nav:menus', menus);
    return json({ changed: 1 });
  }

  // 8) DELETE /api/menus/:id (删除主菜单)
  if (route.length === 2 && route[0] === 'menus' && method === 'DELETE') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const menuId = Number(route[1]);
    const menus = await storage.get('nav:menus') || [];
    const filteredMenus = menus.filter(m => Number(m.id) !== menuId);

    if (filteredMenus.length !== menus.length) {
      await storage.put('nav:menus', filteredMenus);
      // 级联删除该菜单下的所有卡片
      const cards = await storage.get('nav:cards') || [];
      const filteredCards = cards.filter(c => Number(c.menu_id) !== menuId);
      await storage.put('nav:cards', filteredCards);
      return json({ deleted: 1 });
    }
    return error('菜单不存在', 404);
  }

  // ----------------------------------------------------
  // 卡片接口: /api/cards
  // ----------------------------------------------------
  // 1) GET /api/cards/:menuId
  if (route.length === 2 && route[0] === 'cards' && method === 'GET') {
    const menuId = Number(route[1]);
    const subMenuId = url.searchParams.get('subMenuId');
    const cards = await storage.get('nav:cards') || [];

    let filtered = [];
    if (subMenuId) {
      filtered = cards.filter(c => Number(c.sub_menu_id) === Number(subMenuId));
    } else {
      filtered = cards.filter(c => Number(c.menu_id) === menuId && !c.sub_menu_id);
    }

    filtered.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    // 计算 display_logo
    filtered.forEach(card => {
      if (card.custom_logo_path) {
        card.display_logo = card.custom_logo_path.startsWith('http') || card.custom_logo_path.startsWith('/')
          ? card.custom_logo_path
          : '/uploads/' + card.custom_logo_path;
      } else {
        card.display_logo = card.logo_url || (card.url.replace(/\/+$/, '') + '/favicon.ico');
      }
    });

    return json(filtered);
  }

  // 2) POST /api/cards (新增卡片)
  if (path === 'cards' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const body = await request.json();
    const { menu_id, sub_menu_id, title, url: cardUrl, logo_url, custom_logo_path, desc, order } = body;
    const cards = await storage.get('nav:cards') || [];
    const meta = await storage.get('nav:meta') || { nextCardId: 200 };

    const newId = meta.nextCardId || (Math.max(0, ...cards.map(c => c.id)) + 1);
    meta.nextCardId = newId + 1;

    cards.push({
      id: newId,
      menu_id: menu_id ? Number(menu_id) : null,
      sub_menu_id: sub_menu_id ? Number(sub_menu_id) : null,
      title: title || '',
      url: cardUrl || '',
      logo_url: logo_url || '',
      custom_logo_path: custom_logo_path || null,
      desc: desc || '',
      order: Number(order) || 0
    });

    await storage.put('nav:cards', cards);
    await storage.put('nav:meta', meta);
    return json({ id: newId });
  }

  // 3) PUT /api/cards/:id (修改卡片)
  if (route.length === 2 && route[0] === 'cards' && method === 'PUT') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const cardId = Number(route[1]);
    const body = await request.json();
    const cards = await storage.get('nav:cards') || [];
    const card = cards.find(c => Number(c.id) === cardId);

    if (!card) return error('卡片不存在', 404);

    if (body.menu_id !== undefined) card.menu_id = body.menu_id ? Number(body.menu_id) : null;
    if (body.sub_menu_id !== undefined) card.sub_menu_id = body.sub_menu_id ? Number(body.sub_menu_id) : null;
    if (body.title !== undefined) card.title = body.title;
    if (body.url !== undefined) card.url = body.url;
    if (body.logo_url !== undefined) card.logo_url = body.logo_url;
    if (body.custom_logo_path !== undefined) card.custom_logo_path = body.custom_logo_path;
    if (body.desc !== undefined) card.desc = body.desc;
    if (body.order !== undefined) card.order = Number(body.order) || 0;

    await storage.put('nav:cards', cards);
    return json({ changed: 1 });
  }

  // 4) DELETE /api/cards/:id (删除卡片)
  if (route.length === 2 && route[0] === 'cards' && method === 'DELETE') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const cardId = Number(route[1]);
    const cards = await storage.get('nav:cards') || [];
    const filtered = cards.filter(c => Number(c.id) !== cardId);

    if (filtered.length !== cards.length) {
      await storage.put('nav:cards', filtered);
      return json({ deleted: 1 });
    }
    return error('卡片不存在', 404);
  }

  // ----------------------------------------------------
  // 广告接口: /api/ads
  // ----------------------------------------------------
  // 1) GET /api/ads
  if (path === 'ads' && method === 'GET') {
    const ads = await storage.get('nav:ads') || [];
    const page = url.searchParams.get('page');
    const pageSize = url.searchParams.get('pageSize');
    if (page || pageSize) {
      const pageNum = parseInt(page) || 1;
      const size = parseInt(pageSize) || 10;
      const offset = (pageNum - 1) * size;
      return json({
        total: ads.length,
        page: pageNum,
        pageSize: size,
        data: ads.slice(offset, offset + size)
      });
    }
    return json(ads);
  }

  // 2) POST /api/ads (新增广告)
  if (path === 'ads' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const body = await request.json();
    const { position, img, url: adUrl } = body;
    const ads = await storage.get('nav:ads') || [];
    const meta = await storage.get('nav:meta') || { nextAdId: 100 };

    const newId = meta.nextAdId || (Math.max(0, ...ads.map(a => a.id)) + 1);
    meta.nextAdId = newId + 1;

    ads.push({ id: newId, position, img, url: adUrl });
    await storage.put('nav:ads', ads);
    await storage.put('nav:meta', meta);
    return json({ id: newId });
  }

  // 3) PUT /api/ads/:id (修改广告)
  if (route.length === 2 && route[0] === 'ads' && method === 'PUT') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const adId = Number(route[1]);
    const body = await request.json();
    const { img, url: adUrl } = body;

    const ads = await storage.get('nav:ads') || [];
    const ad = ads.find(a => Number(a.id) === adId);
    if (!ad) return error('广告不存在', 404);

    ad.img = img;
    ad.url = adUrl;
    await storage.put('nav:ads', ads);
    return json({ changed: 1 });
  }

  // 4) DELETE /api/ads/:id (删除广告)
  if (route.length === 2 && route[0] === 'ads' && method === 'DELETE') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const adId = Number(route[1]);
    const ads = await storage.get('nav:ads') || [];
    const filtered = ads.filter(a => Number(a.id) !== adId);

    if (filtered.length !== ads.length) {
      await storage.put('nav:ads', filtered);
      return json({ deleted: 1 });
    }
    return error('广告不存在', 404);
  }

  // ----------------------------------------------------
  // 友情链接接口: /api/friends
  // ----------------------------------------------------
  // 1) GET /api/friends
  if (path === 'friends' && method === 'GET') {
    const friends = await storage.get('nav:friends') || [];
    const page = url.searchParams.get('page');
    const pageSize = url.searchParams.get('pageSize');
    if (page || pageSize) {
      const pageNum = parseInt(page) || 1;
      const size = parseInt(pageSize) || 10;
      const offset = (pageNum - 1) * size;
      return json({
        total: friends.length,
        page: pageNum,
        pageSize: size,
        data: friends.slice(offset, offset + size)
      });
    }
    return json(friends);
  }

  // 2) POST /api/friends (新增友链)
  if (path === 'friends' && method === 'POST') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const body = await request.json();
    const { title, url: friendUrl, logo } = body;
    const friends = await storage.get('nav:friends') || [];
    const meta = await storage.get('nav:meta') || { nextFriendId: 100 };

    const newId = meta.nextFriendId || (Math.max(0, ...friends.map(f => f.id)) + 1);
    meta.nextFriendId = newId + 1;

    friends.push({ id: newId, title, url: friendUrl, logo });
    await storage.put('nav:friends', friends);
    await storage.put('nav:meta', meta);
    return json({ id: newId });
  }

  // 3) PUT /api/friends/:id (修改友链)
  if (route.length === 2 && route[0] === 'friends' && method === 'PUT') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const friendId = Number(route[1]);
    const body = await request.json();
    const { title, url: friendUrl, logo } = body;

    const friends = await storage.get('nav:friends') || [];
    const friend = friends.find(f => Number(f.id) === friendId);
    if (!friend) return error('友链不存在', 404);

    friend.title = title;
    friend.url = friendUrl;
    friend.logo = logo;
    await storage.put('nav:friends', friends);
    return json({ changed: 1 });
  }

  // 4) DELETE /api/friends/:id (删除友链)
  if (route.length === 2 && route[0] === 'friends' && method === 'DELETE') {
    const user = await authenticate(request, env);
    if (!user) return error('未授权', 401);

    const friendId = Number(route[1]);
    const friends = await storage.get('nav:friends') || [];
    const filtered = friends.filter(f => Number(f.id) !== friendId);

    if (filtered.length !== friends.length) {
      await storage.put('nav:friends', filtered);
      return json({ deleted: 1 });
    }
    return error('友链不存在', 404);
  }

  // ----------------------------------------------------
  // 用户相关接口: /api/users
  // ----------------------------------------------------
  // 1) GET /api/users/profile
  if (path === 'users/profile' && method === 'GET') {
    const authUser = await authenticate(request, env);
    if (!authUser) return error('未授权', 401);

    const users = await storage.get('nav:users') || [];
    const user = users.find(u => u.id === authUser.id);
    if (!user) return error('用户不存在', 404);

    return json({ data: { id: user.id, username: user.username } });
  }

  // 2) GET /api/users/me
  if (path === 'users/me' && method === 'GET') {
    const authUser = await authenticate(request, env);
    if (!authUser) return error('未授权', 401);

    const users = await storage.get('nav:users') || [];
    const user = users.find(u => u.id === authUser.id);
    if (!user) return error('用户不存在', 404);

    return json({
      last_login_time: user.last_login_time,
      last_login_ip: user.last_login_ip
    });
  }

  // 3) PUT /api/users/password (修改密码)
  if (path === 'users/password' && method === 'PUT') {
    const authUser = await authenticate(request, env);
    if (!authUser) return error('未授权', 401);

    const body = await request.json();
    const { oldPassword, newPassword } = body;

    if (!oldPassword || !newPassword) {
      return error('请提供旧密码和新密码', 400);
    }
    if (newPassword.length < 6) {
      return error('新密码长度至少6位', 400);
    }

    const users = await storage.get('nav:users') || [];
    const user = users.find(u => u.id === authUser.id);
    if (!user) return error('用户不存在', 404);

    const isValid = await verifyPassword(oldPassword, user.password);
    if (!isValid) {
      return error('旧密码错误', 400);
    }

    user.password = await hashPassword(newPassword);
    await storage.put('nav:users', users);
    return json({ message: '密码修改成功' });
  }

  // 4) GET /api/users (获取用户列表)
  if (path === 'users' && method === 'GET') {
    const authUser = await authenticate(request, env);
    if (!authUser) return error('未授权', 401);

    const users = await storage.get('nav:users') || [];
    const list = users.map(u => ({ id: u.id, username: u.username }));

    const page = url.searchParams.get('page');
    const pageSize = url.searchParams.get('pageSize');
    if (page || pageSize) {
      const pageNum = parseInt(page) || 1;
      const size = parseInt(pageSize) || 10;
      const offset = (pageNum - 1) * size;
      return json({
        total: list.length,
        page: pageNum,
        pageSize: size,
        data: list.slice(offset, offset + size)
      });
    }
    return json({ data: list });
  }

  // ----------------------------------------------------
  // 文件上传接口: POST /api/upload
  // ----------------------------------------------------
  if (path === 'upload' && method === 'POST') {
    const authUser = await authenticate(request, env);
    if (!authUser) return error('未授权', 401);

    try {
      const formData = await request.formData();
      const file = formData.get('logo') || formData.get('file');
      if (!file || typeof file === 'string') {
        return error('未检测到上传文件', 400);
      }

      const ext = file.name ? file.name.slice(file.name.lastIndexOf('.')) : '.png';
      const safeName = Date.now() + ext;
      const buffer = await file.arrayBuffer();

      await storage.putRaw(`upload:${safeName}`, buffer, { contentType: file.type || 'image/png' });
      return json({ filename: safeName, url: `/uploads/${safeName}` });
    } catch (e) {
      return error('上传失败: ' + e.message, 500);
    }
  }

  // ----------------------------------------------------
  // 获取上传图片接口: GET /api/uploads/:filename
  // ----------------------------------------------------
  if (route.length === 2 && route[0] === 'uploads' && method === 'GET') {
    const filename = route[1];
    const fileRes = await storage.getRaw(`upload:${filename}`);
    if (fileRes && fileRes.value) {
      return new Response(fileRes.value, {
        headers: {
          'Content-Type': fileRes.metadata?.contentType || 'image/png',
          'Cache-Control': 'public, max-age=31536000, immutable',
          ...corsHeaders
        }
      });
    }
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }

  // ----------------------------------------------------
  // 数据备份与恢复接口: /api/backup/*
  // ----------------------------------------------------
  if (path === 'backup/export' && method === 'GET') {
    const authUser = await authenticate(request, env);
    if (!authUser) return error('未授权', 401);

    const menus = await storage.get('nav:menus') || [];
    const cards = await storage.get('nav:cards') || [];
    const friends = await storage.get('nav:friends') || [];
    const ads = await storage.get('nav:ads') || [];

    return json({
      version: '1.0',
      exportedAt: getShanghaiTime(),
      menus,
      cards,
      friends,
      ads
    });
  }

  if (path === 'backup/import' && method === 'POST') {
    const authUser = await authenticate(request, env);
    if (!authUser) return error('未授权', 401);

    try {
      const data = await request.json();
      if (Array.isArray(data.menus)) await storage.put('nav:menus', data.menus);
      if (Array.isArray(data.cards)) await storage.put('nav:cards', data.cards);
      if (Array.isArray(data.friends)) await storage.put('nav:friends', data.friends);
      if (Array.isArray(data.ads)) await storage.put('nav:ads', data.ads);
      return json({ success: true, message: '数据导入成功' });
    } catch (e) {
      return error('导入失败: ' + e.message, 400);
    }
  }

  // ----------------------------------------------------
  // 数据重置/初始化接口: POST /api/init
  // ----------------------------------------------------
  if (path === 'init' && method === 'POST') {
    const authUser = await authenticate(request, env);
    if (!authUser) return error('未授权', 401);

    const defaultUser = env.ADMIN_USERNAME || 'admin';
    const defaultPass = env.ADMIN_PASSWORD || '123456';
    const passwordHash = await hashPassword(defaultPass);

    await storage.put('nav:menus', initialMenus);
    await storage.put('nav:cards', initialCards);
    await storage.put('nav:friends', initialFriends);
    await storage.put('nav:ads', initialAds);
    await storage.put('nav:users', [
      {
        id: 1,
        username: defaultUser,
        password: passwordHash,
        last_login_time: null,
        last_login_ip: null
      }
    ]);

    return json({ success: true, message: '初始化默认数据成功' });
  }

  return error(`API Not Found: /api/${path}`, 404);
}
