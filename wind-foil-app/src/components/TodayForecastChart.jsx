import React from 'react';
import { format } from 'date-fns';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, ReferenceLine, Label } from 'recharts';
import { ArrowUp } from 'lucide-react';

const CustomArrowDot = (props) => {
    const { cx, cy, payload, index, dataKey, color } = props;
    if (index % 2 !== 0) return null; // Show every 2nd dot to avoid clutter

    const direction = dataKey === 'actualSpeed' ? payload.actualDirection : payload.direction;
    if (direction == null) return null;

    return (
        <svg x={cx - 8} y={cy - 8} width={16} height={16} style={{ overflow: 'visible' }}>
            <line
                x1="8" y1="8" x2="8" y2="-2"
                stroke={color || "var(--accent-primary)"}
                strokeWidth="2"
                transform={`rotate(${direction + 180} 8 8)`}
            />
            <polygon
                points="8,-5 5,0 11,0"
                fill={color || "var(--accent-primary)"}
                transform={`rotate(${direction + 180} 8 8)`}
            />
        </svg>
    );
};

const TodayForecastChart = ({ data, unitLabel }) => {
    if (!data || data.length === 0) return null;

    // Unit conversion helpers (duplicated for simplicity, or we could pass already converted data)
    // Actually, in ForecastPage, the data is mapped before passing.
    // So we assume the data passed here already has chartSpeed, chartGusts, actualSpeed, etc.

    return (
        <div className="glass-panel" style={{ padding: '2rem', height: '400px', marginBottom: '2rem' }}>
            <h3 className="card-title">Today's Comparison (Forecast vs Actual)</h3>
            <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                        <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.2} />
                            <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--status-success)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="var(--status-success)" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />

                    <XAxis
                        dataKey="time"
                        stroke="var(--text-secondary)"
                        fontSize={12}
                        tickMargin={10}
                        tickFormatter={(val) => format(new Date(val), 'HH:mm')}
                    />

                    <YAxis
                        stroke="var(--text-secondary)"
                        fontSize={12}
                        domain={[0, 'auto']}
                        allowDecimals={false}
                        label={{
                            value: `Speed (${unitLabel})`,
                            angle: -90,
                            position: 'insideLeft',
                            style: { textAnchor: 'middle', fill: 'var(--text-secondary)' }
                        }}
                    />

                    <Tooltip
                        content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                                const d = payload[0].payload;
                                return (
                                    <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px' }}>
                                        <p style={{ color: 'var(--text-primary)', marginBottom: '5px', fontWeight: 600 }}>{format(new Date(d.time), 'HH:mm')}</p>
                                        <p style={{ color: 'var(--accent-primary)', margin: 0 }}>
                                            Forecast: <strong>{d.chartSpeed}</strong> {unitLabel}
                                        </p>
                                        {d.actualSpeed != null && (
                                            <p style={{ color: 'var(--status-success)', margin: 0 }}>
                                                Actual: <strong>{d.actualSpeed}</strong> {unitLabel}
                                            </p>
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            Dir: {d.direction}°
                                            <ArrowUp size={12} style={{ transform: `rotate(${d.direction + 180}deg)` }} />
                                        </div>
                                    </div>
                                );
                            }
                            return null;
                        }}
                    />

                    {/* NOW Indicator */}
                    {(() => {
                        const now = new Date();
                        const closest = data.reduce((prev, curr) =>
                            Math.abs(curr.time - now.getTime()) < Math.abs(prev.time - now.getTime()) ? curr : prev
                            , data[0]);

                        return closest ? (
                            <ReferenceLine x={closest.time} stroke="#ff4757" strokeDasharray="5 5" strokeWidth={2} isFront>
                                <Label value="NOW" position="insideTop" offset={25} fill="#ff4757" fontSize={12} fontWeight="bold" />
                            </ReferenceLine>
                        ) : null;
                    })()}

                    {/* Forecast Area */}
                    <Area
                        type="monotone"
                        dataKey="chartSpeed"
                        name="Forecast"
                        stroke="var(--accent-primary)"
                        fillOpacity={1}
                        fill="url(#colorForecast)"
                        strokeWidth={2}
                        dot={<CustomArrowDot color="var(--accent-primary)" />}
                    />

                    {/* Actual Line */}
                    <Line
                        type="monotone"
                        dataKey="actualSpeed"
                        name="Actual"
                        stroke="var(--status-success)"
                        strokeWidth={3}
                        dot={<CustomArrowDot color="var(--status-success)" />}
                        connectNulls
                    />
                </ComposedChart>
            </ResponsiveContainer>
        </div>
    );
};

export default TodayForecastChart;
