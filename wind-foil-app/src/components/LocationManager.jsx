import React, { useState } from 'react';
import { useLocation, isValidCoordinates } from '../context/LocationContext';
import { useToast } from '../context/ToastContext';
import { MapPin, Plus, Trash2, X, Edit2, Save, Compass, Map, AlertCircle } from 'lucide-react';
import { MapContainer, TileLayer, Marker, Polygon, useMapEvents } from 'react-leaflet';
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

const SECTOR_PRESETS = [
    { label: 'SW', min: 200, max: 250, desc: '200°–250° (Fremantle Doctor)' },
    { label: 'S-SW', min: 180, max: 240, desc: '180°–240°' },
    { label: 'W', min: 250, max: 290, desc: '250°–290°' },
    { label: 'NW-NE', min: 315, max: 45, desc: '315°–45° (Northerly wrap)' },
    { label: 'E', min: 70, max: 110, desc: '70°–110° (Morning easterly)' },
    { label: 'All-Round', min: 0, max: 360, desc: '0°–360°' },
];

const computeSectorPoints = (centerLat, centerLng, minDeg, maxDeg, radiusKm = 1.2) => {
    if (minDeg == null || maxDeg == null || isNaN(minDeg) || isNaN(maxDeg)) return null;
    const points = [[centerLat, centerLng]];
    let start = Number(minDeg);
    let end = Number(maxDeg);
    if (end < start) end += 360;
    const span = end - start;
    const steps = Math.max(12, Math.round(span / 10));

    for (let i = 0; i <= steps; i++) {
        const deg = start + (span * i) / steps;
        const rad = (deg * Math.PI) / 180;
        const ptLat = centerLat + (radiusKm / 110.574) * Math.cos(rad);
        const ptLng = centerLng + (radiusKm / (111.320 * Math.cos((centerLat * Math.PI) / 180))) * Math.sin(rad);
        points.push([ptLat, ptLng]);
    }
    points.push([centerLat, centerLng]);
    return points;
};

const MapClickHandler = ({ onPick }) => {
    useMapEvents({
        click(e) {
            onPick(e.latlng.lat.toFixed(6), e.latlng.lng.toFixed(6));
        }
    });
    return null;
};

const LocationPickerMap = ({ lat, lon, idealMin, idealMax, onPick }) => {
    const rawLat = parseFloat(lat);
    const rawLon = parseFloat(lon);
    const parsedLat = (!isNaN(rawLat) && rawLat >= -90 && rawLat <= 90) ? rawLat : -32.013032;
    const parsedLon = (!isNaN(rawLon) && rawLon >= -180 && rawLon <= 180) ? rawLon : 115.829474;
    const center = [parsedLat, parsedLon];
    const sectorPoints = computeSectorPoints(parsedLat, parsedLon, idealMin, idealMax);

    return (
        <div style={{ height: '210px', width: '100%', borderRadius: '8px', overflow: 'hidden', marginTop: '6px', border: '1px solid var(--border-color)', position: 'relative' }}>
            <MapContainer center={center} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={center} />
                {sectorPoints && (
                    <Polygon
                        positions={sectorPoints}
                        pathOptions={{
                            color: '#38bdf8',
                            fillColor: '#38bdf8',
                            fillOpacity: 0.22,
                            weight: 2,
                            dashArray: '4 4'
                        }}
                    />
                )}
                <MapClickHandler onPick={onPick} />
            </MapContainer>
            <div style={{
                position: 'absolute', bottom: '6px', left: '6px', zIndex: 1000,
                background: 'rgba(15, 23, 42, 0.85)', padding: '4px 8px', borderRadius: '4px',
                fontSize: '0.72rem', color: 'var(--text-secondary)'
            }}>
                Click anywhere on map to set coordinates
            </div>
        </div>
    );
};

const normalizeAndValidateCoords = (rawLat, rawLon) => {
    let lat = parseFloat(rawLat);
    let lon = parseFloat(rawLon);
    let swapped = false;

    if (!isNaN(lat) && !isNaN(lon) && Math.abs(lat) > 90 && Math.abs(lat) <= 180 && Math.abs(lon) <= 90) {
        const tmp = lat;
        lat = lon;
        lon = tmp;
        swapped = true;
    }

    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return { valid: false, error: 'Latitude must be between -90 and 90, and Longitude between -180 and 180.' };
    }

    return { valid: true, lat, lon, swapped };
};

