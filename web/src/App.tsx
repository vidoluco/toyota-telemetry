import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { api } from './api/client'
import type { Settings } from './api/types'
import { RangePicker } from './components/RangePicker'
import { clearApiCache, useApi } from './lib/useApi'
import { Commute } from './pages/Commute'
import { Driver } from './pages/Driver'
import { Insights } from './pages/Insights'
import { Places } from './pages/Places'
import { Tank } from './pages/Tank'
import { MapPage } from './pages/MapPage'
import { Overview } from './pages/Overview'
import { TripDetail } from './pages/TripDetail'
import { Trips } from './pages/Trips'

const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const spring = { type: 'spring', bounce: 0, duration: 0.35 } as const

export default function App() {
  const loc = useLocation()
  const isMap = loc.pathname.startsWith('/map')
  return (
    <div className="h-full flex flex-col">
      <TopBar />
      <main className={isMap ? 'flex-1 min-h-0 relative' : 'flex-1 min-h-0 overflow-auto'}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={loc.pathname}
            className={isMap ? 'absolute inset-0' : 'max-w-[1400px] mx-auto px-5 py-5'}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -4 }}
            transition={spring}
          >
            <Routes location={loc}>
              <Route path="/" element={<Overview />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/trips" element={<Trips />} />
              <Route path="/trips/:id" element={<TripDetail />} />
              <Route path="/driver" element={<Driver />} />
              <Route path="/places" element={<Places />} />
              <Route path="/commute/:from/:to" element={<Commute />} />
              <Route path="/tank" element={<Tank />} />
              <Route path="/insights" element={<Insights />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}

/** "2022 Toyota Yaris - NG '20" -> "Yaris": the model, without the marketing. */
function shortModel(model?: string | null): string | null {
  if (!model) return null
  const cleaned = model.replace(/^\d{4}\s+/, '').replace(/^Toyota\s+/i, '').split(/\s+[-–]\s+/)[0] ?? model
  return cleaned.trim() || model
}

function priceTitle(s?: Settings): string {
  switch (s?.fuel_price_source) {
    case 'fills': return `Average of ${s.fuel_price_fills} fills in your tank log`
    case 'env': return 'Price seeded from TOYOTA_FUEL_PRICE in .env'
    case 'default': return 'Never set: every cost is a placeholder until you enter your real price'
    default: return 'Price you set by hand'
  }
}

function TopBar() {
  const { data: vehicle } = useApi('vehicle', () => api.vehicle())
  const year = vehicle?.manufactured?.slice(0, 4)
  return (
    <header className="material sticky top-0 z-30 border-x-0 border-t-0 rounded-none">
      <div className="max-w-[1400px] mx-auto px-5 h-14 flex items-center gap-4">
        <NavLink to="/" className="flex items-baseline gap-2 mr-2" title={vehicle?.model ?? undefined}>
          <span className="title">{shortModel(vehicle?.model) ?? 'Toyota'}</span>
          <span className="small hidden sm:inline">{[year, vehicle?.color].filter(Boolean).join(' · ')}</span>
        </NavLink>
        <nav className="flex items-center gap-0.5 text-sm">
          {([['/', 'Overview'], ['/map', 'Map'], ['/trips', 'Trips'], ['/places', 'Places'], ['/driver', 'Driver'], ['/tank', 'Tank'], ['/insights', 'Insights']] as [string, string][]).map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>{label}</NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <RangePicker />
          <SettingsButton />
          <SyncButton />
        </div>
      </div>
    </header>
  )
}

function SettingsButton() {
  const { data: settings, reload } = useApi('settings', () => api.settings())
  const [open, setOpen] = useState(false)
  const [price, setPrice] = useState<string | null>(null)
  const [currency, setCurrency] = useState<string | null>(null)
  const save = async () => {
    if (price != null || currency != null) {
      await api.saveSettings({
        ...(price != null ? { fuel_price: Number(price) } : {}),
        ...(currency != null ? { currency: currency.trim().toUpperCase() } : {}),
      })
      clearApiCache(); reload()
    }
    setOpen(false)
  }
  return (
    <div className="relative">
      <button className="btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        title={priceTitle(settings)}>
        <span className="num">{settings ? `${settings.fuel_price.toFixed(2)} ${settings.currency}/l` : '…'}</span>
        {settings?.fuel_price_source === 'fills' && <span className="chip !py-0" style={{ color: '#2ee6b7' }}>avg</span>}
        {settings?.fuel_price_source === 'default' && <span className="chip !py-0" style={{ color: '#ffb224' }}>default</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="material absolute right-0 mt-2 p-3 rounded-xl w-56 origin-top-right"
            initial={reduced ? false : { opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
            exit={reduced ? undefined : { opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
            transition={spring}
          >
            <div className="eyebrow mb-2">Fuel price per litre</div>
            <div className="flex gap-2">
              <input className="field flex-1" type="number" step="0.01" aria-label="Fuel price per litre"
                defaultValue={settings?.fuel_price_manual} onChange={(e) => setPrice(e.target.value)} />
              <input className="field w-16" type="text" maxLength={3} aria-label="Currency"
                defaultValue={settings?.currency} onChange={(e) => setCurrency(e.target.value)} />
              <button className="btn on" onClick={save}>Save</button>
            </div>
            <div className="small mt-2">
              {settings?.fuel_price_source === 'fills'
                ? `Costs use ${settings.fuel_price.toFixed(2)} ${settings.currency}/l, the litre-weighted average of the ${settings.fuel_price_fills} fills you logged. This box is the fallback for when there are none.`
                : settings?.fuel_price_source === 'default'
                  ? 'Nobody has set this, so every cost on the dashboard is a placeholder. Type the price you actually pay, or set TOYOTA_FUEL_PRICE and TOYOTA_CURRENCY in .env.'
                  : 'Used for every cost figure. Once you log fills with their price in the tank log, the average of those replaces it.'}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SyncButton() {
  const { data: demo } = useApi('demo', () => api.isDemo())
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')
  const run = async () => {
    setState('busy'); setMsg('Talking to Toyota…')
    try {
      const r = await api.sync(14)
      clearApiCache()
      setMsg(`${r.new_trips} new, ${r.updated_trips} refreshed`)
      setState('done')
      setTimeout(() => window.location.reload(), 1200)
    } catch (e) { setState('error'); setMsg((e as Error).message) }
  }
  return (
    <div className="relative">
      <button className="btn" onClick={run} disabled={state === 'busy' || !!demo?.demo}
        title={demo?.demo ? 'Demo data: connect a car and run toyota sync' : 'Pull the last two weeks from Toyota'}>{state === 'busy' ? 'Syncing…' : demo?.demo ? 'Demo data' : 'Sync now'}</button>
      <AnimatePresence>
        {state !== 'idle' && msg && (
          <motion.div className="material absolute right-0 mt-2 px-3 py-2 rounded-xl text-xs whitespace-nowrap"
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={spring}>
            {msg}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
