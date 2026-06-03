import { useState } from 'react'
import { RG } from '../data.js'
import { Icon } from './primitives.jsx'
import { useFeedTestMutation } from '../queries/feeds.js'
import { WORKER_CONFIGURED } from '../api.js'
import {
  ADAPTER_SURFACE_WORKER_CONFIGURED,
  adapterSurfaceUnavailable,
  okAdapterSurface,
  useDexReadAdapters,
  useLendingReadAdapters,
} from '../queries/adapter-surfaces.js'
import { useChainDataStatus } from '../queries/chain-data-status.js'
import { okArchivalReplayContract, useArchivalReplayContract } from '../queries/archival-replay.js'
import { okPrivatePolicyRecordContract, usePrivatePolicyRecordContract } from '../queries/private-policy-records.js'
import {
  archivalReplayDiagnostic,
  chainDataProviderDiagnostic,
  privatePolicyRecordDiagnostic,
} from '../queries/data-source-diagnostics.js'

const ACCESS_META = {
  live:  { c: 'var(--safe)',   label: 'Live · direct', note: 'Public, CORS-open — the browser fetches it directly.' },
  mixed: { c: 'var(--sui)',    label: 'Live · per-venue', note: 'Most venues are public; a few need a light proxy.' },
  proxy: { c: 'var(--warn)',   label: 'Backend proxy', note: 'Needs a server: API keys, signing or a non-CORS venue.' },
};
const GROUP_ICON = { 'Market data': 'percent', 'On-chain': 'layers', 'Derivatives': 'swap', 'Execution': 'bolt' };

function SurfacePill({ children, tone = 'neutral' }) {
  const cls = tone === 'safe' ? 'badge-safe' : tone === 'warn' ? 'badge-warn' : 'badge-neutral';
  return <span className={`badge ${cls}`} style={{ fontSize: 9.5, whiteSpace: 'nowrap' }}>{children}</span>;
}

