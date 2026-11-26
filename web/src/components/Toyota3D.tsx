import { useEffect, useRef, useState } from 'react'

export type ToyotaModelId = 'yaris' | 'yaris-cross' | 'corolla' | 'chr' | 'rav4'

type ModelSpec = {
  id: ToyotaModelId
  name: string
  segment: string
  sketchfabUid: string
  modelTitle: string
  modelUrl: string
  author: string
  authorUrl: string
}

export const TOYOTA_MODELS: ModelSpec[] = [
  {
    id: 'yaris',
    name: 'Yaris',
    segment: 'Hybrid Hatchback',
    sketchfabUid: 'b702373da1274645a8c57da1cac8bf4d',
    modelTitle: 'Toyota Yaris 2020',
    modelUrl: 'https://sketchfab.com/3d-models/toyota-yaris-2020-b702373da1274645a8c57da1cac8bf4d',
    author: 'SQUIR3D',
    authorUrl: 'https://sketchfab.com/SQUIR3D',
  },
  {
    id: 'yaris-cross',
    name: 'Yaris Cross',
    segment: 'Compact SUV',
    sketchfabUid: 'cacdb1efe9244b2597611e24c7820b84',
    modelTitle: 'Toyota Yaris Cross 2021',
    modelUrl: 'https://sketchfab.com/3d-models/toyota-yaris-cross-2021-cacdb1efe9244b2597611e24c7820b84',
    author: 'SQUIR3D',
    authorUrl: 'https://sketchfab.com/SQUIR3D',
  },
  {
    id: 'corolla',
    name: 'Corolla',
    segment: 'Hybrid',
    sketchfabUid: '6d7d34ee42734d1ab28a6b1f1c5fc4fc',
    modelTitle: 'Toyota Corolla 2020',
    modelUrl: 'https://sketchfab.com/3d-models/toyota-corolla-2020-6d7d34ee42734d1ab28a6b1f1c5fc4fc',
    author: 'ItsDiyor',
    authorUrl: 'https://sketchfab.com/ItsDiyor',
  },
  {
    id: 'chr',
    name: 'C-HR',
    segment: 'Coupe Crossover',
    sketchfabUid: 'f426a2f495fc41c8aaef33574d232567',
    modelTitle: 'Toyota C-HR GR sport 2021',
    modelUrl: 'https://sketchfab.com/3d-models/toyota-c-hr-gr-sport-2021-f426a2f495fc41c8aaef33574d232567',
    author: 'SQUIR3D',
    authorUrl: 'https://sketchfab.com/SQUIR3D',
  },
  {
    id: 'rav4',
    name: 'RAV4',
    segment: 'Hybrid SUV',
    sketchfabUid: 'ed155ad0cb7d447085a519eaff9aa2df',
    modelTitle: '2023 Toyota RAV4 Hybrid',
    modelUrl: 'https://sketchfab.com/3d-models/2023-toyota-rav4-hybrid-ed155ad0cb7d447085a519eaff9aa2df',
    author: 'Ddiaz Design',
    authorUrl: 'https://sketchfab.com/ddiaz-design',
  },
]

export type PaintColor = {
  id: string
  name: string
  hex: string
}

export const TOYOTA_COLORS: PaintColor[] = [
  { id: 'original', name: 'Factory', hex: 'linear-gradient(135deg, #cbd5e1 0%, #475569 100%)' },
  { id: 'silver', name: 'Silver Metallic', hex: '#b8c2cc' },
  { id: 'white', name: 'Pearl White', hex: '#edf2f7' },
  { id: 'grey', name: 'Ash Grey', hex: '#5a6370' },
  { id: 'black', name: 'Obsidian Black', hex: '#1c2026' },
  { id: 'red', name: 'Tokyo Red', hex: '#b91c1c' },
  { id: 'blue', name: 'Juniper Blue', hex: '#1d4ed8' },
  { id: 'bronze', name: 'Oxide Bronze', hex: '#856d52' },
]

function hexToLinearRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return [toLinear(r), toLinear(g), toLinear(b)]
}

export function detectToyotaModel(raw?: string | null): ToyotaModelId {
  const s = (raw ?? '').toLowerCase()
  if (s.includes('yaris cross')) return 'yaris-cross'
  if (s.includes('corolla')) return 'corolla'
  if (s.includes('c-hr') || s.includes('chr')) return 'chr'
  if (s.includes('rav4') || s.includes('rav 4')) return 'rav4'
  return 'yaris'
}

function detectPaintId(raw?: string | null): string {
  const s = (raw ?? '').toLowerCase()
  if (s.includes('silver')) return 'silver'
  if (s.includes('white') || s.includes('pearl')) return 'white'
  if (s.includes('black') || s.includes('obsidian')) return 'black'
  if (s.includes('red') || s.includes('scarlet') || s.includes('coral')) return 'red'
  if (s.includes('blue') || s.includes('cyan') || s.includes('teal')) return 'blue'
  if (s.includes('bronze') || s.includes('brown') || s.includes('sand')) return 'bronze'
  if (s.includes('grey') || s.includes('gray') || s.includes('ash')) return 'grey'
  return 'original'
}

