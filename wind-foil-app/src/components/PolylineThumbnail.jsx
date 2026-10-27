import React, { useMemo } from 'react';
import { decodePolyline } from '../services/tcxService';
import { Navigation } from 'lucide-react';

const PolylineThumbnail = ({ polyline, summary_polyline, height = 110, className = '', style = {} }) => {
    const encoded = polyline || summary_polyline;

    const { pathData, startPoint, endPoint, hasPoints } = useMemo(() => {
        if (!encoded || typeof encoded !== 'string') {
            return { pathData: '', startPoint: null, endPoint: null, hasPoints: false };
        }

        const rawPoints = decodePolyline(encoded);
        if (!rawPoints || rawPoints.length < 2) {
            return { pathData: '', startPoint: null, endPoint: null, hasPoints: false };
        }

        // Downsample points if too dense for ultra-fast SVG rendering
        const maxPoints = 250;
        const step = Math.max(1, Math.floor(rawPoints.length / maxPoints));
        const points = [];
        for (let i = 0; i < rawPoints.length; i += step) {
            points.push(rawPoints[i]);
        }
        if (points[points.length - 1] !== rawPoints[rawPoints.length - 1]) {
            points.push(rawPoints[rawPoints.length - 1]);
        }

        let minLat = Infinity, maxLat = -Infinity;
        let minLng = Infinity, maxLng = -Infinity;

        for (const pt of points) {
            const lat = pt[0];
            const lng = pt[1];
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
        }

        const spanLat = maxLat - minLat || 0.0001;
        const spanLng = maxLng - minLng || 0.0001;

        const viewW = 300;
        const viewH = 120;
        const pad = 12;
        const usableW = viewW - pad * 2;
        const usableH = viewH - pad * 2;

        const project = (lat, lng) => {
            const x = pad + ((lng - minLng) / spanLng) * usableW;
            const y = viewH - pad - ((lat - minLat) / spanLat) * usableH;
            return [Number(x.toFixed(1)), Number(y.toFixed(1))];
        };

        const projected = points.map(p => project(p[0], p[1]));

        let d = `M ${projected[0][0]},${projected[0][1]}`;
        for (let i = 1; i < projected.length; i++) {
            d += ` L ${projected[i][0]},${projected[i][1]}`;
        }

        return {
            pathData: d,
            startPoint: projected[0],
            endPoint: projected[projected.length - 1],
            hasPoints: true
        };
    }, [encoded]);

    if (!hasPoints) {
        return null;
    }

    return (
        <div
            className={`polyline-thumbnail-container ${className}`}
            style={{
                height: `${height}px`,
                width: '100%',
                borderRadius: '8px',
                overflow: 'hidden',
                background: 'rgba(15, 23, 42, 0.65)',
                border: '1px solid rgba(148, 163, 184, 0.12)',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                ...style
            }}
        >
            <svg
                viewBox="0 0 300 120"
                preserveAspectRatio="xMidYMid meet"
                style={{ width: '100%', height: '100%', display: 'block' }}
            >
                <defs>
                    <linearGradient id="thumbGrad" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.8} />
                        <stop offset="100%" stopColor="#818cf8" stopOpacity={0.95} />
                    </linearGradient>
                    <filter id="thumbGlow" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#38bdf8" floodOpacity="0.45" />
                    </filter>
                </defs>

                {/* Subtle coordinate grid lines */}
                <line x1="0" y1="40" x2="300" y2="40" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="0" y1="80" x2="300" y2="80" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="100" y1="0" x2="100" y2="120" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />
                <line x1="200" y1="0" x2="200" y2="120" stroke="rgba(255,255,255,0.03)" strokeWidth="1" strokeDasharray="4 4" />

                {/* Polyline path */}
                <path
                    d={pathData}
                    fill="none"
                    stroke="url(#thumbGrad)"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#thumbGlow)"
                />

                {/* Start Point (Green) */}
                {startPoint && (
                    <circle cx={startPoint[0]} cy={startPoint[1]} r="3.5" fill="#4ade80" stroke="#0f172a" strokeWidth="1.5" />
                )}

                {/* End Point (Red/Amber) */}
                {endPoint && (
                    <circle cx={endPoint[0]} cy={endPoint[1]} r="3.5" fill="#f87171" stroke="#0f172a" strokeWidth="1.5" />
                )}
            </svg>

            {/* Corner Badge */}
            <div
                style={{
                    position: 'absolute',
                    bottom: '6px',
                    right: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '0.68rem',
                    color: 'var(--text-secondary)',
                    background: 'rgba(15, 23, 42, 0.75)',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    backdropFilter: 'blur(4px)',
                    border: '1px solid rgba(255,255,255,0.08)'
                }}
            >
                <Navigation size={10} style={{ color: 'var(--accent-primary)' }} />
                <span>GPS Track · Tap to view</span>
            </div>
        </div>
    );
};

export default PolylineThumbnail;
