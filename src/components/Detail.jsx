/* ===========================================================
   RescueGrid — Policy Inspect slide-over + on-chain explorer
   Makes the MoveGate Mandate + RescuePolicyWrapper tangible: struct, capabilities,
   protocol allow-list, audit trail.
   =========================================================== */
import { RG } from '../data.js'
import { Icon } from './primitives.jsx'
import { Button } from '@heroui/react'
import { useTxDetail } from '../queries/feeds.js'
import { filterPolicyActivity } from '../activity-match.js'

function CapRow({ granted, label, fn }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
      <div style={{ width: 22, height: 22, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: granted ? 'var(--safe-dim)' : 'var(--danger-dim)', color: granted ? 'var(--safe)' : 'var(--danger)' }}>
        <Icon name={granted ? 'check' : 'x'} size={13} stroke={2.6} />
      </div>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: granted ? 'var(--t0)' : 'var(--t1)' }}>{label}</span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--t2)', marginLeft: 8 }}>{fn}</span>
      </div>
      <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: granted ? 'var(--safe)' : 'var(--danger)' }}>
        {granted ? 'GRANTED' : 'DENIED'}
      </span>
    </div>
  )
}

function resolveInspectSource(source) {
  return source || {
    kind: 'demo',
    label: 'demo feed',
    badgeClass: 'badge-neutral',
    icon: 'eye',
    detail: 'Local sample policy shape.',
  }
}

function shortId(value) {
  if (!value || typeof value !== 'string') return '—'
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value
}

