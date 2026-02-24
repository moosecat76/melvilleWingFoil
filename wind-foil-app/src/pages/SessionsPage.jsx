import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useLocation } from '../context/LocationContext';
import { getJournalEntries, addJournalEntry, deleteJournalEntry, updateJournalEntry } from '../services/journalService';
import { Book, Plus, Trash2, Edit2, Calendar, Wind, Clock, MapPin, X, Activity, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { getActivities, getStravaUser, getActivityStreams } from '../services/stravaService';
import { analyzeSession } from '../services/foilAnalysisService';
import { useNavigate } from 'react-router-dom';

const SessionMap = lazy(() => import('../components/SessionMap'));
const FoilAnalysisChart = lazy(() => import('../components/FoilAnalysisChart'));

const legacyCalculateStats = (streams, maxSpeedMs = 0, distanceMeters = 0) => {
    const speedKts = maxSpeedMs * 1.94384;
    const distanceKm = distanceMeters / 1000;
    return { topSpeed: speedKts, distance: distanceKm };
};

const SessionsPage = () => {
    const { currentLocation } = useLocation();
    const navigate = useNavigate();
    const [entries, setEntries] = useState([]);
    const [isAdding, setIsAdding] = useState(false);
    const [editId, setEditId] = useState(null);
    const [activeTab, setActiveTab] = useState('details');

    // Gear state (read from localStorage for the form)
    const userGear = JSON.parse(localStorage.getItem('melvill_user_gear') || '[]');

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
        setEntries(getJournalEntries());
    }, [currentLocation]);

    // Smart Fill Logic — uses weather data from localStorage if available
    const [weatherData, setWeatherData] = useState([]);
    useEffect(() => {
        // We don't have weatherData prop anymore, so skip smart-fill for now
        // In future, could share via context or localStorage
    }, [logDate, logTime, isAdding]);

    const handleAdd = (e) => {
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
            const updated = updateJournalEntry({ ...entryData, id: editId });
            if (updated) {
                setEntries(entries.map(e => e.id === editId ? updated : e));
            }
        } else {
            const added = addJournalEntry(entryData);
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

    const handleDelete = (id) => {
        deleteJournalEntry(id);
        setEntries(entries.filter(e => e.id !== id));
    };

    const [stravaActivities, setStravaActivities] = useState([]);
    const [showActivityPicker, setShowActivityPicker] = useState(false);

    const fetchStravaActivities = async () => {
        try {
            const acts = await getActivities();
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
        setLogDate(format(date, 'yyyy-MM-dd'));
        setLogTime(format(date, 'HH:mm'));

        let streams = null;
        try {
            streams = await getActivityStreams(activity.id);
        } catch (e) {
            console.error('Failed to fetch streams', e);
        }

        const basicStats = legacyCalculateStats(streams, activity.max_speed, activity.distance);
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

    // Get foil stats for a quick summary line
    const getQuickStats = (entry) => {
        let analysis = entry.foilAnalysis;
        if (!analysis && entry.streams) {
            // Don't recompute on every render — just show basic stats
            return null;
        }
        return analysis;
    };

    return (
        <div className="app-container">
            <header style={{ marginBottom: '1.5rem' }}>
                <h1 className="text-gradient" style={{ margin: 0, fontSize: '2rem', fontWeight: 800 }}>
                    Session Journal
                </h1>
            </header>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
                <button
                    onClick={() => {
                        if (isAdding) {
                            setIsAdding(false);
                            setEditId(null);
                            setNewEntry({ notes: '', rating: 5, gearUsed: '', windSpeed: '', windGusts: '', windDirection: '', stravaActivityId: null, mapPolyline: null });
                        } else {
                            setIsAdding(true);
                        }
                    }}
                    className="btn-primary"
                    style={{ padding: '8px 20px', fontSize: '0.9rem' }}
                >
                    {isAdding ? 'Cancel' : '+ Log Session'}
                </button>
            </div>

            {isAdding && (
                <form onSubmit={handleAdd} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '1.5rem', padding: '20px' }}>

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
                            {getStravaUser() ? (
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
                                                <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading map...</div>}>
                                                    <SessionMap summary_polyline={newEntry.mapPolyline} streams={newEntry.streams} />
                                                </Suspense>
                                            ) : (
                                                <div style={{ padding: '20px', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
                                                    Activity linked, but no map data available.
                                                </div>
                                            )}

                                            {newEntry.foilAnalysis && (
                                                <div style={{ marginTop: '20px' }}>
                                                    <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading chart...</div>}>
                                                        <FoilAnalysisChart analysisData={newEntry.foilAnalysis} />
                                                    </Suspense>
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px', marginTop: '12px' }}>
                                                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Foil Time</div>
                                                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#5cb85c' }}>{newEntry.foilAnalysis.stats.totalFoilTime}m</div>
                                                        </div>
                                                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Flights</div>
                                                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: 'white' }}>{newEntry.foilAnalysis.stats.numberOfFlights}</div>
                                                        </div>
                                                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>% Foil</div>
                                                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#38bdf8' }}>{newEntry.foilAnalysis.stats.percentFoil}%</div>
                                                        </div>
                                                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Runs</div>
                                                            <div style={{ fontSize: '1rem', fontWeight: 'bold', color: '#facc15' }}>{newEntry.foilAnalysis.stats.totalRuns}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}

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
                                    <p>Connect to Strava in Settings (Forecast page) to enable map features.</p>
                                </div>
                            )}
                        </div>
                    )}

                    <button type="submit" className="btn-primary" style={{ marginTop: '16px' }}>{editId ? 'Update Entry' : 'Save Entry'}</button>
                </form>
            )}

            {/* Sessions List — hidden while editing to avoid rendering all maps */}
            {!isAdding && <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '5rem' }}>
                {entries.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>No sessions recorded yet. Tap "Log Session" to add your first entry.</p>
                ) : (
                    entries.map((entry, index) => {
                        const analysis = getQuickStats(entry);
                        const isLatest = index === 0;

                        return (
                            <div
                                key={entry.id}
                                className="glass-panel"
                                style={{ padding: '16px', cursor: 'pointer', transition: 'border-color 0.2s' }}
                                onClick={() => navigate(`/session/${entry.id}`)}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ flex: 1 }}>
                                        {/* Location */}
                                        <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <MapPin size={10} /> {entry.locationName || 'Unknown Location'}
                                        </div>

                                        {/* Date & Rating */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                            <span style={{ fontWeight: 600, fontSize: '1rem' }}>
                                                {format(new Date(entry.date), 'EEE dd MMM')}
                                            </span>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                {format(new Date(entry.date), 'h:mm a')}
                                            </span>
                                            <span style={{ color: '#facc15', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                                {'★'.repeat(entry.rating)}{'☆'.repeat(5 - entry.rating)}
                                            </span>
                                        </div>

                                        {/* Wind Snapshot */}
                                        {(entry.windSpeed || entry.windDirection) && (
                                            <div style={{ display: 'flex', gap: '8px', fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                                {entry.windSpeed && <span><Wind size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> {entry.windSpeed} kts</span>}
                                                {entry.windGusts && <span>(Gust {entry.windGusts})</span>}
                                                {entry.windDirection && <span>{entry.windDirection}°</span>}
                                            </div>
                                        )}

                                        {/* Notes preview */}
                                        <p style={{ margin: '2px 0', fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
                                            {entry.notes}
                                        </p>

                                        {/* Foil stats summary inline */}
                                        {analysis && (
                                            <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '0.8rem' }}>
                                                <span style={{ color: '#5cb85c' }}><b>{analysis.stats.totalFoilTime}m</b> Foil</span>
                                                <span style={{ color: '#38bdf8' }}><b>{analysis.stats.percentFoil}%</b></span>
                                                <span style={{ color: '#facc15' }}><b>{analysis.stats.totalRuns}</b> Runs</span>
                                                <span><b>{analysis.stats.numberOfFlights}</b> Flights</span>
                                            </div>
                                        )}

                                        {/* Gear */}
                                        {entry.gearUsed && (
                                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                Gear: {entry.gearUsed}
                                            </div>
                                        )}
                                    </div>

                                    {/* Chevron + Actions */}
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                        <ChevronRight size={20} color="var(--text-secondary)" />
                                        <div style={{ display: 'flex', gap: '6px' }}>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleEdit(entry); }}
                                                style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '4px' }}
                                                title="Edit"
                                            >
                                                <Edit2 size={14} />
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                                                style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: '4px' }}
                                                title="Delete"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Strava Track Map */}
                                {entry.mapPolyline && (
                                    <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }} onClick={(e) => e.stopPropagation()}>
                                        <Suspense fallback={<div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading map...</div>}>
                                            <SessionMap summary_polyline={entry.mapPolyline} streams={entry.streams} />
                                        </Suspense>
                                    </div>
                                )}

                                {/* Most recent session — show chart */}
                                {isLatest && analysis && (
                                    <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }} onClick={(e) => e.stopPropagation()}>
                                        <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading chart...</div>}>
                                            <FoilAnalysisChart analysisData={analysis} />
                                        </Suspense>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>}
        </div>
    );
};

export default SessionsPage;
