import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icon missing in React-Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

let DefaultIcon = L.icon({
    iconUrl: icon,
    shadowUrl: iconShadow,
    iconSize: [25, 41],
    iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

/**
 * Calculates polygon coordinates for an ideal wind sector originating at center
 */
const computeSectorPoints = (centerLat, centerLng, minDeg, maxDeg, radiusKm = 1.6) => {
    if (minDeg == null || maxDeg == null || isNaN(minDeg) || isNaN(maxDeg)) return null;

    const points = [[centerLat, centerLng]];

    let start = Number(minDeg);
    let end = Number(maxDeg);
    if (end < start) end += 360;

    const span = end - start;
    const steps = Math.max(12, Math.round(span / 10));

    for (let i = 0; i <= steps; i++) {
        const deg = start + (span * i) / steps;
        // Direction wind comes from (0 = North, 90 = East, 180 = South, 270 = West)
        const rad = (deg * Math.PI) / 180;
        const ptLat = centerLat + (radiusKm / 110.574) * Math.cos(rad);
        const ptLng = centerLng + (radiusKm / (111.320 * Math.cos((centerLat * Math.PI) / 180))) * Math.sin(rad);
        points.push([ptLat, ptLng]);
    }

    points.push([centerLat, centerLng]);
    return points;
};

const MapComponent = ({ lat, lng, name = "Launch Spot", windDirection, idealWindDirection }) => {
    const mapKey = `${lat}-${lng}`;

    let windIcon = null;
    if (windDirection != null) {
        const arrowHtml = `
            <div style="position: relative; width: 40px; height: 40px; background: #0f172a; border: 2px solid var(--accent-primary); border-radius: 50%; display: flex; justify-content: center; align-items: center; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${windDirection + 180}deg);">
                    <line x1="12" y1="19" x2="12" y2="5"></line>
                    <polyline points="5 12 12 5 19 12"></polyline>
                </svg>
            </div>
        `;

        windIcon = L.divIcon({
            html: arrowHtml,
            className: 'custom-wind-icon',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
    }

    const sectorPoints = idealWindDirection
        ? computeSectorPoints(lat, lng, idealWindDirection.min, idealWindDirection.max)
        : null;

    return (
        <div style={{ height: '320px', width: '100%', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
            <MapContainer
                key={mapKey}
                center={[lat, lng]}
                zoom={13}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={false}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {sectorPoints && (
                    <Polygon
                        positions={sectorPoints}
                        pathOptions={{
                            color: '#4ade80',
                            weight: 1.5,
                            dashArray: '4, 4',
                            fillColor: '#4ade80',
                            fillOpacity: 0.15,
                        }}
                    >
                        <Popup>
                            <strong>Ideal Wind Window</strong><br />
                            {idealWindDirection.min}° – {idealWindDirection.max}°
                        </Popup>
                    </Polygon>
                )}

                <Marker key={windDirection || 'default'} position={[lat, lng]} icon={windIcon || DefaultIcon}>
                    <Popup>
                        <strong>{name}</strong><br />
                        {windDirection != null ? `Live Wind: ${windDirection}°` : 'Launch Point'}
                    </Popup>
                </Marker>
            </MapContainer>

            {/* Corner Badge */}
            <div style={{
                position: 'absolute',
                bottom: '10px',
                left: '10px',
                background: 'rgba(15, 23, 42, 0.85)',
                backdropFilter: 'blur(8px)',
                padding: '6px 10px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
                zIndex: 400,
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                pointerEvents: 'none',
            }}>
                {idealWindDirection && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ display: 'inline-block', width: '10px', height: '10px', background: 'rgba(74, 222, 128, 0.3)', border: '1px dashed #4ade80', borderRadius: '2px' }} />
                        <span>Ideal: <strong>{idealWindDirection.min}° – {idealWindDirection.max}°</strong></span>
                    </div>
                )}
                {windDirection != null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--accent-primary)' }} />
                        <span>Live: <strong>{windDirection}°</strong></span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MapComponent;