export function PolicyInspect({ p, activity, onClose, onRevoke, onTx, readOnly = false, source = null }) {
  const pct = Math.round((p.budgetUsed / p.budgetCap) * 100)
  const log = filterPolicyActivity(activity, p)
  const sourceMeta = resolveInspectSource(source)
  const liveSource = sourceMeta.kind !== 'demo'
  const objectLabel = liveSource ? 'MoveGate Mandate + Wrapper' : 'Demo policy-shaped object'
  const budgetLabel = liveSource ? 'On-chain budget ceiling' : 'Demo budget ceiling'
  const structLabel = liveSource ? 'RescuePolicyWrapper · move' : 'Demo wrapper shape · move-like'
  const auditLabel = liveSource ? `Audit trail · ${log.length} on-chain events` : `Demo audit trail · ${log.length} simulated events`
  const budgetCopy = liveSource
    ? 'The wrapper checks cumulative spent_amount against budget_ceiling before recording an agent trade. Exceeding the cap aborts the transaction on-chain.'
    : 'This budget is local demo state. It previews the cap a real RescuePolicyWrapper would enforce after minting.'
  const capabilityCopy = liveSource
    ? 'MoveGate authorizes only the RescueGrid protocol/action, and the wrapper then enforces pool, budget, slippage and linked mandate constraints.'
    : 'The demo shape previews MoveGate + Wrapper constraints. Real enforcement comes from the shared objects once minted.'
  const wrapperId = p._wrapperId || p.id
  const mandateId = p._mandateId || null
  const budgetCoin = p.budgetCoinType || 'DBUSDC'
  const poolId = p.poolId || p.scope.join(', ')
  const strategyHash = p.strategyHash || null
  const budgetUnits = Math.round(Number(p.budgetCap || 0) * 1_000_000)
  const spentUnits = Math.round(Number(p.budgetUsed || 0) * 1_000_000)
  const statusMeta = {
    active: { cls: 'badge-safe', label: 'active', pulse: true },
    revoked: { cls: 'badge-danger', label: 'revoked', pulse: false },
    expired: { cls: 'badge-warn', label: 'expired', pulse: false },
    paused: { cls: 'badge-neutral', label: 'paused', pulse: false },
  }[p.status] || { cls: 'badge-neutral', label: p.status || 'unknown', pulse: false }

  const protocols = [
    { name: 'Deepbook v3', kind: 'CLOB · spot', on: p.scope.length > 0, note: 'MVP executor adapter · target bound by pool_id' },
    { name: 'Cetus / Turbos / Momentum', kind: 'CLMM · LP', on: false, note: 'roadmap · watch first' },
    { name: 'NAVI / Suilend / Scallop', kind: 'lending', on: false, note: 'roadmap · health guardian' },
    { name: 'Bucket / AlphaLend / Current', kind: 'CDP · lending', on: false, note: 'roadmap · risk monitor' },
    { name: 'SpringSui / Haedal / Volo', kind: 'LST · vault', on: false, note: 'roadmap · watchtower' },
    { name: 'Bluefin / Sudo / DipCoin', kind: 'perps', on: false, note: 'roadmap · watch-only' },
  ]

  const structLines = [
    { t: 'public struct ', k: 'RescuePolicyWrapper', t2: ' has key, store {' },
    { indent: 1, key: 'id', val: `UID  // ${shortId(wrapperId)}` },
    { indent: 1, key: 'owner', val: `address  // ${p.owner ? shortId(p.owner) : RG.user.addr}` },
    { indent: 1, key: 'mandate_id', val: `ID  // ${mandateId ? shortId(mandateId) : 'MoveGate mandate'}` },
    { indent: 1, key: 'agent', val: `address  // ${p.agent ? shortId(p.agent) : 'deployment agent'}` },
    { indent: 1, key: 'pool_id', val: `ID  // ${shortId(poolId)}` },
    { indent: 1, key: 'budget_coin_type', val: `String  // ${budgetCoin}` },
    { indent: 1, key: 'budget_ceiling', val: `u64  // ${budgetUnits} (${p.budgetCap} USDC)` },
    { indent: 1, key: 'spent_amount', val: `u64  // ${spentUnits}` },
    { indent: 1, key: 'max_slippage_bps', val: `u16  // ${Math.round(p.maxSlippage * 100)}` },
    { indent: 1, key: 'strategy_hash', val: `vector<u8>  // ${strategyHash ? shortId(strategyHash) : 'confirmed intent hash'}` },
    { t: '}' },
    { t: 'linked ', k: 'MoveGate Mandate', t2: ' enforces agent, expiry, revocation, protocol/action allow-list' },
  ]

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'var(--overlay-backdrop)', backdropFilter: 'blur(3px)',
      display: 'flex', justifyContent: 'flex-end', animation: 'fadeUp .25s ease' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 540, maxWidth: '94vw', height: '100%', background: 'var(--bg-2)',
        borderLeft: '1px solid var(--border-hi)', overflowY: 'auto', boxShadow: 'var(--drawer-shadow)' }}>
        {/* header */}
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>{objectLabel}</div>
              <h2 className="display" style={{ fontSize: 19, fontWeight: 600 }}>{p.name}</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--sui)' }}>{p.id}</span>
                <span className="badge badge-neutral" style={{ fontSize: 9.5 }}><Icon name={p.mode === 'cloud' ? 'cloud' : 'cpu'} size={10} />{p.mode}</span>
                <span className={`badge ${sourceMeta.badgeClass || 'badge-neutral'}`} style={{ fontSize: 9.5 }}><Icon name={sourceMeta.icon || 'eye'} size={10} />{sourceMeta.label}</span>
                <span className={`badge ${statusMeta.cls}`} style={{ fontSize: 9.5 }}>
                  <span className={`dot ${statusMeta.pulse ? 'pulse' : ''}`}></span>{statusMeta.label}</span>
              </div>
            </div>
            <Button isIconOnly variant="light" size="sm" className="rg-btn-ghost" onPress={onClose} aria-label="Close"><Icon name="x" size={16} /></Button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {/* budget */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 7 }}>
              <span style={{ color: 'var(--t1)', fontWeight: 600 }}>{budgetLabel}</span>
              <span className="mono"><span style={{ color: 'var(--accent)', fontWeight: 700 }}>{p.budgetUsed}</span><span style={{ color: 'var(--t2)' }}> / {p.budgetCap} USDC · {pct}%</span></span>
            </div>
            <div style={{ height: 8, background: 'var(--bg-0)', borderRadius: 100, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', borderRadius: 100, background: pct > 80 ? 'var(--danger)' : 'linear-gradient(90deg,var(--accent),#1fc7b1)', boxShadow: pct > 80 ? 'none' : '0 0 12px var(--accent-glow)' }} />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 7 }}>
              {liveSource
                ? <>The agent calls <span className="mono" style={{ color: 'var(--t1)' }}>assert_within_budget()</span> before every order. Exceeding the cap aborts the transaction on-chain — it is impossible to overspend.</>
                : budgetCopy}
            </div>
          </div>

          {/* move struct */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>{structLabel}</div>
            <div style={{ background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px', fontFamily: 'var(--f-mono)', fontSize: 11.5, lineHeight: 1.7, overflowX: 'auto' }}>
              {structLines.map((l, i) => (
                <div key={i} style={{ paddingLeft: (l.indent || 0) * 18, whiteSpace: 'pre' }}>
                  {l.t && <span style={{ color: 'var(--sui)' }}>{l.t}</span>}
                  {l.k && <span style={{ color: 'var(--accent)' }}>{l.k}</span>}
                  {l.t2 && <span style={{ color: 'var(--t1)' }}>{l.t2}</span>}
                  {l.key && <><span style={{ color: 'var(--t0)' }}>{l.key}</span><span style={{ color: 'var(--t2)' }}>: </span><span style={{ color: 'var(--t2)' }}>{l.val}</span><span style={{ color: 'var(--t3)' }}>,</span></>}
                </div>
              ))}
            </div>
          </div>

          {/* capabilities */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Delegated capabilities</div>
            <div style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '4px 16px' }}>
              <CapRow granted label="Authorize rescue action" fn="movegate::mandate::authorize_action" />
              <div className="divider" />
              <CapRow granted label="Record bounded rescue trade" fn="policy::record_agent_trade" />
              <div className="divider" />
              <CapRow granted label="Consume AuthToken once" fn="movegate::receipt::create_success_receipt" />
              <div className="divider" />
              <CapRow granted={false} label="Trade any other pool" fn="wrapper.pool_id mismatch" />
              <div className="divider" />
              <CapRow granted={false} label="Transfer owner wallet assets" fn="transfer::public_transfer" />
              <div className="divider" />
              <CapRow granted={false} label="Execute after revoke or expiry" fn="MoveGate mandate check" />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 8 }}>{capabilityCopy}</div>
          </div>

          {/* protocol allow-list */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}>
              <span className="eyebrow">Protocol allow-list</span>
              <span style={{ fontSize: 11, color: 'var(--t2)' }}>scope is extensible per-policy</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {protocols.map(pr => (
                <div key={pr.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 'var(--r-sm)',
                  background: pr.on ? 'var(--accent-dim)' : 'var(--glass)', border: `1px solid ${pr.on ? 'var(--accent)' : 'var(--border)'}`, opacity: pr.on ? 1 : 0.55 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: pr.on ? 'var(--accent)' : 'var(--t3)', flexShrink: 0, boxShadow: pr.on ? '0 0 8px var(--accent-glow)' : 'none' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{pr.name}</div>
                    <div style={{ fontSize: 10.5, color: 'var(--t2)' }}>{pr.kind}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: pr.on ? 'var(--accent)' : 'var(--t3)', letterSpacing: '0.05em' }}>{pr.on ? 'ENABLED' : 'SOON'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* gas & signing */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>Gas &amp; signing</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 11, padding: '11px 13px', borderRadius: 'var(--r-sm)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--sui)', flexShrink: 0 }}><Icon name="wallet" size={16} /></span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{liveSource ? 'Owner signs create/revoke only' : 'Owner-signing model'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>
                    {liveSource
                      ? <>The Worker builds unsigned <span className="mono" style={{ color: 'var(--t1)' }}>tx_json</span>; your wallet signs create/revoke. The agent never receives your owner key.</>
                      : <>Demo mode previews the owner-signed create/revoke path. No authority exists until a real wallet signs the policy transaction.</>}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 11, padding: '11px 13px', borderRadius: 'var(--r-sm)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--warn)', flexShrink: 0 }}><Icon name="bolt" size={16} /></span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{liveSource ? 'Agent gas is explicit' : 'Execution gas model'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>{liveSource ? 'Autonomous execution needs the deployment agent to hold SUI gas plus funded DeepBook BalanceManager inventory; readiness checks block when either is missing.' : 'Demo mode spends no gas. Live execution requires agent gas and funded BalanceManager inventory.'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 11, padding: '11px 13px', borderRadius: 'var(--r-sm)', background: 'var(--glass)', border: '1px solid var(--border)' }}>
                <span style={{ color: 'var(--accent)', flexShrink: 0 }}><Icon name="target" size={16} /></span>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{liveSource ? 'Runtime watches DeepBook market data' : 'Trigger model'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 2 }}>
                    {liveSource
                      ? <>The Durable Object monitors the SUI/DBUSDC feed, then Guardian and the wrapper enforce budget, pool, slippage, revocation and expiry before submission.</>
                      : <>Demo mode previews the same trigger shape. Live checks rely on Worker market reads plus on-chain Mandate/Wrapper enforcement.</>}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* audit trail */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 9 }}>{auditLabel}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0, borderLeft: '2px solid var(--border)', paddingLeft: 16, marginLeft: 4 }}>
              {log.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--t2)' }}>{liveSource ? 'No on-chain events yet — the agent is monitoring.' : 'No simulated events yet in this demo policy.'}</div>}
              {log.map((a, i) => (
                <div key={i} style={{ position: 'relative', paddingBottom: i < log.length - 1 ? 16 : 0 }}>
                  <div style={{ position: 'absolute', left: -23, top: 3, width: 10, height: 10, borderRadius: '50%',
                    background: a.kind === 'exec' ? 'var(--accent)' : a.kind === 'guardian' ? 'var(--danger)' : 'var(--sui)', border: '2px solid var(--bg-2)' }} />
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--t2)', marginTop: 2 }}>{a.date} {a.t}{a.tx && <> · <span className="mono" onClick={() => onTx && onTx(a.tx)} style={{ color: 'var(--sui)', cursor: 'pointer' }}>{a.tx}</span></>}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* footer revoke */}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg-2)', borderTop: '1px solid var(--border)', padding: '16px 24px', display: 'flex', gap: 10 }}>
          <Button className="rg-btn-2 justify-center" style={{ flex: 1 }} onPress={onClose}>Close</Button>
          <Button className="bg-danger text-white" style={{ flex: 1 }} isDisabled={readOnly || p.status === 'revoked'} onPress={() => { onRevoke(p.id); onClose() }} startContent={<Icon name="x" size={15} stroke={2.4} />}>
            {readOnly ? 'Read-only mode' : p.status === 'revoked' ? 'Already revoked' : 'Revoke authority'}
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ---------- on-chain explorer drawer ---------- */
function coinMeta(ct) {
  if (!ct) return ['?', 0]
  if (ct.endsWith('::sui::SUI')) return ['SUI', 9]
  if (ct.includes('::DBUSDC::DBUSDC')) return ['USDC', 6]
  if (ct.endsWith('::deep::DEEP')) return ['DEEP', 6]
  if (ct.endsWith('::wal::WAL')) return ['WAL', 9]
  return [ct.split('::').pop(), 0]
}

