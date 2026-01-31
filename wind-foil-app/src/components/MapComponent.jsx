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

const MapComponent = ({ lat, lng, name = "Launch Spot" }) => {
    // We use a key on MapContainer to force re-initialization when coordinates change
    const mapKey = `${lat}-${lng}`;

    return (
        <div style={{ height: '300px', width: '100%', borderRadius: '12px', overflow: 'hidden' }}>
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
                <Marker position={[lat, lng]}>
                    <Popup>
                        {name}<br /> Windsport Location
                    </Popup>
                </Marker>
            </MapContainer>
        </div>
    );
};

export default MapComponent;
