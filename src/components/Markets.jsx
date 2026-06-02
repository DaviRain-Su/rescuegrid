import { useState, useEffect } from 'react'
import { RG } from '../data.js'
import { Icon, Token, Sparkline, ProtoGlyph, fmtUsd, fmtTvlM } from './primitives.jsx'
import { PoolDrawer } from './MarketDrawers.jsx'

const RISK_META = {
  low:  { c: 'var(--safe)',   cls: 'badge-safe' },
  med:  { c: 'var(--warn)',   cls: 'badge-warn' },
  high: { c: 'var(--danger)', cls: 'badge-danger' },
};
const TYPE_C = { Lending: 'var(--sui)', LP: 'var(--accent)', LST: 'var(--safe)', Vault: 'var(--warn)', CLOB: 'var(--accent)' };

function ChainChip({ ch, active, onClick }) {
  const live = ch.live;
  return (
    <button onClick={live ? onClick : undefined} disabled={!live}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 13px', borderRadius: 100, cursor: live ? 'pointer' : 'default',
        border: `1px solid ${active ? ch.c : 'var(--border)'}`,
        background: active ? `${ch.c}1f` : 'var(--glass-2)',
        color: active ? ch.c : 'var(--t2)', fontFamily: 'var(--f-body)', fontSize: 12.5, fontWeight: 600,
        opacity: live ? 1 : 0.55, transition: 'all .14s' }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ch.c, boxShadow: active ? `0 0 8px ${ch.c}` : 'none' }} />
      {ch.name}
      {!live && <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--t3)' }}>SOON</span>}
    </button>
  );
}

