import React, { useMemo } from 'react';
import { suggestBestSessions } from '../services/recommendationService';
import { BadgeCheck, Clock, Wind } from 'lucide-react';
import { format } from 'date-fns';

const BestTime = ({ forecastHourly, userGear, idealWindDirection, unit = 'knots' }) => {

    const suggestions = useMemo(() => {
        if (!forecastHourly) return [];
        return suggestBestSessions(forecastHourly, userGear, idealWindDirection);
    }, [forecastHourly, userGear, idealWindDirection]);

    if (!suggestions || suggestions.length === 0) {
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

    // Show top 3
    const topSuggestions = suggestions.slice(0, 3);
    const speedMult = unit === 'knots' ? 0.539957 : 1;
    const unitLabel = unit === 'knots' ? 'kts' : 'km/h';

    return (
        <div className="card">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <BadgeCheck size={20} />
                Best Time to Go
            </h3>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {topSuggestions.map((slot, idx) => (
                    <div key={idx} style={{
                        background: 'rgba(255,255,255,0.05)',
                        borderRadius: '8px',
                        padding: '10px',
                        borderLeft: `4px solid ${slot.rating.color}`
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontWeight: 'bold', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Clock size={16} />
                                {format(new Date(slot.time), 'EEE h:mm a')}
                            </span>
                            <span style={{ color: slot.rating.color, fontWeight: 'bold', fontSize: '0.9rem' }}>
                                {slot.rating.label}
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '6px' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Wind size={14} /> {(slot.speed * speedMult).toFixed(1)} {unitLabel}
                            </span>
                            <span>
                                Gusts {(slot.gusts * speedMult).toFixed(1)}
                            </span>
                        </div>
                        {slot.gear.text && (
                            <div style={{ fontSize: '0.85rem', color: '#fff', background: 'rgba(0,0,0,0.2)', padding: '4px 8px', borderRadius: '4px', display: 'inline-block' }}>
                                💡 {slot.gear.text}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default BestTime;
