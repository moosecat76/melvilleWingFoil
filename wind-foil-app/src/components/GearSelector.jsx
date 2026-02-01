import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Save, X } from 'lucide-react';

const GearSelector = ({ currentGear, onSave, onClose }) => {
    const [items, setItems] = useState(currentGear || []);
    const [newItem, setNewItem] = useState({ type: 'wing', size: '', model: '' });

    const handleAddItem = () => {
        if (!newItem.size || !newItem.model) return;
        setItems([...items, { ...newItem, id: Date.now() }]);
        setNewItem({ type: 'wing', size: '', model: '' });
    };

    const handleDelete = (id) => {
        setItems(items.filter(i => i.id !== id));
    };

    const handleSave = () => {
        onSave(items);
        onClose();
    };

    return (
        <div className="glass-panel" style={{ padding: '1.5rem', position: 'relative', border: '1px solid var(--accent-primary)' }}>
            <button
                onClick={onClose}
                style={{ position: 'absolute', top: '10px', right: '10px', background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
                <X size={20} />
            </button>

            <h3 className="card-title" style={{ marginBottom: '1rem' }}>Manage My Quiver</h3>

            {/* List Existing */}
            <div style={{ marginBottom: '1.5rem', maxHeight: '150px', overflowY: 'auto' }}>
                {items.length === 0 && <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>No gear added yet.</p>}
                {items.map(item => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem', background: 'var(--bg-secondary)', marginBottom: '0.5rem', borderRadius: '4px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '0.7em', textTransform: 'uppercase', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', padding: '1px 4px', borderRadius: '2px', minWidth: '40px', textAlign: 'center' }}>
                                {item.type || 'wing'}
                            </span>
                            <span>
                                <span style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                                    {item.size}{item.type === 'board' ? 'L' : item.type === 'foil' ? 'cm²' : 'm'}
                                </span> {item.model}
                            </span>
                        </span>
                        <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', color: '#ff4757', cursor: 'pointer' }}>
                            <Trash2 size={16} />
                        </button>
                    </div>
                ))}
            </div>

            {/* Add New */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr auto', gap: '0.5rem', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                <select
                    value={newItem.type}
                    onChange={e => setNewItem({ ...newItem, type: e.target.value })}
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', padding: '0.5rem', borderRadius: '4px', width: '100%' }}
                >
                    <option value="wing">Wing</option>
                    <option value="foil">Foil</option>
                    <option value="board">Board</option>
                </select>
                <input
                    type="number"
                    placeholder={newItem.type === 'board' ? 'Vol (L)' : newItem.type === 'foil' ? 'Area (cm²)' : 'Size (m²)'}
                    step={newItem.type === 'wing' ? '0.1' : '1'}
                    value={newItem.size}
                    onChange={e => setNewItem({ ...newItem, size: e.target.value })}
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', padding: '0.5rem', borderRadius: '4px', width: '100%' }}
                />
                <input
                    type="text"
                    placeholder="Model (e.g. Unit D/Lab)"
                    value={newItem.model}
                    onChange={e => setNewItem({ ...newItem, model: e.target.value })}
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'white', padding: '0.5rem', borderRadius: '4px', width: '100%' }}
                />
                <button
                    onClick={handleAddItem}
                    style={{ background: 'var(--accent-primary)', border: 'none', borderRadius: '4px', padding: '0.5rem', cursor: 'pointer', color: 'black' }}
                >
                    <Plus size={20} />
                </button>
            </div>

            <div style={{ marginTop: '1.5rem', textAlign: 'right' }}>
                <button
                    onClick={handleSave}
                    style={{ background: 'var(--status-success)', color: 'black', border: 'none', padding: '0.5rem 1rem', borderRadius: '4px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}
                >
                    <Save size={16} /> Save Quiver
                </button>
            </div>
        </div>
    );
};

export default GearSelector;
