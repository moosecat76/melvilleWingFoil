import React, { useState, useEffect, lazy, Suspense, useMemo } from 'react';
import { useLocation } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { getJournalEntries, subscribeToJournalEntries, addJournalEntry, deleteJournalEntry, updateJournalEntry } from '../services/journalService';
import { getUserGear, subscribeToUserGear } from '../services/dbService';
import { Book, Plus, Trash2, Edit2, Calendar, Wind, Clock, MapPin, X, ChevronRight, Search, Activity, FileText, CheckCircle2, RotateCcw, Sparkles, RefreshCw, Cloud, LogIn } from 'lucide-react';
import { format } from 'date-fns';
import { parseGpsFile } from '../services/tcxService';
import { analyzeSession } from '../services/foilAnalysisService';
import { extractSessionCoachTags } from '../services/aiCoachService';
import { useNavigate } from 'react-router-dom';
import { getWeatherForecast, getTideForecast, processChartData } from '../services/weatherService';
import { fetchRecentSessions, fetchSessionTelemetry, relabelActivityType, sessionEmoji } from '../services/googleFitService';
import PolylineThumbnail from '../components/PolylineThumbnail';

const SessionMap = lazy(() => import('../components/SessionMap'));
const FoilAnalysisChart = lazy(() => import('../components/FoilAnalysisChart'));
const HeartRateChart = lazy(() => import('../components/HeartRateChart'));

class CardMediaBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    componentDidCatch(err) {
        console.warn('[SessionsPage] Media component render error:', err);
    }
    render() {
        if (this.state.hasError) return null;
        return this.props.children;
    }
}

const safeFormatDate = (dateVal, fmt) => {
    try {
        if (!dateVal) return '—';
        const d = typeof dateVal.toDate === 'function' ? dateVal.toDate() : new Date(dateVal);
        if (isNaN(d.getTime())) return '—';
        return format(d, fmt);
    } catch (_) {
        return '—';
    }
};

