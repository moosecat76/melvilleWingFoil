import React, { useState, useEffect, useMemo } from 'react';
import { format } from 'date-fns';
import { Wind, Navigation, ThumbsUp, ThumbsDown, ArrowUp, AlertTriangle, Anchor, Waves, LogIn, LogOut, User } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, ReferenceLine, ReferenceArea, Label } from 'recharts';
import { getWeatherForecast, getTideForecast, getActualWeather, processChartData } from '../services/weatherService';
import { getWindRating, getGearRecommendation } from '../services/recommendationService';
import { useLocation } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';

import MapComponent from '../components/MapComponent';
import GearSelector from '../components/GearSelector';
import LocationManager from '../components/LocationManager';
import BestTime from '../components/BestTime';
import SimilarSessionsCard from '../components/SimilarSessionsCard';
import { getJournalEntries } from '../services/journalService';
import { getStoredGeminiKey, setStoredGeminiKey } from '../services/aiCoachService';
import { exportData, importData } from '../services/storageService';
import { initiateGoogleFitAuth, handleGoogleFitCallback, getGoogleFitUserAsync, disconnectGoogleFit } from '../services/googleFitService';
import { saveUserGear } from '../services/dbService';
import { Download, Upload, Database, Wifi, Sparkles } from 'lucide-react';

const CustomArrowDot = (props) => {
    const { cx, cy, payload, index, getWindRating, idealWindDirection } = props;
    if (index % 3 !== 0) return null;

    const rating = getWindRating(payload.speed, payload.direction, idealWindDirection);

    return (
        <svg x={cx - 10} y={cy - 10} width={20} height={20} style={{ overflow: 'visible' }}>
            <line
                x1="10" y1="10" x2="10" y2="-5"
                stroke={rating.color}
                strokeWidth="2"
                transform={`rotate(${payload.direction + 180} 10 10)`}
            />
            <polygon
                points="10,-8 6,0 14,0"
                fill={rating.color}
                transform={`rotate(${payload.direction + 180} 10 10)`}
            />
        </svg>
    );
};