function WorkerSurfaceCard({ title, icon, data, query, metricRows, adapterRows }) {
  const unavailable = adapterSurfaceUnavailable(query);
  const loading = ADAPTER_SURFACE_WORKER_CONFIGURED && query.isPending;
  return (
    <div className="card" style={{ padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ color: data ? 'var(--accent)' : 'var(--t2)' }}><Icon name={icon} size={16} /></span>
        <div className="card-title" style={{ fontSize: 13 }}>{title}</div>
        <div style={{ flex: 1 }} />
        {data ? <SurfacePill tone="safe">worker</SurfacePill>
          : loading ? <SurfacePill>loading</SurfacePill>
          : <SurfacePill tone="warn">{unavailable || 'unavailable'}</SurfacePill>}
      </div>
      {data ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {metricRows.map(([k, v]) => (
              <div key={k} style={{ padding: '9px 10px', borderRadius: 8, background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <div className="eyebrow" style={{ fontSize: 8.5 }}>{k}</div>
                <div className="mono display" style={{ fontSize: 17, fontWeight: 600, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {adapterRows.map((row) => (
              <span key={row.id} className="badge badge-neutral" style={{ fontSize: 9.5 }}>
                {row.protocol_name}
                <span style={{ color: row.execution_enabled ? 'var(--safe)' : 'var(--warn)', marginLeft: 5 }}>
                  {row.execution_enabled ? 'exec' : row.execution_blocker_code}
                </span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.45 }}>
          Worker read surfaces appear here when `VITE_WORKER_URL` points at the RescueGrid Worker.
        </div>
      )}
    </div>
  );
}

function ChainDataProviderCard({ data, query, onProbe }) {
  const diagnostic = chainDataProviderDiagnostic(data, query, { workerConfigured: WORKER_CONFIGURED });
  return (
    <div className="card" style={{ padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ color: diagnostic.ready ? 'var(--accent)' : diagnostic.warn ? 'var(--warn)' : 'var(--t2)' }}><Icon name="layers" size={16} /></span>
        <div className="card-title" style={{ fontSize: 13 }}>Worker chain provider</div>
        <div style={{ flex: 1 }} />
        <SurfacePill tone={diagnostic.tone}>{diagnostic.statusLabel}</SurfacePill>
      </div>
      {diagnostic.available ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {diagnostic.metrics.map(([k, v]) => (
              <div key={k} style={{ padding: '9px 10px', borderRadius: 8, background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <div className="eyebrow" style={{ fontSize: 8.5 }}>{k}</div>
                <div className="mono display" style={{ fontSize: 13, fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {diagnostic.readModelRows.map((row) => (
              <span key={row.id} className="badge badge-neutral" style={{ fontSize: 9.5 }}>
                {row.label}
                <span style={{ color: row.warn ? 'var(--warn)' : 'var(--safe)', marginLeft: 5 }}>{row.value}</span>
              </span>
            ))}
          </div>
          {diagnostic.probeError && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--warn)', lineHeight: 1.45 }}>
              {diagnostic.probeError}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={onProbe} disabled={query.isFetching} className="btn btn-sm">
              {query.isFetching ? <><span className="dot pulse" style={{ background: 'var(--accent)' }}></span> probing…</>
                : <><Icon name="refresh" size={12} /> Probe reads</>}
            </button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.45 }}>
          Worker chain-provider status appears here when `VITE_WORKER_URL` points at the RescueGrid Worker.
        </div>
      )}
    </div>
  );
}

function ArchivalReplayCard({ data, query }) {
  const diagnostic = archivalReplayDiagnostic(data, query, { workerConfigured: WORKER_CONFIGURED });
  return (
    <div className="card" style={{ padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ color: diagnostic.ready ? 'var(--accent)' : diagnostic.warn ? 'var(--warn)' : 'var(--t2)' }}><Icon name="clock" size={16} /></span>
        <div className="card-title" style={{ fontSize: 13 }}>Archival replay contract</div>
        <div style={{ flex: 1 }} />
        <SurfacePill tone={diagnostic.tone}>{diagnostic.statusLabel}</SurfacePill>
      </div>
      {diagnostic.available ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {diagnostic.metrics.map(([k, v]) => (
              <div key={k} style={{ padding: '9px 10px', borderRadius: 8, background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <div className="eyebrow" style={{ fontSize: 8.5 }}>{k}</div>
                <div className="mono display" style={{ fontSize: 13, fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {diagnostic.contractRows.map((row) => (
              <span key={row.id} className="badge badge-neutral" style={{ fontSize: 9.5 }}>
                {row.label}
                <span style={{ color: 'var(--warn)', marginLeft: 5 }}>contract</span>
              </span>
            ))}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.45 }}>
            {diagnostic.blocker} · {diagnostic.hotPath}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.45 }}>
          Archival replay contracts appear here when `VITE_WORKER_URL` points at the RescueGrid Worker.
        </div>
      )}
    </div>
  );
}

function PrivatePolicyRecordCard({ data, query }) {
  const diagnostic = privatePolicyRecordDiagnostic(data, query, { workerConfigured: WORKER_CONFIGURED });
  return (
    <div className="card" style={{ padding: '15px 17px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ color: diagnostic.ready ? 'var(--accent)' : diagnostic.warn ? 'var(--warn)' : 'var(--t2)' }}><Icon name="key" size={16} /></span>
        <div className="card-title" style={{ fontSize: 13 }}>Private policy records</div>
        <div style={{ flex: 1 }} />
        <SurfacePill tone={diagnostic.tone}>{diagnostic.statusLabel}</SurfacePill>
      </div>
      {diagnostic.available ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {diagnostic.metrics.map(([k, v]) => (
              <div key={k} style={{ padding: '9px 10px', borderRadius: 8, background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <div className="eyebrow" style={{ fontSize: 8.5 }}>{k}</div>
                <div className="mono display" style={{ fontSize: 13, fontWeight: 600, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {diagnostic.recordRows.map((row) => (
              <span key={row.id} className="badge badge-neutral" style={{ fontSize: 9.5 }}>
                {row.label}
                <span style={{ color: row.encryptionRequired ? 'var(--warn)' : 'var(--t2)', marginLeft: 5 }}>{row.value}</span>
              </span>
            ))}
            {diagnostic.operationsCount > 0 && (
              <span className="badge badge-neutral" style={{ fontSize: 9.5 }}>
                operations<span style={{ color: 'var(--warn)', marginLeft: 5 }}>{diagnostic.operationsCount}</span>
              </span>
            )}
            {diagnostic.eventsCount > 0 && (
              <span className="badge badge-neutral" style={{ fontSize: 9.5 }}>
                events<span style={{ color: 'var(--warn)', marginLeft: 5 }}>{diagnostic.eventsCount}</span>
              </span>
            )}
          </div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.45 }}>
            {diagnostic.blocker} · {diagnostic.hotPath}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11.5, color: 'var(--t2)', lineHeight: 1.45 }}>
          Private policy record contracts appear here when `VITE_WORKER_URL` points at the RescueGrid Worker.
        </div>
      )}
    </div>
  );
}

function FeedTestButton({ feed }) {
  const testFeedMutation = useFeedTestMutation();
  const state = testFeedMutation.isPending ? 'testing' : testFeedMutation.isSuccess ? 'ok' : testFeedMutation.isError ? 'err' : 'idle';
  const result = testFeedMutation.isSuccess
    ? `${testFeedMutation.data.summary} · ${testFeedMutation.data.ms}ms`
    : testFeedMutation.isError
      ? `${testFeedMutation.error?.message || testFeedMutation.error} — may be rate-limited; pipeline is unchanged`
      : '';

  const run = async () => {
    if (!feed.test) return;
    testFeedMutation.mutate(feed);
  };

  if (!feed.test) {
    return <span className="mono" style={{ fontSize: 10.5, color: 'var(--t3)' }}>—</span>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      {state === 'ok' && <span className="mono" style={{ fontSize: 10, color: 'var(--safe)', maxWidth: 230, textAlign: 'right' }}>{result}</span>}
      {state === 'err' && <span className="mono" style={{ fontSize: 10, color: 'var(--warn)', maxWidth: 230, textAlign: 'right' }}>{result}</span>}
      <button onClick={run} disabled={state === 'testing'} className="btn btn-sm"
        style={{ padding: '5px 11px', borderColor: state === 'ok' ? 'var(--safe)' : 'var(--border-hi)', color: state === 'ok' ? 'var(--safe)' : 'var(--t1)', whiteSpace: 'nowrap' }}>
        {state === 'testing' ? <><span className="dot pulse" style={{ background: 'var(--accent)' }}></span> pinging…</>
          : state === 'ok' ? <><Icon name="check" size={12} stroke={2.6} /> live</>
          : <><Icon name="globe" size={12} /> Test live</>}
      </button>
    </div>
  );
}

export function DataSources({ onToast, live, setLive }) {
  const [probeChainData, setProbeChainData] = useState(false);
  const feeds = RG.dataFeeds.filter(f => f.scope === 'sui');
  const groups = [...new Set(feeds.map(f => f.group))];
  const liveCount = feeds.filter(f => f.access !== 'proxy').length;
  const proxyCount = feeds.filter(f => f.access === 'proxy').length;
  const dexQuery = useDexReadAdapters();
  const lendingQuery = useLendingReadAdapters();
  const chainDataQuery = useChainDataStatus({ probe: probeChainData });
  const archivalReplayQuery = useArchivalReplayContract();
  const privateRecordQuery = usePrivatePolicyRecordContract();
  const chainDataStatus = chainDataQuery.data;
  const archivalReplay = okArchivalReplayContract(archivalReplayQuery);
  const privatePolicyRecords = okPrivatePolicyRecordContract(privateRecordQuery);
  const dexSurface = okAdapterSurface(dexQuery);
  const lendingSurface = okAdapterSurface(lendingQuery);

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* mode banner */}
      <div className="card" style={{ padding: '18px 22px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon name="globe" size={22} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="display" style={{ fontSize: 16, fontWeight: 600 }}>Sui feed mode</div>
          <div style={{ fontSize: 12.5, color: 'var(--t2)', marginTop: 3, maxWidth: 560, lineHeight: 1.5 }}>
            The app ships on a <strong style={{ color: 'var(--t0)' }}>Sui-only structured demo feed</strong> shaped like production. Flip to live and the same components read Sui-scoped public APIs — keyed signing still routes through the backend.
          </div>
        </div>
        {/* toggle */}
        <div onClick={() => { const n = !live; setLive(n); onToast && onToast(n ? 'Sui live feed armed — public sources fetch directly; keyed feeds need the backend' : 'Back to Sui demo feed — deterministic data for the prototype', n ? 'var(--accent)' : 'var(--sui)'); }}
          style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 11, padding: '10px 14px', borderRadius: 'var(--r-md)',
            border: `1.5px solid ${live ? 'var(--accent)' : 'var(--border)'}`, background: live ? 'var(--accent-dim)' : 'var(--glass)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: live ? 'var(--accent)' : 'var(--t2)' }}>{live ? 'Live feed' : 'Demo feed'}</span>
          <div style={{ width: 40, height: 24, borderRadius: 100, padding: 3, background: live ? 'var(--accent)' : 'var(--bg-0)', transition: 'background .15s' }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: live ? '#06231f' : 'var(--t2)', transform: live ? 'translateX(16px)' : 'none', transition: 'transform .15s' }} />
          </div>
        </div>
      </div>

      {/* counts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {[['Sui feeds', feeds.length, 'var(--t0)'], ['Direct Sui reads', liveCount, 'var(--safe)'], ['Worker-backed', proxyCount, 'var(--warn)']].map(([k, v, c]) => (
          <div key={k} className="card" style={{ padding: '14px 16px' }}>
            <div className="eyebrow">{k}</div>
            <div className="mono display" style={{ fontSize: 22, fontWeight: 600, marginTop: 6, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 10, marginLeft: 2, display: 'flex', alignItems: 'center', gap: 7 }}>
          <Icon name="shield" size={12} /> Worker adapter surfaces
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ChainDataProviderCard
            data={chainDataStatus}
            query={chainDataQuery}
            onProbe={() => {
              if (probeChainData) chainDataQuery.refetch();
              else setProbeChainData(true);
              onToast && onToast('ChainDataProvider probe queued through the Worker', 'var(--accent)');
            }}
          />
          <WorkerSurfaceCard
            title="Sui DEX read adapters"
            icon="scale"
            data={dexSurface}
            query={dexQuery}
            metricRows={[
              ['Adapters', dexSurface?.counts?.total_adapters ?? '—'],
              ['Markets', dexSurface?.counts?.total_supported_markets ?? '—'],
              ['Spread rows', dexSurface?.counts?.total_spread_pairs ?? '—'],
            ]}
            adapterRows={dexSurface?.adapters || []}
          />
          <WorkerSurfaceCard
            title="Sui lending health reads"
            icon="percent"
            data={lendingSurface}
            query={lendingQuery}
            metricRows={[
              ['Adapters', lendingSurface?.counts?.total_adapters ?? '—'],
              ['Markets', lendingSurface?.counts?.total_supported_markets ?? '—'],
              ['Health rows', lendingSurface?.counts?.total_health_rows ?? '—'],
            ]}
            adapterRows={lendingSurface?.adapters || []}
          />
          <ArchivalReplayCard data={archivalReplay} query={archivalReplayQuery} />
          <PrivatePolicyRecordCard data={privatePolicyRecords} query={privateRecordQuery} />
        </div>
      </div>

      {/* feed groups */}
      {groups.map(g => (
        <div key={g}>
          <div className="eyebrow" style={{ marginBottom: 10, marginLeft: 2, display: 'flex', alignItems: 'center', gap: 7 }}>
            <Icon name={GROUP_ICON[g] || 'layers'} size={12} /> {g}
          </div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {feeds.filter(f => f.group === g).map((f, i) => {
              const am = ACCESS_META[f.access];
              return (
                <div key={f.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 1.3fr 2fr', gap: 14, alignItems: 'center', padding: '15px 18px', borderTop: i ? '1px solid var(--border)' : 'none' }}>
                  {/* name + provider */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 7, height: 7, borderRadius: '50%', background: am.c, flexShrink: 0, boxShadow: f.access !== 'proxy' ? `0 0 6px ${am.c}` : 'none' }} />
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 3, marginLeft: 15 }}>{f.provider}</div>
                  </div>
                  {/* endpoint + meta */}
                  <div style={{ minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--sui)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.endpoint}</div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>{f.type}</span>
                      <span className="mono" style={{ fontSize: 9.5, color: 'var(--t3)' }}>· {f.cadence}</span>
                    </div>
                  </div>
                  {/* access + test */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
                    <span className="badge" style={{ fontSize: 9, background: `color-mix(in srgb, ${am.c} 14%, transparent)`, color: am.c, whiteSpace: 'nowrap' }}>{am.label}</span>
                    {live ? <FeedTestButton feed={f} />
                      : <span className="mono" style={{ fontSize: 10, color: 'var(--t3)' }}>{f.test ? 'testable' : 'demo'}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* architecture note */}
      <div className="card" style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ color: 'var(--accent)' }}><Icon name="layers" size={16} /></span>
          <div className="card-title">How live data flows in</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ padding: '13px 15px', borderRadius: 'var(--r-md)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span style={{ color: 'var(--safe)' }}><Icon name="check" size={14} stroke={2.4} /></span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--safe)' }}>Browser-direct</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t1)', lineHeight: 1.5 }}>
              Public, CORS-open Sui reads (DefiLlama Sui pools, Pyth Sui prices, Sui token tickers and Sui RPC) are fetched straight from the client and mapped into the same data shapes. The <strong style={{ color: 'var(--t0)' }}>Test live</strong> button proves it end-to-end.
            </div>
          </div>
          <div style={{ padding: '13px 15px', borderRadius: 'var(--r-md)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 7 }}>
              <span style={{ color: 'var(--warn)' }}><Icon name="shield" size={14} /></span>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--warn)' }}>Via backend</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t1)', lineHeight: 1.5 }}>
              DeepBook execution building and policy activation run through the Cloudflare Worker. Create/revoke return unsigned tx_json for the wallet to sign; autonomous execution uses the dedicated agent key, and every action stays inside the scoped Move policy.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
