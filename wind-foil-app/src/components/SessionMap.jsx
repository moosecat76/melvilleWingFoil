import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, CircleMarker, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { decodePolyline } from '../services/tcxService';
import { usePreferences } from '../context/PreferencesContext';
import { formatDurationSec } from '../services/foilAnalysisService';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const MapBoundsFocus = ({ allPositions, segmentPositions }) => {
    const map = useMap();
    useEffect(() => {
        if (!map) return;
        try {
            if (segmentPositions && segmentPositions.length >= 2) {
                map.fitBounds(segmentPositions, { padding: [36, 36], maxZoom: 17 });
            } else if (allPositions && allPositions.length >= 2) {
                map.fitBounds(allPositions, { padding: [20, 20] });
            }
        } catch (_) {
            // Ignore invalid bounds during initial mount
        }
    }, [map, segmentPositions, allPositions]);
    return null;
};

const SessionMap = ({
    polyline,
    summary_polyline,
    streams,
    highlightIndex,
    selectedSegment = null,
    maneuvers = null,
    unit: propUnit
}) => {
    const preferences = usePreferences();
    const activeUnit = propUnit || preferences.unit || 'knots';
    const speedMult = activeUnit === 'kmh' ? 3.6 : 1.94384;
    const speedUnit = activeUnit === 'kmh' ? 'km/h' : 'kts';

    const encoded = polyline || summary_polyline;

    // Helper to render simple map (for fallback or no streams)
    const renderSimpleMap = () => {
        if (!encoded) return null;
        const positions = decodePolyline(encoded);
        if (!positions || positions.length === 0) return null;

        const start = positions[0];
        const end = positions[positions.length - 1];

        return (
            <div style={{ height: '320px', width: '100%', borderRadius: '8px', overflow: 'hidden', marginTop: '0.5rem' }}>
                <MapContainer
                    bounds={positions}
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom={false}
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Polyline pathOptions={{ color: 'var(--accent-primary)', weight: 4 }} positions={positions} />
                    <Marker position={start}><Popup>Start</Popup></Marker>
                    <Marker position={end}><Popup>End</Popup></Marker>
                </MapContainer>
            </div>
        );
    };

    // Advanced speed-colored display
    const renderSpeedMap = () => {
        let latlngStream, velocityStream;

        if (Array.isArray(streams)) {
            latlngStream = streams.find(s => s.type === 'latlng')?.data;
            velocityStream = streams.find(s => s.type === 'velocity_smooth')?.data;
        } else if (streams && typeof streams === 'object') {
            latlngStream = streams.latlng?.data;
            velocityStream = streams.velocity_smooth?.data;
        }

        if ((!latlngStream || latlngStream.length === 0) && encoded) {
            try {
                latlngStream = decodePolyline(encoded);
            } catch (e) {
                console.error('[SessionMap] Failed to decode polyline for speed map:', e);
            }
        }

        if (!latlngStream || !velocityStream || latlngStream.length < 2 || velocityStream.length === 0) {
            return renderSimpleMap();
        }

        const buckets = {
            stopped: [],  // < 0.2 m/s
            crawl: [],    // 0.2-0.8 m/s
            planing: [],  // 0.8-1 m/s
            foil: [],     // 1-2 m/s
            cranking: []  // > 2 m/s
        };

        let currentBucket = null;
        let currentPath = [];

        const MAP_SAMPLE_RATE = Math.max(1, Math.ceil(latlngStream.length / 1500));

        for (let i = MAP_SAMPLE_RATE; i < latlngStream.length; i += MAP_SAMPLE_RATE) {
            const p1 = latlngStream[i - MAP_SAMPLE_RATE];
            const p2 = latlngStream[i];
            const ratio1 = (i - MAP_SAMPLE_RATE) / Math.max(1, latlngStream.length - 1);
            const ratio2 = i / Math.max(1, latlngStream.length - 1);
            const idx1 = Math.min(Math.round(ratio1 * (velocityStream.length - 1)), velocityStream.length - 1);
            const idx2 = Math.min(Math.round(ratio2 * (velocityStream.length - 1)), velocityStream.length - 1);
            const speedMs = ((velocityStream[idx1] ?? 0) + (velocityStream[idx2] ?? 0)) / 2;

            let bucketName;
            if (speedMs < 0.2) bucketName = 'stopped';
            else if (speedMs < 0.8) bucketName = 'crawl';
            else if (speedMs < 1) bucketName = 'planing';
            else if (speedMs < 2) bucketName = 'foil';
            else bucketName = 'cranking';

            if (bucketName !== currentBucket) {
                if (currentBucket && currentPath.length > 0) {
                    buckets[currentBucket].push([...currentPath]);
                }
                currentBucket = bucketName;
                currentPath = [p1, p2];
            } else {
                currentPath.push(p2);
            }
        }

        if (currentBucket && currentPath.length > 0) {
            buckets[currentBucket].push([...currentPath]);
        }

        const start = latlngStream[0];
        const end = latlngStream[latlngStream.length - 1];
        const bounds = latlngStream;
        const highlightPoint = highlightIndex != null && latlngStream[highlightIndex] ? latlngStream[highlightIndex] : null;

        // Map selected flight segment indices onto latlngStream
        let segmentPositions = null;
        if (selectedSegment && selectedSegment.start != null && selectedSegment.end != null) {
            const maxVIdx = Math.max(1, velocityStream.length - 1);
            const maxLIdx = Math.max(1, latlngStream.length - 1);
            const startLIdx = Math.max(0, Math.round((selectedSegment.start / maxVIdx) * maxLIdx));
            const endLIdx = Math.min(maxLIdx, Math.round((selectedSegment.end / maxVIdx) * maxLIdx));
            const slice = latlngStream.slice(startLIdx, endLIdx + 1);
            if (slice.length >= 2) {
                segmentPositions = slice;
            }
        }

        const turns = maneuvers?.turns || [];
        const baseOpacity = segmentPositions ? 0.35 : 0.9;

        return (
            <div style={{ height: '340px', width: '100%', borderRadius: '8px', overflow: 'hidden', marginTop: '0.5rem', position: 'relative' }}>
                <MapContainer bounds={bounds} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />

                    <MapBoundsFocus allPositions={bounds} segmentPositions={segmentPositions} />

                    {/* Render Buckets with Colors */}
                    <Polyline positions={buckets.stopped} pathOptions={{ color: '#94a3b8', weight: 3, opacity: segmentPositions ? 0.25 : 0.6 }} />
                    <Polyline positions={buckets.crawl} pathOptions={{ color: '#f87171', weight: 4, opacity: baseOpacity }} />
                    <Polyline positions={buckets.planing} pathOptions={{ color: '#fbbf24', weight: 4, opacity: baseOpacity }} />
                    <Polyline positions={buckets.foil} pathOptions={{ color: '#4ade80', weight: 5, opacity: baseOpacity }} />
                    <Polyline positions={buckets.cranking} pathOptions={{ color: '#818cf8', weight: 5, opacity: baseOpacity }} />

                    {/* Highlighted Selected Flight Segment */}
                    {segmentPositions && (
                        <>
                            <Polyline
                                positions={segmentPositions}
                                pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.5 }}
                            />
                            <Polyline
                                positions={segmentPositions}
                                pathOptions={{ color: '#38bdf8', weight: 6, opacity: 1 }}
                            />
                            <CircleMarker
                                center={segmentPositions[0]}
                                radius={6}
                                pathOptions={{ color: '#0f172a', fillColor: '#4ade80', fillOpacity: 1, weight: 2 }}
                            >
                                <Popup>Flight #{selectedSegment.flightNumber} Start</Popup>
                            </CircleMarker>
                            <CircleMarker
                                center={segmentPositions[segmentPositions.length - 1]}
                                radius={6}
                                pathOptions={{ color: '#0f172a', fillColor: '#f87171', fillOpacity: 1, weight: 2 }}
                            >
                                <Popup>Flight #{selectedSegment.flightNumber} End</Popup>
                            </CircleMarker>
                        </>
                    )}

                    {/* Gybe / Tack Turn Markers */}
                    {turns.map((turn) => {
                        if (!Array.isArray(turn.latlng) || turn.latlng.length < 2) return null;
                        return (
                            <CircleMarker
                                key={`turn-${turn.id}`}
                                center={turn.latlng}
                                radius={5}
                                pathOptions={{
                                    color: '#0f172a',
                                    fillColor: turn.completed ? '#22c55e' : '#fb923c',
                                    fillOpacity: 0.95,
                                    weight: 2
                                }}
                            >
                                <Popup>
                                    <div style={{ fontSize: '0.8rem', lineHeight: 1.4 }}>
                                        <strong>{turn.completed ? `✅ Foiling ${turn.type}` : `💧 Wet ${turn.type} (Touchdown)`}</strong>
                                        <div>Turn Angle: {turn.angleChange}° ({turn.entryBearing}° → {turn.exitBearing}°)</div>
                                        <div>Time: {formatDurationSec(turn.timeSec)}</div>
                                    </div>
                                </Popup>
                            </CircleMarker>
                        );
                    })}

                    <Marker position={start}><Popup>Start</Popup></Marker>
                    <Marker position={end}><Popup>End</Popup></Marker>

                    {highlightPoint && (
                        <CircleMarker
                            center={highlightPoint}
                            radius={6}
                            pathOptions={{ color: '#ffffff', fillColor: '#38bdf8', fillOpacity: 1, weight: 2 }}
                        />
                    )}

                    {/* Legend Overlay */}
                    <div className="leaflet-bottom leaflet-right" style={{ pointerEvents: 'none', margin: '10px', marginBottom: '20px' }}>
                        <div className="leaflet-control" style={{ background: 'rgba(15, 23, 42, 0.9)', padding: '10px', borderRadius: '8px', color: '#f8fafc', fontSize: '0.75rem', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '5px', border: '1px solid rgba(148, 163, 184, 0.2)', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '2px', borderBottom: '1px solid rgba(148, 163, 184, 0.2)', paddingBottom: '2px', color: '#38bdf8' }}>
                                Speed ({speedUnit})
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#94a3b8', borderRadius: '2px' }}></span> &lt; {(0.2 * speedMult).toFixed(1)} (Stopped)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#f87171', borderRadius: '2px' }}></span> {(0.2 * speedMult).toFixed(1)} – {(0.8 * speedMult).toFixed(1)} (Crawl)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#fbbf24', borderRadius: '2px' }}></span> {(0.8 * speedMult).toFixed(1)} – {(1.0 * speedMult).toFixed(1)} (Planing)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#4ade80', borderRadius: '2px' }}></span> {(1.0 * speedMult).toFixed(1)} – {(2.0 * speedMult).toFixed(1)} (Foil)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#818cf8', borderRadius: '2px' }}></span> {(2.0 * speedMult).toFixed(1)}+ (Cranking)</div>
                            {turns.length > 0 && (
                                <>
                                    <div style={{ borderTop: '1px solid rgba(148, 163, 184, 0.2)', marginTop: '2px', paddingTop: '4px', fontWeight: 'bold', color: '#f8fafc' }}>
                                        Maneuvers
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '10px', height: '10px', background: '#22c55e', borderRadius: '50%', border: '1.5px solid #0f172a' }}></span> Foiling Gybe</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '10px', height: '10px', background: '#fb923c', borderRadius: '50%', border: '1.5px solid #0f172a' }}></span> Wet Gybe</div>
                                </>
                            )}
                        </div>
                    </div>
                </MapContainer>
            </div>
        );
    };

    if (streams) {
        return renderSpeedMap();
    }

    return renderSimpleMap();
};

export default SessionMap;
