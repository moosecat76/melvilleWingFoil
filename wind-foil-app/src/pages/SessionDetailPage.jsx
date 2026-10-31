import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { subscribeToJournalEntries, updateJournalEntry } from '../services/journalService';
import { analyzeSession, formatDurationSec } from '../services/foilAnalysisService';
import { generateSessionCoachDebrief, extractSessionCoachTags } from '../services/aiCoachService';
import { ArrowLeft, MapPin, Wind, Clock, Compass, Activity, Zap, Award, Sparkles, RefreshCw, CheckCircle2, Sliders, Target } from 'lucide-react';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';
import { usePreferences } from '../context/PreferencesContext';
import { useToast } from '../context/ToastContext';

const SessionMap = lazy(() => import('../components/SessionMap'));
const FoilAnalysisChart = lazy(() => import('../components/FoilAnalysisChart'));
const HeartRateChart = lazy(() => import('../components/HeartRateChart'));

const SessionDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const { unit } = usePreferences();
    const { showToast } = useToast();
    const speedUnit = unit === 'kmh' ? 'km/h' : 'kts';
    const ktsToUnit = unit === 'kmh' ? 1.852 : 1;

    const [entry, setEntry] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [hoveredIndex, setHoveredIndex] = useState(null);
    const [selectedSegment, setSelectedSegment] = useState(null);
    const [coachLoading, setCoachLoading] = useState(false);

    useEffect(() => {
        if (authLoading) return;
        let isMounted = true;
        const unsubscribe = subscribeToJournalEntries(user?.uid, (entries) => {
            if (!isMounted) return;
            const found = (entries || []).find(e => String(e.id) === String(id));
            if (found) {
                setEntry(found);
                let a = found.foilAnalysis;
                if (found.streams && (!a || !a.adaptiveProfile || !a.maneuvers || !a.efficiency)) {
                    a = analyzeSession(found.streams, { windDirection: found.windDirection });
                }
                setAnalysis(a);
            }
        });
        return () => {
            isMounted = false;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [id, user?.uid, authLoading]);

    const handleGenerateCoachDebrief = async () => {
        if (!entry || coachLoading) return;
        setCoachLoading(true);
        try {
            const [debrief, tags] = await Promise.all([
                generateSessionCoachDebrief(entry, analysis),
                entry.coachTags ? Promise.resolve(entry.coachTags) : extractSessionCoachTags(entry, analysis)
            ]);

            const updatedEntry = {
                ...entry,
                coachDebrief: debrief,
                coachTags: tags
            };
            setEntry(updatedEntry);
            await updateJournalEntry(updatedEntry, user?.uid);
            showToast(
                debrief.source === 'gemini'
                    ? `AI Coach Debrief generated via ${debrief.model}!`
                    : 'Coach Debrief generated & saved!',
                'success'
            );
        } catch (err) {
            console.error('[SessionDetailPage] Coach debrief error:', err);
            showToast('Failed to generate coach debrief: ' + err.message, 'error');
        } finally {
            setCoachLoading(false);
        }
    };

    if (!entry) {
        return (
            <div className="app-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: '1rem' }}>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>Session not found</p>
                <button onClick={() => navigate('/sessions')} className="btn-primary" style={{ padding: '8px 20px' }}>
                    <ArrowLeft size={16} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
                    Back to Sessions
                </button>
            </div>
        );
    }

    const stats = entry.activityStats || {};
    const maneuvers = analysis?.maneuvers || null;
    const efficiency = analysis?.efficiency || null;
    const foilSegments = analysis?.foilSegments || [];
    const coachDebrief = entry.coachDebrief || null;
    const coachTags = entry.coachTags || null;

    const fmtSpeedFromKts = (ktsVal) => {
        if (ktsVal == null || ktsVal === '–') return '–';
        const num = parseFloat(ktsVal);
        if (isNaN(num)) return '–';
        return (num * ktsToUnit).toFixed(1);
    };

    return (
        <div className="app-container" style={{ paddingBottom: '6rem' }}>
            {/* Back Header */}
            <header style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                    onClick={() => navigate('/sessions')}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 0', fontSize: '0.9rem' }}
                >
                    <ArrowLeft size={20} /> Back
                </button>
            </header>

            {/* Session Header */}
            <div className="glass-panel" style={{ padding: '20px', marginBottom: '1.5rem' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <MapPin size={10} /> {entry.locationName || 'Unknown Location'}
                </div>
                <h2 style={{ margin: '0 0 8px 0', fontSize: '1.5rem', fontWeight: 700 }}>
                    {format(new Date(entry.date), 'EEEE dd MMMM yyyy')}
                </h2>
                <div style={{ display: 'flex', gap: '16px', color: 'var(--text-secondary)', fontSize: '0.9rem', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={14} /> {format(new Date(entry.date), 'h:mm a')}
                    </span>
                    <span style={{ color: '#facc15', fontWeight: 'bold' }}>
                        {'★'.repeat(entry.rating)}{'☆'.repeat(5 - entry.rating)}
                    </span>
                </div>
            </div>

            {/* Wind Conditions */}
            {(entry.windSpeed || entry.windDirection) && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Wind size={18} /> Wind Conditions
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                        {entry.windSpeed && (
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Speed</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{fmtSpeedFromKts(entry.windSpeed)} <span style={{ fontSize: '0.8rem' }}>{speedUnit}</span></div>
                            </div>
                        )}
                        {entry.windGusts && (
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Gusts</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{fmtSpeedFromKts(entry.windGusts)} <span style={{ fontSize: '0.8rem' }}>{speedUnit}</span></div>
                            </div>
                        )}
                        {entry.windDirection && (
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Direction</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{entry.windDirection}°</div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Notes & Gear */}
            {(entry.notes || entry.gearUsed || coachTags) && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    {entry.notes && (
                        <div style={{ marginBottom: (entry.gearUsed || coachTags) ? '12px' : 0 }}>
                            <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 600 }}>Notes</h3>
                            <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{entry.notes}</p>
                        </div>
                    )}
                    {entry.gearUsed && (
                        <div style={{ marginBottom: coachTags ? '12px' : 0 }}>
                            <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 600 }}>Gear Used</h3>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                                {entry.gearUsed.split(', ').map((g, i) => (
                                    <span key={i} style={{ background: 'var(--accent-primary)', color: '#0f172a', padding: '4px 10px', borderRadius: '16px', fontSize: '0.8rem', fontWeight: 600 }}>
                                        {g}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                    {coachTags && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                            <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '3px 9px', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.14)', color: '#38bdf8' }}>
                                Power: {coachTags.powerState?.replace('_', ' ')}
                            </span>
                            {coachTags.wingSizeSentiment && (
                                <span style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: '12px', background: 'rgba(74, 222, 128, 0.14)', color: '#4ade80' }}>
                                    Wing: {coachTags.wingSizeSentiment.replace('_', ' ')}
                                </span>
                            )}
                            {coachTags.foilSentiment && (
                                <span style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: '12px', background: 'rgba(167, 139, 250, 0.14)', color: '#a78bfa' }}>
                                    Foil: {coachTags.foilSentiment.replace('_', ' ')}
                                </span>
                            )}
                            {coachTags.fatigue && (
                                <span style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: '12px', background: 'rgba(251, 191, 36, 0.14)', color: '#fbbf24' }}>
                                    Fatigue: {coachTags.fatigue}
                                </span>
                            )}
                            {coachTags.breakthrough && (
                                <span style={{ fontSize: '0.72rem', padding: '3px 9px', borderRadius: '12px', background: 'rgba(250, 204, 21, 0.18)', color: '#facc15', fontWeight: 600 }}>
                                    🏆 {coachTags.breakthrough}
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* ── Phase 5.2: Interactive AI Foil Coach Debrief Card ── */}
            <div className="glass-panel" style={{ padding: '18px', marginBottom: '1.5rem', border: '1px solid rgba(56, 189, 248, 0.35)', background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.85), rgba(30, 41, 59, 0.75))' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: coachDebrief ? '14px' : '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Sparkles size={19} color="#38bdf8" />
                        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                            AI Foil Coach Debrief
                        </h3>
                        {coachDebrief?.model && (
                            <span style={{ fontSize: '0.68rem', color: '#38bdf8', background: 'rgba(56, 189, 248, 0.12)', border: '1px solid rgba(56, 189, 248, 0.25)', padding: '2px 8px', borderRadius: '999px' }}>
                                {coachDebrief.model}
                            </span>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={handleGenerateCoachDebrief}
                        disabled={coachLoading}
                        className="btn-primary"
                        style={{
                            padding: '6px 14px',
                            fontSize: '0.8rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: coachLoading ? 'wait' : 'pointer',
                            opacity: coachLoading ? 0.7 : 1
                        }}
                    >
                        <RefreshCw size={14} className={coachLoading ? 'spin' : ''} />
                        {coachLoading
                            ? 'Analyzing Session…'
                            : coachDebrief
                                ? 'Regenerate Coach Analysis'
                                : 'Generate Coach Debrief'}
                    </button>
                </div>

                {!coachDebrief ? (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                        Synthesize your flight telemetry, gybe completion rate, heart-rate efficiency, and session notes into a personalized 3-point coaching debrief.
                    </p>
                ) : (
                    <div>
                        {coachDebrief.headline && (
                            <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px' }}>
                                {coachDebrief.headline}
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: '12px' }}>
                            <div style={{ background: 'rgba(0,0,0,0.28)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #4ade80' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#4ade80', textTransform: 'uppercase', marginBottom: '6px' }}>
                                    <CheckCircle2 size={14} /> What Went Well
                                </div>
                                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                                    {coachDebrief.whatWentWell}
                                </p>
                            </div>

                            <div style={{ background: 'rgba(0,0,0,0.28)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #38bdf8' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', marginBottom: '6px' }}>
                                    <Sliders size={14} /> Tuning Recommendation
                                </div>
                                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                                    {coachDebrief.tuningRecommendation}
                                </p>
                            </div>

                            <div style={{ background: 'rgba(0,0,0,0.28)', padding: '12px', borderRadius: '8px', borderLeft: '3px solid #a78bfa' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', marginBottom: '6px' }}>
                                    <Target size={14} /> Technique Focus Next Session
                                </div>
                                <p style={{ margin: 0, fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                                    {coachDebrief.techniqueFocus}
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Foil Analysis Stats */}
            {analysis && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Award size={18} color="var(--accent-primary)" /> Foil Summary
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: '8px' }}>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Top Speed</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
                                {fmtSpeedFromKts(stats.topSpeed || analysis.stats.topSpeed)} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>{speedUnit}</span>
                            </div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Time on Foil</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#4ade80' }}>{analysis.stats.totalFoilTime}m</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Longest Flight</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#a78bfa' }}>
                                {analysis.stats.longestFlightFormatted || formatDurationSec(analysis.stats.longestFlightSec || 0)}
                            </div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Distance</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'white' }}>
                                {(stats.distance || analysis.stats.totalDistance) ? parseFloat(stats.distance || analysis.stats.totalDistance).toFixed(2) : '–'} <span style={{ fontSize: '0.75rem', fontWeight: 400 }}>km</span>
                            </div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Flights</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'white' }}>{analysis.stats.numberOfFlights}</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>% Foil</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#38bdf8' }}>{analysis.stats.percentFoil}%</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Runs</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#facc15' }}>{analysis.stats.totalRuns}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Phase 3.2: Maneuver, Tack Symmetry & Efficiency Insights ── */}
            {analysis && (maneuvers || efficiency) && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Compass size={18} color="#4ade80" /> Maneuvers & Efficiency Telemetry
                    </h3>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
                        {/* Gybe Completion */}
                        {maneuvers && maneuvers.totalAttempts > 0 && (
                            <div style={{ background: 'rgba(0,0,0,0.28)', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Foiling Gybes / Turns</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#4ade80' }}>
                                    {maneuvers.completedTurns}/{maneuvers.totalAttempts}{' '}
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                        ({maneuvers.completionRate}%)
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    {maneuvers.completedTurns} dry · {maneuvers.wetTurns} touchdown
                                </div>
                            </div>
                        )}

                        {/* Takeoff Conversion */}
                        {efficiency && efficiency.takeoffAttempts > 0 && (
                            <div style={{ background: 'rgba(0,0,0,0.28)', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Takeoff Conversion</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#38bdf8' }}>
                                    {efficiency.takeoffConversionRate}%
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    {efficiency.successfulFlights} flights from {efficiency.takeoffAttempts} surges
                                </div>
                            </div>
                        )}

                        {/* Upwind VMG & Angle */}
                        {maneuvers?.avgUpwindAngle != null && (
                            <div style={{ background: 'rgba(0,0,0,0.28)', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Upwind Angle & VMG</div>
                                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#fbbf24' }}>
                                    {maneuvers.avgUpwindAngle}°{' '}
                                    {maneuvers.upwindVmgKts != null && (
                                        <span style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 500 }}>
                                            · {fmtSpeedFromKts(maneuvers.upwindVmgKts)} {speedUnit} VMG
                                        </span>
                                    )}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    {maneuvers.avgDownwindAngle != null ? `Downwind angle: ${maneuvers.avgDownwindAngle}°` : 'Relative to wind'}
                                </div>
                            </div>
                        )}

                        {/* HR Foiling vs Pumping */}
                        {(efficiency?.avgFoilHeartRate || efficiency?.avgPumpHeartRate) && (
                            <div style={{ background: 'rgba(0,0,0,0.28)', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Heart Rate Split</div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f87171' }}>
                                    {efficiency.avgFoilHeartRate ? `${efficiency.avgFoilHeartRate} bpm foil` : '–'}
                                </div>
                                {efficiency.avgPumpHeartRate && (
                                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                        vs {efficiency.avgPumpHeartRate} bpm pumping/slogging
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Session Fatigue Split */}
                        {efficiency?.firstHalfFoilPct != null && efficiency?.secondHalfFoilPct != null && (
                            <div style={{ background: 'rgba(0,0,0,0.28)', padding: '12px', borderRadius: '8px' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Endurance Split</div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                    {efficiency.firstHalfFoilPct}% → {efficiency.secondHalfFoilPct}%
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                    1st half vs 2nd half % on foil
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Port vs Starboard Tack Symmetry Bar */}
                    {maneuvers?.portSymmetryPct != null && (
                        <div style={{ marginTop: '14px', background: 'rgba(0,0,0,0.22)', padding: '10px 12px', borderRadius: '8px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '6px' }}>
                                <span style={{ color: '#38bdf8', fontWeight: 600 }}>
                                    Port Tack: {maneuvers.portSymmetryPct}% ({formatDurationSec(maneuvers.portFoilSec)})
                                </span>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>Tack Balance</span>
                                <span style={{ color: '#a78bfa', fontWeight: 600 }}>
                                    Starboard Tack: {100 - maneuvers.portSymmetryPct}% ({formatDurationSec(maneuvers.starboardFoilSec)})
                                </span>
                            </div>
                            <div style={{ width: '100%', height: '8px', background: '#a78bfa', borderRadius: '4px', overflow: 'hidden' }}>
                                <div style={{ width: `${maneuvers.portSymmetryPct}%`, height: '100%', background: '#38bdf8', transition: 'width 0.3s' }} />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Session Map */}
            {entry.mapPolyline && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Session Track</h3>
                        {selectedSegment && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '0.8rem', color: '#38bdf8', fontWeight: 600 }}>
                                    Showing Flight #{selectedSegment.flightNumber} ({formatDurationSec(selectedSegment.durationSec)} · {fmtSpeedFromKts(selectedSegment.topSpeedKts)} {speedUnit} max)
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setSelectedSegment(null)}
                                    style={{
                                        background: 'rgba(56, 189, 248, 0.15)',
                                        border: '1px solid #38bdf8',
                                        color: '#38bdf8',
                                        borderRadius: '12px',
                                        padding: '2px 10px',
                                        fontSize: '0.75rem',
                                        cursor: 'pointer'
                                    }}
                                >
                                    Reset Zoom ✕
                                </button>
                            </div>
                        )}
                    </div>
                    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading map...</div>}>
                        <SessionMap
                            summary_polyline={entry.mapPolyline}
                            streams={entry.streams}
                            highlightIndex={hoveredIndex}
                            selectedSegment={selectedSegment}
                            maneuvers={maneuvers}
                        />
                    </Suspense>
                </div>
            )}

            {/* Flight Analysis Chart */}
            {analysis && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading chart...</div>}>
                        <FoilAnalysisChart
                            analysisData={analysis}
                            onHover={setHoveredIndex}
                            selectedSegment={selectedSegment}
                            onSelectSegment={setSelectedSegment}
                        />
                    </Suspense>
                </div>
            )}

            {/* ── Phase 3.1: Interactive Per-Flight Breakdown Table (Feature #15) ── */}
            {foilSegments.length > 0 && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <Zap size={18} color="#38bdf8" /> Individual Flights ({foilSegments.length})
                        </h3>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Click any flight to highlight & zoom on map
                        </span>
                    </div>

                    <div style={{ maxHeight: '300px', overflowY: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ background: 'rgba(15, 23, 42, 0.85)', color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', position: 'sticky', top: 0 }}>
                                    <th style={{ padding: '8px 12px' }}>#</th>
                                    <th style={{ padding: '8px 12px' }}>At</th>
                                    <th style={{ padding: '8px 12px' }}>Duration</th>
                                    <th style={{ padding: '8px 12px' }}>Distance</th>
                                    <th style={{ padding: '8px 12px' }}>Avg ({speedUnit})</th>
                                    <th style={{ padding: '8px 12px' }}>Top ({speedUnit})</th>
                                    {foilSegments.some(s => s.avgHeartRate) && (
                                        <th style={{ padding: '8px 12px' }}>HR</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {foilSegments.map((seg, idx) => {
                                    const isSelected = selectedSegment && selectedSegment.start === seg.start && selectedSegment.end === seg.end;
                                    const flightNum = seg.flightNumber || idx + 1;
                                    const startSec = seg.startTimeSec ?? (analysis?.data?.time?.[seg.start] || 0);
                                    const durSec = seg.durationSec ?? Math.round((analysis?.data?.time?.[seg.end] || 0) - startSec);
                                    return (
                                        <tr
                                            key={flightNum}
                                            onClick={() => setSelectedSegment(isSelected ? null : { ...seg, flightNumber: flightNum, durationSec: durSec })}
                                            style={{
                                                cursor: 'pointer',
                                                background: isSelected ? 'rgba(56, 189, 248, 0.2)' : (idx % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'),
                                                borderBottom: '1px solid rgba(255,255,255,0.05)',
                                                transition: 'background 0.15s'
                                            }}
                                        >
                                            <td style={{ padding: '8px 12px', fontWeight: 700, color: isSelected ? '#38bdf8' : 'var(--text-primary)' }}>
                                                #{flightNum}
                                            </td>
                                            <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>
                                                {Math.floor(startSec / 60)}:{String(Math.round(startSec % 60)).padStart(2, '0')}
                                            </td>
                                            <td style={{ padding: '8px 12px', fontWeight: 600, color: '#4ade80' }}>
                                                {formatDurationSec(durSec)}
                                            </td>
                                            <td style={{ padding: '8px 12px' }}>
                                                {seg.distanceM != null ? `${seg.distanceM} m` : '–'}
                                            </td>
                                            <td style={{ padding: '8px 12px' }}>
                                                {seg.avgSpeedKts != null ? fmtSpeedFromKts(seg.avgSpeedKts) : '–'}
                                            </td>
                                            <td style={{ padding: '8px 12px', fontWeight: 600, color: 'var(--accent-primary)' }}>
                                                {seg.topSpeedKts != null ? fmtSpeedFromKts(seg.topSpeedKts) : '–'}
                                            </td>
                                            {foilSegments.some(s => s.avgHeartRate) && (
                                                <td style={{ padding: '8px 12px', color: '#f87171' }}>
                                                    {seg.avgHeartRate ? `${seg.avgHeartRate} bpm` : '–'}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* Heart Rate Chart */}
            {entry.streams && (
                <div style={{ marginBottom: '1.5rem' }}>
                    <Suspense fallback={null}>
                        <HeartRateChart streams={entry.streams} onHover={setHoveredIndex} />
                    </Suspense>
                </div>
            )}

            {/* Legacy Stats Fallback */}
            {!analysis && (stats.topSpeed || stats.distance) && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 600 }}>Activity Stats</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Top Speed</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent-primary)' }}>
                                {stats.topSpeed ? fmtSpeedFromKts(stats.topSpeed) : '–'} <span style={{ fontSize: '0.8rem' }}>{speedUnit}</span>
                            </div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Distance</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: 'white' }}>
                                {stats.distance ? parseFloat(stats.distance).toFixed(2) : '–'} <span style={{ fontSize: '0.8rem' }}>km</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SessionDetailPage;
