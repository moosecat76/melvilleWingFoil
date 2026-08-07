import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const CustomHrTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
        const data = payload[0].payload;
        const mins = Math.floor(data.timeSec / 60);
        const secs = Math.round(data.timeSec % 60);
        return (
            <div style={{
                backgroundColor: '#1e293b',
                padding: '8px 12px',
                border: '1px solid #334155',
                color: '#f8fafc',
                borderRadius: '6px',
                fontSize: '12px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}>
                <p style={{ margin: '0 0 4px 0', color: '#94a3b8' }}>⏱️ {mins}m {secs}s</p>
                <p style={{ margin: 0, fontWeight: 'bold', color: '#f87171', fontSize: '13px' }}>
                    ❤️ {data.bpm} <span style={{ fontSize: '11px', fontWeight: 'normal', color: '#cbd5e1' }}>bpm</span>
                </p>
            </div>
        );
    }
    return null;
};

const HeartRateChart = ({ streams, onHover }) => {
    if (!streams) return null;

    // 1. Extract time and heart rate data arrays
    let timeArr = [];
    let hrArr   = [];

    if (Array.isArray(streams)) {
        timeArr = streams.find(s => s.type === 'time')?.data || [];
        hrArr   = streams.find(s => s.type === 'heartrate')?.data || [];
    } else {
        timeArr = streams.time?.data || [];
        hrArr   = streams.heartrate?.data || [];
    }

    if (!hrArr || hrArr.length === 0) return null;

    // Filter out invalid/zero heart rate points
    const validPairs = [];
    for (let i = 0; i < hrArr.length; i++) {
        const bpm = hrArr[i];
        if (bpm && bpm > 30 && bpm < 250) {
            validPairs.push({
                origIdx: i,
                timeSec: timeArr[i] || 0,
                bpm:     Math.round(bpm),
            });
        }
    }

    if (validPairs.length < 2) return null;

    // Calculate stats
    const bpms   = validPairs.map(p => p.bpm);
    const minBpm = Math.min(...bpms);
    const maxBpm = Math.max(...bpms);
    const avgBpm = Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length);

    // Downsample to max ~400 points for smooth performance
    const targetPoints = 400;
    const step = Math.max(1, Math.ceil(validPairs.length / targetPoints));

    const chartData = [];
    for (let i = 0; i < validPairs.length; i += step) {
        chartData.push(validPairs[i]);
    }

    // Y-Axis domain with padding
    const yMin = Math.max(30, minBpm - 10);
    const yMax = Math.min(240, maxBpm + 10);

    return (
        <div style={{
            width: '100%',
            background: 'rgba(0,0,0,0.25)',
            borderRadius: '10px',
            border: '1px solid var(--border-color)',
            padding: '14px',
            marginTop: '16px',
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '12px',
                flexWrap: 'wrap',
                gap: '8px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '1.1rem' }}>❤️</span>
                    <h4 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '0.92rem', fontWeight: 600 }}>
                        Heart Rate Over Time
                    </h4>
                </div>

                <div style={{ display: 'flex', gap: '12px', fontSize: '0.78rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                        Avg: <strong style={{ color: '#f87171' }}>{avgBpm} bpm</strong>
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                        Max: <strong style={{ color: '#fb923c' }}>{maxBpm} bpm</strong>
                    </span>
                    <span style={{ color: 'var(--text-secondary)' }}>
                        Min: <strong style={{ color: '#38bdf8' }}>{minBpm} bpm</strong>
                    </span>
                </div>
            </div>

            <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={chartData}
                        margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                        onMouseMove={(e) => {
                            if (e && e.activeTooltipIndex !== undefined && onHover) {
                                onHover(chartData[e.activeTooltipIndex]?.origIdx ?? null);
                            }
                        }}
                        onMouseLeave={() => {
                            if (onHover) onHover(null);
                        }}
                    >
                        <defs>
                            <linearGradient id="hrGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f87171" stopOpacity={0.4} />
                                <stop offset="95%" stopColor="#f87171" stopOpacity={0.0} />
                            </linearGradient>
                        </defs>

                        <CartesianGrid strokeDasharray="3 3" opacity={0.08} vertical={false} />

                        <XAxis
                            dataKey="timeSec"
                            tickFormatter={(sec) => `${Math.floor(sec / 60)}m`}
                            minTickGap={30}
                            stroke="var(--text-secondary)"
                            fontSize={11}
                        />

                        <YAxis
                            domain={[yMin, yMax]}
                            stroke="var(--text-secondary)"
                            fontSize={11}
                            tickFormatter={(val) => `${val}`}
                        />

                        <Tooltip content={<CustomHrTooltip />} />

                        <ReferenceLine
                            y={avgBpm}
                            stroke="#fb923c"
                            strokeDasharray="4 4"
                            strokeWidth={1}
                            label={{
                                value: `Avg ${avgBpm}`,
                                fill: '#fb923c',
                                fontSize: 10,
                                position: 'insideTopRight',
                            }}
                        />

                        <Area
                            type="monotone"
                            dataKey="bpm"
                            stroke="#f87171"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#hrGradient)"
                            dot={false}
                            activeDot={{ r: 5, fill: '#ef4444', stroke: '#ffffff', strokeWidth: 2 }}
                            name="Heart Rate"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default HeartRateChart;
