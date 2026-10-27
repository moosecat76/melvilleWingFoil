import React, { useMemo, useState } from 'react';
import { suggestBestSessions, isDirectionInSector, analyzeSpotWindProfile, findSimilarPastSessions } from '../services/recommendationService';
import { generatePreSessionGamePlan } from '../services/aiCoachService';
import { BadgeCheck, Clock, Wind, Compass, Sparkles, Sliders, Target } from 'lucide-react';
import { format } from 'date-fns';

const BestTime = ({ forecastHourly, userGear, idealWindDirection, daily, unit = 'knots', sessions = [], locationId = null, locationName = 'Spot', currentTide = null }) => {
    const [gamePlan, setGamePlan] = useState(null);
    const [gamePlanLoading, setGamePlanLoading] = useState(false);

    const blocks = useMemo(() => {
        if (!forecastHourly) return [];
        return suggestBestSessions(forecastHourly, userGear, idealWindDirection, daily, sessions);
    }, [forecastHourly, userGear, idealWindDirection, daily, sessions]);

    const spotProfile = useMemo(() => {
        return analyzeSpotWindProfile(sessions, locationId);
    }, [sessions, locationId]);

    if (!blocks || blocks.length === 0) {
        return (
            <div className="card">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BadgeCheck size={20} />
                    Best Time to Go
                </h3>
                <p style={{ color: 'var(--text-secondary)' }}>No great sessions projected in next 48h.</p>
                {spotProfile && (
                    <div style={{ marginTop: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Compass size={14} color="var(--accent-primary)" />
                        <span>
                            Your best corridor here: <strong>{spotProfile.corridorLabel}</strong> ({spotProfile.avgRating}★ avg across {spotProfile.sessionCount} sessions)
                        </span>
                    </div>
                )}
            </div>
        );
    }

    const topBlocks = blocks.slice(0, 3);
    const speedMult = unit === 'knots' ? 0.539957 : 1;
    const unitLabel = unit === 'knots' ? 'kts' : 'km/h';

    const handleGetGamePlan = async () => {
        const primary = topBlocks[0];
        if (!primary || gamePlanLoading) return;
        setGamePlanLoading(true);
        try {
            const pastMatches = findSimilarPastSessions(
                { speedKmh: primary.avgSpeed, gustsKmh: primary.maxGusts, direction: primary.avgDirection },
                sessions,
                locationId,
                2
            ).map(m => ({
                date: m.entry.date,
                rating: m.entry.rating,
                windKts: m.windKts,
                gearUsed: m.entry.gearUsed,
                percentFoil: m.entry.foilAnalysis?.stats?.percentFoil || null,
                notes: (m.entry.notes || '').slice(0, 180)
            }));

            const plan = await generatePreSessionGamePlan({
                spotName: locationName,
                windowStart: primary.start,
                durationHours: primary.durationHours,
                windKts: Number((primary.avgSpeed * 0.539957).toFixed(1)),
                gustKts: Number((primary.maxGusts * 0.539957).toFixed(1)),
                windDirDeg: Math.round(primary.avgDirection),
                tideM: primary.hourlyData?.[0]?.tide ?? currentTide ?? null,
                recommendedGear: primary.gear?.text || 'Standard Setup',
                pastMatches
            });
            setGamePlan(plan);
        } catch (err) {
            console.error('[BestTime] Game plan error:', err);
        } finally {
            setGamePlanLoading(false);
        }
    };

    return (
        <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '10px' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <BadgeCheck size={20} />
                    Best Time to Go
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {spotProfile && (
                        <span style={{ fontSize: '0.73rem', color: 'var(--accent-primary)', background: 'rgba(56, 189, 248, 0.12)', padding: '3px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Compass size={12} /> Best Corridor: {spotProfile.corridorLabel} ({spotProfile.avgRating}★)
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={handleGetGamePlan}
                        disabled={gamePlanLoading}
                        style={{
                            fontSize: '0.74rem',
                            fontWeight: 600,
                            padding: '4px 10px',
                            borderRadius: '12px',
                            border: '1px solid rgba(56, 189, 248, 0.45)',
                            background: 'rgba(56, 189, 248, 0.16)',
                            color: '#38bdf8',
                            cursor: gamePlanLoading ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}
                    >
                        <Sparkles size={12} />
                        {gamePlanLoading ? 'Briefing…' : gamePlan ? 'Refresh Game Plan' : "Get Coach's Game Plan"}
                    </button>
                </div>
            </div>

            {/* Phase 5.3: Pre-Session Coach's Game Plan */}
            {gamePlan && (
                <div style={{
                    marginBottom: '12px',
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(167, 139, 250, 0.08))',
                    border: '1px solid rgba(56, 189, 248, 0.3)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Sparkles size={13} /> Coach's Game Plan
                        </span>
                        {gamePlan.model && (
                            <span style={{ fontSize: '0.66rem', color: 'var(--text-secondary)' }}>
                                {gamePlan.model}
                            </span>
                        )}
                    </div>
                    <p style={{ margin: '0 0 8px 0', fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                        {gamePlan.briefing}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px', fontSize: '0.78rem' }}>
                        {gamePlan.gearTip && (
                            <div style={{ background: 'rgba(0,0,0,0.22)', padding: '6px 8px', borderRadius: '6px', color: 'var(--text-secondary)' }}>
                                <strong style={{ color: '#38bdf8' }}><Sliders size={11} style={{ verticalAlign: 'middle' }} /> Rigging:</strong> {gamePlan.gearTip}
                            </div>
                        )}
                        {gamePlan.keyFocus && (
                            <div style={{ background: 'rgba(0,0,0,0.22)', padding: '6px 8px', borderRadius: '6px', color: 'var(--text-secondary)' }}>
                                <strong style={{ color: '#4ade80' }}><Target size={11} style={{ verticalAlign: 'middle' }} /> Water Focus:</strong> {gamePlan.keyFocus}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {topBlocks.map((block, idx) => {
                    if (!block || !block.rating) return null;

                    const isIdeal = idealWindDirection &&
                        isDirectionInSector(block.avgDirection, idealWindDirection.min, idealWindDirection.max);

                    return (
                        <div key={idx} style={{
                            background: 'rgba(255,255,255,0.05)',
                            borderRadius: '8px',
                            padding: '12px',
                            borderLeft: `4px solid ${block.rating.color || 'gray'}`
                        }}>
                            {/* Time Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                <span style={{ fontWeight: 'bold', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Clock size={16} />
                                    {format(new Date(block.start), 'EEE h:mm a')} - {format(new Date(block.end), 'h:mm a')}
                                    <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                                        ({block.durationHours}h)
                                    </span>
                                </span>
                                <span style={{ color: block.rating.color, fontWeight: 'bold', fontSize: '0.9rem' }}>
                                    {block.rating.label}
                                </span>
                            </div>

                            {/* Wind Stats & Direction */}
                            <div style={{ display: 'flex', gap: '16px', color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '8px', alignItems: 'center' }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <Wind size={16} />
                                    <span style={{ color: 'white' }}>{(block.avgSpeed * speedMult).toFixed(1)}</span> {unitLabel}
                                    <span style={{ fontSize: '0.8rem' }}>(Gust {(block.maxGusts * speedMult).toFixed(1)})</span>
                                </span>

                                {/* Direction Arrow */}
                                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span
                                        style={{
                                            display: 'inline-block',
                                            transform: `rotate(${block.avgDirection}deg)`,
                                            fontSize: '1.2rem',
                                            lineHeight: 1
                                        }}
                                        title={`${block.avgDirection.toFixed(0)}°`}
                                    >
                                        ↓
                                    </span>
                                    {isIdeal && (
                                        <span style={{
                                            fontSize: '0.7rem',
                                            background: '#4ade80',
                                            color: '#003300',
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                            fontWeight: 'bold'
                                        }}>
                                            IDEAL
                                        </span>
                                    )}
                                </span>
                            </div>

                            {/* Gear Recommendation */}
                            {block.gear && block.gear.text && (
                                <div style={{ fontSize: '0.85rem', color: '#fff', background: 'rgba(0,0,0,0.2)', padding: '6px 10px', borderRadius: '4px', display: 'inline-block', width: '100%' }}>
                                    💡 <strong>Rec:</strong> {block.gear.text}{' '}
                                    <span style={{ opacity: 0.75, fontSize: '0.78rem' }}>{block.gear.sub}</span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default BestTime;