type SketchfabChannel = {
  color?: [number, number, number]
  enable?: boolean
  factor?: number
  texture?: unknown
  tint?: [number, number, number]
}

type SketchfabMaterial = {
  name?: string
  channels?: {
    AlbedoPBR?: SketchfabChannel
    DiffusePBR?: SketchfabChannel
    DiffuseColor?: SketchfabChannel
    ClearCoat?: SketchfabChannel
    MetalnessPBR?: SketchfabChannel
    RoughnessPBR?: SketchfabChannel
    GlossinessPBR?: SketchfabChannel
    Opacity?: SketchfabChannel
  }
}

type SketchfabApi = {
  start: () => void
  addEventListener: (ev: string, cb: () => void) => void
  getMaterialList: (cb: (err: unknown, mats: SketchfabMaterial[]) => void) => void
  setMaterial: (mat: SketchfabMaterial, cb?: () => void) => void
}

declare global {
  interface Window {
    Sketchfab?: new (iframe: HTMLIFrameElement) => {
      init: (uid: string, opts: Record<string, unknown>) => void
    }
  }
}

let sdkPromise: Promise<void> | null = null
function loadSketchfabSdk(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if (window.Sketchfab) return Promise.resolve()
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://static.sketchfab.com/api/sketchfab-viewer-1.12.1.js'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Sketchfab SDK'))
    document.head.appendChild(s)
  })
  return sdkPromise
}

const EXCLUDE_MAT_RE = /(glass|window|windshield|windscreen|tire|tyre|rubber|wheel|rim|alloy|brake|caliper|disc|light|lamp|led|headlight|taillight|fog|indicator|grille|grill|trim|plastic|interior|seat|dash|steering|mirror|chrome|logo|badge|emblem|plate|number|exhaust|carbon|shadow|floor|ground|plane|wiper|antenna|underbody|matte|black)/

function pickPaintMaterials(mats: SketchfabMaterial[]): SketchfabMaterial[] {
  const candidates = mats.filter((m) => {
    const n = (m.name ?? '').toLowerCase()
    if (EXCLUDE_MAT_RE.test(n)) return false
    const op = m.channels?.Opacity
    if (op?.enable && (op.factor ?? 1) < 0.95) return false
    return true
  })

  const explicit = candidates.filter((m) =>
    /(car_?paint|paint|bodywork|body_?shell|exterior|lacquer|varnish|body)/.test((m.name ?? '').toLowerCase()),
  )
  if (explicit.length > 0) return explicit

  return candidates.filter((m) => {
    const rough = m.channels?.RoughnessPBR?.factor
    const gloss = m.channels?.GlossinessPBR?.factor
    return (rough != null && rough < 0.38) || (gloss != null && gloss > 0.62)
  })
}

type SavedChannels = Record<string, { color?: [number, number, number]; texture?: unknown; tint?: [number, number, number] } | undefined>

