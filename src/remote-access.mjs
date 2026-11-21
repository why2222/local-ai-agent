import { timingSafeEqual } from 'node:crypto';
import { REMOTE_HOST, REMOTE_TOKEN } from './config.mjs';

export const REMOTE_COOKIE_NAME = '__Host-remote_token';

export function isRemoteHost(hostHeader) {
  if (!REMOTE_HOST || typeof hostHeader !== 'string') return false;
  const host = hostHeader.toLowerCase();
  const expected = REMOTE_HOST.toLowerCase();
  return host === expected || host === `${expected}:443`;
}

function validToken(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(REMOTE_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    cookies[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return cookies;
}

// 返回访问决策：allow / redirect（登录后设置 Cookie）/ deny。
export function checkRemoteAccess(req) {
  const origin = req.headers.origin;
  if (origin && origin !== `https://${REMOTE_HOST}`) {
    return { action: 'deny', status: 403, code: 'forbidden', message: '来源不被允许' };
  }

  const url = new URL(req.url, `https://${REMOTE_HOST}`);
  const queryToken = url.searchParams.get('token');
  if (queryToken !== null && validToken(queryToken)) {
    // API 请求直接放行；页面请求设置 Cookie 后跳转到无令牌地址。
    if (url.pathname.startsWith('/api/')) return { action: 'allow' };
    url.searchParams.delete('token');
    const qs = url.searchParams.toString();
    return {
      action: 'redirect',
      location: url.pathname + (qs ? `?${qs}` : ''),
      setCookie: `${REMOTE_COOKIE_NAME}=${REMOTE_TOKEN}; HttpOnly; Secure; SameSite=Strict; Path=/`,
    };
  }

  const cookies = parseCookies(req.headers.cookie);
  if (validToken(cookies[REMOTE_COOKIE_NAME])) return { action: 'allow' };

  return { action: 'deny', status: 401, code: 'unauthorized', message: '远程访问需要有效令牌' };
}
