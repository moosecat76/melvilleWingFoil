import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getJournalEntries } from '../services/journalService';
import { analyzeSession } from '../services/foilAnalysisService';
import { ArrowLeft, MapPin, Wind, Clock, Calendar } from 'lucide-react';
import { format } from 'date-fns';

const SessionMap = lazy(() => import('../components/SessionMap'));
const FoilAnalysisChart = lazy(() => import('../components/FoilAnalysisChart'));

const SessionDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const [entry, setEntry] = useState(null);
    const [analysis, setAnalysis] = useState(null);

    useEffect(() => {
        const entries = getJournalEntries();
        const found = entries.find(e => e.id === id);
        if (found) {
            setEntry(found);
            // Compute analysis
            let a = found.foilAnalysis;
            if (!a && found.streams) {
                a = analyzeSession(found.streams);
            }
            setAnalysis(a);
        }
    }, [id]);

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
                                <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{entry.windSpeed} <span style={{ fontSize: '0.8rem' }}>kts</span></div>
                            </div>
                        )}
                        {entry.windGusts && (
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Gusts</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 'bold' }}>{entry.windGusts} <span style={{ fontSize: '0.8rem' }}>kts</span></div>
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
            <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                {entry.notes && (
                    <div style={{ marginBottom: '12px' }}>
                        <h3 style={{ margin: '0 0 6px 0', fontSize: '1rem', fontWeight: 600 }}>Notes</h3>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{entry.notes}</p>
                    </div>
                )}
                {entry.gearUsed && (
                    <div>
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
            </div>

            {/* Foil Analysis Stats */}
            {analysis && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 600 }}>Foil Analysis</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '8px' }}>
                        <div style={{ background: 'rgba(0,0,0,0.3)', padding: '12px', borderRadius: '8px', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Foil Time</div>
                            <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#5cb85c' }}>{analysis.stats.totalFoilTime}m</div>
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

            {/* Session Map */}
            {entry.mapPolyline && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 600 }}>Session Track</h3>
                    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading map...</div>}>
                        <SessionMap summary_polyline={entry.mapPolyline} streams={entry.streams} />
                    </Suspense>
                </div>
            )}

            {/* Flight Analysis Chart */}
            {analysis && (
                <div className="glass-panel" style={{ padding: '16px', marginBottom: '1.5rem' }}>
                    <Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading chart...</div>}>
                        <FoilAnalysisChart analysisData={analysis} />
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
                                {stats.topSpeed ? parseFloat(stats.topSpeed).toFixed(1) : '–'} <span style={{ fontSize: '0.8rem' }}>kts</span>
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