/* ---------------- Yields tab ---------------- */
const TYPE_SCENARIO = { LP: 'lp', Vault: 'lp', CLOB: 'lp', Lending: 'lend', LST: 'lend' };
function YieldMonitor({ onDeploy, onInspect, chain, live, onToast }) {
  const [type, setType] = useState('all');
  const [sort, setSort] = useState('apy');
  const [liveRows, setLiveRows] = useState(null);   // fetched DefiLlama pools
  const [liveState, setLiveState] = useState('idle'); // idle | loading | ok | err
  const types = ['all', 'Lending', 'LP', 'LST', 'Vault', 'CLOB'];

  // when Live feed is on, pull real pools from DefiLlama and map to row shape
  useEffect(() => {
    if (!live) { setLiveState('idle'); setLiveRows(null); return; }
    let cancelled = false;
    setLiveState('loading');
    (async () => {
      try {
        const res = await fetch('https://yields.llama.fi/pools');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        const rows = (json.data || [])
          .filter(p => ['Sui', 'Aptos', 'Solana', 'Ethereum', 'Base'].includes(p.chain))
          .map(p => {
            const base = +(p.apyBase || 0), reward = +(p.apyReward || 0);
            const apy = +(p.apy || base + reward);
            const sym = (p.symbol || '?').toUpperCase();
            const isLP = /[-/]/.test(sym);
            const isLST = /^(ST|HASUI|VSUI|AFSUI|JITOSOL|AMAPT)/.test(sym.replace(/[^A-Z]/g, '')) || /staked/i.test(p.poolMeta || '');
            const type = isLST ? 'LST' : isLP ? 'LP' : 'Lending';
            const risk = apy >= 30 || (p.ilRisk === 'yes') ? 'high' : apy >= 12 ? 'med' : 'low';
            const d7 = +(p.apyPct7D || 0);
            const trend = Array.from({ length: 7 }, (_, i) => +(apy - d7 * (1 - i / 6)).toFixed(2));
            return { proto: (p.project || 'pool'), market: sym, type, chain: (p.chain || '').toLowerCase(),
              tvl: (p.tvlUsd || 0) / 1e6, base, reward, apy, risk, trend, live: true, id: p.pool };
          })
          .filter(p => p.tvl >= 0.5 && p.apy < 300 && p.apy > 0);
        if (cancelled) return;
        setLiveRows(rows);
        setLiveState('ok');
        const sui = rows.filter(r => r.chain === 'sui').length;
        onToast && onToast(`Live · ${rows.length.toLocaleString()} pools from DefiLlama · ${sui} on Sui`, 'var(--accent)');
      } catch (e) {
        if (cancelled) return;
        setLiveState('err');
        onToast && onToast('Live fetch failed (' + (e.message || e) + ') — showing demo data', 'var(--warn)');
      }
    })();
    return () => { cancelled = true; };
  }, [live]);

  const source = (live && liveRows) ? liveRows : RG.yields;
  const rows = source
    .filter(y => (chain === 'all' || y.chain === chain) && (type === 'all' || y.type === type))
    .map(y => ({ ...y, apy: y.apy != null ? y.apy : y.base + y.reward }))
    .sort((a, b) => sort === 'apy' ? b.apy - a.apy : sort === 'tvl' ? b.tvl - a.tvl
      : ({ low: 0, med: 1, high: 2 }[a.risk] - { low: 0, med: 1, high: 2 }[b.risk]))
    .slice(0, live && liveRows ? 40 : 100);
  const maxApy = Math.max(...RG.yields.map(y => y.base + y.reward));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {types.map(t => (
            <button key={t} onClick={() => setType(t)} className="btn btn-sm"
              style={{ textTransform: t === 'all' ? 'none' : 'none',
                background: type === t ? 'var(--accent-dim)' : 'var(--glass-2)',
                borderColor: type === t ? 'var(--accent)' : 'var(--border)',
                color: type === t ? 'var(--accent)' : 'var(--t1)' }}>{t === 'all' ? 'All types' : t}</button>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="eyebrow" style={{ fontSize: 9.5 }}>Sort</span>
          {[['apy', 'APY'], ['tvl', 'TVL'], ['risk', 'Risk']].map(([k, l]) => (
            <button key={k} onClick={() => setSort(k)} className="btn btn-sm"
              style={{ background: sort === k ? 'var(--glass-hi)' : 'transparent', borderColor: sort === k ? 'var(--border-hi)' : 'var(--border)',
                color: sort === k ? 'var(--t0)' : 'var(--t2)' }}>{l}</button>
          ))}
        </div>
      </div>

      {/* table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr 1fr 1.1fr 1.9fr 1.2fr', padding: '11px 18px',
          borderBottom: '1px solid var(--border)' }}>
          {['Protocol / market', 'Type', 'TVL', '7d', 'APY', 'Risk'].map((h, i) => (
            <div key={h} className="eyebrow" style={{ fontSize: 9.5, textAlign: i >= 2 && i !== 4 ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>
        {rows.map((y, i) => {
          const pm = RG.protocols[y.proto] || { name: (y.proto || 'pool').replace(/(^|[-_])([a-z])/g, (m, s, c) => (s ? ' ' : '') + c.toUpperCase()), c: '#5C6A78' };
          const cm = RG.chains.find(c => c.id === y.chain) || { name: y.chain, c: 'var(--t2)' };
          const rm = RISK_META[y.risk];
          const basePct = y.apy > 0 ? (y.base / y.apy) * 100 : 0;
          return (
            <div key={y.id || (y.proto + y.market + i)} className="mkt-row" onClick={() => onInspect && onInspect(y)}
              style={{ display: 'grid', gridTemplateColumns: '2.4fr 1fr 1fr 1.1fr 1.9fr 1.2fr', alignItems: 'center', cursor: 'pointer',
                padding: '13px 18px', borderTop: i ? '1px solid var(--border)' : 'none', transition: 'background .12s' }}>
              {/* protocol / market */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                <ProtoGlyph proto={y.proto} size={34} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{pm.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: cm.c, flexShrink: 0 }} />{cm.name} · {y.market}
                  </div>
                </div>
              </div>
              {/* type */}
              <div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600,
                  padding: '3px 9px', borderRadius: 7, color: TYPE_C[y.type], background: `color-mix(in srgb, ${TYPE_C[y.type]} 13%, transparent)` }}>
                  {y.type}
                </span>
              </div>
              {/* tvl */}
              <div className="mono" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{fmtTvlM(y.tvl)}</div>
              {/* 7d spark */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', paddingRight: 4 }}>
                <Sparkline data={y.trend} w={58} h={22} strokeW={1.6}
                  color={y.trend[y.trend.length - 1] >= y.trend[0] ? 'var(--safe)' : 'var(--danger)'} fill={false} />
              </div>
              {/* apy */}
              <div style={{ paddingLeft: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="mono display" style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}>{y.apy.toFixed(1)}%</span>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>{y.base.toFixed(1)} base{y.reward > 0 ? ` · ${y.reward.toFixed(1)} rwd` : ''}</span>
                </div>
                <div style={{ height: 4, background: 'var(--bg-0)', borderRadius: 100, overflow: 'hidden', marginTop: 5, display: 'flex', maxWidth: 150 }}>
                  <div style={{ width: `${basePct}%`, background: 'var(--sui)' }} />
                  <div style={{ width: `${100 - basePct}%`, background: 'var(--accent)' }} />
                </div>
              </div>
              {/* risk + deploy */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                <span className={`badge ${rm.cls}`}><span className="dot"></span>{y.risk}</span>
                <button onClick={(e) => { e.stopPropagation(); onDeploy && onDeploy({ scenario: TYPE_SCENARIO[y.type] || 'lend' }); }} className="btn btn-sm mkt-deploy"
                  style={{ padding: '6px 10px', borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-dim)' }}>
                  <Icon name="bolt" size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 7 }}>
        {live && liveState === 'loading'
          ? <><span className="dot pulse" style={{ background: 'var(--accent)' }}></span> Fetching live pools from DefiLlama…</>
          : live && liveState === 'ok'
          ? <><Icon name="globe" size={13} style={{ color: 'var(--accent)' }} /> Live · real pools from DefiLlama · click a row for details · {rows.length} shown</>
          : live && liveState === 'err'
          ? <><Icon name="alert" size={13} style={{ color: 'var(--warn)' }} /> Live feed unavailable — showing demo data · {rows.length} pools</>
          : <><Icon name="eye" size={13} style={{ color: 'var(--sui)' }} /> Click any pool for its 30-day APY / TVL history and on-chain details · tap the bolt to hand it to the agent · {rows.length} pools shown.</>}
      </div>
    </div>
  );
}

/* ---------------- Perp arbitrage tab ---------------- */
function arbOf(inst) {
  const vs = inst.venues;
  let lo = vs[0], hi = vs[0];
  vs.forEach(v => { if (v.funding < lo.funding) lo = v; if (v.funding > hi.funding) hi = v; });
  return { lo, hi, spread: hi.funding - lo.funding };
}

function PerpArb({ onDeploy }) {
  const insts = RG.perps.map(p => ({ ...p, ...arbOf(p) })).sort((a, b) => b.spread - a.spread);
  const best = insts[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* best arb highlight */}
      <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        border: '1px solid color-mix(in srgb, var(--accent) 40%, var(--border))' }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="swap" size={22} />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 3 }}>Widest spread right now</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="display" style={{ fontSize: 18, fontWeight: 600 }}>{best.sym}-PERP</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--t2)' }}>delta-neutral funding capture</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-safe" style={{ fontSize: 11 }}>LONG {RG.perpVenues[best.lo.v].name}</span>
          <Icon name="swap" size={14} style={{ color: 'var(--t2)' }} />
          <span className="badge badge-danger" style={{ fontSize: 11 }}>SHORT {RG.perpVenues[best.hi.v].name}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono display" style={{ fontSize: 24, fontWeight: 600, color: 'var(--accent)' }}>+{best.spread.toFixed(1)}%</div>
          <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>net edge · APR</div>
        </div>
        <button onClick={() => onDeploy && onDeploy({ scenario: 'funding-arb' })} className="btn btn-primary btn-sm">
          <Icon name="bolt" size={14} /> Deploy arb
        </button>
      </div>

      {/* per-instrument grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {insts.map(inst => (
          <div key={inst.sym} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <Token sym={inst.sym} size={30} />
              <div style={{ flex: 1 }}>
                <div className="display" style={{ fontSize: 14.5, fontWeight: 600 }}>{inst.sym}-PERP</div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--t2)' }}>mark ${inst.mark < 1 ? inst.mark.toFixed(4) : fmtUsd(inst.mark, inst.mark > 1000 ? 0 : 3)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent)' }}>+{inst.spread.toFixed(1)}%</div>
                <div className="eyebrow" style={{ fontSize: 8.5 }}>spread apr</div>
              </div>
            </div>

            {/* venue rows */}
            <div>
              {inst.venues.slice().sort((a, b) => a.funding - b.funding).map((v, i) => {
                const vm = RG.perpVenues[v.v];
                const isLo = v.v === inst.lo.v, isHi = v.v === inst.hi.v;
                return (
                  <div key={v.v} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 0.9fr', alignItems: 'center', gap: 8,
                    padding: '11px 18px', borderTop: i ? '1px solid var(--border)' : 'none',
                    background: isLo ? 'color-mix(in srgb, var(--safe) 8%, transparent)' : isHi ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: vm.kind === 'cex' ? 2 : '50%', background: vm.c, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vm.name}</span>
                      <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--t3)', flexShrink: 0 }}>{vm.tag}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--t1)', textAlign: 'right' }}>
                      {inst.mark < 1 ? v.px.toFixed(4) : fmtUsd(v.px, v.px > 1000 ? 0 : 3)}
                    </div>
                    <div className="mono" style={{ fontSize: 12.5, fontWeight: 600, textAlign: 'right',
                      color: isLo ? 'var(--safe)' : isHi ? 'var(--danger)' : 'var(--t1)' }}>
                      {v.funding > 0 ? '+' : ''}{v.funding.toFixed(1)}%
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {isLo && <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--safe)', letterSpacing: '0.05em' }}>LONG</span>}
                      {isHi && <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--danger)', letterSpacing: '0.05em' }}>SHORT</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderTop: '1px solid var(--border)', background: 'var(--glass)' }}>
              <Icon name="globe" size={13} style={{ color: 'var(--t2)' }} />
              <span style={{ fontSize: 11, color: 'var(--t2)' }}>
                {[...new Set(inst.venues.map(v => RG.perpVenues[v.v].tag))].join(' · ')}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={() => onDeploy && onDeploy({ scenario: 'funding-arb' })} className="btn btn-sm"
                style={{ padding: '5px 11px', borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-dim)' }}>
                <Icon name="swap" size={12} /> Deploy
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Spot arbitrage tab ---------------- */
function spotArbOf(inst) {
  const vs = inst.venues;
  let buy = vs[0], sell = vs[0];
  vs.forEach(v => { if (v.ask < buy.ask) buy = v; if (v.bid > sell.bid) sell = v; });
  return { buy, sell, spread: (sell.bid - buy.ask) / buy.ask * 100 };
}

function SpotArb({ onDeploy }) {
  const insts = RG.spots.map(s => ({ ...s, ...spotArbOf(s) })).sort((a, b) => b.spread - a.spread);
  const best = insts[0];
  const fmtPx = (p) => p < 1 ? p.toFixed(4) : fmtUsd(p, p > 1000 ? 0 : 3);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* best spot spread highlight */}
      <div className="card" style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap',
        border: '1px solid color-mix(in srgb, var(--accent) 40%, var(--border))' }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="scale" size={22} />
        </div>
        <div>
          <div className="eyebrow" style={{ marginBottom: 3 }}>Widest spot spread right now</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span className="display" style={{ fontSize: 18, fontWeight: 600 }}>{best.sym}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--t2)' }}>buy low · sell high, across CEX &amp; DEX</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="badge badge-safe" style={{ fontSize: 11 }}>BUY {RG.spotVenues[best.buy.v].name}</span>
          <Icon name="swap" size={14} style={{ color: 'var(--t2)' }} />
          <span className="badge badge-danger" style={{ fontSize: 11 }}>SELL {RG.spotVenues[best.sell.v].name}</span>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono display" style={{ fontSize: 24, fontWeight: 600, color: 'var(--accent)' }}>+{best.spread.toFixed(2)}%</div>
          <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>gross spread</div>
        </div>
        <button onClick={() => onDeploy && onDeploy({ scenario: 'spot' })} className="btn btn-primary btn-sm">
          <Icon name="bolt" size={14} /> Deploy arb
        </button>
      </div>

      {/* per-instrument grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {insts.map(inst => (
          <div key={inst.sym} className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
              <Token sym={inst.sym} size={30} />
              <div style={{ flex: 1 }}>
                <div className="display" style={{ fontSize: 14.5, fontWeight: 600 }}>{inst.sym}<span style={{ color: 'var(--t2)' }}>/USDC</span></div>
                <div className="mono" style={{ fontSize: 11, color: 'var(--t2)' }}>{inst.venues.length} venues</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 15, fontWeight: 600, color: inst.spread > 0 ? 'var(--accent)' : 'var(--t2)' }}>{inst.spread > 0 ? '+' : ''}{inst.spread.toFixed(2)}%</div>
                <div className="eyebrow" style={{ fontSize: 8.5 }}>spread</div>
              </div>
            </div>

            {/* header row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 0.9fr', gap: 8, padding: '8px 18px', borderBottom: '1px solid var(--border)' }}>
              {['Venue', 'Bid', 'Ask', ''].map((h, i) => (
                <div key={i} className="eyebrow" style={{ fontSize: 8.5, textAlign: i === 0 ? 'left' : i === 3 ? 'right' : 'right' }}>{h}</div>
              ))}
            </div>

            {/* venue rows */}
            <div>
              {inst.venues.slice().sort((a, b) => a.ask - b.ask).map((v, i) => {
                const vm = RG.spotVenues[v.v];
                const isBuy = v.v === inst.buy.v, isSell = v.v === inst.sell.v;
                return (
                  <div key={v.v} style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 0.9fr', alignItems: 'center', gap: 8,
                    padding: '11px 18px', borderTop: i ? '1px solid var(--border)' : 'none',
                    background: isBuy ? 'color-mix(in srgb, var(--safe) 8%, transparent)' : isSell ? 'color-mix(in srgb, var(--danger) 8%, transparent)' : 'transparent' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                      <span style={{ width: 8, height: 8, borderRadius: vm.kind === 'cex' ? 2 : '50%', background: vm.c, flexShrink: 0 }} />
                      <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{vm.name}</span>
                      <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--t3)', flexShrink: 0 }}>{vm.tag}</span>
                    </div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--t1)', textAlign: 'right' }}>{fmtPx(v.bid)}</div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--t1)', textAlign: 'right' }}>{fmtPx(v.ask)}</div>
                    <div style={{ textAlign: 'right' }}>
                      {isBuy && <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--safe)', letterSpacing: '0.05em' }}>BUY</span>}
                      {isSell && <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: 'var(--danger)', letterSpacing: '0.05em' }}>SELL</span>}
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px', borderTop: '1px solid var(--border)', background: 'var(--glass)' }}>
              <Icon name="globe" size={13} style={{ color: 'var(--t2)' }} />
              <span style={{ fontSize: 11, color: 'var(--t2)' }}>
                {[...new Set(inst.venues.map(v => RG.spotVenues[v.v].tag))].join(' · ')}
              </span>
              <div style={{ flex: 1 }} />
              <button onClick={() => onDeploy && onDeploy({ scenario: 'spot' })} className="btn btn-sm"
                style={{ padding: '5px 11px', borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-dim)' }}>
                <Icon name="scale" size={12} /> Deploy
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Unified opportunities ---------------- */
function Opportunities({ onDeploy, live, onToast }) {
  const [cat, setCat] = useState('all');
  const [liveYields, setLiveYields] = useState(null);
  const chainName = id => (RG.chains.find(c => c.id === id) || {}).name || id;

  // when Live, pull real DefiLlama pools for the Yield slice (top by APY, sane filter)
  useEffect(() => {
    if (!live) { setLiveYields(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('https://yields.llama.fi/pools');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const json = await res.json();
        const rows = (json.data || [])
          .filter(p => ['Sui', 'Aptos', 'Solana', 'Ethereum', 'Base'].includes(p.chain) && (p.apy || 0) > 0 && (p.apy || 0) < 300 && (p.tvlUsd || 0) >= 5e5)
          .sort((a, b) => (b.apy || 0) - (a.apy || 0))
          .slice(0, 16)
          .map(p => {
            const sym = (p.symbol || '?').toUpperCase();
            const isLP = /[-/]/.test(sym);
            return { kind: 'yield', proto: p.project, name: (p.project || 'pool').replace(/(^|[-_])([a-z])/g, (m, s, c) => (s ? ' ' : '') + c.toUpperCase()),
              sub: p.chain + ' · ' + sym, cat: 'Yield', catC: 'var(--sui)', edge: +(p.apy || 0), unit: 'APY',
              risk: (p.apy >= 30 || p.ilRisk === 'yes') ? 'high' : p.apy >= 12 ? 'med' : 'low', scenario: isLP ? 'lp' : 'lend' };
          });
        if (cancelled) return;
        setLiveYields(rows);
        onToast && onToast(`Opportunities · ${rows.length} live yield rows from DefiLlama`, 'var(--accent)');
      } catch (e) { if (!cancelled) { setLiveYields(null); onToast && onToast('Live opportunities unavailable — showing demo', 'var(--warn)'); } }
    })();
    return () => { cancelled = true; };
  }, [live]);

  const yieldOpps = (live && liveYields) ? liveYields : RG.yields.map(y => ({ kind: 'yield', proto: y.proto, name: RG.protocols[y.proto].name,
    sub: chainName(y.chain) + ' · ' + y.market, cat: 'Yield', catC: 'var(--sui)',
    edge: y.base + y.reward, unit: 'APY', risk: y.risk, scenario: TYPE_SCENARIO[y.type] || 'lend' }));
  const opps = [
    ...yieldOpps,
    ...RG.perps.map(p => { const a = arbOf(p); return { kind: 'perp', sym: p.sym, name: p.sym + '-PERP',
      sub: 'Long ' + RG.perpVenues[a.lo.v].name + ' · Short ' + RG.perpVenues[a.hi.v].name, cat: 'Perp arb', catC: 'var(--accent)',
      edge: a.spread, unit: 'APR', risk: 'med', scenario: 'funding-arb' }; }),
    ...RG.spots.map(s => { const a = spotArbOf(s); return { kind: 'spot', sym: s.sym, name: s.sym + ' spot',
      sub: 'Buy ' + RG.spotVenues[a.buy.v].name + ' · Sell ' + RG.spotVenues[a.sell.v].name, cat: 'Spot arb', catC: 'var(--safe)',
      edge: a.spread, unit: 'spread', risk: 'low', scenario: 'spot' }; }),
  ];
  const cats = ['all', 'Yield', 'Perp arb', 'Spot arb'];
  const rows = opps.filter(o => cat === 'all' || o.cat === cat).sort((a, b) => b.edge - a.edge);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
        {cats.map(c => (
          <button key={c} onClick={() => setCat(c)} className="btn btn-sm"
            style={{ background: cat === c ? 'var(--accent-dim)' : 'var(--glass-2)', borderColor: cat === c ? 'var(--accent)' : 'var(--border)',
              color: cat === c ? 'var(--accent)' : 'var(--t1)' }}>{c === 'all' ? 'All opportunities' : c}</button>
        ))}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.1fr 1.4fr 1fr', padding: '11px 18px', borderBottom: '1px solid var(--border)' }}>
          {['Opportunity', 'Category', 'Edge', 'Risk'].map((h, i) => (
            <div key={h} className="eyebrow" style={{ fontSize: 9.5, textAlign: i === 3 ? 'right' : 'left' }}>{h}</div>
          ))}
        </div>
        {rows.map((o, i) => {
          const rm = RISK_META[o.risk];
          return (
            <div key={o.kind + o.name + i} className="mkt-row"
              style={{ display: 'grid', gridTemplateColumns: '2.4fr 1.1fr 1.4fr 1fr', alignItems: 'center',
                padding: '13px 18px', borderTop: i ? '1px solid var(--border)' : 'none', transition: 'background .12s' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                {o.kind === 'yield' ? <ProtoGlyph proto={o.proto} size={32} /> : <Token sym={o.sym} size={32} />}
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{o.name}</div>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--t2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.sub}</div>
                </div>
              </div>
              <div>
                <span style={{ fontSize: 11.5, fontWeight: 600, padding: '3px 9px', borderRadius: 7, color: o.catC, background: `color-mix(in srgb, ${o.catC} 14%, transparent)` }}>{o.cat}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span className="mono display" style={{ fontSize: 18, fontWeight: 600, color: 'var(--accent)' }}>{o.cat === 'Yield' ? '' : '+'}{o.edge.toFixed(o.cat === 'Spot arb' ? 2 : 1)}%</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--t2)' }}>{o.unit}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
                <span className={`badge ${rm.cls}`}><span className="dot"></span>{o.risk}</span>
                <button onClick={() => onDeploy && onDeploy({ scenario: o.scenario })} className="btn btn-sm mkt-deploy"
                  style={{ padding: '6px 10px', borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-dim)' }}>
                  <Icon name="bolt" size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--t2)', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Icon name="radar" size={13} style={{ color: 'var(--accent)' }} />
        Every yield, funding-rate and spot spread the agent tracks — ranked by edge across {RG.chains.length} chains + CEX · {rows.length} shown{live && liveYields ? ' · yields live from DefiLlama' : ''} · tap the bolt to deploy.
      </div>
    </div>
  );
}

/* ---------------- shell ---------------- */
export function MarketsView({ onDeploy, live, onToast }) {
  const [tab, setTab] = useState('opps');
  const [inspect, setInspect] = useState(null);
  const [chain, setChain] = useState('all');
  const protoCount = Object.keys(RG.protocols).length;
  const bestApy = Math.max(...RG.yields.map(y => y.base + y.reward));
  const bestArb = Math.max(...RG.perps.map(p => arbOf(p).spread));
  const trackedTvl = RG.yields.reduce((s, y) => s + y.tvl, 0);

  const stats = [
    { k: 'Tracked TVL', v: fmtTvlM(trackedTvl), sub: `${RG.yields.length} pools · ${RG.chains.length} chains`, icon: 'layers', c: 'var(--sui)' },
    { k: 'Protocols', v: protoCount, sub: 'DeFi + CEX', icon: 'grid', c: 'var(--t1)' },
    { k: 'Best yield', v: bestApy.toFixed(1) + '%', sub: 'APY', icon: 'percent', c: 'var(--accent)' },
    { k: 'Best arb edge', v: '+' + bestArb.toFixed(1) + '%', sub: 'perp funding', icon: 'swap', c: 'var(--accent)' },
  ];

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* aggregate stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {stats.map(s => (
          <div key={s.k} className="card" style={{ padding: '15px 17px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div className="eyebrow">{s.k}</div>
              <span style={{ color: s.c, opacity: .9 }}><Icon name={s.icon} size={15} /></span>
            </div>
            <div className="mono display" style={{ fontSize: 23, fontWeight: 600, marginTop: 8, color: s.c === 'var(--accent)' ? 'var(--accent)' : 'var(--t0)' }}>{s.v}</div>
            <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* chains filter — applies to the yields tab */}
      {tab === 'yields' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
          <span className="eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 2 }}>
            <Icon name="globe" size={13} /> chain</span>
          <button onClick={() => setChain('all')}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 100, cursor: 'pointer',
              border: `1px solid ${chain === 'all' ? 'var(--border-hi)' : 'var(--border)'}`,
              background: chain === 'all' ? 'var(--glass-hi)' : 'var(--glass-2)',
              color: chain === 'all' ? 'var(--t0)' : 'var(--t2)', fontFamily: 'var(--f-body)', fontSize: 12.5, fontWeight: 600 }}>
            All chains</button>
          {RG.chains.map(ch => <ChainChip key={ch.id} ch={ch} active={chain === ch.id} onClick={() => setChain(ch.id)} />)}
        </div>
      )}

      {/* tab switcher */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4, background: 'var(--glass-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 4, width: 'fit-content' }}>
          {[['opps', 'radar', 'Opportunities'], ['yields', 'layers', 'Yield monitor'], ['perps', 'swap', 'Perp arbitrage'], ['spots', 'scale', 'Spot arbitrage']].map(([id, ic, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 16px',
              borderRadius: 8, border: 'none', cursor: 'pointer', fontFamily: 'var(--f-body)', fontSize: 13, fontWeight: 600,
              background: tab === id ? 'var(--glass-hi)' : 'transparent', color: tab === id ? 'var(--t0)' : 'var(--t2)', transition: 'all .14s' }}>
              <Icon name={ic} size={15} style={{ color: tab === id ? 'var(--accent)' : 'var(--t2)' }} /> {label}
            </button>
          ))}
        </div>
        <span className="badge badge-neutral" style={{ fontSize: 10 }}><span className="dot pulse" style={{ background: live ? 'var(--accent)' : 'var(--safe)' }}></span>{live ? 'Live · real feeds' : 'Live · demo feed'}</span>
      </div>

      {tab === 'opps' && <Opportunities onDeploy={onDeploy} live={live} onToast={onToast} />}
      {tab === 'yields' && <YieldMonitor onDeploy={onDeploy} onInspect={setInspect} chain={chain} live={live} onToast={onToast} />}
      {tab === 'perps' && <PerpArb onDeploy={onDeploy} />}
      {tab === 'spots' && <SpotArb onDeploy={onDeploy} />}

      {inspect && <PoolDrawer pool={inspect} onClose={() => setInspect(null)} onDeploy={onDeploy} />}
    </div>
  );
}
