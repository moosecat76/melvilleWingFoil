import React, { useState } from 'react';
import { useLocation } from '../context/LocationContext';
import { MapPin, Plus, Trash2, X, Edit2, Save } from 'lucide-react';

const LocationManager = () => {
    const { locations, currentLocation, switchLocation, addLocation, deleteLocation, updateLocation } = useLocation();
    const [isAdding, setIsAdding] = useState(false);
    const [newLoc, setNewLoc] = useState({ name: '', lat: '', lon: '', idealMin: '135', idealMax: '270' });

    // Editing State
    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({});

    const handleAdd = (e) => {
        e.preventDefault();
        if (newLoc.name && newLoc.lat && newLoc.lon) {
            addLocation(newLoc.name, newLoc.lat, newLoc.lon, newLoc.idealMin, newLoc.idealMax);
            setNewLoc({ name: '', lat: '', lon: '', idealMin: '135', idealMax: '270' });
            setIsAdding(false);
        }
    };

    const startEditing = (e, loc) => {
        e.stopPropagation();
        setEditingId(loc.id);
        setEditForm({
            name: loc.name,
            lat: loc.latitude,
            lon: loc.longitude,
            idealMin: loc.idealWindDirection.min,
            idealMax: loc.idealWindDirection.max
        });
    };

    const handleUpdate = (e) => {
        e.preventDefault();
        updateLocation(editingId, {
            name: editForm.name,
            latitude: parseFloat(editForm.lat),
            longitude: parseFloat(editForm.lon),
            idealMin: editForm.idealMin,
            idealMax: editForm.idealMax
        });
        setEditingId(null);
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
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Ideal Dir:</label>
                        <input
                            placeholder="Min"
                            type="number"
                            value={newLoc.idealMin}
                            onChange={e => setNewLoc({ ...newLoc, idealMin: e.target.value })}
                            style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                        />
                        <input
                            placeholder="Max"
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
                {locations.map(loc => {
                    const isEditing = editingId === loc.id;
                    const isCurrent = currentLocation.id === loc.id;

                    if (isEditing) {
                        return (
                            <form key={loc.id} onSubmit={handleUpdate} style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '8px', background: 'rgba(0,0,0,0.3)', borderRadius: '6px' }}>
                                <input
                                    value={editForm.name}
                                    onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                                    style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid var(--accent-primary)', background: 'transparent', color: 'white' }}
                                />
                                <div style={{ display: 'flex', gap: '6px' }}>
                                    <input
                                        type="number" step="any"
                                        value={editForm.lat}
                                        onChange={e => setEditForm({ ...editForm, lat: e.target.value })}
                                        style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'white' }}
                                    />
                                    <input
                                        type="number" step="any"
                                        value={editForm.lon}
                                        onChange={e => setEditForm({ ...editForm, lon: e.target.value })}
                                        style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'white' }}
                                    />
                                </div>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                    <input
                                        type="number"
                                        value={editForm.idealMin}
                                        onChange={e => setEditForm({ ...editForm, idealMin: e.target.value })}
                                        placeholder="Min"
                                        style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'white' }}
                                    />
                                    <input
                                        type="number"
                                        value={editForm.idealMax}
                                        onChange={e => setEditForm({ ...editForm, idealMax: e.target.value })}
                                        placeholder="Max"
                                        style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'white' }}
                                    />
                                    <button type="submit" style={{ background: 'var(--accent-primary)', border: 'none', borderRadius: '4px', padding: '6px', color: 'white', cursor: 'pointer' }}>
                                        <Save size={16} />
                                    </button>
                                    <button type="button" onClick={() => setEditingId(null)} style={{ background: 'transparent', border: '1px solid var(--border-color)', borderRadius: '4px', padding: '6px', color: 'white', cursor: 'pointer' }}>
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
                                padding: '8px',
                                background: isCurrent ? 'var(--primary-color)' : 'rgba(255,255,255,0.05)',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                border: isCurrent ? '1px solid var(--accent-primary)' : 'none'
                            }}
                            onClick={() => switchLocation(loc.id)}
                        >
                            <span style={{ fontWeight: isCurrent ? 'bold' : 'normal' }}>{loc.name}</span>
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
