import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Wind, Navigation, Calendar, ThumbsUp, ThumbsDown, ArrowUp, AlertTriangle, Anchor, Waves } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, ReferenceLine, ReferenceArea, Label, Customized } from 'recharts';
import { getWeatherForecast, getTideForecast, getActualWeather, processChartData } from '../services/weatherService';
import { getWindRating, getGearRecommendation } from '../services/recommendationService';
import { useLocation } from '../context/LocationContext';
import { useAuth } from '../context/AuthContext';

import MapComponent from './MapComponent';
import GearSelector from './GearSelector';
import LocationManager from './LocationManager';
import Journal from './Journal';
import BestTime from './BestTime';
import { exportData, importData } from '../services/storageService';
import { initiateStravaAuth, handleStravaCallback, getStravaUser, getActivities } from '../services/stravaService';
import { Download, Upload, Database, Activity } from 'lucide-react';

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

const Dashboard = () => {
    const { currentLocation } = useLocation();
    const { user } = useAuth(); // Placeholder for future auth

    const [data, setData] = useState([]);
    const [daily, setDaily] = useState(null);
    const [current, setCurrent] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Gear State
    const [userGear, setUserGear] = useState(() => {
        const saved = localStorage.getItem('melvill_user_gear');
        return saved ? JSON.parse(saved) : [];
    });
    const [showGearSelector, setShowGearSelector] = useState(false);
    // User requested consistency, default to knots.
    const [unit, setUnit] = useState('knots');

    useEffect(() => {
        localStorage.setItem('melvill_user_gear', JSON.stringify(userGear));
    }, [userGear]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                setError(null);

                const rawData = await getWeatherForecast(currentLocation.latitude, currentLocation.longitude);
                const tideData = await getTideForecast(currentLocation.latitude, currentLocation.longitude);
                const actualWeather = await getActualWeather(currentLocation.latitude, currentLocation.longitude);

                // Pass tideData to helper
                const processed = processChartData(rawData, tideData);
                setData(processed);
                setDaily(rawData.daily);

                if (actualWeather) {
                    const diffHours = Math.abs(new Date() - actualWeather.time) / 36e5;
                    if (diffHours < 3) {
                        setCurrent({ ...actualWeather, isActual: true, tide: processed[0]?.tide }); // Try to grab tide
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
                setError('Failed to load weather data.');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
        fetchData();
    }, [currentLocation]);

    // Check for Strava Callback
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        if (code && !getStravaUser()) {
            handleStravaCallback(code).then(() => {
                // Remove code from URL
                window.history.replaceState({}, document.title, "/");
                alert('Strava Connected!');
                // Force re-render or state update if needed
                setLoading(false); // trigger update
            }).catch(e => {
                console.error(e);
                alert('Failed to connect Strava');
            });
        }
    }, []);

    const handleImport = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const result = await importData(file);
            alert(`Successfully restored! Reloading...`);
            window.location.reload();
        } catch (err) {
            alert('Failed to import data: ' + err.message);
        }
    };

    const formatSpeed = (val) => {
        if (val == null) return '-';
        if (unit === 'knots') return (val * 0.539957).toFixed(1);
        return Math.round(val);
    };

    if (loading) return <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading Forecast for {currentLocation.name}...</div>;
    if (error) return <div className="app-container">Error: {error}</div>;

    // Pass idealWindDirection
    const currentRating = current ? getWindRating(current.speed, current.direction, currentLocation.idealWindDirection) : { label: '-', color: 'grey', rating: 0 };
    const gear = getGearRecommendation(current?.speed, userGear);

    const displayedSpeed = formatSpeed(current?.speed);
    const displayedGusts = formatSpeed(current?.gusts);
    const unitLabel = unit === 'knots' ? 'kts' : 'km/h';

    const chartData = data.map(d => {
        const s = (unit === 'knots' ? (d.speed || 0) * 0.539957 : (d.speed || 0));
        const g = (unit === 'knots' ? (d.gusts || 0) * 0.539957 : (d.gusts || 0));
        return {
            ...d,
            chartSpeed: Number(s.toFixed(1)),
            chartGusts: Number(g.toFixed(1))
        };
    });

    console.log('Chart Data Ready:', chartData.length, 'points');

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
                    />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
                    {/* Current Conditions */}
                    <div className="glass-panel" style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                                Gusts: <span style={{ color: 'var(--text-primary)' }}>{displayedGusts}</span> {unitLabel}
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

                    {/* Status & Gear */}
                    <div className="glass-panel" style={{ padding: '2rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                            <div>
                                <h3 className="card-title">Forecast Status</h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                                    <div style={{ color: currentRating.color }}>{React.cloneElement(getRatingIcon(currentRating.rating), { size: 32 })}</div>
                                    <span style={{ fontSize: '1.5rem', fontWeight: 700, color: currentRating.color }}>{currentRating.label}</span>
                                </div>
                            </div>
                        </div>

                        {current?.speed > 35 && (
                            <div className="alert-banner">
                                <AlertTriangle size={18} />
                                <span>High wind warning! Check conditions.</span>
                            </div>
                        )}

                        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <Anchor size={24} color="var(--accent-primary)" />
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recommended Gear</div>
                                    <button
                                        onClick={() => setShowGearSelector(!showGearSelector)}
                                        style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', background: 'none', border: '1px solid var(--accent-primary)', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
                                    >
                                        {userGear.length > 0 ? 'Edit Quiver' : 'Add My Gear'}
                                    </button>
                                </div>
                                {showGearSelector ? (
                                    <div style={{ marginTop: '1rem' }}>
                                        <GearSelector
                                            currentGear={userGear}
                                            onSave={(items) => setUserGear(items)}
                                            onClose={() => setShowGearSelector(false)}
                                        />
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-primary)', marginTop: '0.25rem' }}>{gear.text}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{gear.sub || '(Add gear to personalize)'}</div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Tides Card */}
                        <div className="glass-panel" style={{ padding: '2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                                <Waves size={24} color="var(--accent-primary)" />
                                <h3 className="card-title" style={{ margin: 0 }}>Tide Info</h3>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
                                <div>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Current Level</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                        {current?.tide ? `${current.tide.toFixed(2)} m` : '-'}
                                    </div>
                                </div>
                                {current?.tide < 0.6 && (
                                    <span style={{ color: 'var(--status-warning)', fontWeight: 600, fontSize: '0.9rem' }}>Low Tide Alert!</span>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Feature 2: Journal */}
                <Journal
                    weatherData={data}
                    userGear={userGear}
                    onAddGear={() => {
                        setShowGearSelector(true);
                        // Optional: Scroll to top or give visual feedback?
                        // For now just opening the selector which is high up on the page.
                    }}
                />

                {/* Main Chart */}
                <div className="glass-panel" style={{ padding: '2rem', height: '400px' }}>
                    <h3 className="card-title">7-Day Forecast (Arrows show direction)</h3>
                    <ResponsiveContainer width="100%" height="100%">
                        {/* Use chartData which has converted units */}
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
                                minTickGap={60}
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
                                allowDecimals={false} // Force integers for clean scale
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
                                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                                                    Gusts: {data.chartGusts} {unitLabel}
                                                </p>
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

                            {/* Day Separators - Vertical Grid Lines at Midnight */}
                            {/* Day Separators & Labels */}
                            {chartData.map((d) => {
                                const hour = d.rawDate.getHours();
                                // Vertical Line at Midnight
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
                                // Label at Noon in the middle of the day slot
                                if (hour === 12) {
                                    return (
                                        <ReferenceLine
                                            key={`label-${d.time}`}
                                            x={d.time}
                                            stroke="none"
                                            label={{
                                                value: d.rawDate.toLocaleDateString('en-US', { weekday: 'long' }),
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

                            {/* NOW Indicator - Find closest chart time to current time/actuals */}
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

                            <Area
                                type="monotone"
                                dataKey="chartSpeed"
                                name="speed"
                                stroke="var(--accent-primary)"
                                fillOpacity={1}
                                fill="url(#colorSpeed)"
                                strokeWidth={2}
                                dot={<CustomArrowDot getWindRating={getWindRating} idealWindDirection={currentLocation.idealWindDirection} />}
                            />
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

                <div className="glass-panel" style={{ padding: '2rem' }}>
                    <h3 className="card-title">Launch Location</h3>
                    <MapComponent lat={currentLocation.latitude} lng={currentLocation.longitude} name={currentLocation.name} />
                </div>

                {/* Data Management Section */}
                <div className="glass-panel" style={{ padding: '2rem' }}>
                    <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Database size={20} /> Data & Settings
                    </h3>
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem' }}>
                        <button onClick={exportData} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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

                        <div style={{ width: '1px', background: 'var(--border-color)', margin: '0 10px' }}></div>

                        {!getStravaUser() ? (
                            <button onClick={initiateStravaAuth} style={{ background: '#fc4c02', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <Activity size={16} /> Connect Strava
                            </button>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)' }}>
                                <Activity size={16} color="#fc4c02" />
                                <span>Connected as {getStravaUser().firstname}</span>
                            </div>
                        )}
                    </div>
                </div>

            </main >

            <footer style={{ marginTop: '4rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                <p>Data provided by Open-Meteo API & OpenStreetMap. {user ? `Signed in as ${user.displayName}` : ''}</p>
            </footer>
        </div >
    );
};

export default Dashboard;
