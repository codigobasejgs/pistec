// Executa a CLI Vercel usando o túnel SOCKS5 autorizado apenas para domínios Vercel.
// Uso: node --require ./scripts/vercel-proxy.mjs "C:/Users/jefferson/AppData/Roaming/npm/node_modules/vercel/dist/vc.js" whoami
import https from 'node:https';
import { SocksProxyAgent } from 'socks-proxy-agent';
const agent = new SocksProxyAgent('socks5h://127.0.0.1:1080');
const isVercel = host => typeof host === 'string' && (host === 'vercel.com' || host.endsWith('.vercel.com') || host === 'vercel.sh' || host.endsWith('.vercel.sh'));
function patch(method) {
  const original = https[method];
  https[method] = function patched(first, second, third) {
    if (typeof first === 'string' || first instanceof URL) {
      const url = new URL(first);
      if (!isVercel(url.hostname)) return original.call(this, first, second, third);
      const options = typeof second === 'object' && second !== null ? { ...second, agent } : { agent };
      return typeof second === 'function' ? original.call(this, first, options, second) : original.call(this, first, options, third);
    }
    if (first && typeof first === 'object' && isVercel(first.hostname || first.host?.split(':')[0])) {
      return original.call(this, { ...first, agent }, second, third);
    }
    return original.call(this, first, second, third);
  };
}
patch('request');
patch('get');