const SessionsPage = () => {
    const { currentLocation } = useLocation();
    const { user, login, loading: authLoading } = useAuth();
    const { showToast } = useToast();
    const [confirmDeleteId, setConfirmDeleteId] = useState(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const navigate = useNavigate();
    const [entries, setEntries] = useState([]);
    const [isAdding, setIsAdding] = useState(false);
    const [editId, setEditId] = useState(null);
    const [tcxFileName, setTcxFileName] = useState(null);
    const [isTcxParsing, setIsTcxParsing] = useState(false);
    const [gfitSessions, setGfitSessions] = useState(null);    // null=not loaded, []=[]
    const [gfitLoading, setGfitLoading] = useState(false);
    const [gfitLoadingId, setGfitLoadingId] = useState(null);  // id of session being fetched
    const [showGfitDrawer, setShowGfitDrawer] = useState(false);

    // Filter State (Core UX #9)
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedLocation, setSelectedLocation] = useState('ALL');
    const [minRating, setMinRating] = useState(0);

    // Gear state (real-time synced across devices)
    const [userGear, setUserGear] = useState([]);
    useEffect(() => {
        if (authLoading) return;
        let isMounted = true;
        if (user?.uid) {
            const unsubscribeGear = subscribeToUserGear(
                user.uid,
                (gear) => {
                    if (isMounted) setUserGear(gear || []);
                },
                async () => {
                    try {
                        const gear = await getUserGear(user.uid);
                        if (isMounted) setUserGear(gear || []);
                    } catch (_) { /* ignore */ }
                }
            );
            return () => {
                isMounted = false;
                if (typeof unsubscribeGear === 'function') unsubscribeGear();
            };
        } else {
            try {
                setUserGear(JSON.parse(localStorage.getItem('melvill_user_gear') || '[]'));
            } catch {
                setUserGear([]);
            }
        }
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
        let isMounted = true;
        const unsubscribe = subscribeToJournalEntries(user?.uid, (data) => {
            if (isMounted) setEntries(data || []);
        });
        return () => {
            isMounted = false;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [user?.uid, authLoading]);

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
    }, [isAdding, currentLocation, weatherData.length]);

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
            notes: newEntry.notes || '',
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
            // 5.1 Structured Note Mining on Session Save (once per save)
            if (entryData.notes?.trim() || entryData.foilAnalysis) {
                try {
                    entryData.coachTags = await extractSessionCoachTags(entryData, entryData.foilAnalysis);
                } catch (tagErr) {
                    console.warn('[SessionsPage] Coach tag extraction skipped:', tagErr);
                }
            }

            if (editId) {
                const updated = await updateJournalEntry({ ...entryData, id: editId }, user?.uid);
                if (updated) {
                    setEntries(entries.map(e => e.id === editId ? updated : e));
                }
                showToast('Session & AI Coach tags updated!', 'success');
            } else {
                const added = await addJournalEntry(entryData, user?.uid);
                setEntries([added, ...entries]);
                showToast('Session logged & analyzed by AI Coach!', 'success');
            }

            // Reset
            setNewEntry({ notes: '', rating: 5, gearUsed: '', windSpeed: '', windGusts: '', windDirection: '', mapPolyline: null, streams: null, activityStats: null, foilAnalysis: null });
            setTcxFileName(null);
            setIsAdding(false);
            setEditId(null);
            setShowGfitDrawer(false);
        } catch (err) {
            console.error('Failed to save journal entry:', err);
            showToast('Failed to save entry: ' + err.message, 'error');
        }
    };

    const handleEdit = (entry) => {
        setEditId(entry.id);
        const dateObj = new Date(entry.date);
        setLogDate(format(dateObj, 'yyyy-MM-dd'));
        setLogTime(format(dateObj, 'HH:mm'));
        setNewEntry({
            notes: entry.notes || '',
            rating: entry.rating || 5,
            gearUsed: entry.gearUsed || '',
            windSpeed: entry.windSpeed || '',
            windGusts: entry.windGusts || '',
            windDirection: entry.windDirection || '',
            mapPolyline: entry.mapPolyline || null,
            streams: entry.streams || null,
            activityStats: entry.activityStats || null,
            foilAnalysis: (entry.streams && (!entry.foilAnalysis || !entry.foilAnalysis.adaptiveProfile)) ? analyzeSession(entry.streams) : (entry.foilAnalysis || null)
        });
        setTcxFileName(entry.mapPolyline ? 'Saved track' : null);
        setIsAdding(true);
        setShowGfitDrawer(false);
    };

    const handleDelete = async (id) => {
        try {
            await deleteJournalEntry(id, user?.uid);
            setEntries(entries.filter(e => e.id !== id));
            setConfirmDeleteId(null);
            showToast('Session deleted', 'info');
        } catch (err) {
            showToast('Failed to delete session: ' + err.message, 'error');
        }
    };

    const handleClearTelemetry = () => {
        setNewEntry(prev => ({
            ...prev,
            mapPolyline: null,
            streams: null,
            activityStats: null,
            foilAnalysis: null
        }));
        setTcxFileName(null);
        showToast('Telemetry unlinked from entry', 'info');
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
            showToast(`Imported ${file.name} successfully`, 'success');
        } catch (e) {
            console.error('[TCX] Parse error:', e);
            showToast('Failed to parse GPS file: ' + e.message, 'error');
            setTcxFileName(null);
        } finally {
            setIsTcxParsing(false);
        }
    };

    // ── Fetch session list from Google Health API ───────────────────────────
    const handleFetchGfitSessions = async () => {
        setGfitLoading(true);
        setShowGfitDrawer(true);
        try {
            const sessions = await fetchRecentSessions(user?.uid, 10);
            setGfitSessions(sessions);
        } catch (e) {
            console.error('[GHealth] fetchRecentSessions error:', e);
            showToast('Could not load Google Health sessions: ' + e.message, 'error');
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
            setShowGfitDrawer(false);

            setNewEntry(prev => ({
                ...prev,
                ...weatherUpdates,
                mapPolyline,
                streams,
                activityStats,
                foilAnalysis: analysis,
            }));
            showToast(`Imported ${label} session`, 'success');
        } catch (e) {
            console.error('[GFit] fetchSessionTelemetry error:', e);
            showToast('Failed to load session data: ' + e.message, 'error');
        } finally {
            setGfitLoadingId(null);
        }
    };

    // Get foil stats for a quick summary line
    const getQuickStats = (entry) => {
        try {
            let analysis = entry.foilAnalysis;
            if (entry.streams && (!analysis || !analysis.adaptiveProfile || !analysis.data)) {
                return analyzeSession(entry.streams) || analysis || null;
            }
            return analysis || null;
        } catch (e) {
            console.warn('[SessionsPage] Failed to compute analysis for entry:', entry?.id, e);
            return entry?.foilAnalysis || null;
        }
    };

    // Chronological session numbering (1 to N based on ascending session date)
    const sessionNumberMap = useMemo(() => {
        const sorted = [...entries].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
        const map = new Map();
        sorted.forEach((e, idx) => {
            if (e.id) map.set(String(e.id), idx + 1);
        });
        return map;
    }, [entries]);

    // Distinct locations for filter dropdown
    const uniqueLocations = useMemo(() => {
        const set = new Set();
        entries.forEach(e => {
            if (e.locationName) set.add(e.locationName);
        });
        return Array.from(set);
    }, [entries]);

    // Filtered entries
    const filteredEntries = useMemo(() => {
        return entries.filter(entry => {
            if (selectedLocation !== 'ALL' && entry.locationName !== selectedLocation) {
                return false;
            }
            if (minRating > 0 && (Number(entry.rating) || 0) < minRating) {
                return false;
            }
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase();
                const matchNotes = (entry.notes || '').toLowerCase().includes(q);
                const matchGear = (entry.gearUsed || '').toLowerCase().includes(q);
                const matchLoc = (entry.locationName || '').toLowerCase().includes(q);
                if (!matchNotes && !matchGear && !matchLoc) return false;
            }
            return true;
        });
    }, [entries, selectedLocation, minRating, searchQuery]);

    const isFiltered = searchQuery.trim() !== '' || selectedLocation !== 'ALL' || minRating > 0;

    const handleManualSync = async () => {
        if (!user?.uid || isSyncing) return;
        setIsSyncing(true);
        try {
            const refreshed = await getJournalEntries(user.uid);
            setEntries(refreshed);
            showToast(`Cloud sync complete (${refreshed.length} sessions)`, 'success');
        } catch (err) {
            showToast('Cloud sync failed: ' + err.message, 'error');
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="app-container">
            <header style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1 className="text-gradient" style={{ margin: 0, fontSize: '2rem', fontWeight: 800 }}>
                        Session Journal
                    </h1>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {user ? (
                            <>
                                <Cloud size={13} color="#4ade80" />
                                <span>Live cloud sync active ({user.email || user.displayName})</span>
                            </>
                        ) : (
                            <>
                                <Cloud size={13} color="#fbbf24" />
                                <span>Local device only — sign in to sync across mobile &amp; desktop</span>
                            </>
                        )}
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {user ? (
                        <button
                            type="button"
                            onClick={handleManualSync}
                            disabled={isSyncing}
                            className="btn-secondary"
                            style={{ padding: '7px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
                            title="Force sync with cloud database"
                        >
                            <RefreshCw size={14} className={isSyncing ? 'spin' : ''} />
                            {isSyncing ? 'Syncing…' : 'Sync Now'}
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={login}
                            disabled={authLoading}
                            className="btn-secondary"
                            style={{ padding: '7px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }}
                        >
                            <LogIn size={14} />
                            Sign in to Sync
                        </button>
                    )}

                    <button
                        onClick={() => {
                            if (isAdding) {
                                setIsAdding(false);
                                setEditId(null);
                                setNewEntry({ notes: '', rating: 5, gearUsed: '', windSpeed: '', windGusts: '', windDirection: '', mapPolyline: null, streams: null, activityStats: null, foilAnalysis: null });
                                setTcxFileName(null);
                                setShowGfitDrawer(false);
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
            </header>

            {/* ── Unified Single-View Session Logging Form (Core UX #8) ── */}
            {isAdding && (
                <form onSubmit={handleAdd} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '2rem', padding: '24px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)' }}>
                            {editId ? 'Edit Session Entry' : 'Log New Session'}
                        </h3>
                        <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <MapPin size={14} /> {currentLocation.name}
                        </span>
                    </div>

                    {/* Step 1: Optional Telemetry Import */}
                    <div style={{
                        background: 'rgba(15, 23, 42, 0.45)',
                        border: '1px solid rgba(56, 189, 248, 0.2)',
                        borderRadius: '12px',
                        padding: '16px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Activity size={16} /> Step 1: GPS & Health Telemetry (Optional)
                            </span>
                            {newEntry.mapPolyline && (
                                <button
                                    type="button"
                                    onClick={handleClearTelemetry}
                                    style={{ background: 'none', border: 'none', color: '#f87171', fontSize: '0.75rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                >
                                    <RotateCcw size={12} /> Clear Telemetry
                                </button>
                            )}
                        </div>

                        {newEntry.mapPolyline ? (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)',
                                borderRadius: '8px', padding: '10px 14px'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <CheckCircle2 size={18} color="#38bdf8" />
                                    <div>
                                        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f8fafc' }}>
                                            {tcxFileName || 'Telemetry Loaded'}
                                        </div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                            {newEntry.foilAnalysis?.stats ? (
                                                `${newEntry.foilAnalysis.stats.totalDistance} km · ${newEntry.foilAnalysis.stats.topSpeed} kts top · ${newEntry.foilAnalysis.stats.percentFoil}% on foil`
                                            ) : (
                                                'GPS track & stats loaded'
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <span style={{ fontSize: '0.72rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.15)', padding: '4px 8px', borderRadius: '4px' }}>
                                    Auto-populated
                                </span>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                                    {/* Google Health button */}
                                    <button
                                        type="button"
                                        onClick={handleFetchGfitSessions}
                                        disabled={gfitLoading}
                                        style={{
                                            padding: '12px 14px',
                                            background: 'rgba(66, 133, 244, 0.12)',
                                            border: '1px solid rgba(66, 133, 244, 0.3)',
                                            borderRadius: '8px',
                                            color: 'white',
                                            cursor: gfitLoading ? 'wait' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '8px',
                                            fontSize: '0.85rem',
                                            fontWeight: 600
                                        }}
                                    >
                                        <span style={{ fontSize: '1.1rem' }}>🏃</span>
                                        <span>{gfitLoading ? 'Loading Google Health…' : 'Import from Google Health'}</span>
                                    </button>

                                    {/* File upload */}
                                    <label
                                        htmlFor="unified-tcx-file"
                                        style={{
                                            padding: '12px 14px',
                                            background: 'rgba(255, 255, 255, 0.04)',
                                            border: '1px dashed var(--border-color)',
                                            borderRadius: '8px',
                                            color: 'var(--text-primary)',
                                            cursor: isTcxParsing ? 'wait' : 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '8px',
                                            fontSize: '0.85rem'
                                        }}
                                    >
                                        <FileText size={16} color="var(--accent-primary)" />
                                        <span>{isTcxParsing ? 'Parsing file…' : 'Upload TCX / GPX File'}</span>
                                        <input
                                            id="unified-tcx-file"
                                            type="file"
                                            accept=".tcx,.gpx,application/xml,text/xml"
                                            onChange={e => handleTcxFile(e.target.files[0])}
                                            style={{ display: 'none' }}
                                        />
                                    </label>
                                </div>

                                {/* Google Health Drawer */}
                                {showGfitDrawer && gfitSessions && (
                                    <div style={{
                                        maxHeight: '220px', overflowY: 'auto',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '8px', background: 'rgba(0,0,0,0.4)', marginTop: '4px'
                                    }}>
                                        {gfitSessions.length === 0 ? (
                                            <div style={{ padding: '16px', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                No sessions found in the last 10 days.
                                            </div>
                                        ) : (
                                            gfitSessions.map(session => {
                                                const startMs = parseInt(session.startTimeMillis);
                                                const durMin = Math.round((parseInt(session.endTimeMillis) - startMs) / 60000);
                                                const label = relabelActivityType(session.activityType, session.name);
                                                const isLoading = gfitLoadingId === session.id;
                                                return (
                                                    <button
                                                        key={session.id}
                                                        type="button"
                                                        onClick={() => handleGfitSessionSelect(session)}
                                                        disabled={!!gfitLoadingId}
                                                        style={{
                                                            width: '100%', display: 'flex', alignItems: 'center',
                                                            gap: '12px', padding: '10px 14px',
                                                            background: isLoading ? 'rgba(66,133,244,0.2)' : 'transparent',
                                                            border: 'none', borderBottom: '1px solid rgba(255,255,255,0.06)',
                                                            color: 'var(--text-primary)', cursor: gfitLoadingId ? 'wait' : 'pointer',
                                                            textAlign: 'left'
                                                        }}
                                                    >
                                                        <span style={{ fontSize: '1.2rem' }}>{sessionEmoji(label)}</span>
                                                        <div style={{ flex: 1 }}>
                                                            <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{label}</div>
                                                            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                                                                {new Date(startMs).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {durMin} min
                                                            </div>
                                                        </div>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)' }}>
                                                            {isLoading ? 'Loading…' : 'Select →'}
                                                        </span>
                                                    </button>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Step 2: Session Details */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                            Step 2: Conditions, Gear & Notes
                        </span>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Date</label>
                                <input
                                    type="date"
                                    value={logDate}
                                    onChange={e => setLogDate(e.target.value)}
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                                    required
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Time</label>
                                <input
                                    type="time"
                                    value={logTime}
                                    onChange={e => setLogTime(e.target.value)}
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                                    required
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Wind (kts)</label>
                                <input
                                    value={newEntry.windSpeed}
                                    onChange={e => setNewEntry({ ...newEntry, windSpeed: e.target.value })}
                                    placeholder="Speed"
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gusts (kts)</label>
                                <input
                                    value={newEntry.windGusts}
                                    onChange={e => setNewEntry({ ...newEntry, windGusts: e.target.value })}
                                    placeholder="Gusts"
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Dir (°)</label>
                                <input
                                    value={newEntry.windDirection}
                                    onChange={e => setNewEntry({ ...newEntry, windDirection: e.target.value })}
                                    placeholder="Deg"
                                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit' }}
                                />
                            </div>
                        </div>

                        {/* Gear Used */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem' }}>Gear Used</label>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                                {newEntry.gearUsed.split(', ').filter(g => g.trim() !== '').map((gearStr, idx) => (
                                    <div key={idx} style={{
                                        background: 'var(--accent-primary)',
                                        color: '#0f172a',
                                        fontWeight: 600,
                                        padding: '4px 10px',
                                        borderRadius: '16px',
                                        fontSize: '0.78rem',
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
                                            <X size={14} color="#0f172a" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                            <select
                                value=""
                                onChange={(e) => {
                                    if (e.target.value) {
                                        handleAddGearToEntry(JSON.parse(e.target.value));
                                    }
                                }}
                                style={{
                                    width: '100%',
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

                        {/* Rating */}
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                <label style={{ fontSize: '0.85rem' }}>Session Rating</label>
                                <span style={{ color: '#facc15', fontWeight: 'bold', fontSize: '0.9rem' }}>
                                    {'★'.repeat(Number(newEntry.rating) || 5)}{'☆'.repeat(5 - (Number(newEntry.rating) || 5))} ({newEntry.rating}/5)
                                </span>
                            </div>
                            <input
                                type="range" min="1" max="5"
                                value={newEntry.rating}
                                onChange={e => setNewEntry({ ...newEntry, rating: e.target.value })}
                                style={{ width: '100%' }}
                            />
                        </div>

                        {/* Notes (Optional) */}
                        <div>
                            <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.85rem' }}>
                                Notes <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 400 }}>(optional)</span>
                            </label>
                            <textarea
                                value={newEntry.notes}
                                onChange={e => setNewEntry({ ...newEntry, notes: e.target.value })}
                                placeholder="How did the session feel? Any breakthrough gybes, gear tuning, or gust notes?"
                                style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'transparent', color: 'inherit', minHeight: '65px' }}
                            />
                        </div>
                    </div>

                    {/* Step 3: Interactive Preview if Telemetry is Loaded */}
                    {newEntry.mapPolyline && (
                        <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
                            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-primary)', display: 'block', marginBottom: '8px' }}>
                                Telemetry Preview
                            </span>

                            <CardMediaBoundary>
                                <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading map...</div>}>
                                    <SessionMap
                                        summary_polyline={newEntry.mapPolyline}
                                        streams={newEntry.streams}
                                        highlightIndex={hoveredIndex}
                                    />
                                </Suspense>
                            </CardMediaBoundary>

                            {newEntry.foilAnalysis && (
                                <div style={{ marginTop: '12px' }}>
                                    <CardMediaBoundary>
                                        <Suspense fallback={null}>
                                            <FoilAnalysisChart
                                                analysisData={newEntry.foilAnalysis}
                                                onHover={setHoveredIndex}
                                            />
                                        </Suspense>
                                    </CardMediaBoundary>
                                </div>
                            )}

                            {newEntry.streams && (
                                <div style={{ marginTop: '12px' }}>
                                    <CardMediaBoundary>
                                        <Suspense fallback={null}>
                                            <HeartRateChart streams={newEntry.streams} onHover={setHoveredIndex} />
                                        </Suspense>
                                    </CardMediaBoundary>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', marginTop: '8px' }}>
                        <button
                            type="button"
                            onClick={() => {
                                setIsAdding(false);
                                setEditId(null);
                            }}
                            className="btn-secondary"
                            style={{ padding: '10px 18px' }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn-primary"
                            style={{ padding: '10px 24px' }}
                        >
                            {editId ? 'Update Session' : 'Save Session'}
                        </button>
                    </div>
                </form>
            )}

            {/* ── Sessions Filter Bar (Core UX #9) ── */}
            {!isAdding && entries.length > 0 && (
                <div className="glass-panel" style={{ padding: '12px 16px', marginBottom: '1rem', display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: '1 1 200px' }}>
                        <Search size={16} color="var(--text-secondary)" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                            placeholder="Filter notes, gear, spots…"
                            style={{
                                width: '100%',
                                background: 'transparent',
                                border: 'none',
                                outline: 'none',
                                color: 'var(--text-primary)',
                                fontSize: '0.85rem'
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        {/* Spot Filter */}
                        {uniqueLocations.length > 1 && (
                            <select
                                value={selectedLocation}
                                onChange={e => setSelectedLocation(e.target.value)}
                                style={{
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color)',
                                    background: 'var(--bg-secondary)',
                                    color: 'var(--text-primary)',
                                    fontSize: '0.78rem'
                                }}
                            >
                                <option value="ALL">All Spots</option>
                                {uniqueLocations.map(loc => (
                                    <option key={loc} value={loc}>{loc}</option>
                                ))}
                            </select>
                        )}

                        {/* Star Rating Chips */}
                        <div style={{ display: 'flex', gap: '4px' }}>
                            {[
                                { label: 'All', val: 0 },
                                { label: '3★+', val: 3 },
                                { label: '4★+', val: 4 },
                                { label: '5★', val: 5 }
                            ].map(item => (
                                <button
                                    key={item.label}
                                    type="button"
                                    onClick={() => setMinRating(item.val)}
                                    style={{
                                        padding: '3px 8px',
                                        borderRadius: '12px',
                                        fontSize: '0.72rem',
                                        border: '1px solid var(--border-color)',
                                        background: minRating === item.val ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
                                        color: minRating === item.val ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                        cursor: 'pointer'
                                    }}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>

                        {/* Result Counter & Clear */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            <span>Showing {filteredEntries.length} of {entries.length}</span>
                            {isFiltered && (
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSearchQuery('');
                                        setSelectedLocation('ALL');
                                        setMinRating(0);
                                    }}
                                    style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', padding: '2px 4px', fontSize: '0.72rem' }}
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ── Sessions List ── */}
            {!isAdding && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBottom: '5rem' }}>
                    {entries.length === 0 ? (
                        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                            No sessions recorded yet. Tap "+ Log Session" to add your first entry.
                        </p>
                    ) : filteredEntries.length === 0 ? (
                        <div className="glass-panel" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                            No sessions match your filter criteria.
                        </div>
                    ) : (
                        filteredEntries.map((entry, index) => {
                            const analysis = getQuickStats(entry);
                            const isLatest = index === 0;
                            const safeRating = Math.min(5, Math.max(0, Math.round(Number(entry.rating) || 0)));
                            const hasHeartRateData = Boolean(
                                entry.streams?.heartrate?.data?.some((v) => v > 0) ||
                                (Array.isArray(entry.streams) && entry.streams.find((s) => s.type === 'heartrate')?.data?.some((v) => v > 0))
                            );

                            return (
                                <div
                                    key={entry.id || `${entry.date}-${index}`}
                                    className="glass-panel"
                                    style={{ padding: '16px', cursor: 'pointer', transition: 'border-color 0.2s' }}
                                    onClick={() => navigate(`/session/${entry.id}`)}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <div style={{ flex: 1 }}>
                                            {/* Location */}
                                            <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <MapPin size={10} /> {entry.locationName || 'Unknown Location'}
                                            </div>

                                            {/* Date & Rating */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                                                {sessionNumberMap.has(String(entry.id)) && (
                                                    <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent-primary)', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.22)', padding: '1px 6px', borderRadius: '4px' }}>
                                                        #{sessionNumberMap.get(String(entry.id))}
                                                    </span>
                                                )}
                                                <span style={{ fontWeight: 600, fontSize: '1rem' }}>
                                                    {safeFormatDate(entry.date, 'EEE dd MMM')}
                                                </span>
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                                    {safeFormatDate(entry.date, 'h:mm a')}
                                                </span>
                                                <span style={{ color: '#facc15', fontWeight: 'bold', fontSize: '0.85rem' }}>
                                                    {'★'.repeat(safeRating)}{'☆'.repeat(5 - safeRating)}
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
                                            {entry.notes && (
                                                <p style={{ margin: '4px 0', fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '85%' }}>
                                                    {entry.notes}
                                                </p>
                                            )}

                                            {/* Foil stats summary inline */}
                                            {analysis && analysis.stats && (
                                                <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                                                    {(entry.activityStats?.topSpeed || analysis.stats?.topSpeed) && (
                                                        <span style={{ color: 'var(--accent-primary)' }}><b>{entry.activityStats?.topSpeed || analysis.stats.topSpeed} kts</b> Top Speed</span>
                                                    )}
                                                    {(entry.activityStats?.distance || analysis.stats?.totalDistance) && (
                                                        <span><b>{parseFloat(entry.activityStats?.distance || analysis.stats.totalDistance).toFixed(2)} km</b> Distance</span>
                                                    )}
                                                    <span style={{ color: '#5cb85c' }}><b>{analysis.stats.totalFoilTime}m</b> Time on Foil</span>
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

                                            {/* AI Coach Tags (Phase 5.1) */}
                                            {entry.coachTags && (
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px', alignItems: 'center' }}>
                                                    <span style={{
                                                        fontSize: '0.68rem',
                                                        fontWeight: 600,
                                                        padding: '2px 7px',
                                                        borderRadius: '10px',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '3px',
                                                        background: entry.coachTags.powerState === 'dialed'
                                                            ? 'rgba(74, 222, 128, 0.14)'
                                                            : entry.coachTags.powerState === 'underpowered'
                                                                ? 'rgba(56, 189, 248, 0.14)'
                                                                : 'rgba(251, 191, 36, 0.14)',
                                                        color: entry.coachTags.powerState === 'dialed'
                                                            ? '#4ade80'
                                                            : entry.coachTags.powerState === 'underpowered'
                                                                ? '#38bdf8'
                                                                : '#fbbf24',
                                                        border: '1px solid rgba(255,255,255,0.08)'
                                                    }}>
                                                        <Sparkles size={10} />
                                                        {entry.coachTags.powerState.replace('_', ' ')}
                                                    </span>
                                                    {entry.coachTags.foilSentiment && entry.coachTags.foilSentiment !== 'balanced' && (
                                                        <span style={{ fontSize: '0.68rem', padding: '2px 7px', borderRadius: '10px', background: 'rgba(167, 139, 250, 0.14)', color: '#a78bfa' }}>
                                                            Foil: {entry.coachTags.foilSentiment.replace('_', ' ')}
                                                        </span>
                                                    )}
                                                    {entry.coachTags.breakthrough && (
                                                        <span style={{ fontSize: '0.68rem', padding: '2px 7px', borderRadius: '10px', background: 'rgba(250, 204, 21, 0.14)', color: '#facc15' }}>
                                                            🏆 {entry.coachTags.breakthrough}
                                                        </span>
                                                    )}
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
                                                {confirmDeleteId === entry.id ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'rgba(248, 113, 113, 0.15)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(248, 113, 113, 0.3)' }} onClick={(e) => e.stopPropagation()}>
                                                        <span style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 600 }}>Delete?</span>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); handleDelete(entry.id); }}
                                                            style={{ background: '#f87171', border: 'none', color: '#0f172a', borderRadius: '3px', padding: '2px 6px', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer' }}
                                                        >
                                                            Yes
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }}
                                                            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '2px 4px', fontSize: '0.72rem' }}
                                                        >
                                                            Cancel
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(entry.id); }}
                                                        style={{ background: 'none', border: 'none', color: '#ff6b6b', cursor: 'pointer', padding: '4px' }}
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* ── Track Visualization: Interactive Map on Latest, Lightweight SVG Thumbnail on Older ── */}
                                    {entry.mapPolyline && (
                                        <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }} onClick={(e) => e.stopPropagation()}>
                                            {isLatest ? (
                                                <CardMediaBoundary>
                                                    <Suspense fallback={<div style={{ padding: '30px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading interactive map...</div>}>
                                                        <SessionMap summary_polyline={entry.mapPolyline} streams={entry.streams} />
                                                    </Suspense>
                                                </CardMediaBoundary>
                                            ) : (
                                                <PolylineThumbnail
                                                    summary_polyline={entry.mapPolyline}
                                                    height={100}
                                                />
                                            )}
                                        </div>
                                    )}

                                    {/* Most recent session chart */}
                                    {isLatest && analysis && (
                                        <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }} onClick={(e) => e.stopPropagation()}>
                                            <CardMediaBoundary>
                                                <Suspense fallback={<div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading chart...</div>}>
                                                    <FoilAnalysisChart analysisData={analysis} />
                                                </Suspense>
                                            </CardMediaBoundary>
                                        </div>
                                    )}

                                    {/* Heart rate chart for latest or non-GPS session */}
                                    {(isLatest || !analysis) && hasHeartRateData && (
                                        <div style={{ marginTop: '12px', borderTop: '1px solid var(--border-color)', paddingTop: '12px' }} onClick={(e) => e.stopPropagation()}>
                                            <CardMediaBoundary>
                                                <Suspense fallback={null}>
                                                    <HeartRateChart streams={entry.streams} />
                                                </Suspense>
                                            </CardMediaBoundary>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            )}
        </div>
    );
};

export default SessionsPage;