const LocationManager = () => {
    const { locations, currentLocation, switchLocation, addLocation, deleteLocation, updateLocation } = useLocation();
    const { showToast } = useToast();
    const [isAdding, setIsAdding] = useState(false);
    const [showAddMap, setShowAddMap] = useState(false);
    const [newLoc, setNewLoc] = useState({ name: '', lat: '', lon: '', idealMin: '135', idealMax: '270' });

    // Editing State
    const [editingId, setEditingId] = useState(null);
    const [showEditMap, setShowEditMap] = useState(false);
    const [editForm, setEditForm] = useState({});

    const handleAdd = (e) => {
        e.preventDefault();
        if (newLoc.name && newLoc.lat !== '' && newLoc.lon !== '') {
            const check = normalizeAndValidateCoords(newLoc.lat, newLoc.lon);
            if (!check.valid) {
                showToast(check.error, 'error');
                return;
            }
            if (check.swapped) {
                showToast('Auto-swapped Latitude & Longitude to valid ranges', 'info');
            }
            addLocation(newLoc.name, check.lat, check.lon, newLoc.idealMin, newLoc.idealMax);
            setNewLoc({ name: '', lat: '', lon: '', idealMin: '135', idealMax: '270' });
            setShowAddMap(false);
            setIsAdding(false);
        }
    };

    const startEditing = (e, loc) => {
        e.stopPropagation();
        setEditingId(loc.id);
        setShowEditMap(false);
        setEditForm({
            name: loc.name,
            lat: loc.latitude,
            lon: loc.longitude,
            idealMin: loc.idealWindDirection?.min ?? '135',
            idealMax: loc.idealWindDirection?.max ?? '270'
        });
    };

    const handleUpdate = (e) => {
        e.preventDefault();
        const check = normalizeAndValidateCoords(editForm.lat, editForm.lon);
        if (!check.valid) {
            showToast(check.error, 'error');
            return;
        }
        if (check.swapped) {
            showToast('Auto-swapped Latitude & Longitude to valid ranges', 'info');
        }
        updateLocation(editingId, {
            name: editForm.name,
            latitude: check.lat,
            longitude: check.lon,
            idealMin: editForm.idealMin,
            idealMax: editForm.idealMax
        });
        setEditingId(null);
        setShowEditMap(false);
        showToast('Location updated', 'success');
    };

    return (
        <div className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <MapPin size={20} />
                    {currentLocation.name}
                </h3>
                <button
                    onClick={() => {
                        setIsAdding(!isAdding);
                        setShowAddMap(false);
                    }}
                    className="btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                >
                    {isAdding ? <X size={16} /> : <Plus size={16} />}
                </button>
            </div>

            {/* ── Add Location Form ── */}
            {isAdding && (
                <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1rem', padding: '12px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                    <input
                        placeholder="Location Name (e.g. Woodman Point)"
                        value={newLoc.name}
                        onChange={e => setNewLoc({ ...newLoc, name: e.target.value })}
                        style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                        required
                    />

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                            placeholder="Lat (e.g. -32.01)"
                            type="number" step="any"
                            value={newLoc.lat}
                            onChange={e => setNewLoc({ ...newLoc, lat: e.target.value })}
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                            required
                        />
                        <input
                            placeholder="Lon (e.g. 115.83)"
                            type="number" step="any"
                            value={newLoc.lon}
                            onChange={e => setNewLoc({ ...newLoc, lon: e.target.value })}
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                            required
                        />
                        <button
                            type="button"
                            onClick={() => setShowAddMap(!showAddMap)}
                            className="btn-secondary"
                            style={{ padding: '8px 12px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                            title="Pick coordinates on map"
                        >
                            <Map size={14} /> {showAddMap ? 'Hide Map' : 'Map Picker'}
                        </button>
                    </div>

                    {showAddMap && (
                        <LocationPickerMap
                            lat={newLoc.lat}
                            lon={newLoc.lon}
                            idealMin={newLoc.idealMin}
                            idealMax={newLoc.idealMax}
                            onPick={(lat, lon) => setNewLoc(prev => ({ ...prev, lat, lon }))}
                        />
                    )}

                    {/* Cardinal Presets */}
                    <div style={{ marginTop: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                            <Compass size={12} /> Wind Sector Presets:
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {SECTOR_PRESETS.map(preset => (
                                <button
                                    key={preset.label}
                                    type="button"
                                    onClick={() => setNewLoc({ ...newLoc, idealMin: String(preset.min), idealMax: String(preset.max) })}
                                    style={{
                                        fontSize: '0.72rem',
                                        padding: '3px 8px',
                                        borderRadius: '12px',
                                        border: '1px solid var(--border-color)',
                                        background: (newLoc.idealMin === String(preset.min) && newLoc.idealMax === String(preset.max)) ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.04)',
                                        color: (newLoc.idealMin === String(preset.min) && newLoc.idealMax === String(preset.max)) ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                        cursor: 'pointer'
                                    }}
                                    title={preset.desc}
                                >
                                    {preset.label} ({preset.min}°–{preset.max}°)
                                </button>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', minWidth: '70px' }}>Custom Sector:</label>
                        <input
                            placeholder="Min °"
                            type="number"
                            value={newLoc.idealMin}
                            onChange={e => setNewLoc({ ...newLoc, idealMin: e.target.value })}
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                        />
                        <span style={{ color: 'var(--text-secondary)' }}>to</span>
                        <input
                            placeholder="Max °"
                            type="number"
                            value={newLoc.idealMax}
                            onChange={e => setNewLoc({ ...newLoc, idealMax: e.target.value })}
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                        />
                    </div>

                    <button type="submit" className="btn-primary" style={{ marginTop: '6px' }}>Add Location</button>
                </form>
            )}

            {/* ── Locations List ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {locations.map(loc => {
                    const isEditing = editingId === loc.id;
                    const isCurrent = currentLocation.id === loc.id;
                    const coordsValid = isValidCoordinates(loc.latitude, loc.longitude);

                    if (isEditing) {
                        return (
                            <form key={loc.id} onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', background: 'rgba(0,0,0,0.35)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                <input
                                    value={editForm.name}
                                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                    style={{ width: '100%', padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--accent-primary)', background: 'transparent', color: 'white' }}
                                    placeholder="Location Name"
                                    required
                                />
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <input
                                        type="number" step="any"
                                        value={editForm.lat}
                                        onChange={e => setEditForm({ ...editForm, lat: e.target.value })}
                                        style={{ flex: 1, padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'white' }}
                                        placeholder="Lat (-90 to 90)"
                                        required
                                    />
                                    <input
                                        type="number" step="any"
                                        value={editForm.lon}
                                        onChange={e => setEditForm({ ...editForm, lon: e.target.value })}
                                        style={{ flex: 1, padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'white' }}
                                        placeholder="Lon (-180 to 180)"
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowEditMap(!showEditMap)}
                                        className="btn-secondary"
                                        style={{ padding: '6px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
                                        title="Pick coordinates on map"
                                    >
                                        <Map size={13} /> {showEditMap ? 'Hide' : 'Map'}
                                    </button>
                                </div>

                                {showEditMap && (
                                    <LocationPickerMap
                                        lat={editForm.lat}
                                        lon={editForm.lon}
                                        idealMin={editForm.idealMin}
                                        idealMax={editForm.idealMax}
                                        onPick={(lat, lon) => setEditForm(prev => ({ ...prev, lat, lon }))}
                                    />
                                )}

                                {/* Cardinal Presets */}
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '2px' }}>
                                    {SECTOR_PRESETS.map(preset => (
                                        <button
                                            key={preset.label}
                                            type="button"
                                            onClick={() => setEditForm({ ...editForm, idealMin: String(preset.min), idealMax: String(preset.max) })}
                                            style={{
                                                fontSize: '0.7rem',
                                                padding: '2px 6px',
                                                borderRadius: '10px',
                                                border: '1px solid var(--border-color)',
                                                background: (editForm.idealMin === String(preset.min) && editForm.idealMax === String(preset.max)) ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255,255,255,0.04)',
                                                color: (editForm.idealMin === String(preset.min) && editForm.idealMax === String(preset.max)) ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            {preset.label}
                                        </button>
                                    ))}
                                </div>

                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <input
                                        type="number"
                                        value={editForm.idealMin}
                                        onChange={e => setEditForm({ ...editForm, idealMin: e.target.value })}
                                        placeholder="Min °"
                                        style={{ flex: 1, padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'white' }}
                                    />
                                    <span style={{ color: 'var(--text-secondary)' }}>to</span>
                                    <input
                                        type="number"
                                        value={editForm.idealMax}
                                        onChange={e => setEditForm({ ...editForm, idealMax: e.target.value })}
                                        placeholder="Max °"
                                        style={{ flex: 1, padding: '6px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'white' }}
                                    />
                                    <button type="submit" style={{ background: 'var(--accent-primary)', border: 'none', borderRadius: '4px', padding: '6px 10px', color: 'white', cursor: 'pointer' }} title="Save">
                                        <Save size={16} />
                                    </button>
                                    <button type="button" onClick={() => { setEditingId(null); setShowEditMap(false); }} style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px 10px', color: 'white', cursor: 'pointer' }} title="Cancel">
                                        <X size={16} />
                                    </button>
                                </div>
                            </form>
                        );
                    }

                    return (
                        <div
                            key={loc.id}
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                padding: '8px 12px',
                                background: isCurrent ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255,255,255,0.05)',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                border: !coordsValid
                                    ? '1px solid #f87171'
                                    : isCurrent
                                        ? '1px solid var(--accent-primary)'
                                        : '1px solid transparent'
                            }}
                            onClick={() => switchLocation(loc.id)}
                        >
                            <div>
                                <span style={{ fontWeight: isCurrent ? 'bold' : 'normal', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    {loc.name}
                                    {!coordsValid && (
                                        <span style={{ fontSize: '0.68rem', color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                            <AlertCircle size={12} /> Invalid Lat/Lon
                                        </span>
                                    )}
                                </span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                    {Number(loc.latitude).toFixed(4)}, {Number(loc.longitude).toFixed(4)}
                                    {loc.idealWindDirection ? ` · Sector: ${loc.idealWindDirection.min}°–${loc.idealWindDirection.max}°` : ''}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <button
                                    onClick={(e) => startEditing(e, loc)}
                                    style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}
                                    title="Edit Location"
                                >
                                    <Edit2 size={14} />
                                </button>
                                {loc.id !== 'melville' && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); deleteLocation(loc.id); }}
                                        style={{ background: 'transparent', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: '4px' }}
                                        title="Delete Location"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default LocationManager;
