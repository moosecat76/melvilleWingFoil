import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
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

const MapComponent = ({ lat, lng, name = "Launch Spot", windDirection }) => {
    // We use a key on MapContainer to force re-initialization when coordinates change
    const mapKey = `${lat}-${lng}`;

    // Create a custom icon for the wind direction arrow if direction is provided
    let windIcon = null;
    if (windDirection != null) {
        // Use a generic SVG arrow since ReactDOMServer can cause browser bundling issues in Vite
        const arrowHtml = `
            <div style="position: relative; width: 40px; height: 40px; background: var(--bg-secondary); border: 2px solid var(--accent-primary); border-radius: 50%; display: flex; justify-content: center; align-items: center; box-shadow: 0 4px 6px rgba(0,0,0,0.3);">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(${windDirection + 180}deg);">
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

    return (
        <div style={{ height: '300px', width: '100%', borderRadius: '12px', overflow: 'hidden', position: 'relative' }}>
            <MapContainer
                key={mapKey}
                center={[lat, lng]}
                zoom={13}
                style={{ height: '100%', width: '100%' }}
                scrollWheelZoom={false}
            >
                <TileLayer
                    // Using CartoDB Dark Matter tiles for dark mode aesthetic
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                />
                <Marker key={windDirection || 'default'} position={[lat, lng]} icon={windIcon || DefaultIcon}>
                    <Popup>
                        {name}<br /> Windsport Location
                    </Popup>
                </Marker>
            </MapContainer>
        </div>
    );
};

export default MapComponent;
