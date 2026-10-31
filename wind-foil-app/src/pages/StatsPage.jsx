import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy, TrendingUp, Layers, Zap, Wind, Award, Calendar, Compass } from 'lucide-react';
import {
    ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis,
    CartesianGrid, Tooltip
} from 'recharts';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { subscribeToJournalEntries } from '../services/journalService';
import { analyzeSession, formatDurationSec } from '../services/foilAnalysisService';

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

const StatsPage = () => {
    const { user, loading: authLoading } = useAuth();
    const { unit } = usePreferences();
    const navigate = useNavigate();

    const speedUnit = unit === 'kmh' ? 'km/h' : 'kts';
    const ktsToUnit = unit === 'kmh' ? 1.852 : 1;

    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (authLoading) return;
        let mounted = true;
        setLoading(true);
        const unsubscribe = subscribeToJournalEntries(user?.uid, (data) => {
            if (mounted) {
                setEntries(data || []);
                setLoading(false);
            }
        });
        return () => {
            mounted = false;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [user?.uid, authLoading]);

    // Enrich entries with computed foilAnalysis (including maneuvers & longestFlightSec)
    const enrichedSessions = useMemo(() => {
        return entries
            .map((entry) => {
                let analysis = entry.foilAnalysis;
                if (entry.streams && (!analysis || !analysis.maneuvers || analysis.stats?.longestFlightSec == null)) {
                    try {
                        analysis = analyzeSession(entry.streams, { windDirection: entry.windDirection, gearUsed: entry.gearUsed }) || analysis;
                    } catch (_) {
                        // Keep stored analysis if re-computation fails
                    }
                }
                const d = entry.date ? new Date(entry.date) : new Date(0);
                return {
                    ...entry,
                    parsedDate: isNaN(d.getTime()) ? new Date(0) : d,
                    computedAnalysis: analysis || null,
                };
            })
            .sort((a, b) => a.parsedDate - b.parsedDate); // chronological order for progression charts
    }, [entries]);

    // Compute Personal Bests & Lifetime Totals
    const summary = useMemo(() => {
        let bestTopSpeed = { val: 0, entry: null };
        let bestLongestFlight = { val: 0, entry: null };
        let bestFoilPct = { val: 0, entry: null };
        let bestGybeRate = { val: 0, attempts: 0, entry: null };
        let bestDistance = { val: 0, entry: null };

        let totalDistanceKm = 0;
        let totalFoilMinutes = 0;
        let totalFlights = 0;
        let totalGybesCompleted = 0;

        for (const s of enrichedSessions) {
            const a = s.computedAnalysis;
            const st = a?.stats || {};
            const act = s.activityStats || {};

            const topKts = parseFloat(act.topSpeed || st.topSpeed || 0);
            if (!isNaN(topKts) && topKts > bestTopSpeed.val) {
                bestTopSpeed = { val: topKts, entry: s };
            }

            let longestSec = st.longestFlightSec || 0;
            if (!longestSec && Array.isArray(a?.foilSegments) && a?.data?.time) {
                for (const seg of a.foilSegments) {
                    const dur = Math.round((a.data.time[seg.end] || 0) - (a.data.time[seg.start] || 0));
                    if (dur > longestSec) longestSec = dur;
                }
            }
            if (longestSec > bestLongestFlight.val) {
                bestLongestFlight = { val: longestSec, entry: s };
            }

            const pct = parseFloat(st.percentFoil || 0);
            if (!isNaN(pct) && pct > bestFoilPct.val) {
                bestFoilPct = { val: pct, entry: s };
            }

            const distKm = parseFloat(act.distance || st.totalDistance || 0);
            if (!isNaN(distKm) && distKm > 0) {
                totalDistanceKm += distKm;
                if (distKm > bestDistance.val) {
                    bestDistance = { val: distKm, entry: s };
                }
            }

            const foilMin = parseFloat(st.totalFoilTime || 0);
            if (!isNaN(foilMin) && foilMin > 0) {
                totalFoilMinutes += foilMin;
            }

            const flights = parseInt(st.numberOfFlights || 0, 10);
            if (!isNaN(flights) && flights > 0) {
                totalFlights += flights;
            }

            const m = a?.maneuvers;
            if (m && m.totalAttempts > 0) {
                totalGybesCompleted += (m.completedTurns || 0);
                if (m.totalAttempts >= 2 && (m.completionRate || 0) > bestGybeRate.val) {
                    bestGybeRate = { val: m.completionRate, attempts: m.totalAttempts, entry: s };
                }
            }
        }

        return {
            totalSessions: enrichedSessions.length,
            totalDistanceKm: totalDistanceKm.toFixed(1),
            totalFoilHours: (totalFoilMinutes / 60).toFixed(1),
            totalFoilMinutes: Math.round(totalFoilMinutes),
            totalFlights,
            totalGybesCompleted,
            bestTopSpeed,
            bestLongestFlight,
            bestFoilPct,
            bestGybeRate,
            bestDistance,
        };
    }, [enrichedSessions]);

    // Build Progression Series for Charts
    const progressionData = useMemo(() => {
        return enrichedSessions
            .filter(s => s.computedAnalysis?.stats || s.activityStats)
            .map((s) => {
                const st = s.computedAnalysis?.stats || {};
                const act = s.activityStats || {};
                const m = s.computedAnalysis?.maneuvers || {};
                const topKts = parseFloat(act.topSpeed || st.topSpeed || 0);

                let longestSec = st.longestFlightSec || 0;
                if (!longestSec && Array.isArray(s.computedAnalysis?.foilSegments) && s.computedAnalysis?.data?.time) {
                    const tArr = s.computedAnalysis.data.time;
                    for (const seg of s.computedAnalysis.foilSegments) {
                        const dur = Math.round((tArr[seg.end] || 0) - (tArr[seg.start] || 0));
                        if (dur > longestSec) longestSec = dur;
                    }
                }

                return {
                    id: s.id,
                    dateLabel: safeFormatDate(s.date, 'dd MMM'),
                    fullDate: safeFormatDate(s.date, 'EEE dd MMM yyyy'),
                    location: s.locationName || 'Spot',
                    percentFoil: Number(parseFloat(st.percentFoil || 0).toFixed(1)),
                    topSpeed: Number((topKts * ktsToUnit).toFixed(1)),
                    foilMinutes: Number(parseFloat(st.totalFoilTime || 0).toFixed(1)),
                    longestFlightSec: longestSec,
                    gybeRate: m.completionRate != null ? m.completionRate : null,
                    rating: Number(s.rating || 0),
                };
            });
    }, [enrichedSessions, ktsToUnit]);

    // Build Quiver Analytics Breakdown
    const quiverStats = useMemo(() => {
        const map = new Map();

        for (const s of enrichedSessions) {
            if (!s.gearUsed || typeof s.gearUsed !== 'string') continue;
            const items = s.gearUsed.split(',').map(g => g.trim()).filter(Boolean);
            const st = s.computedAnalysis?.stats || {};
            const act = s.activityStats || {};

            const foilMin = parseFloat(st.totalFoilTime || 0) || 0;
            const distKm = parseFloat(act.distance || st.totalDistance || 0) || 0;
            const topKts = parseFloat(act.topSpeed || st.topSpeed || 0) || 0;
            const pctFoil = parseFloat(st.percentFoil || 0);
            const windKts = parseFloat(s.windSpeed || 0);
            const rating = Number(s.rating || 0);

            for (const gearName of items) {
                if (!map.has(gearName)) {
                    map.set(gearName, {
                        name: gearName,
                        sessions: 0,
                        foilMinutes: 0,
                        distanceKm: 0,
                        maxSpeedKts: 0,
                        foilPctSum: 0,
                        foilPctCount: 0,
                        windSumKts: 0,
                        windCount: 0,
                        ratingSum: 0,
                        ratingCount: 0,
                    });
                }
                const rec = map.get(gearName);
                rec.sessions += 1;
                rec.foilMinutes += foilMin;
                rec.distanceKm += distKm;
                if (topKts > rec.maxSpeedKts) rec.maxSpeedKts = topKts;
                if (!isNaN(pctFoil) && pctFoil > 0) {
                    rec.foilPctSum += pctFoil;
                    rec.foilPctCount += 1;
                }
                if (!isNaN(windKts) && windKts > 0) {
                    rec.windSumKts += windKts;
                    rec.windCount += 1;
                }
                if (rating > 0) {
                    rec.ratingSum += rating;
                    rec.ratingCount += 1;
                }
            }
        }

        return Array.from(map.values())
            .map(r => ({
                ...r,
                avgFoilPct: r.foilPctCount > 0 ? (r.foilPctSum / r.foilPctCount).toFixed(1) : null,
                avgWindKts: r.windCount > 0 ? (r.windSumKts / r.windCount).toFixed(1) : null,
                avgRating: r.ratingCount > 0 ? (r.ratingSum / r.ratingCount).toFixed(1) : null,
            }))
            .sort((a, b) => b.sessions - a.sessions);
    }, [enrichedSessions]);

    if (loading) {
        return (
            <div className="app-container" style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-secondary)' }}>
                Loading progression & quiver analytics…
            </div>
        );
    }

    return (
        <div className="app-container" style={{ paddingBottom: '6rem' }}>
            <header style={{ marginBottom: '1.5rem' }}>
                <h1 className="text-gradient" style={{ margin: 0, fontSize: '2rem', fontWeight: 800 }}>
                    Progression & Quiver Stats
                </h1>
                <p style={{ margin: '4px 0 0 0', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Personal records, foiling progression trends, and gear performance across {summary.totalSessions} logged sessions
                </p>
            </header>

            {enrichedSessions.length === 0 ? (
                <div className="glass-panel" style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                    No sessions logged yet. Log your first session with GPS telemetry or notes to unlock progression analytics!
                </div>
            ) : (
                <>
                    {/* ── Lifetime Totals Banner ── */}
                    <div className="glass-panel" style={{ padding: '16px 20px', marginBottom: '1.5rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '12px', textAlign: 'center' }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Sessions</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>{summary.totalSessions}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Distance</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--accent-primary)' }}>{summary.totalDistanceKm} <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>km</span></div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Foil Time</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#4ade80' }}>{summary.totalFoilMinutes} <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>min</span></div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Flights</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#a78bfa' }}>{summary.totalFlights}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Foiling Gybes</div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#fbbf24' }}>{summary.totalGybesCompleted}</div>
                        </div>
                    </div>

                    {/* ── Personal Bests Trophy Grid ── */}
                    <div className="glass-panel" style={{ padding: '20px', marginBottom: '1.5rem' }}>
                        <h3 style={{ margin: '0 0 14px 0', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Trophy size={18} color="#facc15" /> Personal Bests
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: '12px' }}>
                            {/* Top Speed PB */}
                            <div
                                onClick={() => summary.bestTopSpeed.entry && navigate(`/session/${summary.bestTopSpeed.entry.id}`)}
                                style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '10px', cursor: summary.bestTopSpeed.entry ? 'pointer' : 'default', border: '1px solid rgba(56, 189, 248, 0.2)' }}
                            >
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Top Speed</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)', margin: '4px 0' }}>
                                    {summary.bestTopSpeed.val > 0 ? `${(summary.bestTopSpeed.val * ktsToUnit).toFixed(1)} ${speedUnit}` : '—'}
                                </div>
                                {summary.bestTopSpeed.entry && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        {safeFormatDate(summary.bestTopSpeed.entry.date, 'dd MMM yyyy')} · {summary.bestTopSpeed.entry.locationName}
                                    </div>
                                )}
                            </div>

                            {/* Longest Flight PB */}
                            <div
                                onClick={() => summary.bestLongestFlight.entry && navigate(`/session/${summary.bestLongestFlight.entry.id}`)}
                                style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '10px', cursor: summary.bestLongestFlight.entry ? 'pointer' : 'default', border: '1px solid rgba(167, 139, 250, 0.2)' }}
                            >
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Longest Single Flight</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#a78bfa', margin: '4px 0' }}>
                                    {summary.bestLongestFlight.val > 0 ? formatDurationSec(summary.bestLongestFlight.val) : '—'}
                                </div>
                                {summary.bestLongestFlight.entry && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        {safeFormatDate(summary.bestLongestFlight.entry.date, 'dd MMM yyyy')} · {summary.bestLongestFlight.entry.locationName}
                                    </div>
                                )}
                            </div>

                            {/* Best % Foil PB */}
                            <div
                                onClick={() => summary.bestFoilPct.entry && navigate(`/session/${summary.bestFoilPct.entry.id}`)}
                                style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '10px', cursor: summary.bestFoilPct.entry ? 'pointer' : 'default', border: '1px solid rgba(74, 222, 128, 0.2)' }}
                            >
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Highest % Time on Foil</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#4ade80', margin: '4px 0' }}>
                                    {summary.bestFoilPct.val > 0 ? `${summary.bestFoilPct.val}%` : '—'}
                                </div>
                                {summary.bestFoilPct.entry && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        {safeFormatDate(summary.bestFoilPct.entry.date, 'dd MMM yyyy')} · {summary.bestFoilPct.entry.locationName}
                                    </div>
                                )}
                            </div>

                            {/* Best Gybe Completion PB */}
                            <div
                                onClick={() => summary.bestGybeRate.entry && navigate(`/session/${summary.bestGybeRate.entry.id}`)}
                                style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '10px', cursor: summary.bestGybeRate.entry ? 'pointer' : 'default', border: '1px solid rgba(251, 191, 36, 0.2)' }}
                            >
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Best Gybe Completion</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fbbf24', margin: '4px 0' }}>
                                    {summary.bestGybeRate.val > 0 ? `${summary.bestGybeRate.val}%` : '—'}
                                </div>
                                {summary.bestGybeRate.entry && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        {safeFormatDate(summary.bestGybeRate.entry.date, 'dd MMM yyyy')} ({summary.bestGybeRate.attempts} turns)
                                    </div>
                                )}
                            </div>

                            {/* Max Distance PB */}
                            <div
                                onClick={() => summary.bestDistance.entry && navigate(`/session/${summary.bestDistance.entry.id}`)}
                                style={{ background: 'rgba(0,0,0,0.3)', padding: '14px', borderRadius: '10px', cursor: summary.bestDistance.entry ? 'pointer' : 'default', border: '1px solid rgba(255, 255, 255, 0.1)' }}
                            >
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Max Session Distance</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'white', margin: '4px 0' }}>
                                    {summary.bestDistance.val > 0 ? `${summary.bestDistance.val.toFixed(2)} km` : '—'}
                                </div>
                                {summary.bestDistance.entry && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        {safeFormatDate(summary.bestDistance.entry.date, 'dd MMM yyyy')} · {summary.bestDistance.entry.locationName}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── Progression Over Time Chart ── */}
                    {progressionData.length >= 2 && (
                        <div className="glass-panel" style={{ padding: '20px', marginBottom: '1.5rem', height: '360px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <TrendingUp size={18} color="var(--accent-primary)" /> Foiling Progression Over Time
                                </h3>
                                <div style={{ display: 'flex', gap: '14px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ width: '10px', height: '10px', background: 'rgba(74, 222, 128, 0.5)', borderRadius: '2px', display: 'inline-block' }} /> % Time on Foil
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ width: '12px', height: '2px', background: '#38bdf8', display: 'inline-block' }} /> Top Speed ({speedUnit})
                                    </span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <span style={{ width: '12px', height: '2px', borderTop: '2px dashed #fbbf24', display: 'inline-block' }} /> Gybe %
                                    </span>
                                </div>
                            </div>

                            <ResponsiveContainer width="100%" height="86%">
                                <ComposedChart data={progressionData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />
                                    <XAxis dataKey="dateLabel" stroke="var(--text-secondary)" fontSize={12} />
                                    <YAxis yAxisId="pct" domain={[0, 100]} stroke="#4ade80" fontSize={12} tickFormatter={v => `${v}%`} />
                                    <YAxis yAxisId="spd" orientation="right" stroke="#38bdf8" fontSize={12} tickFormatter={v => `${v}`} />
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length) {
                                                const d = payload[0].payload;
                                                return (
                                                    <div style={{ background: '#1e293b', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px', fontSize: '0.8rem' }}>
                                                        <div style={{ fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '4px' }}>{d.fullDate}</div>
                                                        <div style={{ color: '#4ade80' }}>% on Foil: <b>{d.percentFoil}%</b> ({d.foilMinutes}m)</div>
                                                        <div style={{ color: '#38bdf8' }}>Top Speed: <b>{d.topSpeed} {speedUnit}</b></div>
                                                        {d.longestFlightSec > 0 && (
                                                            <div style={{ color: '#a78bfa' }}>Longest Flight: <b>{formatDurationSec(d.longestFlightSec)}</b></div>
                                                        )}
                                                        {d.gybeRate != null && (
                                                            <div style={{ color: '#fbbf24' }}>Gybe Completion: <b>{d.gybeRate}%</b></div>
                                                        )}
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Bar yAxisId="pct" dataKey="percentFoil" fill="#4ade80" fillOpacity={0.35} radius={[4, 4, 0, 0]} name="% Foil" />
                                    <Line yAxisId="pct" type="monotone" dataKey="gybeRate" stroke="#fbbf24" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} connectNulls name="Gybe %" />
                                    <Line yAxisId="spd" type="monotone" dataKey="topSpeed" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3 }} name={`Top Speed (${speedUnit})`} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    )}

                    {/* ── Quiver Usage & Performance Breakdown ── */}
                    <div className="glass-panel" style={{ padding: '20px' }}>
                        <h3 style={{ margin: '0 0 12px 0', fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Layers size={18} color="#a78bfa" /> Quiver Usage & Gear Performance
                        </h3>

                        {quiverStats.length === 0 ? (
                            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', margin: 0 }}>
                                Tag gear from your quiver when logging sessions to track wing, foil, and board performance here.
                            </p>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem', textAlign: 'left' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                                            <th style={{ padding: '8px 10px' }}>Gear</th>
                                            <th style={{ padding: '8px 10px' }}>Sessions</th>
                                            <th style={{ padding: '8px 10px' }}>Foil Time</th>
                                            <th style={{ padding: '8px 10px' }}>Distance</th>
                                            <th style={{ padding: '8px 10px' }}>Avg % Foil</th>
                                            <th style={{ padding: '8px 10px' }}>Top Speed</th>
                                            <th style={{ padding: '8px 10px' }}>Avg Wind</th>
                                            <th style={{ padding: '8px 10px' }}>Avg Rating</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {quiverStats.map((g, idx) => (
                                            <tr key={g.name} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                                                <td style={{ padding: '10px', fontWeight: 600, color: 'var(--accent-primary)' }}>{g.name}</td>
                                                <td style={{ padding: '10px', fontWeight: 600 }}>{g.sessions}</td>
                                                <td style={{ padding: '10px', color: '#4ade80' }}>{Math.round(g.foilMinutes)} m</td>
                                                <td style={{ padding: '10px' }}>{g.distanceKm.toFixed(1)} km</td>
                                                <td style={{ padding: '10px', color: '#38bdf8' }}>{g.avgFoilPct ? `${g.avgFoilPct}%` : '—'}</td>
                                                <td style={{ padding: '10px', fontWeight: 600 }}>
                                                    {g.maxSpeedKts > 0 ? `${(g.maxSpeedKts * ktsToUnit).toFixed(1)} ${speedUnit}` : '—'}
                                                </td>
                                                <td style={{ padding: '10px', color: 'var(--text-secondary)' }}>
                                                    {g.avgWindKts ? `${(parseFloat(g.avgWindKts) * ktsToUnit).toFixed(1)} ${speedUnit}` : '—'}
                                                </td>
                                                <td style={{ padding: '10px', color: '#facc15', fontWeight: 600 }}>
                                                    {g.avgRating ? `${g.avgRating} ★` : '—'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default StatsPage;
