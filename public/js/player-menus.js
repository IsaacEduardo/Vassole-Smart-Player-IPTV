// Menus do player: qualidade (versões do canal e níveis do HLS) e velocidade de reprodução.
import { S, displayName, variantsOf } from './store.js';
import { choose, toast } from './ui.js';

// engine: motor de reprodução (platform.js), que expõe os níveis de qualidade do stream.
export const qualityAvailable = (engine, item) => !!(engine.levels().length > 1 || (item?.kind === 'live' && variantsOf(item)));

const mbps = (b) => `${(b / 1e6).toFixed(1).replace('.', ',')} Mb/s`;
const levelLabel = (l) => [l.height ? `${l.height}p` : '', l.bitrate ? mbps(l.bitrate) : ''].filter(Boolean).join(' · ') || 'Nível';

// playVariant(item): toca outra versão do mesmo canal (SD/HD/FHD).
export async function pickQuality(engine, item, playVariant) {
  const opts = [];
  const g = item?.kind === 'live' ? variantsOf(item) : null;
  if (g) {
    for (const v of g) opts.push({ label: `Versão do canal: ${v.qlabel || 'Padrão'} · ${displayName(v)}`, value: `v:${v.key}`, active: v.key === item.key });
  }
  const levels = engine.levels();
  if (levels.length > 1) {
    const { auto, current } = engine.level();
    const now = levels[current];
    opts.push({ label: `Automática${auto && now ? ` (agora ${levelLabel(now)})` : ''}`, value: 'auto', active: auto });
    levels.map((l, i) => ({ l, i }))
      .sort((a, b) => (b.l.height || 0) - (a.l.height || 0) || (b.l.bitrate || 0) - (a.l.bitrate || 0))
      .forEach(({ l, i }) => opts.push({ label: levelLabel(l), value: `l:${i}`, active: !auto && current === i }));
  }
  if (!opts.length) { toast('Uma única qualidade disponível'); return; }
  const v = await choose('Qualidade', opts);
  if (v === undefined) return;
  if (v === 'auto') { engine.setLevel(-1); toast('Qualidade automática'); return; }
  if (v.startsWith('l:')) {
    const i = Number(v.slice(2));
    engine.setLevel(i);
    toast(`Qualidade: ${levelLabel(levels[i])}`);
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
