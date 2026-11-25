// Background worker: builds chunks of planet maps so the main thread never stalls while drawing.
import { generatePage } from './terrain.js?v=20261124231212';
import { buildAtlas } from './art.js?v=20261124231212';
import { SKIN } from './skin.js?v=20261124231212';

const art = buildAtlas(SKIN);

self.onmessage = e => {
  const { job, key, desc, N, x0, y0, sx, sy, L } = e.data;
  const m = generatePage(desc, art, N, x0, y0, sx, sy);
  self.postMessage({ job, key, id: desc.id, W: desc.W, L, x0, y0, sx, sy, ids: m.ids, col: m.col, fld: m.fld, counts: m.counts,
    settlements: L === 0 ? m.settlements : null, ms: m.ms }, [m.ids.buffer, m.col.buffer, m.fld.buffer, m.counts.buffer]);
};
