import React, { useState } from 'react';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';
import { usePreferences } from '../context/PreferencesContext';

const CustomTooltip = ({ active, payload, hasAltitude, speedUnit, speedMult, isRelative, altLabel }) => {
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
                    <p style={{ margin: '0 0 2px 0' }}>
                        {altLabel}: <strong style={{ color: '#82ca9d' }}>{isRelative && data.altitude >= 0 ? '+' : ''}{data.altitude.toFixed(2)} m</strong>
                        {isRelative && typeof data.rawAltitude === 'number' && (
                            <span style={{ fontSize: '10px', color: '#94a3b8' }}> (raw {data.rawAltitude.toFixed(1)} m)</span>
                        )}
                    </p>
                )}
                <p style={{ margin: 0 }}>State: <strong style={{ color: data.state === 'beach' ? '#f87171' : data.state === 'foiling' ? '#4ade80' : '#fbbf24' }}>{data.state.charAt(0).toUpperCase() + data.state.slice(1)}</strong></p>
            </div>
        );
    }
    return null;
};

const toggleBtnStyle = (active) => ({
    background: active ? 'rgba(130, 202, 157, 0.2)' : 'transparent',
    border: '1px solid ' + (active ? '#82ca9d' : 'rgba(255,255,255,0.15)'),
    color: active ? '#82ca9d' : 'var(--text-secondary)',
    borderRadius: '10px',
    padding: '2px 8px',
    fontSize: '0.72rem',
    cursor: 'pointer'
});

