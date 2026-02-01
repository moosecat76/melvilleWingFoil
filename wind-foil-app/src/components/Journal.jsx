import React, { useState, useEffect } from 'react';
import { useLocation } from '../context/LocationContext';
import { getJournalEntries, addJournalEntry, deleteJournalEntry } from '../services/journalService';
import { Book, Plus, Trash2, Calendar, Wind, Clock, MapPin, X } from 'lucide-react';
import { format } from 'date-fns';

const Journal = ({ weatherData, userGear = [], onAddGear }) => {
    const { currentLocation } = useLocation();
    const [entries, setEntries] = useState([]);
    const [isAdding, setIsAdding] = useState(false);

    // Form State
    const [logDate, setLogDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [logTime, setLogTime] = useState(format(new Date(), 'HH:mm'));

    const [newEntry, setNewEntry] = useState({
        notes: '',
        rating: 5,
        gearUsed: '',
        windSpeed: '',
        windGusts: '',
        windDirection: ''
    });

    const handleAddGearToEntry = (gearItem) => {
        const gearString = `${gearItem.size}m ${gearItem.model}`;
        setNewEntry(prev => {
            const current = prev.gearUsed;
            return {
                ...prev,
                gearUsed: current ? `${current}, ${gearString}` : gearString
            };
        });
    };

    useEffect(() => {
        // Load all entries
        setEntries(getJournalEntries());
    }, [currentLocation]); // Reload if location changes (just to be safe, though global list doesn't depend on location)

    // Smart Fill Logic
    useEffect(() => {
        if (!isAdding || !weatherData || weatherData.length === 0) return;

        const target = new Date(`${logDate}T${logTime}`);

        // Find closest weather data point
        const closest = weatherData.reduce((prev, curr) =>
            Math.abs(curr.rawDate - target) < Math.abs(prev.rawDate - target) ? curr : prev
        );

        if (closest && Math.abs(closest.rawDate - target) < 2 * 60 * 60 * 1000) { // Within 2 hours
            // Only auto-fill if fields are empty or match previous auto-fill (simplified: just fill)
            // We'll trust the user to edit if wrong.
            setNewEntry(prev => ({
                ...prev,
                windSpeed: (closest.speed * 0.539957).toFixed(1), // Store as Knots by default
                windGusts: (closest.gusts * 0.539957).toFixed(1), // Store as Knots
                windDirection: closest.direction
            }));
        }
    }, [logDate, logTime, isAdding, weatherData]);

    const handleAdd = (e) => {
        e.preventDefault();
        const added = addJournalEntry({
            locationId: currentLocation.id,
            locationName: currentLocation.name,
            date: new Date(`${logDate}T${logTime}`).toISOString(), // Use selected time
            notes: newEntry.notes,
            rating: parseInt(newEntry.rating),
            gearUsed: newEntry.gearUsed,
            windSpeed: newEntry.windSpeed,
            windGusts: newEntry.windGusts,
            windDirection: newEntry.windDirection
        });
        setEntries([added, ...entries]);

        // Reset
        setNewEntry({ notes: '', rating: 5, gearUsed: '', windSpeed: '', windGusts: '', windDirection: '' });
        setIsAdding(false);
    };

    const handleDelete = (id) => {
        deleteJournalEntry(id);
        setEntries(entries.filter(e => e.id !== id));
    };

    return (
        <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <Book size={20} />
                    Session Journal
                </h3>
                <button
                    onClick={() => setIsAdding(!isAdding)}
                    className="btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                >
                    {isAdding ? 'Cancel' : 'Log Session'}
                </button>
            </div>

            {isAdding && (
                <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '1.5rem', padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Date</label>
                            <input
                                type="date"
                                value={logDate}
                                onChange={e => setLogDate(e.target.value)}
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Time</label>
                            <input
                                type="time"
                                value={logTime}
                                onChange={e => setLogTime(e.target.value)}
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Wind (kts)</label>
                            <input
                                value={newEntry.windSpeed}
                                onChange={e => setNewEntry({ ...newEntry, windSpeed: e.target.value })}
                                placeholder="Speed"
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gusts (kts)</label>
                            <input
                                value={newEntry.windGusts}
                                onChange={e => setNewEntry({ ...newEntry, windGusts: e.target.value })}
                                placeholder="Gusts"
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Dir (°)</label>
                            <input
                                value={newEntry.windDirection}
                                onChange={e => setNewEntry({ ...newEntry, windDirection: e.target.value })}
                                placeholder="Deg"
                                style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                            />
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.9rem' }}>Gear Used</label>

                        {/* Selected Gear Chips */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                            {newEntry.gearUsed.split(', ').filter(g => g.trim() !== '').map((gearStr, idx) => (
                                <div key={idx} style={{
                                    background: 'var(--accent-primary)',
                                    color: 'black',
                                    padding: '4px 8px',
                                    borderRadius: '16px',
                                    fontSize: '0.8rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    <span>{gearStr}</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const currentList = newEntry.gearUsed.split(', ').filter(g => g.trim() !== '');
                                            const newList = currentList.filter((_, i) => i !== idx);
                                            setNewEntry({ ...newEntry, gearUsed: newList.join(', ') });
                                        }}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex' }}
                                    >
                                        <X size={14} color="black" />
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Gear Dropdown & Add New */}
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <select
                                value=""
                                onChange={(e) => {
                                    if (e.target.value) {
                                        handleAddGearToEntry(JSON.parse(e.target.value));
                                    }
                                }}
                                style={{
                                    flex: 1,
                                    padding: '8px',
                                    borderRadius: '4px',
                                    border: '1px solid var(--border-color)',
                                    background: 'var(--bg-secondary)',
                                    color: 'white'
                                }}
                            >
                                <option value="">Select Gear from Quiver...</option>
                                {userGear.map(gear => (
                                    <option key={gear.id} value={JSON.stringify(gear)}>
                                        {gear.size}m {gear.model}
                                    </option>
                                ))}
                            </select>

                            <button
                                type="button"
                                onClick={onAddGear}
                                style={{
                                    background: 'none', border: '1px solid var(--accent-primary)',
                                    color: 'var(--accent-primary)', padding: '0 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem'
                                }}
                            >
                                <Plus size={16} /> Add New
                            </button>
                        </div>
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.9rem' }}>Notes</label>
                        <textarea
                            value={newEntry.notes}
                            onChange={e => setNewEntry({ ...newEntry, notes: e.target.value })}
                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit', minHeight: '60px' }}
                            required
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.9rem' }}>Rating (1-5)</label>
                        <input
                            type="range" min="1" max="5"
                            value={newEntry.rating}
                            onChange={e => setNewEntry({ ...newEntry, rating: e.target.value })}
                            style={{ width: '100%' }}
                        />
                        <div style={{ textAlign: 'center' }}>{newEntry.rating} / 5</div>
                    </div>
                    <button type="submit" className="btn-primary">Save Entry</button>
                </form>
            )}

            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                {entries.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center' }}>No sessions recorded yet.</p>
                ) : (
                    entries.map(entry => (
                        <div key={entry.id} style={{
                            padding: '12px',
                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                            marginBottom: '8px'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                                <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    <MapPin size={12} /> {entry.locationName || 'Unknown Location'}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Clock size={14} />
                                    {format(new Date(entry.date), 'dd MMM h:mm a')}
                                </span>
                                <span style={{ color: 'var(--primary-color)', fontWeight: 'bold' }}>{entry.rating}/5</span>
                            </div>

                            {/* Weather Snapshot */}
                            {(entry.windSpeed || entry.windDirection) && (
                                <div style={{ display: 'flex', gap: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: '4px' }}>
                                    {entry.windSpeed && <span><Wind size={12} style={{ display: 'inline' }} /> {entry.windSpeed} kts</span>}
                                    {entry.windGusts && <span>(Gust {entry.windGusts})</span>}
                                    {entry.windDirection && <span>{entry.windDirection}°</span>}
                                </div>
                            )}

                            <p style={{ margin: '4px 0' }}>{entry.notes}</p>
                            {entry.gearUsed && <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: 0 }}>Gear: {entry.gearUsed}</p>}
                            <div style={{ textAlign: 'right', marginTop: '4px' }}>
                                <button
                                    onClick={() => handleDelete(entry.id)}
                                    style={{ background: 'transparent', border: 'none', color: '#ff6b6b', cursor: 'pointer', fontSize: '0.8rem' }}
                                >
                                    Remove
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default Journal;
