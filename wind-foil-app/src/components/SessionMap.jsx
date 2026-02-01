
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

        // Buckets for different speed ranges (User Requested: <2, 2-3, 3-4, 5-7, 10-15, 15-20, >20)
        // We will fill gaps (4-5, 7-10) with intermediate or extended ranges to ensure continuity.
        const buckets = {
            stopped: [], // < 2
            crawl: [],   // 2-3
            slow: [],    // 3-4
            gap1: [],    // 4-5 (Gap filler)
            takeoff: [], // 5-7
            gap2: [],    // 7-10 (Gap filler)
            planing: [], // 10-15
            fast: [],    // 15-20
            turbo: []    // > 20
        };

        for (let i = 1; i < latlngStream.length; i++) {
            const p1 = latlngStream[i - 1];
            const p2 = latlngStream[i];
            const speedMs = (velocityStream[i - 1] + velocityStream[i]) / 2;
            const speedKts = speedMs * 1.94384;

            const segment = [p1, p2];

            if (speedKts < 2) buckets.stopped.push(segment);
            else if (speedKts < 3) buckets.crawl.push(segment);
            else if (speedKts < 4) buckets.slow.push(segment);
            else if (speedKts < 5) buckets.gap1.push(segment); // 4-5 range
            else if (speedKts < 7) buckets.takeoff.push(segment);
            else if (speedKts < 10) buckets.gap2.push(segment); // 7-10 range
            else if (speedKts < 15) buckets.planing.push(segment);
            else if (speedKts < 20) buckets.fast.push(segment);
            else buckets.turbo.push(segment);
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

                    {/* Render Buckets with Colors */}
                    <Polyline positions={buckets.stopped} pathOptions={{ color: '#7f8c8d', weight: 3, opacity: 0.6 }} /> {/* Grey */}
                    <Polyline positions={buckets.crawl} pathOptions={{ color: '#c0392b', weight: 4 }} />   {/* Deep Red */}
                    <Polyline positions={buckets.slow} pathOptions={{ color: '#e74c3c', weight: 4 }} />    {/* Red */}
                    <Polyline positions={buckets.gap1} pathOptions={{ color: '#d35400', weight: 4 }} />   {/* Dk Orange (4-5) */}
                    <Polyline positions={buckets.takeoff} pathOptions={{ color: '#f39c12', weight: 4 }} /> {/* Orange */}
                    <Polyline positions={buckets.gap2} pathOptions={{ color: '#f1c40f', weight: 4 }} />    {/* Yellow (7-10) */}
                    <Polyline positions={buckets.planing} pathOptions={{ color: '#2ecc71', weight: 4 }} /> {/* Green */}
                    <Polyline positions={buckets.fast} pathOptions={{ color: '#3498db', weight: 4 }} />    {/* Blue */}
                    <Polyline positions={buckets.turbo} pathOptions={{ color: '#9b59b6', weight: 4 }} />   {/* Purple */}

                    <Marker position={start}><Popup>Start</Popup></Marker>
                    <Marker position={end}><Popup>End</Popup></Marker>

                    {/* Legend Overlay */}
                    <div className="leaflet-bottom leaflet-right" style={{ pointerEvents: 'none', margin: '10px', marginBottom: '20px' }}>
                        <div className="leaflet-control" style={{ background: 'rgba(0,0,0,0.8)', padding: '8px', borderRadius: '4px', color: 'white', fontSize: '0.75rem', pointerEvents: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ display: 'block', width: '10px', height: '10px', background: '#7f8c8d' }}></span> &lt; 2</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ display: 'block', width: '10px', height: '10px', background: '#c0392b' }}></span> 2-3</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ display: 'block', width: '10px', height: '10px', background: '#e74c3c' }}></span> 3-4</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ display: 'block', width: '10px', height: '10px', background: '#f39c12' }}></span> 5-7</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ display: 'block', width: '10px', height: '10px', background: '#2ecc71' }}></span> 10-15</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ display: 'block', width: '10px', height: '10px', background: '#3498db' }}></span> 15-20</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}><span style={{ display: 'block', width: '10px', height: '10px', background: '#9b59b6' }}></span> &gt; 20</div>
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
