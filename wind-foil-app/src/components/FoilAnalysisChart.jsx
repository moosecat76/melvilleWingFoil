import React from 'react';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';
import { usePreferences } from '../context/PreferencesContext';

const CustomTooltip = ({ active, payload, hasAltitude, speedUnit, speedMult }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        const displaySpeed = (data.speed * speedMult).toFixed(1);
        return (
            <div style={{ backgroundColor: '#1e293b', padding: '10px', border: '1px solid #334155', color: '#f8fafc', borderRadius: '4px', fontSize: '12px' }}>
                <p style={{ margin: '0 0 5px 0', color: '#94a3b8' }}>{Math.floor(data.time / 60)}m {Math.round(data.time % 60)}s</p>
                <p style={{ margin: '0 0 2px 0' }}>
                    Speed: <strong style={{ color: '#8884d8' }}>{displaySpeed} {speedUnit}</strong>{' '}
                    <span style={{ fontSize: '10px', color: '#94a3b8' }}>({data.speed.toFixed(1)} m/s)</span>
                </p>
                {hasAltitude && (
                    <p style={{ margin: '0 0 2px 0' }}>Altitude: <strong style={{ color: '#82ca9d' }}>{data.altitude.toFixed(2)} m</strong></p>
                )}
                <p style={{ margin: 0 }}>State: <strong style={{ color: data.state === 'beach' ? '#f87171' : data.state === 'foiling' ? '#4ade80' : '#fbbf24' }}>{data.state.charAt(0).toUpperCase() + data.state.slice(1)}</strong></p>
            </div>
        );
    }
    return null;
};