const ForecastPage = () => {
    const { currentLocation, resetToDefaultLocation } = useLocation();
    const { user, login, logout, loading: authLoading } = useAuth();
    const { unit, setUnit, unitLabel, formatSpeedFromKmh } = usePreferences();
    const { showToast } = useToast();

    const [googleFitUser, setGoogleFitUser] = useState(null);
    const [gfitAuthLoading, setGfitAuthLoading] = useState(false);
    const [geminiKeyInput, setGeminiKeyInput] = useState(() => getStoredGeminiKey());
    const [showKeyEditor, setShowKeyEditor] = useState(false);

    const [data, setData] = useState([]);
    const [daily, setDaily] = useState(null);
    const [current, setCurrent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Responsive Forecast Horizon: 3 days on mobile (<= 768px), 7 days on other views
    const [forecastDays, setForecastDays] = useState(() => {
        if (typeof window !== 'undefined') {
            return window.innerWidth <= 768 ? 3 : 7;
        }
        return 7;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return;
        const mql = window.matchMedia('(max-width: 768px)');
        const handleViewportChange = (e) => {
            setForecastDays(e.matches ? 3 : 7);
        };
        if (mql.addEventListener) {
            mql.addEventListener('change', handleViewportChange);
            return () => mql.removeEventListener('change', handleViewportChange);
        } else if (mql.addListener) {
            mql.addListener(handleViewportChange);
            return () => mql.removeListener(handleViewportChange);
        }
    }, []);

    // Gear & Historical Sessions State
    const [userGear, setUserGear] = useState([]);
    const [userSessions, setUserSessions] = useState([]);
    useEffect(() => {
        if (authLoading) return;
        const fetchGearAndSessions = async () => {
            if (user?.uid) {
                const { getUserGear } = await import('../services/dbService');
                const gear = await getUserGear(user.uid);
                setUserGear(gear);
            } else {
                setUserGear(JSON.parse(localStorage.getItem('melvill_user_gear') || '[]'));
            }
            try {
                const entries = await getJournalEntries(user?.uid);
                setUserSessions(entries || []);
            } catch (e) {
                console.warn('[ForecastPage] Failed to load journal entries:', e);
            }
        };
        fetchGearAndSessions();
    }, [user?.uid, authLoading]);

    const handleSaveGear = async (items) => {
        setUserGear(items);
        if (user?.uid) {
            await saveUserGear(user.uid, items);
        } else {
            localStorage.setItem('melvill_user_gear', JSON.stringify(items));
        }
        showToast('Quiver saved successfully', 'success');
    };

    const [showGearSelector, setShowGearSelector] = useState(false);

    useEffect(() => {
        let isMounted = true;
        const fetchData = async () => {
            try {
                setLoading(true);
                setError(null);

                const rawData = await getWeatherForecast(currentLocation.latitude, currentLocation.longitude);
                const tideData = await getTideForecast(currentLocation.latitude, currentLocation.longitude);
                const actualWeather = await getActualWeather(currentLocation.latitude, currentLocation.longitude);

                if (!isMounted) return;

                const processed = processChartData(rawData, tideData);
                setData(processed);
                setDaily(rawData.daily);

                if (actualWeather) {
                    const diffHours = Math.abs(new Date() - actualWeather.time) / 36e5;
                    if (diffHours < 3) {
                        setCurrent({ ...actualWeather, isActual: true, tide: processed[0]?.tide });
                    } else {
                        setCurrent(processed.find(p => Math.abs(p.rawDate - new Date()) < 36e5) || processed[0]);
                    }
                } else {
                    const now = new Date();
                    if (processed && processed.length > 0) {
                        const closest = processed.reduce((prev, curr) => {
                            return (Math.abs(curr.rawDate - now) < Math.abs(prev.rawDate - now) ? curr : prev);
                        });
                        setCurrent(closest);
                    }
                }
            } catch (err) {
                console.error(err);
                if (isMounted) {
                    setError('Failed to load weather data.');
                    showToast('Failed to load weather data', 'error');
                }
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        fetchData();
        return () => { isMounted = false; };
    }, [currentLocation]);

    // ── Check Google Health connection on mount ──
    useEffect(() => {
        if (authLoading) return;
        getGoogleFitUserAsync(user?.uid).then(setGoogleFitUser);
    }, [user?.uid, authLoading]);

    // ── Handle Google Health OAuth callback (?state=googlefit&code=...) ──
    useEffect(() => {
        if (authLoading) return;
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        if (code && state === 'googlefit') {
            window.history.replaceState({}, document.title, window.location.pathname);
            setGfitAuthLoading(true);
            handleGoogleFitCallback(code, user?.uid)
                .then((profile) => {
                    setGoogleFitUser(profile);
                    showToast(`Google Health connected as ${profile.email || 'your account'}!`, 'success');
                })
                .catch((e) => {
                    console.error('[ForecastPage] Google Health callback error:', e);
                    showToast('Google Health connection failed: ' + e.message, 'error');
                })
                .finally(() => setGfitAuthLoading(false));
        }
    }, [user?.uid, authLoading, showToast]);

    // ── Memoized chart data & nighttime shading (ALL HOOKS CALLED AT TOP) ──
    const oneDayAgo = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        d.setHours(0, 0, 0, 0);
        return d;
    }, []);

    const chartData = useMemo(() => {
        if (!data || data.length === 0) return [];
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const startCutoff = forecastDays === 3 ? startOfToday : oneDayAgo;
        const endCutoff = forecastDays === 3
            ? new Date(startOfToday.getTime() + 3 * 24 * 3600 * 1000)
            : null;

        return data
            .filter(d => d.rawDate >= startCutoff && (!endCutoff || d.rawDate <= endCutoff))
            .map(d => {
                const s = (unit === 'knots' ? (d.speed || 0) * 0.539957 : (d.speed || 0));
                const g = (unit === 'knots' ? (d.gusts || 0) * 0.539957 : (d.gusts || 0));
                return {
                    ...d,
                    chartSpeed: Number(s.toFixed(1)),
                    chartGusts: Number(g.toFixed(1))
                };
            });
    }, [data, unit, oneDayAgo, forecastDays]);

    const nightBands = useMemo(() => {
        if (!chartData || chartData.length === 0) return [];

        const times = chartData.map(d => d.time);
        const minTime = times[0];
        const maxTime = times[times.length - 1];

        const findClosestTime = (targetMs) => {
            let closest = times[0];
            let minDiff = Math.abs(times[0] - targetMs);
            for (let i = 1; i < times.length; i++) {
                const diff = Math.abs(times[i] - targetMs);
                if (diff < minDiff) {
                    minDiff = diff;
                    closest = times[i];
                }
            }
            return closest;
        };

        const bands = [];

        if (daily && Array.isArray(daily.time) && Array.isArray(daily.sunrise) && Array.isArray(daily.sunset)) {
            for (let i = 0; i < daily.time.length; i++) {
                const sunsetMs = new Date(daily.sunset[i]).getTime();
                const nextSunriseMs = (i < daily.time.length - 1 && daily.sunrise[i + 1])
                    ? new Date(daily.sunrise[i + 1]).getTime()
                    : null;

                if (nextSunriseMs) {
                    const start = findClosestTime(sunsetMs);
                    const end = findClosestTime(nextSunriseMs);
                    if (start < end && end >= minTime && start <= maxTime) {
                        bands.push({
                            start: Math.max(start, minTime),
                            end: Math.min(end, maxTime)
                        });
                    }
                }
            }

            // Check day 0 pre-sunrise
            if (daily.sunrise[0]) {
                const firstSunrise = findClosestTime(new Date(daily.sunrise[0]).getTime());
                if (minTime < firstSunrise) {
                    bands.unshift({ start: minTime, end: firstSunrise });
                }
            }
        }

        // Fallback: if daily is missing or produced no bands in range, compute by hour (19:00 -> 06:00)
        if (bands.length === 0) {
            let currentBand = null;
            for (const d of chartData) {
                const h = d.rawDate.getHours();
                const isNight = (h >= 19 || h < 6);
                if (isNight) {
                    if (!currentBand) {
                        currentBand = { start: d.time, end: d.time };
                    } else {
                        currentBand.end = d.time;
                    }
                } else {
                    if (currentBand && currentBand.start !== currentBand.end) {
                        bands.push(currentBand);
                    }
                    currentBand = null;
                }
            }
            if (currentBand && currentBand.start !== currentBand.end) {
                bands.push(currentBand);
            }
        }

        return bands;
    }, [daily, chartData]);

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            setLoading(true);
            const result = await importData(file);

            if (user?.uid && result.data) {
                const { restoreBackupToFirestore } = await import('../services/dbService');
                await restoreBackupToFirestore(user.uid, result.data);
            }
            showToast('Successfully restored data! Refreshing…', 'success');
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch (err) {
            setLoading(false);
            showToast('Failed to import data: ' + err.message, 'error');
        }
    };

    const handleExport = () => {
        try {
            exportData(user?.uid);
            showToast('Data exported successfully', 'success');
        } catch (err) {
            showToast('Failed to export data: ' + err.message, 'error');
        }
    };

    // ── Conditional renders after all hooks are executed ──
    if (loading) return <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>Loading Forecast for {currentLocation.name}...</div>;
    if (error) {
        return (
            <div className="app-container">
                <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <h1 className="text-gradient" style={{ margin: 0, fontSize: '2.5rem', fontWeight: 800 }}>
                            Wind Foil App
                        </h1>
                        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Navigation size={16} /> {currentLocation.name} ({Number(currentLocation.latitude).toFixed(4)}, {Number(currentLocation.longitude).toFixed(4)})
                        </p>
                    </div>
                </header>

                <div className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', border: '1px solid rgba(248, 113, 113, 0.4)', background: 'rgba(248, 113, 113, 0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#f87171', fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.5rem' }}>
                        <AlertTriangle size={20} />
                        <span>{error}</span>
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
                        Could not fetch forecast for <strong>{currentLocation.name}</strong> at coordinates <code>{currentLocation.latitude}, {currentLocation.longitude}</code>. You can edit or delete the location below, or switch back to Melville Waters.
                    </p>
                    <button
                        onClick={resetToDefaultLocation}
                        className="btn-primary"
                        style={{ padding: '8px 16px', fontSize: '0.85rem' }}
                    >
                        Reset to Melville Waters
                    </button>
                </div>

                <LocationManager />
            </div>
        );
    }

    const currentRating = current ? getWindRating(current.speed, current.direction, currentLocation.idealWindDirection) : { label: '-', color: 'grey', rating: 0 };
    const gear = getGearRecommendation(current?.speed, userGear, {
        sessions: userSessions,
        gustsKmh: current?.gusts
    });

    const displayedSpeed = formatSpeedFromKmh(current?.speed);
    const displayedGusts = formatSpeedFromKmh(current?.gusts);

    const getRatingIcon = (ratingVal) => {
        if (ratingVal <= 1) return <ThumbsDown />;
        return <ThumbsUp />;
    };

    return (
        <div className="app-container">
            <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="text-gradient" style={{ margin: 0, fontSize: '2.5rem', fontWeight: 800 }}>
                        Wind Foil App
                    </h1>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Navigation size={16} /> {currentLocation.name}
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                    <div className="unit-toggle">
                        <button className={unit === 'kmh' ? 'active' : ''} onClick={() => setUnit('kmh')}>km/h</button>
                        <button className={unit === 'knots' ? 'active' : ''} onClick={() => setUnit('knots')}>knots</button>
                    </div>
                    {user ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {user.photoURL && <img src={user.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />}
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{user.displayName?.split(' ')[0]}</span>
                            <button onClick={logout} className="btn-secondary" style={{ padding: '4px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <LogOut size={14} /> Sign Out
                            </button>
                        </div>
                    ) : (
                        <button onClick={login} disabled={authLoading} style={{ background: 'var(--accent-primary)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '0.85rem' }}>
                            <LogIn size={16} /> Sign in with Google
                        </button>
                    )}
                </div>
            </header>

            <main style={{ display: 'grid', gap: '2rem' }}>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', alignItems: 'start' }}>
                    <LocationManager />
                    <BestTime
                        forecastHourly={data}
                        userGear={userGear}
                        idealWindDirection={currentLocation.idealWindDirection}
                        daily={daily}
                        unit={unit}
                        sessions={userSessions}
                        locationId={currentLocation.id}
                        locationName={currentLocation.name}
                        currentTide={current?.tide}
                    />
                </div>

                {/* Status, Wind & Tide Cards Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
                    {/* Current Conditions Card */}
                    <div className="glass-panel" style={{ padding: '1.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <h2 className="card-title">Current Wind</h2>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                                <span className="metric-value">{displayedSpeed}</span>
                                <span className="metric-label">{unitLabel}</span>
                                {current?.isActual && (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--status-success)', fontWeight: 600, border: '1px solid var(--status-success)', padding: '2px 6px', borderRadius: '4px' }}>LIVE</span>
                                )}
                            </div>
                            <div style={{ marginTop: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                Gusts: <span style={{ color: '#fbbf24', fontWeight: 600 }}>{displayedGusts}</span> {unitLabel}
                            </div>
                        </div>
                        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'end', gap: '0.5rem' }}>
                            <div style={{
                                position: 'relative', width: '60px', height: '60px', border: '2px solid var(--border-color)', borderRadius: '50%',
                                display: 'flex', justifyContent: 'center', alignItems: 'center', background: 'var(--bg-secondary)'
                            }}>
                                <div className="wind-compass" style={{ transform: `rotate(${current?.direction + 180}deg)` }}>
                                    <ArrowUp size={32} color="var(--accent-primary)" />
                                </div>
                                <span style={{ position: 'absolute', bottom: '-25px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    {current?.direction}°
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Status & Gear Card */}
                    <div className="glass-panel" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                                <div>
                                    <h3 className="card-title">Forecast Status</h3>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                                        <div style={{ color: currentRating.color }}>{React.cloneElement(getRatingIcon(currentRating.rating), { size: 30 })}</div>
                                        <span style={{ fontSize: '1.4rem', fontWeight: 700, color: currentRating.color }}>{currentRating.label}</span>
                                    </div>
                                </div>
                            </div>

                            {current?.speed > 35 && (
                                <div className="alert-banner">
                                    <AlertTriangle size={18} />
                                    <span>High wind warning! Check conditions.</span>
                                </div>
                            )}
                        </div>

                        <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <Anchor size={24} color="var(--accent-primary)" />
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recommended Gear</div>
                                    <button
                                        onClick={() => setShowGearSelector(!showGearSelector)}
                                        style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', background: 'none', border: '1px solid var(--accent-primary)', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
                                    >
                                        {userGear.length > 0 ? 'Edit Quiver' : 'Add My Gear'}
                                    </button>
                                </div>
                                {showGearSelector ? (
                                    <div style={{ marginTop: '0.75rem' }}>
                                        <GearSelector
                                            currentGear={userGear}
                                            onSave={handleSaveGear}
                                            onClose={() => setShowGearSelector(false)}
                                        />
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                                            <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)' }}>{gear.text}</span>
                                            {gear.isDataDriven && (
                                                <span style={{ fontSize: '0.68rem', fontWeight: 600, color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '999px', padding: '1px 7px' }}>
                                                    Sweet Spot
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>{gear.sub || '(Add gear to personalize)'}</div>
                                        {gear.gustAdvice && (
                                            <div style={{ fontSize: '0.75rem', color: '#fbbf24', marginTop: '4px' }}>
                                                ⚡ {gear.gustAdvice}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Un-nested Tide Info Card */}
                    <div className="glass-panel" style={{ padding: '1.75rem', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
                                <Waves size={24} color="var(--accent-primary)" />
                                <h3 className="card-title" style={{ margin: 0 }}>Tide Info</h3>
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Current Level</div>
                            <div style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                {current?.tide ? `${current.tide.toFixed(2)} m` : '-'}
                            </div>
                        </div>

                        {current?.tide != null && current.tide < 0.6 ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--status-warning)', fontWeight: 600, fontSize: '0.85rem', marginTop: '1rem', background: 'rgba(251, 191, 36, 0.1)', padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
                                <AlertTriangle size={16} />
                                <span>Low Tide Alert (&lt; 0.6m)</span>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '1rem' }}>
                                Tide levels from Open-Meteo Marine model
                            </div>
                        )}
                    </div>
                </div>

                {/* Similar Past Sessions Context Card (Phase 4.3) */}
                <SimilarSessionsCard
                    forecastHourly={data}
                    current={current}
                    sessions={userSessions}
                    userGear={userGear}
                    idealWindDirection={currentLocation.idealWindDirection}
                    daily={daily}
                    locationId={currentLocation.id}
                />

                {/* Main Forecast Chart (3-Day on Mobile, 7-Day on Desktop) with Gust Band & Nighttime Shading */}
                <div className="glass-panel" style={{ padding: '2rem', height: '420px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <h3 className="card-title" style={{ margin: 0 }}>{forecastDays}-Day Forecast</h3>
                            <div className="unit-toggle" style={{ transform: 'scale(0.85)', transformOrigin: 'left center' }}>
                                <button
                                    type="button"
                                    className={forecastDays === 3 ? 'active' : ''}
                                    onClick={() => setForecastDays(3)}
                                    title="Show 3-day forecast"
                                >
                                    3D
                                </button>
                                <button
                                    type="button"
                                    className={forecastDays === 7 ? 'active' : ''}
                                    onClick={() => setForecastDays(7)}
                                    title="Show 7-day forecast"
                                >
                                    7D
                                </button>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ width: '12px', height: '2px', background: 'var(--accent-primary)', display: 'inline-block' }} />
                                Wind Speed
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ width: '12px', height: '2px', borderTop: '2px dashed #fbbf24', display: 'inline-block' }} />
                                Gusts
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ width: '10px', height: '10px', background: 'rgba(0,0,0,0.4)', borderRadius: '2px', display: 'inline-block', border: '1px solid rgba(255,255,255,0.1)' }} />
                                Night
                            </span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ width: '12px', height: '2px', borderTop: '2px dashed #60a5fa', display: 'inline-block' }} />
                                Tide (m)
                            </span>
                        </div>
                    </div>
                    <ResponsiveContainer width="100%" height="90%">
                        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />

                            <XAxis
                                dataKey="time"
                                stroke="var(--text-secondary)"
                                fontSize={12}
                                tickMargin={10}
                                minTickGap={forecastDays === 3 ? 35 : 60}
                                tickFormatter={(val) => {
                                    const d = new Date(val);
                                    return format(d, 'EEE HH:mm');
                                }}
                            />

                            <YAxis
                                yAxisId="wind"
                                stroke="var(--text-secondary)"
                                fontSize={12}
                                domain={[0, 'auto']}
                                allowDecimals={false}
                                label={{
                                    value: `Speed (${unitLabel})`,
                                    angle: -90,
                                    position: 'insideLeft',
                                    style: { textAnchor: 'middle', fill: 'var(--text-secondary)' }
                                }}
                            />
                            <YAxis
                                yAxisId="tide"
                                orientation="right"
                                stroke="var(--accent-primary)"
                                fontSize={12}
                                domain={['auto', 'auto']}
                                hide={false}
                                tickFormatter={(val) => `${val}m`}
                            />

                            <Tooltip
                                content={({ active, payload, label }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px' }}>
                                                <p style={{ color: 'var(--accent-primary)', marginBottom: '5px', fontWeight: 600 }}>{data.displayDate} {data.label}</p>
                                                <p style={{ color: 'var(--text-primary)', margin: 0 }}>
                                                    Speed: <strong>{data.chartSpeed}</strong> {unitLabel}
                                                </p>
                                                <p style={{ color: '#fbbf24', fontSize: '0.9rem', margin: 0 }}>
                                                    Gusts: <strong>{data.chartGusts}</strong> {unitLabel}
                                                </p>
                                                {data.tide != null && (
                                                    <p style={{ color: '#60a5fa', fontSize: '0.85rem', margin: 0 }}>
                                                        Tide: <strong>{data.tide.toFixed(2)} m</strong>
                                                    </p>
                                                )}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', color: 'var(--text-secondary)' }}>
                                                    Direction: {data.direction}°
                                                    <ArrowUp size={14} style={{ transform: `rotate(${data.direction + 180}deg)` }} />
                                                </div>
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />

                            {/* Nighttime Shading Bands */}
                            {nightBands.map((band, idx) => (
                                <ReferenceArea
                                    key={`night-${idx}`}
                                    x1={band.start}
                                    x2={band.end}
                                    yAxisId="wind"
                                    fill="#000000"
                                    fillOpacity={0.45}
                                    strokeOpacity={0}
                                    ifFront={false}
                                />
                            ))}

                            {/* Day Separators & Labels */}
                            {chartData.map((d) => {
                                const hour = d.rawDate.getHours();
                                if (hour === 0) {
                                    return (
                                        <ReferenceLine
                                            key={`line-${d.time}`}
                                            x={d.time}
                                            stroke="var(--border-color)"
                                            strokeOpacity={0.5}
                                            strokeDasharray="3 3"
                                        />
                                    );
                                }
                                if (hour === 12) {
                                    return (
                                        <ReferenceLine
                                            key={`label-${d.time}`}
                                            x={d.time}
                                            stroke="none"
                                            label={{
                                                value: d.rawDate.toLocaleDateString('en-US', { weekday: forecastDays === 3 ? 'short' : 'long' }),
                                                position: 'insideTop',
                                                fill: 'var(--text-secondary)',
                                                fontSize: 12,
                                                fontWeight: 600,
                                            }}
                                        />
                                    );
                                }
                                return null;
                            })}

                            {/* NOW Indicator */}
                            {(() => {
                                const nowTarget = current?.time ? new Date(current.time) : new Date();
                                const closest = chartData.reduce((prev, curr) =>
                                    Math.abs(curr.rawDate - nowTarget) < Math.abs(prev.rawDate - nowTarget) ? curr : prev
                                    , chartData[0]);

                                return closest ? (
                                    <ReferenceLine x={closest.time} stroke="#ff4757" strokeDasharray="5 5" strokeWidth={2} isFront>
                                        <Label value="NOW" position="insideTop" offset={25} fill="#ff4757" fontSize={12} fontWeight="bold" />
                                    </ReferenceLine>
                                ) : null;
                            })()}

                            {/* Gust Line (Feature #13) */}
                            <Line
                                yAxisId="wind"
                                type="monotone"
                                dataKey="chartGusts"
                                name="Gusts"
                                stroke="#fbbf24"
                                strokeWidth={1.5}
                                strokeDasharray="3 3"
                                dot={false}
                                opacity={0.65}
                            />

                            {/* Main Speed Area */}
                            <Area
                                yAxisId="wind"
                                type="monotone"
                                dataKey="chartSpeed"
                                name="speed"
                                stroke="var(--accent-primary)"
                                fillOpacity={1}
                                fill="url(#colorSpeed)"
                                strokeWidth={2}
                                dot={<CustomArrowDot getWindRating={getWindRating} idealWindDirection={currentLocation.idealWindDirection} />}
                            />

                            {/* Tide Height Line */}
                            <Line
                                yAxisId="tide"
                                type="monotone"
                                dataKey="tide"
                                name="Tide Height"
                                stroke="#60a5fa"
                                strokeWidth={2}
                                dot={false}
                                strokeDasharray="5 5"
                                opacity={0.6}
                            />

                        </ComposedChart>
                    </ResponsiveContainer>
                </div>

                {/* Launch Location Map with Live Wind & Ideal Sector Cone */}
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    <h3 className="card-title">Launch Location</h3>
                    <MapComponent
                        lat={currentLocation.latitude}
                        lng={currentLocation.longitude}
                        name={currentLocation.name}
                        windDirection={current?.direction}
                        idealWindDirection={currentLocation.idealWindDirection}
                    />
                </div>

                {/* Data Management Section */}
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Database size={20} /> Data & Settings
                    </h3>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem', alignItems: 'center' }}>
                        <button onClick={handleExport} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Download size={16} /> Export Data
                        </button>
                        <div style={{ position: 'relative' }}>
                            <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }} onClick={() => document.getElementById('import-file').click()}>
                                <Upload size={16} /> Import Data
                            </button>
                            <input
                                id="import-file"
                                type="file"
                                accept=".json"
                                onChange={handleImport}
                                style={{ position: 'absolute', top: 0, left: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer', display: 'none' }}
                            />
                        </div>

                        {/* Google Health connect/disconnect */}
                        <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 6px' }}></div>

                        {gfitAuthLoading ? (
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Connecting…</span>
                        ) : !googleFitUser ? (
                            <button
                                onClick={initiateGoogleFitAuth}
                                style={{ background: '#4285F4', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                            >
                                <Wifi size={16} /> Connect Google Health
                            </button>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                    <Wifi size={16} color="#4285F4" />
                                    <span>Google Health: <strong>{googleFitUser.email}</strong></span>
                                </div>
                                <button
                                    onClick={initiateGoogleFitAuth}
                                    title="Re-authorize Google Health"
                                    style={{ background: '#4285F4', color: 'white', border: 'none', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                                >
                                    Reconnect
                                </button>
                                <button
                                    onClick={async () => {
                                        await disconnectGoogleFit(user?.uid);
                                        setGoogleFitUser(null);
                                        showToast('Google Health disconnected', 'info');
                                    }}
                                    style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-color)', padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem' }}
                                >
                                    Disconnect
                                </button>
                            </div>
                        )}

                        <div style={{ width: '1px', height: '24px', background: 'var(--border-color)', margin: '0 6px' }}></div>

                        {/* Optional Gemini API Key for AI Foil Coach */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                onClick={() => setShowKeyEditor(!showKeyEditor)}
                                className="btn-secondary"
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.82rem' }}
                            >
                                <Sparkles size={15} color="#38bdf8" />
                                {geminiKeyInput.trim() ? 'AI Coach Key Configured' : 'Configure AI Coach Key'}
                            </button>
                            {showKeyEditor && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <input
                                        type="password"
                                        value={geminiKeyInput}
                                        onChange={e => setGeminiKeyInput(e.target.value)}
                                        placeholder="GEMINI_API_KEY (optional if in .env)"
                                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'white', fontSize: '0.8rem', minWidth: '220px' }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setStoredGeminiKey(geminiKeyInput);
                                            setShowKeyEditor(false);
                                            showToast(geminiKeyInput.trim() ? 'Gemini API Key saved locally' : 'Cleared local Gemini API key', 'success');
                                        }}
                                        className="btn-primary"
                                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                                    >
                                        Save
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </main>

            <footer style={{ marginTop: '4rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem', paddingBottom: '5rem' }}>
                <p>Data provided by Open-Meteo API & OpenStreetMap. {user ? `Signed in as ${user.displayName}` : ''}</p>
            </footer>
        </div>
    );
};

export default ForecastPage;
