// Menus do player: qualidade (versões do canal e níveis do HLS) e velocidade de reprodução.
import { S, displayName, variantsOf } from './store.js';
import { choose, toast } from './ui.js';

export const qualityAvailable = (hls, item) => !!((hls && hls.levels.length > 1) || (item?.kind === 'live' && variantsOf(item)));

const mbps = (b) => `${(b / 1e6).toFixed(1).replace('.', ',')} Mb/s`;
const levelLabel = (l) => [l.height ? `${l.height}p` : '', l.bitrate ? mbps(l.bitrate) : ''].filter(Boolean).join(' · ') || 'Nível';

// playVariant(item): toca outra versão do mesmo canal (SD/HD/FHD).
export async function pickQuality(hls, item, playVariant) {
  const opts = [];
  const g = item?.kind === 'live' ? variantsOf(item) : null;
  if (g) {
    for (const v of g) opts.push({ label: `Versão do canal: ${v.qlabel || 'Padrão'} · ${displayName(v)}`, value: `v:${v.key}`, active: v.key === item.key });
  }
  if (hls && hls.levels.length > 1) {
    const now = hls.levels[hls.currentLevel];
    opts.push({ label: `Automática${hls.autoLevelEnabled && now ? ` (agora ${levelLabel(now)})` : ''}`, value: 'auto', active: hls.autoLevelEnabled });
    hls.levels.map((l, i) => ({ l, i }))
      .sort((a, b) => (b.l.height || 0) - (a.l.height || 0) || (b.l.bitrate || 0) - (a.l.bitrate || 0))
      .forEach(({ l, i }) => opts.push({ label: levelLabel(l), value: `l:${i}`, active: !hls.autoLevelEnabled && hls.currentLevel === i }));
  }
  if (!opts.length) { toast('Uma única qualidade disponível'); return; }
  const v = await choose('Qualidade', opts);
  if (v === undefined) return;
  if (v === 'auto') { hls.currentLevel = -1; toast('Qualidade automática'); return; }
  if (v.startsWith('l:')) {
    const i = Number(v.slice(2));
    hls.currentLevel = i;
    toast(`Qualidade: ${levelLabel(hls.levels[i])}`);
    return;
  }
  const target = g.find((x) => `v:${x.key}` === v);
  if (target && target.key !== item.key) {
    S.variantChoice.set(item.qkey, target.key);
    playVariant(target);
  }
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// Devolve a velocidade escolhida, ou undefined se o menu for fechado.
export function pickSpeed(current) {
  return choose('Velocidade', RATES.map((r) => ({
    label: r === 1 ? 'Normal (1×)' : `${String(r).replace('.', ',')}×`, value: r, active: Math.abs((current || 1) - r) < 0.01,
  })));
}
