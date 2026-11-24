// Background worker: builds planet maps so the main thread never stalls while drawing.
import { generateMap } from './terrain.js';
import { buildAtlas } from './art.js';
import { SKIN } from './skin.js';

const art = buildAtlas(SKIN);

self.onmessage = e => {
  const { job, desc, W, H, level, y0, y1 } = e.data;
  const m = generateMap(desc, W, H, art, y0, y1);
  self.postMessage({ job, id: desc.id, level, W, H, y0, y1, ids: m.ids, col: m.col, counts: m.counts, settlements: m.settlements, ms: m.ms },
    [m.ids.buffer, m.col.buffer, m.counts.buffer]);
};
