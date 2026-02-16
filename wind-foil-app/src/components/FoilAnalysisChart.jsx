
import React from 'react';
import { ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine } from 'recharts';

const FoilAnalysisChart = ({ analysisData }) => {
    if (!analysisData) return null;

    const { data, foilSegments, baselineAltitude } = analysisData;
    const { velocity, altitude, time } = data;

    // Prepare chart data
    // downsampling for performance if needed, but for now map 1:1
    const chartData = time.map((t, i) => ({
        time: t,
        timeMin: (t / 60).toFixed(2), // formatted for X-Axis
        speed: velocity[i],
        altitude: altitude[i]
    }));

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
                <ComposedChart data={chartData}>
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

                    <Tooltip
                        contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', color: '#f8fafc' }}
                        formatter={(value, name) => [value.toFixed(2), name]}
                        labelFormatter={(label) => `${Math.floor(label / 60)}m ${Math.round(label % 60)}s`}
                    />

                    {/* Baseline Reference */}
                    <ReferenceLine y={baselineAltitude} yAxisId="altitude" stroke="#82ca9d" strokeDasharray="5 5" label="Base" />

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
