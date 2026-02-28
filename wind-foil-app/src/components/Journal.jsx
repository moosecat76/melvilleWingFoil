import React, { useState, useEffect } from 'react';
import { useLocation } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { getJournalEntries, addJournalEntry, deleteJournalEntry, updateJournalEntry } from '../services/journalService';
import { Book, Plus, Trash2, Edit2, Calendar, Wind, Clock, MapPin, X, Activity } from 'lucide-react';
import { format } from 'date-fns';
import { getActivities, getStravaUser, getActivityStreams } from '../services/stravaService';
import SessionMap from './SessionMap';
import { analyzeSession } from '../services/foilAnalysisService';
import FoilAnalysisChart from './FoilAnalysisChart';

// Helper to calculate statistics (Legacy wrapper for backward compatibility or simple quick stats)
const legacyCalculateStats = (streams, maxSpeedMs = 0, distanceMeters = 0) => {
    const speedKts = maxSpeedMs * 1.94384;
    const distanceKm = distanceMeters / 1000;

    // Default fallback
    return { topSpeed: speedKts, distance: distanceKm };
};

const Journal = ({ weatherData, userGear = [], onAddGear }) => {
    const { currentLocation } = useLocation();
    const { user } = useAuth();
    const [entries, setEntries] = useState([]);
    const [isAdding, setIsAdding] = useState(false);
    const [editId, setEditId] = useState(null);
    const [activeTab, setActiveTab] = useState('details');
    const [stravaConnected, setStravaConnected] = useState(false);

    // Form State
    const [logDate, setLogDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [logTime, setLogTime] = useState(format(new Date(), 'HH:mm'));

    const [newEntry, setNewEntry] = useState({
        notes: '',
        rating: 5,
        gearUsed: '',
        windSpeed: '',
        windGusts: '',
        windDirection: '',
        activityStats: null,
        foilAnalysis: null
    });

    const handleAddGearToEntry = (gearItem) => {
        const unit = gearItem.type === 'board' ? 'L' : gearItem.type === 'foil' ? 'cm²' : 'm';
        const gearString = `${gearItem.size}${unit} ${gearItem.model}`;
        setNewEntry(prev => {
            const current = prev.gearUsed;
            return {
                ...prev,
                gearUsed: current ? `${current}, ${gearString}` : gearString
            };
        });
    };

    useEffect(() => {
        const fetchEntries = async () => {
            const data = await getJournalEntries(user?.uid);
            setEntries(data);
        };
        fetchEntries();
    }, [currentLocation, user?.uid]);

    // Check Strava connection status
    useEffect(() => {
        const checkStrava = async () => {
            const su = await getStravaUser(user?.uid);
            setStravaConnected(!!su);
        };
        checkStrava();
    }, [user?.uid]);

    // Smart Fill Logic
    useEffect(() => {
        if (!isAdding || editId || !weatherData || weatherData.length === 0) return;

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

    const handleAdd = async (e) => {
        e.preventDefault();

        const entryData = {
            locationId: currentLocation.id,
            locationName: currentLocation.name,
            date: new Date(`${logDate}T${logTime}`).toISOString(),
            notes: newEntry.notes,
            rating: parseInt(newEntry.rating),
            gearUsed: newEntry.gearUsed,
            windSpeed: newEntry.windSpeed,
            windGusts: newEntry.windGusts,
            windDirection: newEntry.windDirection,
            stravaActivityId: newEntry.stravaActivityId,
            mapPolyline: newEntry.mapPolyline,
            streams: newEntry.streams,
            activityStats: newEntry.activityStats,
            foilAnalysis: newEntry.foilAnalysis
        };

        if (editId) {
            const updated = await updateJournalEntry({ ...entryData, id: editId }, user?.uid);
            if (updated) {
                setEntries(entries.map(e => e.id === editId ? updated : e));
            }
        } else {
            const added = await addJournalEntry(entryData, user?.uid);
            setEntries([added, ...entries]);
        }

        // Reset
        setNewEntry({ notes: '', rating: 5, gearUsed: '', windSpeed: '', windGusts: '', windDirection: '', stravaActivityId: null, mapPolyline: null, activityStats: null, foilAnalysis: null });
        setIsAdding(false);
        setEditId(null);
        setShowActivityPicker(false);
    };

    const handleEdit = (entry) => {
        setEditId(entry.id);
        const dateObj = new Date(entry.date);
        setLogDate(format(dateObj, 'yyyy-MM-dd'));
        setLogTime(format(dateObj, 'HH:mm'));
        setNewEntry({
            notes: entry.notes,
            rating: entry.rating,
            gearUsed: entry.gearUsed || '',
            windSpeed: entry.windSpeed || '',
            windGusts: entry.windGusts || '',
            windDirection: entry.windDirection || '',
            stravaActivityId: entry.stravaActivityId || null,
            mapPolyline: entry.mapPolyline || null,
            streams: entry.streams || null,
            activityStats: entry.activityStats || null,
            foilAnalysis: entry.foilAnalysis || null
        });
        setIsAdding(true);
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this session?')) {
            await deleteJournalEntry(id, user?.uid);
            setEntries(entries.filter(e => e.id !== id));
        }
    };

    const [stravaActivities, setStravaActivities] = useState([]);
    const [showActivityPicker, setShowActivityPicker] = useState(false);

    const fetchStravaActivities = async () => {
        try {
            const acts = await getActivities(user?.uid);
            if (acts && acts.length > 0) {
                setStravaActivities(acts);
                setShowActivityPicker(true);
            } else {
                alert('No recent activities found or not connected.');
            }
        } catch (e) {
            console.error(e);
            alert('Failed to load Strava activities. Check connection.');
        }
    };

    const handleSelectActivity = async (activity) => {
        const date = new Date(activity.start_date);

        // Auto-fill from Strava
        setLogDate(format(date, 'yyyy-MM-dd'));
        setLogTime(format(date, 'HH:mm'));

        // Fetch detailed streams for analysis
        let streams = null;
        try {
            streams = await getActivityStreams(activity.id, user?.uid);
        } catch (e) {
            console.error('Failed to fetch streams', e);
        }

        // Calculate Stats
        const basicStats = legacyCalculateStats(streams, activity.max_speed, activity.distance);
        // Run Full Analysis
        const analysis = analyzeSession(streams);

        setNewEntry(prev => ({
            ...prev,
            stravaActivityId: activity.id,
            mapPolyline: activity.map?.summary_polyline,
            streams: streams,
            notes: prev.notes || activity.name,
            activityStats: basicStats,
            foilAnalysis: analysis
        }));
        setShowActivityPicker(false);
    };

    return (
        <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <Book size={20} />
                    Session Journal
                </h3>
                <button
                    onClick={() => {
                        if (isAdding) {
                            setIsAdding(false);
                            setEditId(null);
                            setIsAdding(false);
                            setEditId(null);
                            setNewEntry({ notes: '', rating: 5, gearUsed: '', windSpeed: '', windGusts: '', windDirection: '', stravaActivityId: null, mapPolyline: null });
                        } else {
                            setIsAdding(true);
                        }
                    }}
                    className="btn-secondary"
                    style={{ padding: '4px 8px', fontSize: '0.8rem' }}
                >
                    {isAdding ? 'Cancel' : 'Log Session'}
                </button>
            </div>

            {isAdding && (
                <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '1.5rem', padding: '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>

                    {/* Tabs */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '16px' }}>
                        <button
                            type="button"
                            onClick={() => setActiveTab('details')}
                            style={{
                                padding: '8px 16px',
                                background: 'none',
                                border: 'none',
                                borderBottom: activeTab === 'details' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                                color: activeTab === 'details' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontWeight: activeTab === 'details' ? 'bold' : 'normal'
                            }}
                        >
                            Session Details
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('map')}
                            style={{
                                padding: '8px 16px',
                                background: 'none',
                                border: 'none',
                                borderBottom: activeTab === 'map' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                                color: activeTab === 'map' ? 'var(--text-primary)' : 'var(--text-secondary)',
                                cursor: 'pointer',
                                fontWeight: activeTab === 'map' ? 'bold' : 'normal',
                                display: 'flex', alignItems: 'center', gap: '6px'
                            }}
                        >
                            <MapPin size={16} /> Map & Stats
                        </button>
                    </div>

                    {/* Tab Content: Details */}
                    {activeTab === 'details' && (
                        <>
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
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.9rem' }}>Notes</label>
                                <textarea
                                    value={newEntry.notes}
                                    onChange={e => setNewEntry({ ...newEntry, notes: e.target.value })}
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit', minHeight: '60px' }}
                                    required
                                />
                            </div>

                            <div style={{ marginTop: '16px' }}>
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
                                                [{gear.type || 'wing'}] {gear.size}{gear.type === 'board' ? 'L' : gear.type === 'foil' ? 'cm²' : 'm'} {gear.model}
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

                            <div style={{ marginTop: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.9rem' }}>Rating (1-5)</label>
                                <input
                                    type="range" min="1" max="5"
                                    value={newEntry.rating}
                                    onChange={e => setNewEntry({ ...newEntry, rating: e.target.value })}
                                    style={{ width: '100%' }}
                                />
                                <div style={{ textAlign: 'center' }}>{newEntry.rating} / 5</div>
                            </div>
                        </>
                    )}

                    {/* Tab Content: Map & Stats */}
                    {activeTab === 'map' && (
                        <div style={{ minHeight: '200px' }}>
                            {stravaConnected ? (
                                <>
                                    {!newEntry.stravaActivityId && (
                                        <button type="button" onClick={fetchStravaActivities} className="btn-secondary" style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: '#fc4c02', color: 'white', border: 'none', marginBottom: '10px' }}>
                                            <Activity size={16} /> Link Strava Activity
                                        </button>
                                    )}

                                    {showActivityPicker && (
                                        <div style={{ marginTop: '8px', marginBottom: '10px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden', maxHeight: '150px', overflowY: 'auto' }}>
                                            {stravaActivities.map(act => (
                                                <div
                                                    key={act.id}
                                                    onClick={() => handleSelectActivity(act)}
                                                    style={{ padding: '8px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem' }}
                                                >
                                                    <div style={{ fontWeight: 600 }}>{act.name}</div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>
                                                        {format(new Date(act.start_date), 'MMM d, HH:mm')} • {(act.distance / 1000).toFixed(2)}km
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {newEntry.stravaActivityId && (
                                        <div>
                                            <div style={{ fontSize: '0.8rem', color: '#fc4c02', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '5px', justifyContent: 'space-between' }}>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Activity size={14} /> Activity Linked</span>
                                                <button type="button" onClick={() => setNewEntry({ ...newEntry, stravaActivityId: null, mapPolyline: null, streams: null })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.8rem', textDecoration: 'underline' }}>Unlink</button>
                                            </div>
                                            {newEntry.mapPolyline ? (
                                                <SessionMap summary_polyline={newEntry.mapPolyline} streams={newEntry.streams} />
                                            ) : (
                                                <div style={{ padding: '20px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
                                                    Activity linked, but no map data available.
                                                </div>
                                            )}

                                            {/* Advanced Analysis Chart */}
                                            {newEntry.foilAnalysis && (
                                                <div style={{ marginTop: '20px' }}>
                                                    <FoilAnalysisChart analysisData={newEntry.foilAnalysis} />

                                                    {/* New Stats Grid */}
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginTop: '12px' }}>
                                                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Foil Time</div>
                                                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#5cb85c' }}>
                                                                {newEntry.foilAnalysis.stats.totalFoilTime}m
                                                            </div>
                                                        </div>
                                                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Flights</div>
                                                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'white' }}>
                                                                {newEntry.foilAnalysis.stats.numberOfFlights}
                                                            </div>
                                                        </div>
                                                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>% Foil</div>
                                                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#38bdf8' }}>
                                                                {newEntry.foilAnalysis.stats.percentFoil}%
                                                            </div>
                                                        </div>
                                                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Runs</div>
                                                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#facc15' }}>
                                                                {newEntry.foilAnalysis.stats.totalRuns}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

                                            {/* Fallback to simple stats if no advanced analysis but basic stats exist */}
                                            {newEntry.activityStats && !newEntry.foilAnalysis && (
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginTop: '12px' }}>
                                                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Top Speed</div>
                                                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
                                                            {newEntry.activityStats.topSpeed ? parseFloat(newEntry.activityStats.topSpeed).toFixed(1) : '–'} <span style={{ fontSize: '0.8rem' }}>kts</span>
                                                        </div>
                                                    </div>
                                                    <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Distance</div>
                                                        <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'white' }}>
                                                            {newEntry.activityStats.distance ? parseFloat(newEntry.activityStats.distance).toFixed(2) : '–'} <span style={{ fontSize: '0.8rem' }}>km</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {!newEntry.stravaActivityId && !showActivityPicker && (
                                        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
                                            <MapPin size={32} style={{ marginBottom: '8px', opacity: 0.5 }} />
                                            <p>Link a Strava activity to see your track and speed analysis here.</p>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div style={{ padding: '20px', textAlign: 'center' }}>
                                    <p>Connect to Strava in Settings to enable map features.</p>
                                </div>
                            )}
                        </div>
                    )}

                    <button type="submit" className="btn-primary" style={{ marginTop: '16px' }}>{editId ? 'Update Entry' : 'Save Entry'}</button>
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

                            {/* Map Visualization & Stats */}
                            {entry.mapPolyline && (
                                <>
                                    <SessionMap summary_polyline={entry.mapPolyline} streams={entry.streams} />

                                    {(() => {
                                        // On-demand analysis for existing entries that might not have it saved yet
                                        let analysis = entry.foilAnalysis;
                                        if (!analysis && entry.streams) {
                                            analysis = analyzeSession(entry.streams);
                                        }

                                        if (analysis) {
                                            return (
                                                <div style={{ marginTop: '10px' }}>
                                                    <FoilAnalysisChart analysisData={analysis} />
                                                    <div style={{ display: 'flex', gap: '10px', marginTop: '8px', fontSize: '0.85rem' }}>
                                                        <span style={{ color: '#5cb85c' }}><b>{analysis.stats.totalFoilTime}m</b> Foil</span>
                                                        <span style={{ color: '#38bdf8' }}><b>{analysis.stats.percentFoil}%</b> Eff.</span>
                                                        <span style={{ color: '#facc15' }}><b>{analysis.stats.totalRuns}</b> Runs</span>
                                                    </div>
                                                </div>
                                            )
                                        }

                                        // Fallback legacy stats
                                        const stats = entry.activityStats || {};
                                        return (
                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px' }}>
                                                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Top Speed</div>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
                                                        {stats.topSpeed ? parseFloat(stats.topSpeed).toFixed(1) : '–'} <span style={{ fontSize: '0.8rem' }}>kts</span>
                                                    </div>
                                                </div>
                                                <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Distance</div>
                                                    <div style={{ fontSize: '1.1rem', fontWeight: 'bold', color: 'white' }}>
                                                        {stats.distance ? parseFloat(stats.distance).toFixed(2) : '–'} <span style={{ fontSize: '0.8rem' }}>km</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </>
                            )}

                            <div style={{ textAlign: 'right', marginTop: '4px' }}>
                                <button
                                    onClick={() => handleEdit(entry)}
                                    style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: '0.8rem', marginRight: '10px' }}
                                >
                                    Edit
                                </button>
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
        </div >
    );
};

export default Journal;
