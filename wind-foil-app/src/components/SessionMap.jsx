
import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// Simple Polyline Decoder
const decodePolyline = (str, precision) => {
    var index = 0,
        lat = 0,
        lng = 0,
        coordinates = [],
        shift = 0,
        result = 0,
        byte = null,
        latitude_change,
        longitude_change,
        factor = Math.pow(10, precision || 5);

    while (index < str.length) {
        byte = null;
        shift = 0;
        result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        shift = result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += latitude_change;
        lng += longitude_change;
        coordinates.push([lat / factor, lng / factor]);
    }
    return coordinates;
};



const SessionMap = ({ polyline, summary_polyline, streams }) => {
    const encoded = polyline || summary_polyline;

    // Helper to render simple map (for fallback or no streams)
    const renderSimpleMap = () => {
        if (!encoded) return null;
        const positions = decodePolyline(encoded);
        if (!positions || positions.length === 0) return null;

        const start = positions[0];
        const end = positions[positions.length - 1];

        return (
            <div style={{ height: '300px', width: '100%', borderRadius: '8px', overflow: 'hidden', marginTop: '1rem' }}>
                <MapContainer
                    bounds={positions}
                    style={{ height: '100%', width: '100%' }}
                    scrollWheelZoom={false}
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />
                    <Polyline pathOptions={{ color: 'var(--accent-primary)', weight: 4 }} positions={positions} />
                    <Marker position={start}><Popup>Start</Popup></Marker>
                    <Marker position={end}><Popup>End</Popup></Marker>
                </MapContainer>
            </div>
        );
    };

    // Advanced speed-colored display
    // Advanced speed-colored display
    const renderSpeedMap = () => {
        // Handle both Array (key_by_type=false) and Object (key_by_type=true) formats
        let latlngStream, velocityStream;

        if (Array.isArray(streams)) {
            latlngStream = streams.find(s => s.type === 'latlng')?.data;
            velocityStream = streams.find(s => s.type === 'velocity_smooth')?.data;
        } else if (streams && typeof streams === 'object') {
            latlngStream = streams.latlng?.data;
            velocityStream = streams.velocity_smooth?.data;
        }

        // If data is missing, fallback to simple map
        if (!latlngStream || !velocityStream) {
            return renderSimpleMap();
        }

        // Buckets based on user request (<1: stopped, 1-2: crawl, 2-3: planing, 3-5: foil, 5+: cranking)
        // Using m/s for thresholds as requested (1 m/s ≈ 2 kts)
        const buckets = {
            stopped: [],  // < 1 m/s
            crawl: [],    // 1-2 m/s
            planing: [],  // 2-3 m/s
            foil: [],     // 3-5 m/s
            cranking: []  // > 5 m/s
        };

        for (let i = 1; i < latlngStream.length; i++) {
            const p1 = latlngStream[i - 1];
            const p2 = latlngStream[i];
            const speedMs = (velocityStream[i - 1] + velocityStream[i]) / 2;
            const segment = [p1, p2];

            if (speedMs < 1) buckets.stopped.push(segment);
            else if (speedMs < 2) buckets.crawl.push(segment);
            else if (speedMs < 3) buckets.planing.push(segment);
            else if (speedMs < 5) buckets.foil.push(segment);
            else buckets.cranking.push(segment);
        }

        const start = latlngStream[0];
        const end = latlngStream[latlngStream.length - 1];

        // Calculate bounds
        const bounds = latlngStream;

        return (
            <div style={{ height: '300px', width: '100%', borderRadius: '8px', overflow: 'hidden', marginTop: '1rem', position: 'relative' }}>
                <MapContainer bounds={bounds} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                    />

                    {/* Render Buckets with Colors (matching CSS tokens) */}
                    <Polyline positions={buckets.stopped} pathOptions={{ color: '#94a3b8', weight: 3, opacity: 0.6 }} /> {/* Slate 400 */}
                    <Polyline positions={buckets.crawl} pathOptions={{ color: '#f87171', weight: 4 }} />   {/* Red 400 */}
                    <Polyline positions={buckets.planing} pathOptions={{ color: '#fbbf24', weight: 4 }} /> {/* Amber 400 */}
                    <Polyline positions={buckets.foil} pathOptions={{ color: '#4ade80', weight: 5 }} />    {/* Green 400 */}
                    <Polyline positions={buckets.cranking} pathOptions={{ color: '#818cf8', weight: 5 }} /> {/* Indigo 400 */}

                    <Marker position={start}><Popup>Start</Popup></Marker>
                    <Marker position={end}><Popup>End</Popup></Marker>

                    {/* Legend Overlay */}
                    <div className="leaflet-bottom leaflet-right" style={{ pointerEvents: 'none', margin: '10px', marginBottom: '20px' }}>
                        <div className="leaflet-control" style={{ background: 'rgba(15, 23, 42, 0.9)', padding: '10px', borderRadius: '8px', color: '#f8fafc', fontSize: '0.75rem', pointerEvents: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', border: '1px solid rgba(148, 163, 184, 0.2)', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)' }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '2px', borderBottom: '1px solid rgba(148, 163, 184, 0.2)', paddingBottom: '2px', color: '#38bdf8' }}>Speed (m/s)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#94a3b8', borderRadius: '2px' }}></span> &lt; 1 (Stopped)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#f87171', borderRadius: '2px' }}></span> 1 - 2 (Crawl)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#fbbf24', borderRadius: '2px' }}></span> 2 - 3 (Planing)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#4ade80', borderRadius: '2px' }}></span> 3 - 5 (Foil)</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><span style={{ display: 'block', width: '12px', height: '12px', background: '#818cf8', borderRadius: '2px' }}></span> 5+ (Cranking)</div>
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