const FoilAnalysisChart = ({ analysisData, onHover, unit: propUnit }) => {
    const preferences = usePreferences();
    const activeUnit = propUnit || preferences.unit || 'knots';
    const speedMult = activeUnit === 'kmh' ? 3.6 : 1.94384;
    const speedUnit = activeUnit === 'kmh' ? 'km/h' : 'kts';

    if (!analysisData || !analysisData.data) return null;

    const { data, foilSegments = [], baselineAltitude, dynamicBaseline, pointStates, mode, adaptiveThreshold } = analysisData;
    const { velocity, altitude, time } = data;
    if (!Array.isArray(time) || !Array.isArray(velocity) || time.length === 0 || velocity.length === 0) {
        return null;
    }

    // Prepare chart data - downsample to greatly improve JS rendering performance
    // Ensure we preserve peak velocity within each downsampled bucket so short flights/peaks don't vanish visually
    const targetPoints = 500;
    const samplingRate = Math.max(1, Math.ceil(time.length / targetPoints));

    const chartData = [];
    for (let i = 0; i < time.length; i += samplingRate) {
        let bestIdx = i;
        if (samplingRate > 1) {
            const bucketEnd = Math.min(time.length, i + samplingRate);
            for (let j = i + 1; j < bucketEnd; j++) {
                if (velocity[j] > velocity[bestIdx]) {
                    bestIdx = j;
                }
            }
        }
        chartData.push({
            originalIndex: bestIdx,
            time: time[bestIdx],
            timeMin: (time[bestIdx] / 60).toFixed(2), // formatted for X-Axis
            speed: velocity[bestIdx],
            displaySpeed: Number((velocity[bestIdx] * speedMult).toFixed(1)),
            altitude: altitude ? altitude[bestIdx] : 0,
            baseline: dynamicBaseline ? dynamicBaseline[bestIdx] : baselineAltitude,
            state: pointStates ? pointStates[bestIdx] : 'sailing'
        });
    }

    // Calculate domain for Altitude to make sure it looks good inverted
    const minAlt = altitude && altitude.length > 0 ? Math.min(...altitude) : 0;
    const maxAlt = altitude && altitude.length > 0 ? Math.max(...altitude) : 0;
    const hasAltitude = mode ? mode === 'altitude' : (maxAlt - minAlt) > 0.1;
    const altPadding = hasAltitude ? (maxAlt - minAlt) * 0.1 : 1;
    const foilLineY = adaptiveThreshold || 1.95;
    const foilLineConverted = Number((foilLineY * speedMult).toFixed(1));

    return (
        <div style={{ width: '100%', height: 400, background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ margin: 0, color: 'var(--text-secondary)' }}>Flight Analysis</h4>
                {!hasAltitude && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '10px' }}>
                        Adaptive foil threshold: ~{foilLineConverted} {speedUnit} ({foilLineY.toFixed(1)} m/s)
                    </span>
                )}
            </div>
            <ResponsiveContainer width="100%" height="90%">
                <ComposedChart
                    data={chartData}
                    onMouseMove={(e) => {
                        if (e && e.activeTooltipIndex !== undefined && chartData[e.activeTooltipIndex] && onHover) {
                            onHover(chartData[e.activeTooltipIndex].originalIndex);
                        }
                    }}
                    onMouseLeave={() => {
                        if (onHover) onHover(null);
                    }}
                >
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />

                    <XAxis
                        dataKey="time"
                        type="number"
                        domain={['dataMin', 'dataMax']}
                        tickFormatter={(val) => Math.floor(val / 60) + 'm'}
                        minTickGap={30}
                        stroke="var(--text-secondary)"
                        fontSize={12}
                    />

                    {/* Primary Y-Axis: Speed in user unit */}
                    <YAxis
                        yAxisId="speed"
                        orientation="left"
                        label={{ value: `Speed (${speedUnit})`, angle: -90, position: 'insideLeft', fill: '#8884d8' }}
                        stroke="#8884d8"
                        fontSize={12}
                    />

                    {/* Secondary Y-Axis: Altitude (m) - INVERTED (only when altitude is present) */}
                    {hasAltitude && (
                        <YAxis
                            yAxisId="altitude"
                            orientation="right"
                            reversed={true}
                            domain={[minAlt - altPadding, maxAlt + altPadding]}
                            label={{ value: 'Altitude (m)', angle: 90, position: 'insideRight', fill: '#82ca9d' }}
                            stroke="#82ca9d"
                            fontSize={12}
                        />
                    )}

                    <Tooltip content={<CustomTooltip hasAltitude={hasAltitude} speedUnit={speedUnit} speedMult={speedMult} />} />

                    {/* Dynamic Baseline replacing static ReferenceLine */}
                    {hasAltitude && (
                        <Line yAxisId="altitude" type="monotone" dataKey="baseline" stroke="#82ca9d" strokeDasharray="5 5" dot={false} strokeWidth={1} name="Base" />
                    )}

                    {/* Adaptive speed threshold reference line when in speed-only mode */}
                    {!hasAltitude && (
                        <ReferenceLine yAxisId="speed" y={foilLineConverted} stroke="#4ade80" strokeDasharray="4 4" strokeOpacity={0.6} />
                    )}

                    {/* Foil Segments Background Overlay */}
                    {foilSegments.map((seg, idx) => (
                        <ReferenceArea
                            key={idx}
                            x1={time[seg.start]}
                            x2={time[seg.end]}
                            yAxisId="speed"
                            fill="#4ade80"
                            fillOpacity={0.22}
                        />
                    ))}

                    {/* Lines */}
                    <Line
                        yAxisId="speed"
                        type="monotone"
                        dataKey="displaySpeed"
                        stroke="#8884d8"
                        dot={false}
                        strokeWidth={2}
                        name="Speed"
                    />

                    {hasAltitude && (
                        <Area
                            yAxisId="altitude"
                            type="monotone"
                            dataKey="altitude"
                            stroke="#82ca9d"
                            fill="#82ca9d"
                            fillOpacity={0.1}
                            dot={false}
                            name="Altitude"
                        />
                    )}

                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default FoilAnalysisChart;
