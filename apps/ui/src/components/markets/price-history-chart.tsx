'use client';

import { useEffect, useMemo, useState } from 'react';

import { fetchIndexedPriceHistory, getIndexerWebSocketUrl } from '@/lib/markets';

type RangeKey = '1H' | '6H' | '1D' | '1W' | 'ALL';

interface PricePoint {
  key: string;
  no: number;
  ts: number;
  yes: number;
}

interface LiveTradePayload {
  market_id: number;
  timestamp_ms: number;
  receipt_id: string;
  yes: number;
  no: number;
}

interface LiveTradeMessage {
  type: 'trade';
  data: LiveTradePayload;
}

interface PriceHistoryChartProps {
  marketId: number;
  no: number;
  yes: number;
}

const FETCH_LIMIT = 2000;
const FALLBACK_SYNC_MS = 20000;
const RANGES: Array<{ key: RangeKey; label: string; ms: number | null }> = [
  { key: '1H', label: '1H', ms: 60 * 60 * 1000 },
  { key: '6H', label: '6H', ms: 6 * 60 * 60 * 1000 },
  { key: '1D', label: '1D', ms: 24 * 60 * 60 * 1000 },
  { key: '1W', label: '1W', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: 'ALL', label: 'ALL', ms: null },
];

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatTimeLabel(ts: number, includeDate: boolean): string {
  if (!Number.isFinite(ts) || ts <= 0) return '--';
  const formatter = new Intl.DateTimeFormat(undefined, includeDate
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });
  return formatter.format(new Date(ts));
}

function toPointCoords(points: PricePoint[]) {
  const minTs = points.length > 0 ? points[0].ts : 0;
  const maxTs = points.length > 0 ? points[points.length - 1].ts : 0;
  const span = maxTs - minTs;

  return points.map((point, index) => {
    const x = span > 0
      ? ((point.ts - minTs) / span) * 100
      : points.length > 1
        ? (index / (points.length - 1)) * 100
        : 50;

    return {
      x,
      yesY: 100 - clampPercent(point.yes),
      noY: 100 - clampPercent(point.no),
    };
  });
}

function toPolyline(points: PricePoint[], key: 'yes' | 'no'): string {
  const coords = toPointCoords(points);
  return coords
    .map((coord, index) => `${coord.x.toFixed(2)},${(key === 'yes' ? coord.yesY : coord.noY).toFixed(2)}`)
    .join(' ');
}

function normalizeIndexedPoints(points: Array<{ blockHeight: number; timestampMs: number; yesRaw: string; noRaw: string; yes: number; no: number }>): PricePoint[] {
  return points.map((point) => ({
    key: `${point.blockHeight}:${point.timestampMs}:${point.yesRaw}:${point.noRaw}`,
    yes: clampPercent(point.yes),
    no: clampPercent(point.no),
    ts: point.timestampMs,
  }));
}

function rangeStartTs(range: RangeKey, lastTs: number): number | null {
  const cfg = RANGES.find((item) => item.key === range);
  if (!cfg || cfg.ms === null) return null;
  return lastTs - cfg.ms;
}