const FoilAnalysisChart = ({ analysisData, onHover, selectedSegment = null, onSelectSegment = null, unit: propUnit }) => {
    const preferences = usePreferences();
    const [altView, setAltView] = useState('relative'); // 'relative' (drift/tide-corrected) | 'raw'
    const activeUnit = propUnit || preferences.unit || 'knots';
    const speedMult = activeUnit === 'kmh' ? 3.6 : 1.94384;
    const speedUnit = activeUnit === 'kmh' ? 'km/h' : 'kts';

    if (!analysisData || !analysisData.data) return null;

    const { data, foilSegments = [], baselineAltitude, dynamicBaseline, pointStates, mode, adaptiveThreshold } = analysisData;
    const { velocity, altitude, time, altitudeNormalized } = data;
    if (!Array.isArray(time) || !Array.isArray(velocity) || time.length === 0 || velocity.length === 0) {
        return null;
    }

    const isAltitudeMode = mode === 'altitude';
    const hasRawAltitude = Array.isArray(altitude) && altitude.length === time.length &&
        (Math.max(...altitude) - Math.min(...altitude)) > 0.1;
    const hasNormalized = Array.isArray(altitudeNormalized) && altitudeNormalized.length === time.length;
    // Always show altitude when it was recorded, even if detection used speed only
    const hasAltitude = hasRawAltitude;
    const isRelative = hasNormalized && altView === 'relative';
    const altSeries = isRelative ? altitudeNormalized : altitude;
    const altLabel = isRelative ? 'Rel. altitude' : 'Altitude';

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
            timeMin: (time[bestIdx] / 60).toFixed(2),
            speed: velocity[bestIdx],
            displaySpeed: Number((velocity[bestIdx] * speedMult).toFixed(1)),
            altitude: hasAltitude ? altSeries[bestIdx] : 0,
            rawAltitude: hasAltitude ? altitude[bestIdx] : null,
            // Altitude baseline only makes sense when detection used altitude and we show raw values
            baseline: (isAltitudeMode && !isRelative) ? (dynamicBaseline ? dynamicBaseline[bestIdx] : baselineAltitude) : null,
            state: pointStates ? pointStates[bestIdx] : 'sailing'
        });
    }

    const minAlt = hasAltitude ? Math.min(...altSeries) : 0;
    const maxAlt = hasAltitude ? Math.max(...altSeries) : 0;
    const altPadding = hasAltitude ? Math.max(0.2, (maxAlt - minAlt) * 0.1) : 1;
    const foilLineY = adaptiveThreshold || 1.95;
    const foilLineConverted = Number((foilLineY * speedMult).toFixed(1));

    const handleChartClick = (e) => {
        if (!onSelectSegment || !e || e.activeTooltipIndex === undefined || !chartData[e.activeTooltipIndex]) return;
        const clickedOriginalIdx = chartData[e.activeTooltipIndex].originalIndex;
        const matchedSeg = foilSegments.find(s => clickedOriginalIdx >= s.start && clickedOriginalIdx <= s.end);
        if (matchedSeg) {
            if (selectedSegment && selectedSegment.start === matchedSeg.start && selectedSegment.end === matchedSeg.end) {
                onSelectSegment(null);
            } else {
                onSelectSegment(matchedSeg);
            }
        } else if (selectedSegment) {
            onSelectSegment(null);
        }
    };

    return (
        <div style={{ width: '100%', height: 400, background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <h4 style={{ margin: 0, color: 'var(--text-secondary)' }}>Flight Analysis</h4>
                    {selectedSegment && onSelectSegment && (
                        <button
                            type="button"
                            onClick={() => onSelectSegment(null)}
                            style={{
                                background: 'rgba(56, 189, 248, 0.2)',
                                border: '1px solid #38bdf8',
                                color: '#38bdf8',
                                borderRadius: '12px',
                                padding: '2px 10px',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                cursor: 'pointer'
                            }}
                        >
                            Flight #{selectedSegment.flightNumber || ''} Focused · Clear ✕
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {hasAltitude && hasNormalized && (
                        <div style={{ display: 'flex', gap: '4px' }} title="Relative altitude removes slow drift from tide, air pressure and sensor warm-up">
                            <button type="button" style={toggleBtnStyle(altView === 'relative')} onClick={() => setAltView('relative')}>Relative alt</button>
                            <button type="button" style={toggleBtnStyle(altView === 'raw')} onClick={() => setAltView('raw')}>Raw alt</button>
                        </div>
                    )}
                    {!isAltitudeMode && (
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.06)', padding: '2px 8px', borderRadius: '10px' }}>
                            Adaptive foil threshold: ~{foilLineConverted} {speedUnit} ({foilLineY.toFixed(1)} m/s)
                        </span>
                    )}
                </div>
            </div>
            <ResponsiveContainer width="100%" height="90%">
                <ComposedChart
                    data={chartData}
                    onClick={handleChartClick}
                    onMouseMove={(e) => {
                        if (e && e.activeTooltipIndex !== undefined && chartData[e.activeTooltipIndex] && onHover) {
                            onHover(chartData[e.activeTooltipIndex].originalIndex);
                        }
                    }}
                    onMouseLeave={() => {
                        if (onHover) onHover(null);
                    }}
                    style={{ cursor: onSelectSegment ? 'pointer' : 'default' }}
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

                    <YAxis
                        yAxisId="speed"
                        orientation="left"
                        label={{ value: `Speed (${speedUnit})`, angle: -90, position: 'insideLeft', fill: '#8884d8' }}
                        stroke="#8884d8"
                        fontSize={12}
                    />

                    {hasAltitude && (
                        <YAxis
                            yAxisId="altitude"
                            orientation="right"
                            reversed={isAltitudeMode && !isRelative}
                            domain={[Number((minAlt - altPadding).toFixed(1)), Number((maxAlt + altPadding).toFixed(1))]}
                            label={{ value: isRelative ? 'Rel. altitude (m)' : 'Altitude (m)', angle: 90, position: 'insideRight', fill: '#82ca9d' }}
                            stroke="#82ca9d"
                            fontSize={12}
                        />
                    )}

                    <Tooltip content={<CustomTooltip hasAltitude={hasAltitude} speedUnit={speedUnit} speedMult={speedMult} isRelative={isRelative} altLabel={altLabel} />} />

                    {hasAltitude && isAltitudeMode && !isRelative && (
                        <Line yAxisId="altitude" type="monotone" dataKey="baseline" stroke="#82ca9d" strokeDasharray="5 5" dot={false} strokeWidth={1} name="Base" />
                    )}

                    {hasAltitude && isRelative && (
                        <ReferenceLine yAxisId="altitude" y={0} stroke="#82ca9d" strokeDasharray="5 5" strokeOpacity={0.4} />
                    )}

                    {!isAltitudeMode && (
                        <ReferenceLine yAxisId="speed" y={foilLineConverted} stroke="#4ade80" strokeDasharray="4 4" strokeOpacity={0.6} />
                    )}

                    {/* Foil Segments Background Overlay */}
                    {foilSegments.map((seg, idx) => {
                        const isSelected = selectedSegment && selectedSegment.start === seg.start && selectedSegment.end === seg.end;
                        return (
                            <ReferenceArea
                                key={idx}
                                x1={time[seg.start]}
                                x2={time[seg.end]}
                                yAxisId="speed"
                                fill={isSelected ? '#38bdf8' : '#4ade80'}
                                fillOpacity={isSelected ? 0.45 : 0.22}
                                stroke={isSelected ? '#38bdf8' : 'none'}
                                strokeWidth={isSelected ? 2 : 0}
                            />
                        );
                    })}

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
                            baseValue={isRelative ? 0 : 'dataMin'}
                        />
                    )}

                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default FoilAnalysisChart;
