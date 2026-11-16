// Request bridge: Electron preload (window.vms) or the HTTP dev server.
export class ApiError extends Error {
  constructor(error) { super(error.message); this.code = error.code; this.detail = error.detail; }
}

export async function call(channel, args = {}) {
  let res;
  if (window.vms && window.vms.invoke) {
    res = await window.vms.invoke(channel, args);
  } else {
    const r = await fetch(`/api/${channel}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) });
    res = await r.json();
  }
  if (!res.ok) throw new ApiError(res.error);
  return res.data;
}

export const isDesktop = () => !!(window.vms && window.vms.platform === 'electron');
