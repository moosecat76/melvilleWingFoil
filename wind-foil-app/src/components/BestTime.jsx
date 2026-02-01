import React, { useMemo } from 'react';
import { suggestBestSessions } from '../services/recommendationService';
import { BadgeCheck, Clock, Wind } from 'lucide-react';
import { format } from 'date-fns';

const BestTime = ({ forecastHourly, userGear, idealWindDirection, daily, unit = 'knots' }) => {

    const blocks = useMemo(() => {
        if (!forecastHourly) return [];
        return suggestBestSessions(forecastHourly, userGear, idealWindDirection, daily);
    }, [forecastHourly, userGear, idealWindDirection, daily]);

    if (!blocks || blocks.length === 0) {
        return (
            <div className="card">
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <BadgeCheck size={20} />
                    Best Time to Go
                </h3>
                <p style={{ color: 'var(--text-secondary)' }}>No great sessions projected in next 48h.</p>
            </div>
        );
    }

    // Show top 3 blocks
    const topBlocks = blocks.slice(0, 3);
    const speedMult = unit === 'knots' ? 0.539957 : 1;
    const unitLabel = unit === 'knots' ? 'kts' : 'km/h';

    return (
        <div className="card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BadgeCheck size={20} />
                Best Time to Go
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {topBlocks.map((block, idx) => {
                    // Safe checks
                    if (!block || !block.rating) return null;

                    // Check if direction is ideal for UI badge
                    const isIdeal = idealWindDirection &&
                        block.avgDirection >= idealWindDirection.min &&
                        block.avgDirection <= idealWindDirection.max;

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
                                    💡 <strong>Rec:</strong> {block.gear.text} <span style={{ opacity: 0.7 }}>{block.gear.sub}</span>
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
