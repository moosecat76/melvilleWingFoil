import React, { useMemo, useState } from 'react';
import {
    suggestBestSessions,
    rankLocationsAndTimes,
    isDirectionInSector,
    analyzeSpotWindProfile,
    findSimilarPastSessions
} from '../services/recommendationService';
import { generatePreSessionGamePlan } from '../services/aiCoachService';
import { BadgeCheck, Clock, Wind, Compass, Sparkles, Sliders, Target, MapPin, ArrowRight } from 'lucide-react';
import { format } from 'date-fns';

const BestTime = ({
    forecastHourly,
    userGear,
    idealWindDirection,
    daily,
    unit = 'knots',
    sessions = [],
    locationId = null,
    locationName = 'Spot',
    currentTide = null,
    allLocationForecasts = [],
    onSwitchLocation = null
}) => {
    const [gamePlan, setGamePlan] = useState(null);
    const [gamePlanLoading, setGamePlanLoading] = useState(false);
    const [scopeMode, setScopeMode] = useState('ALL'); // 'ALL' (across saved spots) | 'CURRENT' (this spot only)

    const currentSpotBlocks = useMemo(() => {
        if (!forecastHourly) return [];
        return suggestBestSessions(
            forecastHourly,
            userGear,
            idealWindDirection,
            daily,
            sessions,
            { id: locationId, name: locationName, idealWindDirection }
        );
    }, [forecastHourly, userGear, idealWindDirection, daily, sessions, locationId, locationName]);

    const multiLocationRanking = useMemo(() => {
        if (!Array.isArray(allLocationForecasts) || allLocationForecasts.length === 0) {
            return {
                bestOverallBlock: currentSpotBlocks[0] || null,
                rankedBlocks: currentSpotBlocks,
                bestByLocation: locationId
                    ? [{ location: { id: locationId, name: locationName, idealWindDirection }, topBlock: currentSpotBlocks[0] || null }]
                    : []
            };
        }
        return rankLocationsAndTimes(allLocationForecasts, userGear, sessions);
    }, [allLocationForecasts, userGear, sessions, currentSpotBlocks, locationId, locationName, idealWindDirection]);

    const hasMultipleSpots = Array.isArray(allLocationForecasts) && allLocationForecasts.length > 1;
    const blocks = (hasMultipleSpots && scopeMode === 'ALL')
        ? multiLocationRanking.rankedBlocks
        : currentSpotBlocks;

    const bestOverall = multiLocationRanking.bestOverallBlock || currentSpotBlocks[0] || null;

    const spotProfile = useMemo(() => {
        return analyzeSpotWindProfile(sessions, locationId);
    }, [sessions, locationId]);

    if (!blocks || blocks.length === 0) {
        return (
            <div className="card">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BadgeCheck size={20} />
                    Best Time &amp; Location to Go
                </h3>
                <p style={{ color: 'var(--text-secondary)' }}>
                    No great sessions projected in next 48h{locationName ? ` at ${locationName}` : ''}.
                </p>
                {spotProfile && (
                    <div style={{ marginTop: '8px', fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Compass size={14} color="var(--accent-primary)" />
                        <span>
                            Your best corridor at {locationName}: <strong>{spotProfile.corridorLabel}</strong> ({spotProfile.avgRating}★ avg across {spotProfile.sessionCount} sessions)
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
            const targetLocId = primary.locationId || locationId;
            const targetLocName = primary.locationName || locationName;
            const pastMatches = findSimilarPastSessions(
                { speedKmh: primary.avgSpeed, gustsKmh: primary.maxGusts, direction: primary.avgDirection },
                sessions,
                targetLocId,
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
                spotName: targetLocName,
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
                    Best Time &amp; Location to Go
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {hasMultipleSpots && (
                        <div className="unit-toggle" style={{ transform: 'scale(0.85)', transformOrigin: 'right center' }}>
                            <button
                                type="button"
                                className={scopeMode === 'ALL' ? 'active' : ''}
                                onClick={() => setScopeMode('ALL')}
                                title="Compare all saved locations"
                            >
                                All Spots
                            </button>
                            <button
                                type="button"
                                className={scopeMode === 'CURRENT' ? 'active' : ''}
                                onClick={() => setScopeMode('CURRENT')}
                                title={`Only show windows at ${locationName}`}
                            >
                                {locationName}
                            </button>
                        </div>
                    )}
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

            {/* Top Recommended Spot & Time Callout Banner */}
            {bestOverall && (
                <div style={{
                    marginBottom: '12px',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    background: 'rgba(74, 222, 128, 0.08)',
                    border: '1px solid rgba(74, 222, 128, 0.28)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '8px'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            textTransform: 'uppercase',
                            letterSpacing: '0.04em',
                            background: '#4ade80',
                            color: '#052e16',
                            padding: '2px 7px',
                            borderRadius: '999px'
                        }}>
                            Top Pick
                        </span>
                        <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                            <MapPin size={14} color="var(--accent-primary)" />
                            {bestOverall.locationName || locationName}
                        </span>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                            · {format(new Date(bestOverall.start), 'EEE h:mm a')} ({(bestOverall.avgSpeed * speedMult).toFixed(1)} {unitLabel})
                        </span>
                    </div>
                    {bestOverall.locationId && bestOverall.locationId !== locationId && typeof onSwitchLocation === 'function' && (
                        <button
                            type="button"
                            onClick={() => onSwitchLocation(bestOverall.locationId)}
                            style={{
                                fontSize: '0.74rem',
                                fontWeight: 600,
                                color: 'var(--accent-primary)',
                                background: 'rgba(56, 189, 248, 0.14)',
                                border: '1px solid rgba(56, 189, 248, 0.35)',
                                borderRadius: '6px',
                                padding: '3px 8px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                            }}
                        >
                            Switch to {bestOverall.locationName} <ArrowRight size={12} />
                        </button>
                    )}
                </div>
            )}

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

                    const blockIdealRange = block.idealWindDirection || idealWindDirection;
                    const isIdeal = block.isIdealSector !== undefined
                        ? block.isIdealSector
                        : (blockIdealRange && isDirectionInSector(block.avgDirection, blockIdealRange.min, blockIdealRange.max));
                    const blockLocName = block.locationName || locationName;
                    const isOtherLocation = block.locationId && locationId && block.locationId !== locationId;

                    return (
                        <div key={`${block.locationId || 'spot'}-${block.start}-${idx}`} style={{
                            background: 'rgba(255,255,255,0.05)',
                            borderRadius: '8px',
                            padding: '12px',
                            borderLeft: `4px solid ${block.rating.color || 'gray'}`
                        }}>
                            {/* Location & Time Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span
                                        onClick={() => isOtherLocation && typeof onSwitchLocation === 'function' && onSwitchLocation(block.locationId)}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '4px',
                                            fontSize: '0.76rem',
                                            fontWeight: 700,
                                            padding: '2px 8px',
                                            borderRadius: '12px',
                                            background: isOtherLocation ? 'rgba(167, 139, 250, 0.16)' : 'rgba(56, 189, 248, 0.15)',
                                            color: isOtherLocation ? '#c4b5fd' : 'var(--accent-primary)',
                                            border: isOtherLocation ? '1px solid rgba(167, 139, 250, 0.35)' : '1px solid rgba(56, 189, 248, 0.3)',
                                            cursor: isOtherLocation && onSwitchLocation ? 'pointer' : 'default'
                                        }}
                                        title={isOtherLocation ? `Switch forecast view to ${blockLocName}` : `Recommended spot: ${blockLocName}`}
                                    >
                                        <MapPin size={12} />
                                        {blockLocName}
                                    </span>

                                    <span style={{ fontWeight: 'bold', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <Clock size={15} />
                                        {format(new Date(block.start), 'EEE h:mm a')} - {format(new Date(block.end), 'h:mm a')}
                                        <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-secondary)' }}>
                                            ({block.durationHours}h)
                                        </span>
                                    </span>
                                </div>
                                <span style={{ color: block.rating.color, fontWeight: 'bold', fontSize: '0.9rem' }}>
                                    {block.rating.label}
                                </span>
                            </div>

                            {/* Wind Stats & Direction */}
                            <div style={{ display: 'flex', gap: '16px', color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
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
                                    <span style={{ fontSize: '0.8rem' }}>{Math.round(block.avgDirection)}°</span>
                                    {isIdeal && (
                                        <span style={{
                                            fontSize: '0.7rem',
                                            background: '#4ade80',
                                            color: '#003300',
                                            padding: '1px 6px',
                                            borderRadius: '4px',
                                            fontWeight: 'bold'
                                        }}>
                                            IDEAL SECTOR
                                        </span>
                                    )}
                                </span>
                            </div>

                            {/* Gear Recommendation */}
                            {block.gear && block.gear.text && (
                                <div style={{ fontSize: '0.85rem', color: '#fff', background: 'rgba(0,0,0,0.2)', padding: '6px 10px', borderRadius: '4px', display: 'inline-block', width: '100%' }}>
                                    💡 <strong>Rec at {blockLocName}:</strong> {block.gear.text}{' '}
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
