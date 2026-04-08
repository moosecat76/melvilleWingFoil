
import React from 'react';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';

const CustomTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        return (
            <div style={{ backgroundColor: '#1e293b', padding: '10px', border: '1px solid #334155', color: '#f8fafc', borderRadius: '4px', fontSize: '12px' }}>
                <p style={{ margin: '0 0 5px 0', color: '#94a3b8' }}>{Math.floor(data.time / 60)}m {Math.round(data.time % 60)}s</p>
                <p style={{ margin: '0 0 2px 0' }}>Speed: <strong style={{color: '#8884d8'}}>{data.speed.toFixed(2)} m/s</strong></p>
                <p style={{ margin: '0 0 2px 0' }}>Altitude: <strong style={{color: '#82ca9d'}}>{data.altitude.toFixed(2)} m</strong></p>
                <p style={{ margin: 0 }}>State: <strong style={{color: data.state === 'beach' ? '#f87171' : data.state === 'foiling' ? '#4ade80' : '#fbbf24'}}>{data.state.charAt(0).toUpperCase() + data.state.slice(1)}</strong></p>
            </div>
        );
    }
    return null;
};

const FoilAnalysisChart = ({ analysisData, onHover }) => {
    if (!analysisData) return null;

    const { data, foilSegments, baselineAltitude, dynamicBaseline, pointStates } = analysisData;
    const { velocity, altitude, time } = data;

    // Prepare chart data - downsample to greatly improve JS rendering performance
    const targetPoints = 500;
    const samplingRate = Math.max(1, Math.ceil(time.length / targetPoints));
    
    const chartData = [];
    for (let i = 0; i < time.length; i += samplingRate) {
        chartData.push({
            originalIndex: i,
            time: time[i],
            timeMin: (time[i] / 60).toFixed(2), // formatted for X-Axis
            speed: velocity[i],
            altitude: altitude[i],
            baseline: dynamicBaseline ? dynamicBaseline[i] : baselineAltitude,
            state: pointStates ? pointStates[i] : 'sailing'
        });
    }

    // Calculate domain for Altitude to make sure it looks good inverted
    // Inverted means: Lower values (flight) are HIGHER on the screen.
    // So 'dataMin' should be at the top, 'dataMax' at the bottom. 
    // Recharts 'reversed' prop on YAxis handles this.
    // Domain: [Min Alt - padding, Max Alt + padding]
    const minAlt = Math.min(...altitude);
    const maxAlt = Math.max(...altitude);
    const altPadding = (maxAlt - minAlt) * 0.1;

    return (
        <div style={{ width: '100%', height: 400, background: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '10px' }}>
            <h4 style={{ margin: '0 0 10px 0', color: 'var(--text-secondary)' }}>Flight Analysis</h4>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart 
                    data={chartData}
                    onMouseMove={(e) => {
                        if (e && e.activeTooltipIndex !== undefined && onHover) {
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
                        tickFormatter={(val) => Math.floor(val / 60) + 'm'}
                        minTickGap={30}
                        stroke="var(--text-secondary)"
                        fontSize={12}
                    />

                    {/* Primary Y-Axis: Speed (m/s) */}
                    <YAxis
                        yAxisId="speed"
                        orientation="left"
                        label={{ value: 'Speed (m/s)', angle: -90, position: 'insideLeft', fill: '#8884d8' }}
                        stroke="#8884d8"
                        fontSize={12}
                    />

                    {/* Secondary Y-Axis: Altitude (m) - INVERTED */}
                    <YAxis
                        yAxisId="altitude"
                        orientation="right"
                        reversed={true}
                        domain={[minAlt - altPadding, maxAlt + altPadding]}
                        label={{ value: 'Altitude (m)', angle: 90, position: 'insideRight', fill: '#82ca9d' }}
                        stroke="#82ca9d"
                        fontSize={12}
                    />

                    <Tooltip content={<CustomTooltip />} />

                    {/* Dynamic Baseline replacing static ReferenceLine */}
                    <Line yAxisId="altitude" type="monotone" dataKey="baseline" stroke="#82ca9d" strokeDasharray="5 5" dot={false} strokeWidth={1} name="Base" />

                    {/* Foil Segments Background Overlay */}
                    {foilSegments.map((seg, idx) => (
                        <ReferenceArea
                            key={idx}
                            x1={time[seg.start]}
                            x2={time[seg.end]}
                            yAxisId="speed"
                            fill="#4ade80"
                            fillOpacity={0.2}
                        />
                    ))}

                    {/* Lines */}
                    <Line
                        yAxisId="speed"
                        type="monotone"
                        dataKey="speed"
                        stroke="#8884d8"
                        dot={false}
                        strokeWidth={2}
                        name="Speed"
                    />

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

                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default FoilAnalysisChart;
