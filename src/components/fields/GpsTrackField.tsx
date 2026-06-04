/**
 * GpsTrackField — GPS path recording + landmark drops + area calculation.
 * Pure browser APIs only:
 *   - navigator.geolocation.watchPosition  (continuous tracking)
 *   - OpenStreetMap tiles                  (free map, no API key)
 *   - Shoelace formula                     (area from polygon vertices)
 *   - Haversine formula                    (distance)
 *   - navigator.wakeLock                   (keep screen on)
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { MapPin, Play, Square, Navigation, RefreshCw, AlertTriangle, Plus, X } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GpsPoint {
  lat: number;
  lng: number;
  accuracy: number;
  ts: number;
}

export interface Landmark {
  id: string;
  lat: number;
  lng: number;
  type: string;
  label: string;
  ts: number;
}

export interface GpsTrackData {
  points: GpsPoint[];
  landmarks: Landmark[];
  startTime: number;
  endTime: number;
  distanceM: number;
  areaM2: number;
  durationMs: number;
  centroid: { lat: number; lng: number };
}

const LANDMARK_TYPES = [
  { id: "house",    emoji: "🏠", label: "House / Household" },
  { id: "well",     emoji: "💧", label: "Water source / Well" },
  { id: "school",   emoji: "🏫", label: "School / Anganwadi" },
  { id: "health",   emoji: "🏥", label: "Health facility" },
  { id: "temple",   emoji: "⛪", label: "Temple / Mosque / Church" },
  { id: "road",     emoji: "🔀", label: "Road junction" },
  { id: "field",    emoji: "🌾", label: "Agricultural field" },
  { id: "hazard",   emoji: "⚠️", label: "Hazard / Problem area" },
  { id: "toilet",   emoji: "🚽", label: "Toilet / Sanitation" },
  { id: "waste",    emoji: "🗑️", label: "Waste dump site" },
  { id: "other",    emoji: "📍", label: "Other landmark" },
];

// ── Math ──────────────────────────────────────────────────────────────────────

function haversineM(a: GpsPoint, b: GpsPoint): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function totalDistance(pts: GpsPoint[]): number {
  return pts.slice(1).reduce((d, p, i) => d + haversineM(pts[i], p), 0);
}

function shoelaceAreaM2(pts: GpsPoint[]): number {
  if (pts.length < 3) return 0;
  const R = 6371000;
  const mPerDegLat = R * Math.PI / 180;
  const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
  const mPerDegLng = mPerDegLat * Math.cos(lat0 * Math.PI / 180);
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].lng * mPerDegLng * pts[j].lat * mPerDegLat;
    area -= pts[j].lng * mPerDegLng * pts[i].lat * mPerDegLat;
  }
  return Math.abs(area) / 2;
}

function calcCentroid(pts: GpsPoint[]) {
  return {
    lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length,
    lng: pts.reduce((s, p) => s + p.lng, 0) / pts.length,
  };
}

export function fmtArea(m2: number): string {
  if (m2 < 1000) return `${m2.toFixed(0)} m²`;
  if (m2 < 1_000_000) return `${(m2 / 10000).toFixed(3)} ha  ·  ${(m2 / 4047).toFixed(2)} acres`;
  return `${(m2 / 1_000_000).toFixed(4)} km²  ·  ${(m2 / 4047).toFixed(1)} acres`;
}

export function fmtDist(m: number): string {
  return m < 1000 ? `${m.toFixed(0)} m` : `${(m / 1000).toFixed(2)} km`;
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ── OSM tile helpers ──────────────────────────────────────────────────────────

function latLngToTileXY(lat: number, lng: number, zoom: number) {
  const n = 2 ** zoom;
  const x = Math.floor((lng + 180) / 360 * n);
  const latR = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n);
  return { x, y };
}

function tileToLatLng(x: number, y: number, zoom: number) {
  const n = 2 ** zoom;
  return {
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI,
    lng: x / n * 360 - 180,
  };
}

function autoZoom(pts: GpsPoint[]): number {
  if (pts.length === 0) return 16;
  const spread = Math.max(
    Math.max(...pts.map((p) => p.lat)) - Math.min(...pts.map((p) => p.lat)),
    Math.max(...pts.map((p) => p.lng)) - Math.min(...pts.map((p) => p.lng)),
  );
  if (spread < 0.0005) return 18;
  if (spread < 0.002) return 17;
  if (spread < 0.008) return 16;
  if (spread < 0.03) return 15;
  if (spread < 0.1) return 14;
  return 13;
}

// ── Map drawing ───────────────────────────────────────────────────────────────

async function drawMap(
  canvas: HTMLCanvasElement,
  pts: GpsPoint[],
  landmarks: Landmark[],
  finished: boolean,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#f0efe9";
  ctx.fillRect(0, 0, W, H);

  if (pts.length === 0) {
    ctx.fillStyle = "#999";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Map will appear here as you walk", W / 2, H / 2);
    return;
  }

  const zoom = autoZoom(pts);
  const allLat = pts.map((p) => p.lat);
  const allLng = pts.map((p) => p.lng);
  const padFrac = 0.25;
  const dLat = (Math.max(...allLat) - Math.min(...allLat)) || 0.001;
  const dLng = (Math.max(...allLng) - Math.min(...allLng)) || 0.001;
  const viewMinLat = Math.min(...allLat) - dLat * padFrac;
  const viewMaxLat = Math.max(...allLat) + dLat * padFrac;
  const viewMinLng = Math.min(...allLng) - dLng * padFrac;
  const viewMaxLng = Math.max(...allLng) + dLng * padFrac;

  const tl = latLngToTileXY(viewMaxLat, viewMinLng, zoom);
  const br = latLngToTileXY(viewMinLat, viewMaxLng, zoom);
  const txRange = br.x - tl.x + 1;
  const tyRange = br.y - tl.y + 1;

  // Load OSM tiles
  if (txRange * tyRange <= 16) {
    const tileW = W / txRange;
    const tileH = H / tyRange;
    await Promise.all(
      Array.from({ length: txRange }, (_, xi) =>
        Array.from({ length: tyRange }, (_, yi) => {
          const tx = tl.x + xi;
          const ty = tl.y + yi;
          return new Promise<void>((res) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            const sub = ["a", "b", "c"][(tx + ty) % 3];
            img.src = `https://${sub}.tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`;
            img.onload = () => { ctx.drawImage(img, xi * tileW, yi * tileH, tileW, tileH); res(); };
            img.onerror = () => res();
            setTimeout(res, 3000);
          });
        })
      ).flat()
    );
  }

  const tlPx = tileToLatLng(tl.x, tl.y, zoom);
  const brPx = tileToLatLng(br.x + 1, br.y + 1, zoom);
  const toXY = (lat: number, lng: number) => ({
    x: (lng - tlPx.lng) / (brPx.lng - tlPx.lng) * W,
    y: (lat - tlPx.lat) / (brPx.lat - tlPx.lat) * H,
  });

  // Filled polygon
  if (finished && pts.length >= 3) {
    ctx.beginPath();
    const { x, y } = toXY(pts[0].lat, pts[0].lng);
    ctx.moveTo(x, y);
    pts.forEach((p) => { const { x, y } = toXY(p.lat, p.lng); ctx.lineTo(x, y); });
    ctx.closePath();
    ctx.fillStyle = "rgba(255,225,124,0.4)";
    ctx.fill();
    ctx.strokeStyle = "#b8860b";
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    ctx.stroke();
  }

  // Path line
  if (pts.length >= 2) {
    ctx.beginPath();
    ctx.setLineDash(finished ? [] : [6, 3]);
    ctx.strokeStyle = finished ? "#171E19" : "#ef4444";
    ctx.lineWidth = 3;
    const { x, y } = toXY(pts[0].lat, pts[0].lng);
    ctx.moveTo(x, y);
    pts.forEach((p) => { const { x, y } = toXY(p.lat, p.lng); ctx.lineTo(x, y); });
    if (finished) ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Start marker (green circle)
  const s = toXY(pts[0].lat, pts[0].lng);
  ctx.beginPath(); ctx.arc(s.x, s.y, 8, 0, Math.PI * 2);
  ctx.fillStyle = "#22c55e"; ctx.fill();
  ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("S", s.x, s.y + 4);

  // End/current marker
  if (pts.length > 1) {
    const e = toXY(pts[pts.length - 1].lat, pts[pts.length - 1].lng);
    ctx.beginPath(); ctx.arc(e.x, e.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = finished ? "#171E19" : "#ef4444"; ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(finished ? "E" : "↑", e.x, e.y + 4);
  }

  // Landmark pins
  landmarks.forEach((lm) => {
    const lmType = LANDMARK_TYPES.find((t) => t.id === lm.type);
    const emoji = lmType?.emoji ?? "📍";
    const { x, y } = toXY(lm.lat, lm.lng);
    // Pin circle
    ctx.beginPath(); ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fillStyle = "#fff"; ctx.fill();
    ctx.strokeStyle = "#171E19"; ctx.lineWidth = 2; ctx.stroke();
    // Emoji
    ctx.font = "13px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(emoji, x, y + 5);
    // Label bubble
    const shortLabel = lm.label.length > 12 ? lm.label.slice(0, 12) + "…" : lm.label;
    const tw = ctx.measureText(shortLabel).width + 8;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(x - tw / 2, y - 28, tw, 14);
    ctx.strokeStyle = "#ccc"; ctx.lineWidth = 1;
    ctx.strokeRect(x - tw / 2, y - 28, tw, 14);
    ctx.fillStyle = "#333"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center";
    ctx.fillText(shortLabel, x, y - 18);
  });

  // Attribution
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillRect(0, H - 16, W, 16);
  ctx.fillStyle = "#555"; ctx.font = "9px sans-serif"; ctx.textAlign = "left";
  ctx.fillText("© OpenStreetMap contributors", 4, H - 4);
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  value: GpsTrackData | undefined;
  onChange: (v: GpsTrackData | undefined) => void;
  readOnly?: boolean;
}

export function GpsTrackField({ value, onChange, readOnly }: Props) {
  const [tracking, setTracking] = useState(false);
  const [points, setPoints] = useState<GpsPoint[]>(value?.points ?? []);
  const [landmarks, setLandmarks] = useState<Landmark[]>(value?.landmarks ?? []);
  const [startTime, setStartTime] = useState<number | null>(value ? value.startTime : null);
  const [elapsed, setElapsed] = useState(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(!!value);
  const [showLandmarkPicker, setShowLandmarkPicker] = useState(false);
  const [landmarkLabel, setLandmarkLabel] = useState("");
  const [pendingLandmarkType, setPendingLandmarkType] = useState<string | null>(null);
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const watchRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (canvasRef.current) drawMap(canvasRef.current, points, landmarks, done).catch(() => {});
  }, [points, landmarks, done]);

  useEffect(() => {
    if (tracking && startTime) {
      timerRef.current = setInterval(() => setElapsed(Date.now() - startTime), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [tracking, startTime]);

  const start = useCallback(async () => {
    if (!("geolocation" in navigator)) { setError("GPS not available on this device."); return; }
    setError(null); setPoints([]); setLandmarks([]); setDone(false);
    const now = Date.now();
    setStartTime(now); setTracking(true);
    try {
      if ("wakeLock" in navigator) {
        // @ts-ignore
        wakeLockRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {}
    let lastPt: GpsPoint | null = null;
    watchRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const pt: GpsPoint = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, ts: pos.timestamp };
        setAccuracy(pt.accuracy);
        setCurrentPos({ lat: pt.lat, lng: pt.lng });
        if (pt.accuracy > 100) return;
        if (lastPt && haversineM(lastPt, pt) < 3) return;
        lastPt = pt;
        setPoints((prev) => [...prev, pt]);
      },
      (err) => setError(`GPS error: ${err.message}`),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );
  }, []);

  const stop = useCallback(() => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    wakeLockRef.current?.release().catch(() => {});
    setTracking(false); setDone(true);
  }, []);

  const dropLandmark = useCallback((type: string, label: string) => {
    if (!currentPos) return;
    const lm: Landmark = {
      id: `lm_${Date.now()}`,
      lat: currentPos.lat,
      lng: currentPos.lng,
      type,
      label: label || LANDMARK_TYPES.find((t) => t.id === type)?.label || type,
      ts: Date.now(),
    };
    setLandmarks((prev) => [...prev, lm]);
    setShowLandmarkPicker(false);
    setPendingLandmarkType(null);
    setLandmarkLabel("");
  }, [currentPos]);

  useEffect(() => {
    if (done && points.length >= 2 && startTime) {
      const endTime = Date.now();
      const data: GpsTrackData = {
        points, landmarks, startTime, endTime,
        distanceM: totalDistance(points),
        areaM2: shoelaceAreaM2(points),
        durationMs: endTime - startTime,
        centroid: calcCentroid(points),
      };
      onChange(data);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  useEffect(() => {
    if (value && canvasRef.current) { setPoints(value.points); setLandmarks(value.landmarks ?? []); setDone(true); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (readOnly && value) return <GpsTrackSummary data={value} />;

  return (
    <div className="space-y-3">
      <div className="border-2 border-border bg-card">
        {/* Canvas map */}
        <canvas ref={canvasRef} width={480} height={300}
          className="w-full block bg-muted"
          style={{ imageRendering: "crisp-edges" }} />

        {/* Stats */}
        <div className="grid grid-cols-4 gap-px border-t-2 border-border bg-border">
          {[
            { label: "Points", value: String(points.length) },
            { label: "Distance", value: fmtDist(totalDistance(points)) },
            { label: "Pins", value: String(landmarks.length) },
            { label: "Time", value: tracking ? fmtDuration(elapsed) : done ? fmtDuration(value?.durationMs ?? 0) : "—" },
          ].map(({ label, value: v }) => (
            <div key={label} className="bg-card py-2 text-center">
              <div className="font-display text-base leading-none">{v}</div>
              <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Area result */}
        {done && points.length >= 3 && (
          <div className="border-t-2 border-border bg-primary/20 px-4 py-3">
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Calculated area</div>
            <div className="font-display text-2xl mt-0.5">{fmtArea(shoelaceAreaM2(points))}</div>
          </div>
        )}

        {/* GPS accuracy */}
        {tracking && accuracy !== null && (
          <div className={`border-t border-border px-3 py-1.5 flex items-center gap-2 text-[10px] ${accuracy < 15 ? "bg-green-50" : accuracy < 40 ? "bg-yellow-50" : "bg-red-50"}`}>
            <Navigation className={`h-3 w-3 ${accuracy < 15 ? "text-green-600" : accuracy < 40 ? "text-yellow-600" : "text-red-500"}`} />
            <span>GPS ±{accuracy.toFixed(0)}m {accuracy > 50 ? "— move outside, accuracy low" : accuracy < 15 ? "— excellent" : "— good"}</span>
          </div>
        )}

        {error && (
          <div className="border-t border-border px-3 py-1.5 flex items-center gap-2 text-[10px] text-destructive bg-destructive/5">
            <AlertTriangle className="h-3 w-3" /> {error}
          </div>
        )}
      </div>

      {/* Landmark picker modal */}
      {showLandmarkPicker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShowLandmarkPicker(false)}>
          <div className="w-full max-w-md bg-background border-t-4 border-border pb-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
              <span className="font-display text-base uppercase">Drop landmark</span>
              <button onClick={() => setShowLandmarkPicker(false)} className="border border-border p-1.5 hover:bg-muted"><X className="h-4 w-4" /></button>
            </div>
            {!pendingLandmarkType ? (
              <div className="p-3 grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                {LANDMARK_TYPES.map((t) => (
                  <button key={t.id} onClick={() => setPendingLandmarkType(t.id)}
                    className="flex items-center gap-2 border-2 border-border px-3 py-2.5 text-left text-sm font-bold hover:bg-primary/20 active:bg-primary">
                    <span className="text-xl">{t.emoji}</span>
                    <span className="text-[11px] uppercase tracking-wide leading-tight">{t.label}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="text-sm font-bold">{LANDMARK_TYPES.find((t) => t.id === pendingLandmarkType)?.emoji} {LANDMARK_TYPES.find((t) => t.id === pendingLandmarkType)?.label}</div>
                <input
                  type="text"
                  className="input-brutal w-full"
                  placeholder="Custom label (optional)"
                  value={landmarkLabel}
                  onChange={(e) => setLandmarkLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") dropLandmark(pendingLandmarkType, landmarkLabel); }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={() => setPendingLandmarkType(null)} className="flex-1 border-2 border-border py-2 text-[11px] font-bold uppercase hover:bg-muted">Back</button>
                  <button onClick={() => dropLandmark(pendingLandmarkType, landmarkLabel)}
                    className="flex-1 btn-brutal py-2 text-[11px]">Pin it</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      {!readOnly && (
        <div className="space-y-2">
          {!tracking && !done && (
            <button onClick={() => void start()}
              className="w-full flex items-center justify-center gap-2 bg-primary border-2 border-border py-3.5 font-bold uppercase tracking-wider text-sm hover:bg-primary/80">
              <Play className="h-5 w-5" /> Start area tracking
            </button>
          )}
          {tracking && (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => { setShowLandmarkPicker(true); setPendingLandmarkType(null); }}
                className="flex items-center justify-center gap-2 border-2 border-border bg-card py-3 font-bold uppercase tracking-wider text-xs hover:bg-primary/20">
                <MapPin className="h-4 w-4" /> Drop pin
              </button>
              <button onClick={stop}
                className="flex items-center justify-center gap-2 bg-destructive text-destructive-foreground border-2 border-border py-3 font-bold uppercase tracking-wider text-xs">
                <Square className="h-4 w-4" /> Stop & save
              </button>
            </div>
          )}
          {done && (
            <button onClick={() => { setDone(false); setPoints([]); setLandmarks([]); onChange(undefined); setStartTime(null); }}
              className="w-full flex items-center justify-center gap-2 border-2 border-border py-3 font-bold uppercase tracking-wider text-sm hover:bg-muted">
              <RefreshCw className="h-4 w-4" /> Re-map area
            </button>
          )}
        </div>
      )}

      {/* Landmark list */}
      {landmarks.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Landmarks dropped ({landmarks.length})</div>
          {landmarks.map((lm) => {
            const t = LANDMARK_TYPES.find((x) => x.id === lm.type);
            return (
              <div key={lm.id} className="flex items-center gap-2 border border-border px-3 py-1.5 text-[11px]">
                <span>{t?.emoji ?? "📍"}</span>
                <span className="flex-1 font-semibold">{lm.label}</span>
                <span className="text-muted-foreground">{lm.lat.toFixed(5)}, {lm.lng.toFixed(5)}</span>
                {!done && (
                  <button onClick={() => setLandmarks((prev) => prev.filter((x) => x.id !== lm.id))} className="text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!tracking && !done && (
        <p className="text-[10px] text-muted-foreground">
          Walk the boundary of the area. Tap <strong>Drop pin</strong> to mark landmarks as you go.
          Tap Stop when you return near the start.
        </p>
      )}
      {tracking && (
        <p className="text-[10px] text-yellow-700 font-bold">
          ⚡ Keep screen on · GPS is recording · Walk the boundary
        </p>
      )}
    </div>
  );
}

// ── Read-only + printable summary ─────────────────────────────────────────────

export function GpsTrackSummary({ data, printable }: { data: GpsTrackData; printable?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) drawMap(canvasRef.current, data.points, data.landmarks ?? [], true).catch(() => {});
  }, [data]);

  return (
    <div className={`space-y-3 ${printable ? "print:break-inside-avoid" : ""}`}>
      <canvas ref={canvasRef} width={600} height={360}
        className="w-full border-2 border-border block" style={{ imageRendering: "crisp-edges" }} />

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "Area", value: fmtArea(data.areaM2) },
          { label: "Perimeter", value: fmtDist(data.distanceM) },
          { label: "Duration", value: fmtDuration(data.durationMs) },
        ].map(({ label, value }) => (
          <div key={label} className="border-2 border-border p-3 text-center">
            <div className="font-display text-lg leading-tight">{value}</div>
            <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div className="border border-border p-2 text-center">
          <div className="font-bold">{data.points.length}</div>
          <div className="text-muted-foreground">GPS points</div>
        </div>
        <div className="border border-border p-2 text-center">
          <div className="font-bold">{(data.landmarks ?? []).length}</div>
          <div className="text-muted-foreground">Landmarks</div>
        </div>
        <div className="border border-border p-2 text-center">
          <div className="font-bold">{new Date(data.startTime).toLocaleDateString("en-GB")}</div>
          <div className="text-muted-foreground">Date</div>
        </div>
      </div>

      {/* Landmark table */}
      {(data.landmarks ?? []).length > 0 && (
        <div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Landmarks</div>
          <div className="border-2 border-border overflow-hidden">
            {(data.landmarks ?? []).map((lm, i) => {
              const t = LANDMARK_TYPES.find((x) => x.id === lm.type);
              return (
                <div key={lm.id} className={`flex items-center gap-2 px-3 py-1.5 text-[11px] ${i % 2 === 0 ? "" : "bg-muted/30"} ${i > 0 ? "border-t border-border" : ""}`}>
                  <span className="shrink-0">{t?.emoji ?? "📍"}</span>
                  <span className="flex-1 font-semibold">{lm.label}</span>
                  <span className="text-muted-foreground font-mono text-[9px]">{lm.lat.toFixed(5)}, {lm.lng.toFixed(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {printable && (
        <div className="text-[9px] text-muted-foreground border-t border-border pt-2">
          Recorded: {new Date(data.startTime).toLocaleString("en-GB")} · Centroid: {data.centroid.lat.toFixed(5)}, {data.centroid.lng.toFixed(5)} · © OpenStreetMap contributors
        </div>
      )}
    </div>
  );
}
