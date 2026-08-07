import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useLocation } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { getJournalEntries, addJournalEntry, deleteJournalEntry, updateJournalEntry } from '../services/journalService';
import { Book, Plus, Trash2, Edit2, Calendar, Wind, Clock, MapPin, X, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { parseGpsFile } from '../services/tcxService';
import { analyzeSession } from '../services/foilAnalysisService';
import { useNavigate } from 'react-router-dom';
import { getWeatherForecast, getTideForecast, processChartData } from '../services/weatherService';
import { fetchRecentSessions, fetchSessionTelemetry, relabelActivityType, sessionEmoji } from '../services/googleFitService';

const SessionMap = lazy(() => import('../components/SessionMap'));
const FoilAnalysisChart = lazy(() => import('../components/FoilAnalysisChart'));
const HeartRateChart = lazy(() => import('../components/HeartRateChart'));


const SessionsPage = () => {
    const { currentLocation } = useLocation();
    const { user, loading: authLoading } = useAuth();
    const navigate = useNavigate();
    const [entries, setEntries] = useState([]);
    const [isAdding, setIsAdding] = useState(false);
    const [editId, setEditId] = useState(null);
    const [activeTab, setActiveTab] = useState('details');
    const [tcxFileName, setTcxFileName] = useState(null);
    const [isTcxParsing, setIsTcxParsing] = useState(false);
    const [gfitSessions, setGfitSessions] = useState(null);    // null=not loaded, []=[]
    const [gfitLoading, setGfitLoading] = useState(false);
    const [gfitLoadingId, setGfitLoadingId] = useState(null);  // id of session being fetched

    // Gear state 
    const [userGear, setUserGear] = useState([]);
    useEffect(() => {
        if (authLoading) return;
        const fetchGear = async () => {
            if (user?.uid) {
                const { getUserGear } = await import('../services/dbService');
                const gear = await getUserGear(user.uid);
                setUserGear(gear);
            } else {
                setUserGear(JSON.parse(localStorage.getItem('melvill_user_gear') || '[]'));
            }
        };
        fetchGear();
    }, [user?.uid, authLoading]);

    // Form State
    const [logDate, setLogDate] = useState(format(new Date(), 'yyyy-MM-dd'));
    const [logTime, setLogTime] = useState(format(new Date(), 'HH:mm'));

    const [hoveredIndex, setHoveredIndex] = useState(null);

    const [newEntry, setNewEntry] = useState({
        notes: '',
        rating: 5,
        gearUsed: '',
        windSpeed: '',
        windGusts: '',
        windDirection: '',
        stravaActivityId: null,
        mapPolyline: null,
        streams: null,
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
        if (authLoading) return;
        const fetchEntries = async () => {
            const data = await getJournalEntries(user?.uid);
            setEntries(data);
        }
        fetchEntries();
    }, [currentLocation, user?.uid, authLoading]);

    // Smart Fill Logic — uses weather data (last 7 days history from Open-Meteo)
    const [weatherData, setWeatherData] = useState([]);
    useEffect(() => {
        if (!isAdding || weatherData.length > 0) return;
        const fetchWeather = async () => {
            try {
                const rawData = await getWeatherForecast(currentLocation.latitude, currentLocation.longitude);
                const tideData = await getTideForecast(currentLocation.latitude, currentLocation.longitude);
                const processed = processChartData(rawData, tideData);
                setWeatherData(processed);
            } catch (err) {
                console.warn('Failed to fetch weather data for smart-fill', err);
            }
        };
        fetchWeather();
    }, [isAdding, currentLocation]);

    const findWeatherForTime = (targetDate, currentWeatherData) => {
        if (!currentWeatherData || currentWeatherData.length === 0) return null;
        
        // Find closest weather data point
        const closest = currentWeatherData.reduce((prev, curr) =>
            Math.abs(curr.rawDate - targetDate) < Math.abs(prev.rawDate - targetDate) ? curr : prev
        );

        // Within 3 hours
        return (closest && Math.abs(closest.rawDate - targetDate) < 3 * 60 * 60 * 1000) ? closest : null;
    };

    useEffect(() => {
        if (!isAdding || editId || !weatherData || weatherData.length === 0) return;

        const target = new Date(`${logDate}T${logTime}`);
        const closest = findWeatherForTime(target, weatherData);

        if (closest) {
            setNewEntry(prev => ({
                ...prev,
                windSpeed: (closest.speed * 0.539957).toFixed(1),
                windGusts: (closest.gusts * 0.539957).toFixed(1),
                windDirection: closest.direction
            }));
        }
    }, [logDate, logTime, isAdding, weatherData, editId]);

    const handleAdd = async (e) => {
        e.preventDefault();

        const entryData = {
            locationId: currentLocation.id,
            locationName: currentLocation.name,
            date: new Date(`${logDate}T${logTime}`).toISOString(),
            notes: newEntry.notes,
            rating: parseInt(newEntry.rating),
            gearUsed: newEntry.gearUsed || '',
            windSpeed: newEntry.windSpeed || '',
            windGusts: newEntry.windGusts || '',
            windDirection: newEntry.windDirection || '',
            stravaActivityId: newEntry.stravaActivityId || null,
            mapPolyline: newEntry.mapPolyline || null,
            streams: newEntry.streams || null,
            activityStats: newEntry.activityStats || null,
            foilAnalysis: newEntry.foilAnalysis || null
        };

        try {
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
            setNewEntry({ notes: '', rating: 5, gearUsed: '', windSpeed: '', windGusts: '', windDirection: '', mapPolyline: null, streams: null, activityStats: null, foilAnalysis: null });
            setTcxFileName(null);
            setIsAdding(false);
            setEditId(null);
        } catch (err) {
            console.error('Failed to save journal entry:', err);
            alert('Failed to save entry: ' + err.message + '\n\nSee browser console for details.');
        }
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
            mapPolyline: entry.mapPolyline || null,
            streams: entry.streams || null,
            activityStats: entry.activityStats || null,
            foilAnalysis: entry.foilAnalysis || null
        });
        setTcxFileName(entry.mapPolyline ? 'Saved track' : null);
        setIsAdding(true);
    };

    const handleDelete = async (id) => {
        if (window.confirm('Delete this session?')) {
            await deleteJournalEntry(id, user?.uid);
            setEntries(entries.filter(e => e.id !== id));
        }
    };

    const handleTcxFile = async (file) => {
        if (!file) return;
        setIsTcxParsing(true);
        setTcxFileName(file.name);
        try {
            const { streams, activityStats, mapPolyline } = await parseGpsFile(file);
            const analysis = analyzeSession(streams);

            // Auto-fill date/time from the GPS track's start time
            const startTime = activityStats.startTime;
            setLogDate(format(startTime, 'yyyy-MM-dd'));
            setLogTime(format(startTime, 'HH:mm'));

            // Auto-fill wind from weather if available
            let weatherUpdates = {};
            const closest = findWeatherForTime(startTime, weatherData);
            if (closest) {
                weatherUpdates = {
                    windSpeed: (closest.speed * 0.539957).toFixed(1),
                    windGusts: (closest.gusts * 0.539957).toFixed(1),
                    windDirection: closest.direction
                };
            }

            setNewEntry(prev => ({
                ...prev,
                ...weatherUpdates,
                mapPolyline,
                streams,
                activityStats,
                foilAnalysis: analysis
            }));
        } catch (e) {
            console.error('[TCX] Parse error:', e);
            alert('Failed to parse GPS file: ' + e.message);
            setTcxFileName(null);
        } finally {
            setIsTcxParsing(false);
        }
    };

    // ── Fetch session list from Google Health API ───────────────────────────
    const handleFetchGfitSessions = async () => {
        setGfitLoading(true);
        setGfitSessions(null);
        try {
            const sessions = await fetchRecentSessions(user?.uid, 60);
            setGfitSessions(sessions);
        } catch (e) {
            console.error('[GHealth] fetchRecentSessions error:', e);
            alert('Could not load Google Health sessions: ' + e.message);
            setGfitSessions([]);
        } finally {
            setGfitLoading(false);
        }
    };

    // ── Load telemetry for a selected session ────────────────────────────────
    const handleGfitSessionSelect = async (session) => {
        setGfitLoadingId(session.id);
        try {
            const { streams, activityStats, mapPolyline } = await fetchSessionTelemetry(user?.uid, session);
            const analysis = analyzeSession(streams);

            // Auto-fill date / time from session start
            const startTime = activityStats.startTime;
            setLogDate(format(startTime, 'yyyy-MM-dd'));
            setLogTime(format(startTime, 'HH:mm'));

            // Auto-fill wind from weather if available
            let weatherUpdates = {};
            const closest = findWeatherForTime(startTime, weatherData);
            if (closest) {
                weatherUpdates = {
                    windSpeed:     (closest.speed * 0.539957).toFixed(1),
                    windGusts:     (closest.gusts * 0.539957).toFixed(1),
                    windDirection: closest.direction,
                };
            }

            const label = relabelActivityType(session.activityType, session.name);
            setTcxFileName(`Google Health: ${label}`);
            setGfitSessions(null);  // Dismiss the picker

            setNewEntry(prev => ({
                ...prev,
                ...weatherUpdates,
                mapPolyline,
                streams,
                activityStats,
                foilAnalysis: analysis,
            }));
        } catch (e) {
            console.error('[GFit] fetchSessionTelemetry error:', e);
            alert('Failed to load session data: ' + e.message);
        } finally {
            setGfitLoadingId(null);
        }
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
                            setNewEntry({ notes: '', rating: 5, gearUsed: '', windSpeed: '', windGusts: '', windDirection: '', mapPolyline: null, streams: null, activityStats: null, foilAnalysis: null });
                            setTcxFileName(null);
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
                            {/* ── Import options (hide once any data is loaded) ── */}
                            {!newEntry.streams && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>

                                    {/* Google Health session picker */}
                                    <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
                                        <button
                                            type="button"
                                            onClick={handleFetchGfitSessions}
                                            disabled={gfitLoading}
                                            style={{
                                                width: '100%', padding: '14px 16px',
                                                background: 'rgba(66,133,244,0.12)', border: 'none',
                                                color: 'white', cursor: gfitLoading ? 'wait' : 'pointer',
                                                display: 'flex', alignItems: 'center', gap: '10px',
                                                fontSize: '0.9rem', fontWeight: 600,
                                            }}
                                        >
                                            <span style={{ fontSize: '1.2rem' }}>🏃</span>
                                            {gfitLoading ? 'Loading sessions…' : 'Fetch from Google Health'}
                                            <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 400 }}>last 60 days</span>
                                        </button>

                                        {/* Session list */}
                                        {gfitSessions !== null && (
                                            <div style={{ maxHeight: '240px', overflowY: 'auto', borderTop: '1px solid var(--border-color)' }}>
                                                {gfitSessions.length === 0 ? (
                                                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                        No sessions found in the last 60 days.
                                                    </div>
                                                ) : (
                                                    gfitSessions.map(session => {
                                                        const startMs   = parseInt(session.startTimeMillis);
                                                        const durMin    = Math.round((parseInt(session.endTimeMillis) - startMs) / 60000);
                                                        const label     = relabelActivityType(session.activityType, session.name);
                                                        const isLoading = gfitLoadingId === session.id;
                                                        return (
                                                            <button
                                                                key={session.id}
                                                                type="button"
                                                                onClick={() => handleGfitSessionSelect(session)}
                                                                disabled={!!gfitLoadingId}
                                                                style={{
                                                                    width: '100%', display: 'flex', alignItems: 'center',
                                                                    gap: '12px', padding: '10px 16px',
                                                                    background: isLoading ? 'rgba(66,133,244,0.15)' : 'transparent',
                                                                    border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
                                                                    color: 'var(--text-primary)', cursor: gfitLoadingId ? 'wait' : 'pointer',
                                                                    textAlign: 'left', transition: 'background 0.15s',
                                                                }}
                                                                onMouseEnter={e => { if (!gfitLoadingId) e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; }}
                                                                onMouseLeave={e => { e.currentTarget.style.background = isLoading ? 'rgba(66,133,244,0.15)' : 'transparent'; }}
                                                            >
                                                                <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>
                                                                    {sessionEmoji(label)}
                                                                </span>
                                                                <div style={{ flex: 1 }}>
                                                                    <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{label}</div>
                                                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                                                                        {new Date(startMs).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                                        {' · '}{durMin} min
                                                                    </div>
                                                                </div>
                                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                                    {isLoading ? '⏳ Loading…' : '→'}
                                                                </span>
                                                            </button>
                                                        );
                                                    })
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Divider */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
                                        <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                                        or import a file
                                        <div style={{ flex: 1, height: '1px', background: 'var(--border-color)' }} />
                                    </div>

                                    {/* File drop zone */}
                                    <label
                                        htmlFor="tcx-file-input"
                                        style={{
                                            display: 'flex', flexDirection: 'column', alignItems: 'center',
                                            justifyContent: 'center', gap: '8px', padding: '24px 20px',
                                            border: '2px dashed var(--border-color)', borderRadius: '12px',
                                            cursor: 'pointer', color: 'var(--text-secondary)',
                                            textAlign: 'center', transition: 'border-color 0.2s',
                                            opacity: isTcxParsing ? 0.6 : 1
                                        }}
                                        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--accent-primary)'; }}
                                        onDragLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                                        onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border-color)'; const f = e.dataTransfer.files[0]; if (f) handleTcxFile(f); }}
                                    >
                                        <MapPin size={28} style={{ opacity: 0.5 }} />
                                        {isTcxParsing ? (
                                            <span>Parsing GPS file…</span>
                                        ) : (
                                            <>
                                                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.9rem' }}>Import TCX / GPX file</span>
                                                <span style={{ fontSize: '0.8rem' }}>Drop here or click to browse</span>
                                            </>
                                        )}
                                        <input
                                            id="tcx-file-input" type="file" accept=".tcx,.gpx"
                                            style={{ display: 'none' }} disabled={isTcxParsing}
                                            onChange={e => { const f = e.target.files?.[0]; if (f) handleTcxFile(f); e.target.value = ''; }}
                                        />
                                    </label>
                                </div>
                            )}


                            {/* ── Non-GPS session view (HR or basic metadata) ── */}
                            {newEntry.streams && !newEntry.mapPolyline && (
                                <div>
                                    <div style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px', justifyContent: 'space-between' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: newEntry.activityStats?.heartRateAvg ? '#f87171' : 'var(--accent-primary)' }}>
                                            <span style={{ fontSize: '1rem' }}>{newEntry.activityStats?.heartRateAvg ? '❤️' : '⏱️'}</span>
                                            <strong>{tcxFileName || (newEntry.activityStats?.heartRateAvg ? 'Heart rate only (no GPS)' : 'Basic session imported')}</strong>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => { setNewEntry({ ...newEntry, mapPolyline: null, streams: null, activityStats: null, foilAnalysis: null }); setTcxFileName(null); }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.8rem', textDecoration: 'underline' }}
                                        >
                                            Remove
                                        </button>
                                    </div>

                                    {/* Stats bar */}
                                    {newEntry.activityStats && (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
                                            {[
                                                { label: 'Duration',  value: `${newEntry.activityStats.duration} min`,             color: 'white' },
                                                { label: 'Avg HR',    value: newEntry.activityStats.heartRateAvg ? `${newEntry.activityStats.heartRateAvg} bpm` : '—', color: '#f87171' },
                                                { label: 'Max HR',    value: newEntry.activityStats.heartRateMax ? `${newEntry.activityStats.heartRateMax} bpm` : '—', color: '#fb923c' },
                                            ].map(stat => (
                                                <div key={stat.label} style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{stat.label}</div>
                                                    <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Heart Rate Chart (for Non-GPS sessions) */}
                                    <Suspense fallback={null}>
                                        <HeartRateChart streams={newEntry.streams} />
                                    </Suspense>

                                    <div style={{ padding: '16px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', border: '1px solid var(--border-color)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.83rem', marginTop: '12px' }}>
                                        {newEntry.activityStats?.heartRateAvg ? (
                                            <>❤️ No GPS track for this session — heart rate & duration data imported.</>
                                        ) : (
                                            <>⏱️ No GPS track or heart rate data found — date, start time, duration & weather auto-filled.</>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* ── Linked GPS track view ── */}
                            {newEntry.mapPolyline && (
                                <div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px', justifyContent: 'space-between' }}>
                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <MapPin size={14} />
                                            <strong>{tcxFileName || 'GPS track imported'}</strong>
                                        </span>
                                        <button
                                            type="button"
                                            onClick={() => { setNewEntry({ ...newEntry, mapPolyline: null, streams: null, activityStats: null, foilAnalysis: null }); setTcxFileName(null); }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.8rem', textDecoration: 'underline' }}
                                        >
                                            Remove track
                                        </button>
                                    </div>

                                    {/* Top-level stats bar */}
                                    {newEntry.activityStats && (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '12px' }}>
                                            {[{ label: 'Top Speed', value: `${newEntry.activityStats.topSpeed} kts`, color: 'var(--accent-primary)' },
                                              { label: 'Avg Speed',  value: `${newEntry.activityStats.avgSpeed} kts`,  color: 'white' },
                                              { label: 'Distance',   value: `${newEntry.activityStats.distance} km`,  color: 'white' },
                                              { label: 'Duration',   value: `${newEntry.activityStats.duration} min`, color: 'white' },
                                            ].map(stat => (
                                                <div key={stat.label} style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '6px', textAlign: 'center' }}>
                                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{stat.label}</div>
                                                    <div style={{ fontSize: '0.95rem', fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Map */}
                                    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading map…</div>}>
                                        <SessionMap summary_polyline={newEntry.mapPolyline} streams={newEntry.streams} highlightIndex={hoveredIndex} />
                                    </Suspense>

                                    {/* Foil analysis chart */}
                                    {newEntry.foilAnalysis && (
                                        <div style={{ marginTop: '20px' }}>
                                            <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading chart…</div>}>
                                                <FoilAnalysisChart analysisData={newEntry.foilAnalysis} onHover={setHoveredIndex} />
                                            </Suspense>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginTop: '12px' }}>
                                                {[{ label: 'Foil Time', value: `${newEntry.foilAnalysis.stats.totalFoilTime}m`, color: '#5cb85c' },
                                                  { label: 'Flights',   value: newEntry.foilAnalysis.stats.numberOfFlights,       color: 'white' },
                                                  { label: '% Foil',    value: `${newEntry.foilAnalysis.stats.percentFoil}%`,     color: '#38bdf8' },
                                                  { label: 'Runs',      value: newEntry.foilAnalysis.stats.totalRuns,             color: '#facc15' },
                                                ].map(stat => (
                                                    <div key={stat.label} style={{ background: 'rgba(0,0,0,0.3)', padding: '8px', borderRadius: '4px', textAlign: 'center' }}>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{stat.label}</div>
                                                        <div style={{ fontSize: '1rem', fontWeight: 'bold', color: stat.color }}>{stat.value}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {/* Heart Rate Chart (for GPS sessions) */}
                                    <Suspense fallback={null}>
                                        <HeartRateChart streams={newEntry.streams} onHover={setHoveredIndex} />
                                    </Suspense>
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

                                        {/* Heart rate summary inline (for non-GPS / HR sessions) */}
                                        {!analysis && (entry.activityStats?.heartRateAvg || entry.streams?.heartrate) && (
                                            <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '0.8rem', color: '#f87171' }}>
                                                <span>❤️ <b>{entry.activityStats?.heartRateAvg || '—'}</b> bpm avg</span>
                                                {entry.activityStats?.heartRateMax && (
                                                    <span style={{ color: '#fb923c' }}><b>{entry.activityStats.heartRateMax}</b> bpm max</span>
                                                )}
                                                {entry.activityStats?.duration && (
                                                    <span style={{ color: 'var(--text-secondary)' }}>⏱️ <b>{entry.activityStats.duration}</b> min</span>
                                                )}
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

                                {/* Most recent session or non-GPS session — show chart */}
                                {isLatest && analysis && (
                                    <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }} onClick={(e) => e.stopPropagation()}>
                                        <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading chart...</div>}>
                                            <FoilAnalysisChart analysisData={analysis} />
                                        </Suspense>
                                    </div>
                                )}

                                {/* Heart rate chart for latest or non-GPS session */}
                                {entry.streams && !analysis && (
                                    <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }} onClick={(e) => e.stopPropagation()}>
                                        <Suspense fallback={null}>
                                            <HeartRateChart streams={entry.streams} />
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