export function Toyota3D({
  modelId,
  colorName,
}: {
  modelId: ToyotaModelId
  colorName?: string | null
}) {
  const spec = TOYOTA_MODELS.find((m) => m.id === modelId) ?? TOYOTA_MODELS[0]!
  const [pickedColor, setPickedColor] = useState<string | null>(null)
  const activeColorId = pickedColor ?? detectPaintId(colorName)
  const activeColor = TOYOTA_COLORS.find((c) => c.id === activeColorId) ?? TOYOTA_COLORS[0]!

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const apiRef = useRef<SketchfabApi | null>(null)
  const paintMatsRef = useRef<{ mat: SketchfabMaterial; orig: SavedChannels }[]>([])
  const activeColorRef = useRef(activeColor)
  activeColorRef.current = activeColor

  const applyColor = (color: PaintColor) => {
    const sfApi = apiRef.current
    if (!sfApi || paintMatsRef.current.length === 0) return
    const rgb = color.id === 'original' ? null : hexToLinearRgb(color.hex)
    for (const { mat, orig } of paintMatsRef.current) {
      const ch = mat.channels
      if (!ch) continue
      let changed = false
      for (const key of ['AlbedoPBR', 'DiffusePBR', 'DiffuseColor'] as const) {
        const c = ch[key]
        if (!c || c.enable === false) continue
        if (rgb) {
          c.color = [...rgb] as [number, number, number]
          if (c.texture) delete c.texture
          changed = true
        } else if (orig[key]) {
          if (orig[key].color) c.color = [...orig[key].color] as [number, number, number]
          if (orig[key].texture) c.texture = orig[key].texture
          changed = true
        }
      }
      if (ch.ClearCoat?.tint) {
        if (rgb) {
          ch.ClearCoat.tint = [1, 1, 1]
          changed = true
        } else if (orig.ClearCoat?.tint) {
          ch.ClearCoat.tint = [...orig.ClearCoat.tint] as [number, number, number]
          changed = true
        }
      }
      if (changed) sfApi.setMaterial(mat, () => {})
    }
  }

  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    let cancelled = false
    apiRef.current = null
    paintMatsRef.current = []

    loadSketchfabSdk()
      .then(() => {
        if (cancelled || !window.Sketchfab || !iframeRef.current) return
        const client = new window.Sketchfab(iframeRef.current)
        client.init(spec.sketchfabUid, {
          autostart: 1,
          autospin: 0.2,
          ui_theme: 'dark',
          transparent: 1,
          ui_controls: 0,
          ui_infos: 0,
          ui_watermark: 0,
          ui_hint: 0,
          ui_ar: 0,
          ui_help: 0,
          ui_settings: 0,
          ui_vr: 0,
          ui_annotations: 0,
          ui_stop: 0,
          scrollwheel: 0,
          preload: 1,
          success: (sfApi: SketchfabApi) => {
            if (cancelled) return
            sfApi.start()
            sfApi.addEventListener('viewerready', () => {
              if (cancelled) return
              apiRef.current = sfApi
              sfApi.getMaterialList((err, mats) => {
                if (err || cancelled) return
                const picked = pickPaintMaterials(mats)
                paintMatsRef.current = picked.map((mat) => ({
                  mat,
                  orig: {
                    AlbedoPBR: mat.channels?.AlbedoPBR
                      ? { color: mat.channels.AlbedoPBR.color ? [...mat.channels.AlbedoPBR.color] as [number, number, number] : undefined, texture: mat.channels.AlbedoPBR.texture }
                      : undefined,
                    DiffusePBR: mat.channels?.DiffusePBR
                      ? { color: mat.channels.DiffusePBR.color ? [...mat.channels.DiffusePBR.color] as [number, number, number] : undefined, texture: mat.channels.DiffusePBR.texture }
                      : undefined,
                    DiffuseColor: mat.channels?.DiffuseColor
                      ? { color: mat.channels.DiffuseColor.color ? [...mat.channels.DiffuseColor.color] as [number, number, number] : undefined, texture: mat.channels.DiffuseColor.texture }
                      : undefined,
                    ClearCoat: mat.channels?.ClearCoat?.tint
                      ? { tint: [...mat.channels.ClearCoat.tint] as [number, number, number] }
                      : undefined,
                  },
                }))
                if (activeColorRef.current.id !== 'original') {
                  applyColor(activeColorRef.current)
                }
              })
            })
          },
        })
      })
      .catch(() => { /* fallback to iframe */ })

    return () => { cancelled = true }
  }, [spec.sketchfabUid])

  useEffect(() => {
    applyColor(activeColor)
  }, [activeColor])

  const selectColor = (id: string) => {
    setPickedColor(id)
  }

  return (
    <section className="panel p-4 flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="eyebrow text-ink">Toyota {spec.name}</span>
          <span className="chip">{spec.segment}</span>
        </div>

        <div className="flex items-center gap-2">
          <span className="small hidden sm:inline">
            {activeColor.id === 'original' ? 'Factory' : activeColor.name}
          </span>
          <div className="flex items-center gap-1.5">
            {TOYOTA_COLORS.map((c) => (
              <button
                key={c.id}
                type="button"
                title={c.name}
                aria-label={`Color ${c.name}`}
                aria-pressed={activeColor.id === c.id}
                onClick={() => selectColor(c.id)}
                className={`h-4 w-4 rounded-full border transition-transform ${
                  activeColor.id === c.id ? 'scale-125 border-ev ring-2 ring-ev/40' : 'border-white/30 hover:scale-110'
                }`}
                style={{ background: c.hex }}
              />
            ))}
          </div>
        </div>
      </header>

      <div className="relative h-72 sm:h-[360px] w-full rounded-xl overflow-hidden border border-line bg-[#0b1017]">
        <iframe
          ref={iframeRef}
          key={spec.sketchfabUid}
          title={`3D model of Toyota ${spec.name}`}
          className="h-full w-full border-0"
          allow="autoplay; fullscreen; xr-spatial-tracking"
          allowFullScreen
        />
      </div>

      <div className="flex items-center justify-between gap-2 small">
        <span>
          3D model:{' '}
          <a href={spec.modelUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink">
            {spec.modelTitle}
          </a>{' '}
          by{' '}
          <a href={spec.authorUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink">
            {spec.author}
          </a>{' '}
          on Sketchfab
        </span>
      </div>
    </section>
  )
}
