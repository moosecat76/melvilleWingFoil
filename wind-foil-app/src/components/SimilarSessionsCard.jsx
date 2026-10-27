import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { History, Wind, ChevronRight, Sparkles } from 'lucide-react';
import { format } from 'date-fns';
import { suggestBestSessions, findSimilarPastSessions } from '../services/recommendationService';

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

const SimilarSessionsCard = ({
    forecastHourly,
    userGear,
    idealWindDirection,
    daily,
    current,
    sessions = [],
    locationId = null,
    unit = 'knots'
}) => {
    const navigate = useNavigate();
    const speedMult = unit === 'knots' ? 0.539957 : 1;
    const ktsToUnit = unit === 'kmh' ? 1.852 : 1;
    const unitLabel = unit === 'knots' ? 'kts' : 'km/h';

    const { matches, contextLabel } = useMemo(() => {
        if (!sessions || sessions.length === 0) {
            return { matches: [], contextLabel: '' };
        }

        const blocks = forecastHourly
            ? suggestBestSessions(forecastHourly, userGear, idealWindDirection, daily, sessions)
            : [];

        let targetCondition = null;
        let label = '';

        if (blocks && blocks.length > 0) {
            const nextBlock = blocks[0];
            targetCondition = {
                speedKmh: nextBlock.avgSpeed,
                gustsKmh: nextBlock.maxGusts || nextBlock.avgGusts,
                direction: nextBlock.avgDirection,
            };
            const dispSpd = (nextBlock.avgSpeed * speedMult).toFixed(1);
            label = `Matched to Next Best Window (${safeFormatDate(nextBlock.start, 'EEE h:mm a')} · ${dispSpd} ${unitLabel})`;
        } else if (current && current.speed) {
            targetCondition = {
                speedKmh: current.speed,
                gustsKmh: current.gusts || current.speed,
                direction: current.direction,
            };
            const dispSpd = (current.speed * speedMult).toFixed(1);
            label = `Matched to Current Wind (${dispSpd} ${unitLabel})`;
        }

        if (!targetCondition) {
            return { matches: [], contextLabel: '' };
        }

        const found = findSimilarPastSessions(targetCondition, sessions, locationId, 2);
        return { matches: found, contextLabel: label };
    }, [forecastHourly, userGear, idealWindDirection, daily, current, sessions, locationId, speedMult, unitLabel]);

    if (!matches || matches.length === 0) {
        return null;
    }

    return (
        <div className="glass-panel" style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <History size={18} color="var(--accent-primary)" /> Similar Past Sessions
                </h3>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Sparkles size={13} color="#fbbf24" /> {contextLabel}
                </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
                {matches.map(({ entry, windKts, gustKts, similarityScore, powerLabel }) => {
                    const pctFoil = entry.foilAnalysis?.stats?.percentFoil;
                    const safeRating = Math.min(5, Math.max(1, Math.round(Number(entry.rating) || 4)));
                    const dispWind = (windKts * ktsToUnit).toFixed(1);
                    const dispGust = (gustKts * ktsToUnit).toFixed(1);

                    return (
                        <div
                            key={entry.id}
                            onClick={() => navigate(`/session/${entry.id}`)}
                            style={{
                                background: 'rgba(15, 23, 42, 0.55)',
                                border: '1px solid var(--border-color)',
                                borderRadius: '10px',
                                padding: '12px 14px',
                                cursor: 'pointer',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '10px',
                                transition: 'border-color 0.2s'
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)' }}>
                                        {safeFormatDate(entry.date, 'EEE dd MMM yyyy')}
                                    </span>
                                    <span style={{ color: '#facc15', fontSize: '0.82rem', fontWeight: 700 }}>
                                        {'★'.repeat(safeRating)}{'☆'.repeat(5 - safeRating)}
                                    </span>
                                    <span style={{
                                        fontSize: '0.68rem',
                                        background: 'rgba(56, 189, 248, 0.15)',
                                        color: 'var(--accent-primary)',
                                        padding: '1px 6px',
                                        borderRadius: '10px',
                                        fontWeight: 600
                                    }}>
                                        {similarityScore}% match
                                    </span>
                                    {powerLabel && (
                                        <span style={{
                                            fontSize: '0.68rem',
                                            background: powerLabel === 'Dialed' ? 'rgba(74, 222, 128, 0.18)' : 'rgba(251, 191, 36, 0.18)',
                                            color: powerLabel === 'Dialed' ? '#4ade80' : '#fbbf24',
                                            padding: '1px 6px',
                                            borderRadius: '10px',
                                            fontWeight: 600
                                        }}>
                                            {powerLabel}
                                        </span>
                                    )}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '4px', flexWrap: 'wrap' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }}>
                                        <Wind size={12} color="var(--accent-primary)" /> {dispWind} {unitLabel}
                                        {gustKts > windKts && <span style={{ color: 'var(--text-secondary)' }}>(Gust {dispGust})</span>}
                                    </span>
                                    {entry.windDirection && <span>{entry.windDirection}°</span>}
                                    {pctFoil != null && (
                                        <span style={{ color: '#4ade80', fontWeight: 600 }}>{pctFoil}% on foil</span>
                                    )}
                                </div>

                                {entry.gearUsed && (
                                    <div style={{ fontSize: '0.78rem', color: 'var(--accent-primary)', fontWeight: 600, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        Gear: {entry.gearUsed}
                                    </div>
                                )}

                                {entry.notes && (
                                    <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        "{entry.notes}"
                                    </div>
                                )}
                            </div>

                            <ChevronRight size={18} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default SimilarSessionsCard;