export function PriceHistoryChart({ marketId, no, yes }: PriceHistoryChartProps) {
  const [history, setHistory] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyError, setHistoryError] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);
  const [range, setRange] = useState<RangeKey>('1D');
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHistoryError(false);

    fetchIndexedPriceHistory(marketId, FETCH_LIMIT)
      .then((points) => {
        if (!active) return;
        setHistory(normalizeIndexedPoints(points));
        setHistoryError(false);
      })
      .catch(() => {
        if (!active) return;
        setHistory([]);
        setHistoryError(true);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [marketId]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectAttempt = 0;

    const connect = () => {
      if (!active) return;
      setSocketConnected(false);

      try {
        socket = new WebSocket(getIndexerWebSocketUrl(marketId));
      } catch {
        reconnectAttempt += 1;
        const delay = Math.min(1000 * (2 ** reconnectAttempt), 15000);
        reconnectTimer = setTimeout(connect, delay);
        return;
      }

      socket.onopen = () => {
        reconnectAttempt = 0;
        setSocketConnected(true);
      };

      socket.onmessage = (event) => {
        let parsed: LiveTradeMessage;
        try {
          parsed = JSON.parse(event.data) as LiveTradeMessage;
        } catch {
          return;
        }

        if (parsed.type !== 'trade' || parsed.data.market_id !== marketId) {
          return;
        }

        const next: PricePoint = {
          key: parsed.data.receipt_id,
          yes: clampPercent(parsed.data.yes),
          no: clampPercent(parsed.data.no),
          ts: Number(parsed.data.timestamp_ms || Date.now()),
        };

        setHistory((prev) => {
          if (prev.some((point) => point.key === next.key)) {
            return prev;
          }
          const merged = [...prev, next].sort((a, b) => a.ts - b.ts);
          return merged.slice(-FETCH_LIMIT);
        });
      };

      socket.onerror = () => {
        setSocketConnected(false);
      };

      socket.onclose = () => {
        setSocketConnected(false);
        if (!active) return;
        reconnectAttempt += 1;
        const delay = Math.min(1000 * (2 ** reconnectAttempt), 15000);
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }
      if (socket) {
        socket.close();
      }
    };
  }, [marketId]);

  useEffect(() => {
    if (socketConnected) {
      return;
    }

    const interval = setInterval(() => {
      fetchIndexedPriceHistory(marketId, FETCH_LIMIT)
        .then((points) => {
          setHistory(normalizeIndexedPoints(points));
          setHistoryError(false);
        })
        .catch(() => {
          setHistoryError((prev) => prev || history.length === 0);
        });
    }, FALLBACK_SYNC_MS);

    return () => {
      clearInterval(interval);
    };
  }, [history.length, marketId, socketConnected]);

  const sortedHistory = useMemo(() => [...history].sort((a, b) => a.ts - b.ts), [history]);

  const visiblePoints = useMemo(() => {
    if (sortedHistory.length === 0) {
      return [];
    }

    const lastTs = sortedHistory[sortedHistory.length - 1].ts;
    const startTs = rangeStartTs(range, lastTs);

    const filtered = startTs === null
      ? sortedHistory
      : sortedHistory.filter((point) => point.ts >= startTs);

    if (filtered.length > 0) {
      return filtered;
    }

    return [sortedHistory[sortedHistory.length - 1]];
  }, [range, sortedHistory]);

  const series = useMemo(() => ({
    yes: toPolyline(visiblePoints, 'yes'),
    no: toPolyline(visiblePoints, 'no'),
    coords: toPointCoords(visiblePoints),
  }), [visiblePoints]);

  const firstTs = visiblePoints.length > 0 ? visiblePoints[0].ts : 0;
  const lastTs = visiblePoints.length > 0 ? visiblePoints[visiblePoints.length - 1].ts : 0;
  const midTs = visiblePoints.length > 0 ? visiblePoints[Math.floor(visiblePoints.length / 2)].ts : 0;
  const includeDate = lastTs - firstTs >= 24 * 60 * 60 * 1000;

  const hoverIndex = useMemo(() => {
    if (hoverRatio === null || visiblePoints.length === 0) {
      return null;
    }

    if (visiblePoints.length === 1) {
      return 0;
    }

    const targetTs = firstTs + ((lastTs - firstTs) * hoverRatio);
    let bestIndex = 0;
    let bestDistance = Math.abs(visiblePoints[0].ts - targetTs);

    for (let index = 1; index < visiblePoints.length; index += 1) {
      const distance = Math.abs(visiblePoints[index].ts - targetTs);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    return bestIndex;
  }, [firstTs, hoverRatio, lastTs, visiblePoints]);

  const hoveredPoint = hoverIndex !== null ? visiblePoints[hoverIndex] : null;
  const hoveredCoord = hoverIndex !== null ? series.coords[hoverIndex] : null;

  const latestYes = visiblePoints.length > 0 ? visiblePoints[visiblePoints.length - 1].yes : clampPercent(yes);
  const latestNo = visiblePoints.length > 0 ? visiblePoints[visiblePoints.length - 1].no : clampPercent(no);

  const legendYes = hoveredPoint ? hoveredPoint.yes : latestYes;
  const legendNo = hoveredPoint ? hoveredPoint.no : latestNo;

  return (
    <section className="price-chart">
      <div className="price-chart__legend">
        <span className="price-chart__legend-item price-chart__legend-item--yes">
          <span className="price-chart__legend-dot" />
          Yes {legendYes.toFixed(0)}%
        </span>
        <span className="price-chart__legend-item price-chart__legend-item--no">
          <span className="price-chart__legend-dot" />
          No {legendNo.toFixed(0)}%
        </span>
      </div>

      {loading ? <p className="price-chart__status">Loading price history...</p> : null}
      {!loading && historyError && history.length === 0 ? <p className="price-chart__status price-chart__status--error">Indexer unavailable</p> : null}
      {!loading && !historyError && history.length === 0 ? <p className="price-chart__status">No indexed trades yet</p> : null}

      {!loading && visiblePoints.length > 0 ? (
        <div
          className="price-chart__plot"
          onMouseMove={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (!bounds.width) return;
            const ratio = (event.clientX - bounds.left) / bounds.width;
            setHoverRatio(Math.max(0, Math.min(1, ratio)));
          }}
          onMouseLeave={() => setHoverRatio(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="price-chart__svg" aria-label="YES and NO price chart">
            <line x1="0" y1="0" x2="100" y2="0" className="price-chart__grid" />
            <line x1="0" y1="25" x2="100" y2="25" className="price-chart__grid" />
            <line x1="0" y1="50" x2="100" y2="50" className="price-chart__grid" />
            <line x1="0" y1="75" x2="100" y2="75" className="price-chart__grid" />
            <line x1="0" y1="100" x2="100" y2="100" className="price-chart__grid" />

            <polyline points={series.yes} className="price-chart__line price-chart__line--yes" />
            <polyline points={series.no} className="price-chart__line price-chart__line--no" />

            {hoveredCoord ? (
              <>
                <line x1={hoveredCoord.x} y1="0" x2={hoveredCoord.x} y2="100" className="price-chart__crosshair" />
                <circle cx={hoveredCoord.x} cy={hoveredCoord.yesY} r="1.2" className="price-chart__dot price-chart__dot--yes" />
                <circle cx={hoveredCoord.x} cy={hoveredCoord.noY} r="1.2" className="price-chart__dot price-chart__dot--no" />
              </>
            ) : null}
          </svg>

          <div className="price-chart__y-axis" aria-label="Price chart percentage axis">
            <span>100%</span>
            <span>75%</span>
            <span>50%</span>
            <span>25%</span>
            <span>0%</span>
          </div>

          {hoveredPoint ? (
            <div className="price-chart__tooltip">
              <span className="price-chart__tooltip-time">{formatTimeLabel(hoveredPoint.ts, includeDate)}</span>
              <span className="price-chart__tooltip-yes">Yes {hoveredPoint.yes.toFixed(1)}%</span>
              <span className="price-chart__tooltip-no">No {hoveredPoint.no.toFixed(1)}%</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && visiblePoints.length > 0 ? (
        <div className="price-chart__x-axis" aria-label="Price chart time axis">
          <span>{formatTimeLabel(firstTs, includeDate)}</span>
          <span>{formatTimeLabel(midTs, includeDate)}</span>
          <span>{formatTimeLabel(lastTs, includeDate)}</span>
        </div>
      ) : null}

      <div className="price-chart__ranges" role="tablist" aria-label="Chart range">
        {RANGES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`price-chart__range-button ${range === item.key ? 'active' : ''}`}
            onClick={() => setRange(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
