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
import { MapPin, Play, Square, Navigation, RefreshCw, AlertTriangle, X, Satellite } from "lucide-react";

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

const DRAFT_KEY = "gps_track_draft";

interface GpsDraft {
  points: GpsPoint[];
  landmarks: Landmark[];
  startTime: number;
  savedAt: number;
}

function saveDraft(pts: GpsPoint[], lms: Landmark[], st: number) {
  try {
    const draft: GpsDraft = { points: pts, landmarks: lms, startTime: st, savedAt: Date.now() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {}
}

function loadDraft(): GpsDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as GpsDraft;
    // Discard drafts older than 24 hours
    if (Date.now() - d.savedAt > 86400000) { localStorage.removeItem(DRAFT_KEY); return null; }
    return d;
  } catch { return null; }
}

function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch {} }

export function GpsTrackField({ value, onChange, readOnly }: Props) {
  const [tracking, setTracking] = useState(false);
  const [paused, setPaused] = useState(false);
  const [points, setPoints] = useState<GpsPoint[]>(value?.points ?? []);
  const [landmarks, setLandmarks] = useState<Landmark[]>(value?.landmarks ?? []);
  const [startTime, setStartTime] = useState<number | null>(value ? value.startTime : null);
  const [elapsed, setElapsed] = useState(value?.durationMs ?? 0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(!!value);
  const [showLandmarkPicker, setShowLandmarkPicker] = useState(false);
  const [landmarkLabel, setLandmarkLabel] = useState("");
  const [pendingLandmarkType, setPendingLandmarkType] = useState<string | null>(null);
  const [currentPos, setCurrentPos] = useState<{ lat: number; lng: number } | null>(null);
  const [draft, setDraft] = useState<GpsDraft | null>(() => (!value ? loadDraft() : null));

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const watchRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedBaseRef = useRef(value?.durationMs ?? 0);

  useEffect(() => {
    if (canvasRef.current) drawMap(canvasRef.current, points, landmarks, done || paused).catch(() => {});
  }, [points, landmarks, done, paused]);

  useEffect(() => {
    if (tracking && startTime) {
      const base = elapsedBaseRef.current;
      const t0 = Date.now();
      timerRef.current = setInterval(() => setElapsed(base + (Date.now() - t0)), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [tracking, startTime]);

  const beginWatch = useCallback((existingPoints: GpsPoint[]) => {
    let lastPt: GpsPoint | null = existingPoints[existingPoints.length - 1] ?? null;
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

  const startFresh = useCallback(async () => {
    if (!("geolocation" in navigator)) { setError("GPS not available on this device."); return; }
    setError(null); const freshPts: GpsPoint[] = []; const freshLms: Landmark[] = [];
    setPoints(freshPts); setLandmarks(freshLms); setDone(false); setPaused(false);
    const now = Date.now(); setStartTime(now); setTracking(true);
    elapsedBaseRef.current = 0; setElapsed(0);
    try { if ("wakeLock" in navigator) { // @ts-ignore
      wakeLockRef.current = await navigator.wakeLock.request("screen"); } } catch {}
    beginWatch(freshPts);
  }, [beginWatch]);

  const continueFromDraft = useCallback(async (d: GpsDraft) => {
    if (!("geolocation" in navigator)) { setError("GPS not available on this device."); return; }
    setError(null);
    setPoints(d.points); setLandmarks(d.landmarks); setDraft(null);
    setStartTime(d.startTime); setDone(false); setPaused(false); setTracking(true);
    const sessionMs = Date.now() - d.savedAt;
    elapsedBaseRef.current = sessionMs; setElapsed(sessionMs);
    try { if ("wakeLock" in navigator) { // @ts-ignore
      wakeLockRef.current = await navigator.wakeLock.request("screen"); } } catch {}
    beginWatch(d.points);
  }, [beginWatch]);

  const pause = useCallback((currentPoints: GpsPoint[], currentLandmarks: Landmark[], currentStart: number | null) => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    wakeLockRef.current?.release().catch(() => {});
    setTracking(false); setPaused(true);
    if (currentStart) saveDraft(currentPoints, currentLandmarks, currentStart);
    setDraft(null);
  }, []);

  const resume = useCallback(async (currentPoints: GpsPoint[]) => {
    if (!("geolocation" in navigator)) return;
    setError(null); setPaused(false); setTracking(true);
    try { if ("wakeLock" in navigator) { // @ts-ignore
      wakeLockRef.current = await navigator.wakeLock.request("screen"); } } catch {}
    beginWatch(currentPoints);
  }, [beginWatch]);

  const finish = useCallback((currentPoints: GpsPoint[], currentLandmarks: Landmark[], currentStart: number | null) => {
    if (watchRef.current !== null) navigator.geolocation.clearWatch(watchRef.current);
    wakeLockRef.current?.release().catch(() => {});
    clearDraft(); setTracking(false); setPaused(false); setDone(true);
  }, []);

  const dropLandmark = useCallback((type: string, label: string) => {
    if (!currentPos) return;
    const lm: Landmark = {
      id: `lm_${Date.now()}`,
      lat: currentPos.lat, lng: currentPos.lng, type,
      label: label || LANDMARK_TYPES.find((t) => t.id === type)?.label || type,
      ts: Date.now(),
    };
    setLandmarks((prev) => [...prev, lm]);
    setShowLandmarkPicker(false); setPendingLandmarkType(null); setLandmarkLabel("");
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

  const accColor = accuracy === null ? "" : accuracy < 15 ? "text-green-600" : accuracy < 40 ? "text-yellow-600" : "text-red-500";
  const accLabel = accuracy === null ? "Searching…" : `GPS ±${accuracy.toFixed(0)}m ${accuracy < 15 ? "· excellent" : accuracy < 40 ? "· good" : "· move outside"}`;

  // ── Not started ─────────────────────────────────────────────────────────────
  if (!tracking && !paused && !done) {
    return (
      <div className="space-y-3">
        <div className="border-2 border-border bg-card">
          <div className="px-5 py-6 flex flex-col items-center gap-3 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/20 border-2 border-border flex items-center justify-center">
              <Satellite className="h-8 w-8 text-foreground" />
            </div>
            <div>
              <div className="font-display text-base uppercase tracking-widest">Area Map</div>
              <div className="mt-1 text-[11px] text-muted-foreground leading-snug">
                Walk the boundary of the area while GPS records your path.
                Tap landmarks (wells, roads, schools) as you go.
              </div>
            </div>
          </div>

          {/* Continue from previous session if draft exists */}
          {draft && draft.points.length > 0 && (
            <div className="border-t-2 border-border bg-yellow-50 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-yellow-800 mb-2">
                📍 Saved session found — {draft.points.length} points · {fmtDist(totalDistance(draft.points))}
              </div>
              <div className="text-[10px] text-yellow-700 mb-3">
                Saved {new Date(draft.savedAt).toLocaleString("en-GB", { timeStyle: "short", dateStyle: "short" })}
              </div>
              <div className="flex gap-2">
                <button onClick={() => void continueFromDraft(draft)}
                  className="flex-[2] flex items-center justify-center gap-2 bg-yellow-400 border-2 border-border py-3.5 font-bold uppercase tracking-wider text-sm active:opacity-80"
                  style={{ touchAction: "manipulation" }}>
                  <Play className="h-5 w-5" /> Continue Session
                </button>
                <button onClick={() => { clearDraft(); setDraft(null); }}
                  className="flex-1 border-2 border-border py-3.5 text-[11px] font-bold uppercase text-muted-foreground active:bg-muted"
                  style={{ touchAction: "manipulation" }}>
                  Discard
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => void startFresh()}
            className={`w-full flex items-center justify-center gap-3 bg-primary border-t-2 border-border py-5 font-bold uppercase tracking-wider text-base active:opacity-80 ${draft ? "text-sm py-4" : ""}`}
            style={{ touchAction: "manipulation" }}
          >
            <Play className="h-6 w-6" /> {draft ? "Start Fresh Instead" : "Start Area Tracking"}
          </button>
        </div>
        {error && (
          <div className="flex items-center gap-2 border-2 border-destructive bg-destructive/10 px-3 py-2 text-[11px] font-bold text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
          </div>
        )}
      </div>
    );
  }

  // ── Tracking active ──────────────────────────────────────────────────────────
  if (tracking || paused) {
    return (
      <>
        <div className="space-y-2">
          {/* Live map */}
          <div className="border-2 border-border bg-card overflow-hidden">
            <canvas ref={canvasRef} width={480} height={280}
              className="w-full block" style={{ aspectRatio: "480/280", display: "block" }} />
            {/* Stats strip */}
            <div className="grid grid-cols-4 gap-px border-t-2 border-border bg-border">
              {[
                { label: "Points", value: String(points.length) },
                { label: "Distance", value: fmtDist(totalDistance(points)) },
                { label: "Pins", value: String(landmarks.length) },
                { label: "Time", value: fmtDuration(elapsed) },
              ].map(({ label, value: v }) => (
                <div key={label} className="bg-card py-2 text-center">
                  <div className="font-display text-sm leading-none">{v}</div>
                  <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">{label}</div>
                </div>
              ))}
            </div>
            {/* GPS accuracy bar / paused indicator */}
            {tracking ? (
              <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/40">
                <Navigation className={`h-3.5 w-3.5 shrink-0 ${accColor}`} />
                <span className={`text-[11px] font-bold ${accColor}`}>{accLabel}</span>
                {accuracy !== null && accuracy > 50 && (
                  <span className="ml-auto text-[10px] text-destructive font-bold">Move outside</span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-yellow-50">
                <span className="text-[11px] font-bold text-yellow-800">⏸ Paused · GPS saved · Tap Resume to continue</span>
              </div>
            )}
          </div>

          {/* Guidance */}
          {tracking && (
            <div className="bg-yellow-50 border-2 border-yellow-400 px-3 py-2 flex items-center gap-2">
              <span className="text-lg shrink-0">⚡</span>
              <span className="text-[11px] font-bold text-yellow-800">Keep screen on · Walk boundary · Pause to rest</span>
            </div>
          )}
        </div>

        {/* Sticky bottom tracking bar — always reachable */}
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t-4 border-border safe-area-inset-bottom"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          {tracking ? (
            <div className="p-3 flex gap-2">
              <button onClick={() => { setShowLandmarkPicker(true); setPendingLandmarkType(null); }}
                className="flex-1 flex items-center justify-center gap-2 border-2 border-border bg-card py-4 font-bold uppercase tracking-wider text-sm active:bg-primary/20"
                style={{ touchAction: "manipulation" }}>
                <MapPin className="h-5 w-5" /> Drop Pin
              </button>
              <button onClick={() => pause(points, landmarks, startTime)}
                className="flex-1 flex items-center justify-center gap-2 border-2 border-border bg-yellow-400 py-4 font-bold uppercase tracking-wider text-sm active:opacity-80"
                style={{ touchAction: "manipulation" }}>
                <Square className="h-5 w-5" /> Pause
              </button>
            </div>
          ) : (
            <div className="p-3 flex gap-2">
              <button onClick={() => void resume(points)}
                className="flex-[2] flex items-center justify-center gap-2 bg-primary border-2 border-border py-4 font-bold uppercase tracking-wider text-base active:opacity-80"
                style={{ touchAction: "manipulation" }}>
                <Play className="h-5 w-5" /> Resume
              </button>
              <button onClick={() => finish(points, landmarks, startTime)}
                className="flex-1 flex items-center justify-center gap-2 bg-foreground text-background border-2 border-border py-4 font-bold uppercase tracking-wider text-sm active:opacity-80"
                style={{ touchAction: "manipulation" }}>
                <Square className="h-4 w-4" /> Finish &amp; Save
              </button>
            </div>
          )}
        </div>
        {/* Spacer so sticky bar doesn't overlap content */}
        <div className="h-24" />

        {/* Landmarks already dropped (removable while tracking/paused) */}
        {landmarks.length > 0 && (
          <div className="border-2 border-border divide-y divide-border">
            <div className="px-3 py-1.5 bg-muted text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
              Pins dropped ({landmarks.length}) — tap ✕ to remove
            </div>
            {landmarks.map((lm) => {
              const t = LANDMARK_TYPES.find((x) => x.id === lm.type);
              return (
                <div key={lm.id} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                  <span>{t?.emoji ?? "📍"}</span>
                  <span className="flex-1 font-semibold">{lm.label}</span>
                  <button onClick={() => setLandmarks((prev) => prev.filter((x) => x.id !== lm.id))}
                    className="text-muted-foreground hover:text-destructive p-1">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Landmark picker modal */}
        {showLandmarkPicker && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setShowLandmarkPicker(false)}>
            <div className="w-full max-w-md bg-background border-t-4 border-border" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom))" }} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 border-b-2 border-border">
                <span className="font-display text-base uppercase">Drop Landmark</span>
                <button onClick={() => setShowLandmarkPicker(false)} className="border border-border p-1.5"><X className="h-4 w-4" /></button>
              </div>
              {!pendingLandmarkType ? (
                <div className="p-3 grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                  {LANDMARK_TYPES.map((t) => (
                    <button key={t.id} onClick={() => setPendingLandmarkType(t.id)}
                      className="flex items-center gap-2 border-2 border-border px-3 py-3 text-left font-bold active:bg-primary"
                      style={{ touchAction: "manipulation" }}>
                      <span className="text-2xl">{t.emoji}</span>
                      <span className="text-[11px] uppercase tracking-wide leading-tight">{t.label}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="p-4 space-y-3">
                  <div className="text-sm font-bold">{LANDMARK_TYPES.find((t) => t.id === pendingLandmarkType)?.emoji} {LANDMARK_TYPES.find((t) => t.id === pendingLandmarkType)?.label}</div>
                  <input type="text" className="input-brutal w-full" placeholder="Custom label (optional)"
                    value={landmarkLabel} onChange={(e) => setLandmarkLabel(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") dropLandmark(pendingLandmarkType, landmarkLabel); }} autoFocus />
                  <div className="flex gap-2">
                    <button onClick={() => setPendingLandmarkType(null)} className="flex-1 border-2 border-border py-3 text-[11px] font-bold uppercase">Back</button>
                    <button onClick={() => dropLandmark(pendingLandmarkType, landmarkLabel)} className="flex-1 btn-brutal py-3 text-[11px]">Pin It</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  }

  // ── Done / saved ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Completed map */}
      <div className="border-2 border-border bg-card overflow-hidden">
        <canvas ref={canvasRef} width={480} height={280}
          className="w-full block" style={{ aspectRatio: "480/280", display: "block" }} />

        {/* Area result — prominent */}
        {points.length >= 3 && (
          <div className="border-t-2 border-border bg-primary px-4 py-3 flex items-center justify-between">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-widest opacity-60">Calculated Area</div>
              <div className="font-display text-xl leading-tight mt-0.5">{fmtArea(shoelaceAreaM2(points))}</div>
            </div>
            <div className="text-right text-[10px] font-bold uppercase opacity-70 space-y-0.5">
              <div>{fmtDist(totalDistance(points))} perimeter</div>
              <div>{points.length} GPS points</div>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-3 gap-px border-t border-border bg-border">
          {[
            { label: "Duration", value: fmtDuration(value?.durationMs ?? 0) },
            { label: "Landmarks", value: String(landmarks.length) },
            { label: "Date", value: value ? new Date(value.startTime).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "—" },
          ].map(({ label, value: v }) => (
            <div key={label} className="bg-card py-2 text-center">
              <div className="font-display text-sm leading-none">{v}</div>
              <div className="text-[8px] font-bold uppercase tracking-widest text-muted-foreground mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Landmark list */}
      {landmarks.length > 0 && (
        <div className="border-2 border-border divide-y divide-border">
          <div className="px-3 py-1.5 bg-muted text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
            Landmarks ({landmarks.length})
          </div>
          {landmarks.map((lm) => {
            const t = LANDMARK_TYPES.find((x) => x.id === lm.type);
            return (
              <div key={lm.id} className="flex items-center gap-2 px-3 py-2 text-[11px]">
                <span>{t?.emoji ?? "📍"}</span>
                <span className="flex-1 font-semibold">{lm.label}</span>
                <span className="text-muted-foreground font-mono text-[9px]">{lm.lat.toFixed(5)}, {lm.lng.toFixed(5)}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Re-map button — with confirmation to avoid accidental loss */}
      {!readOnly && (
        <RemapButton onConfirm={() => { clearDraft(); setDone(false); setPaused(false); setPoints([]); setLandmarks([]); onChange(undefined); setStartTime(null); elapsedBaseRef.current = 0; setElapsed(0); setDraft(loadDraft()); }} />
      )}
    </div>
  );
}

// ── Re-map confirmation button ────────────────────────────────────────────────

function RemapButton({ onConfirm }: { onConfirm: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button onClick={() => setConfirming(true)}
        className="w-full flex items-center justify-center gap-2 border-2 border-border py-3.5 font-bold uppercase tracking-wider text-sm active:bg-muted"
        style={{ touchAction: "manipulation" }}>
        <RefreshCw className="h-4 w-4" /> Re-map Area
      </button>
    );
  }
  return (
    <div className="border-2 border-destructive bg-destructive/10 p-3 space-y-2">
      <p className="text-[11px] font-bold text-destructive flex items-center gap-1.5">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        This will delete the current map and all pins. Are you sure?
      </p>
      <div className="flex gap-2">
        <button onClick={() => setConfirming(false)}
          className="flex-1 border-2 border-border py-2.5 text-[11px] font-bold uppercase active:bg-muted"
          style={{ touchAction: "manipulation" }}>
          Keep map
        </button>
        <button onClick={onConfirm}
          className="flex-1 border-2 border-destructive bg-destructive text-destructive-foreground py-2.5 text-[11px] font-bold uppercase active:opacity-80"
          style={{ touchAction: "manipulation" }}>
          Yes, re-map
        </button>
      </div>
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
