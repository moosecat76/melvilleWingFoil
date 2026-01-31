import React, { useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { MapPin, Plus, Trash2, X } from 'lucide-react';

const LocationManager = () => {
    const { locations, currentLocation, switchLocation, addLocation, deleteLocation } = useLocation();
    const [isAdding, setIsAdding] = useState(false);
    const [newLoc, setNewLoc] = useState({ name: '', lat: '', lon: '', idealMin: '135', idealMax: '270' });

    const handleAdd = (e) => {
        e.preventDefault();
        if (newLoc.name && newLoc.lat && newLoc.lon) {
            addLocation(newLoc.name, newLoc.lat, newLoc.lon, newLoc.idealMin, newLoc.idealMax);
            setNewLoc({ name: '', lat: '', lon: '', idealMin: '135', idealMax: '270' });
            setIsAdding(false);
        }
    };

    return (
        <div className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <MapPin size={20} />
                    {currentLocation.name}
                </h3>
                <button
                    onClick={() => setIsAdding(!isAdding)}
                    className="btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                >
                    {isAdding ? <X size={16} /> : <Plus size={16} />}
                </button>
            </div>

            {isAdding && (
                <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '1rem', padding: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                    <input
                        placeholder="Location Name"
                        value={newLoc.name}
                        onChange={e => setNewLoc({ ...newLoc, name: e.target.value })}
                        style={{ padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                            placeholder="Latitude"
                            type="number" step="any"
                            value={newLoc.lat}
                            onChange={e => setNewLoc({ ...newLoc, lat: e.target.value })}
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                        />
                        <input
                            placeholder="Longitude"
                            type="number" step="any"
                            value={newLoc.lon}
                            onChange={e => setNewLoc({ ...newLoc, lon: e.target.value })}
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Ideal Dir (Min/Max):</label>
                        <input
                            placeholder="Min Deg"
                            type="number"
                            value={newLoc.idealMin}
                            onChange={e => setNewLoc({ ...newLoc, idealMin: e.target.value })}
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                        />
                        <input
                            placeholder="Max Deg"
                            type="number"
                            value={newLoc.idealMax}
                            onChange={e => setNewLoc({ ...newLoc, idealMax: e.target.value })}
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                        />
                    </div>
                    <button type="submit" className="btn-primary" style={{ marginTop: '4px' }}>Add Location</button>
                </form>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {locations.map(loc => (
                    <div
                        key={loc.id}
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: '8px',
                            background: currentLocation.id === loc.id ? 'var(--primary-color)' : 'rgba(255,255,255,0.05)',
                            borderRadius: '6px',
                            cursor: 'pointer'
                        }}
                        onClick={() => switchLocation(loc.id)}
                    >
                        <span>{loc.name}</span>
                        {loc.id !== 'melville' && (
                            <button
                                onClick={(e) => { e.stopPropagation(); deleteLocation(loc.id); }}
                                style={{ background: 'transparent', border: 'none', color: '#ff6b6b', cursor: 'pointer' }}
                            >
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default LocationManager;