export function TxDrawer({ tx, onClose }) {
  const txQuery = useTxDetail(tx)
  const data = txQuery.data || null
  const err = txQuery.isError ? String(txQuery.error?.message || txQuery.error) : null

  const short = (a) => (a ? a.slice(0, 6) + '…' + a.slice(-4) : '—')
  const explorer = `https://suiscan.xyz/testnet/tx/${tx}`
  const row = (k, v, mono) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
      <span style={{ fontSize: 12.5, color: 'var(--t2)' }}>{k}</span>
      <span className={mono ? 'mono' : ''} style={{ fontSize: 12.5, color: 'var(--t0)', textAlign: 'right', fontWeight: mono ? 600 : 500 }}>{v}</span>
    </div>
  )
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'var(--overlay-backdrop-strong)', backdropFilter: 'blur(3px)',
      display: 'flex', justifyContent: 'flex-end', animation: 'fadeUp .22s ease' }}>
    <div onClick={e => e.stopPropagation()} style={{ width: 500, maxWidth: '94vw', height: '100%', background: 'var(--bg-2)',
        borderLeft: '1px solid var(--border-hi)', overflowY: 'auto', boxShadow: 'var(--drawer-shadow)' }}>
        <div style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-2)', borderBottom: '1px solid var(--border)', padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Sui · transaction</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }}>{tx}</span>
                {data && <span className={`badge ${data.success ? 'badge-safe' : 'badge-warn'}`}><span className="dot"></span>{data.success ? 'Success' : 'Failed'}</span>}
                {!data && !err && <span className="badge badge-neutral"><span className="dot"></span>Loading…</span>}
                {err && <span className="badge badge-warn"><span className="dot"></span>Unavailable</span>}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--t2)', marginTop: 5 }}>
                Testnet{data?.checkpoint ? ` · checkpoint ${data.checkpoint.toLocaleString()}` : ''}
              </div>
            </div>
            <Button isIconOnly variant="light" size="sm" className="rg-btn-ghost" onPress={onClose} aria-label="Close"><Icon name="x" size={16} /></Button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 22 }}>
          {!data && !err && <div style={{ fontSize: 12.5, color: 'var(--t2)' }}>Decoding transaction from chain…</div>}
          {err && (
            <div style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Could not load this transaction</div>
              <div style={{ fontSize: 11.5, color: 'var(--t2)' }}>{err}. It may be older than the fullnode's retention window, or a demo record. You can still open it on the explorer below.</div>
            </div>
          )}
          {data && (
            <>
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Overview</div>
                <div>
                  {row('Executed by', <span className="mono" style={{ color: 'var(--sui)' }}>{short(data.sender)}</span>)}
                  {row('Gas used', `${data.gasSui.toFixed(6)} SUI`, true)}
                  {row('Gas paid by', data.gasOwner === data.sender ? 'signer (self)' : short(data.gasOwner))}
                  {row('Timestamp', data.timestampMs ? new Date(data.timestampMs).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—')}
                </div>
              </div>

              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Programmable transaction block · {data.calls.length} call{data.calls.length === 1 ? '' : 's'}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {data.calls.length === 0 && <div style={{ fontSize: 12, color: 'var(--t2)' }}>No Move calls in this transaction.</div>}
                  {data.calls.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg-0)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                      <span className="mono" style={{ fontSize: 10, color: 'var(--t2)' }}>#{i + 1}</span>
                      <span style={{ width: 16, height: 16, borderRadius: 5, background: 'var(--safe-dim)', color: 'var(--safe)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Icon name="check" size={10} stroke={2.8} /></span>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--t0)', wordBreak: 'break-all' }}>{c.target}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Events emitted · {data.events.length}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {data.events.length === 0 && <div style={{ fontSize: 12, color: 'var(--t2)' }}>No events emitted.</div>}
                  {data.events.map((e, i) => (
                    <div key={i} style={{ background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }}>{e.type}</span>
                      {e.data && <div className="mono" style={{ fontSize: 11, color: 'var(--t1)', marginTop: 4, wordBreak: 'break-all' }}>{e.data}</div>}
                    </div>
                  ))}
                </div>
              </div>

              {data.balanceChanges.length > 0 && (
                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>Balance changes</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                    {data.balanceChanges.map((b, i) => {
                      const [sym, dec] = coinMeta(b.coinType)
                      const amt = Number(b.amount) / 10 ** dec
                      const up = amt >= 0
                      return (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', background: 'var(--glass)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px' }}>
                          <span className="mono" style={{ fontSize: 11.5, color: 'var(--t1)' }}>{short(b.owner)}</span>
                          <span className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: up ? 'var(--safe)' : 'var(--danger)' }}>{up ? '+' : ''}{amt.toLocaleString(undefined, { maximumFractionDigits: dec })} {sym}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          <Button className="rg-btn-2 justify-center" onPress={() => window.open(explorer, '_blank', 'noopener,noreferrer')} startContent={<Icon name="link" size={14} />}>
            View on SuiScan
          </Button>
        </div>
      </div>
    </div>
  )
}
