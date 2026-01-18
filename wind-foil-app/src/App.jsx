import React, { useState, useEffect } from 'react';
import { Wind, Navigation, Calendar, ThumbsUp, ThumbsDown, ArrowUp, AlertTriangle, Anchor } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, ReferenceLine, Label } from 'recharts';
import { getWeatherForecast, processChartData } from './services/weatherService';

const CustomArrowDot = (props) => {
  const { cx, cy, payload, index } = props;
  // Show arrow every 3rd point to avoid clutter (every 3 hours)
  if (index % 3 !== 0) return null;

  return (
    <svg x={cx - 10} y={cy - 10} width={20} height={20} style={{ overflow: 'visible' }}>
      <line
        x1="10" y1="10" x2="10" y2="-5"
        stroke="var(--accent-primary)"
        strokeWidth="2"
        transform={`rotate(${payload.direction + 180} 10 10)`}
      />
      <polygon
        points="10,-8 6,0 14,0"
        fill="var(--accent-primary)"
        transform={`rotate(${payload.direction + 180} 10 10)`}
      />
    </svg>
  );
};

function App() {
  const [data, setData] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [unit, setUnit] = useState('knots'); // Default to knots

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Single call now handles both history and forecast
        const rawData = await getWeatherForecast();
        const processed = processChartData(rawData);
        setData(processed);

        // Find current conditions (closest hour to now)
        const now = new Date();
        const closest = processed.reduce((prev, curr) => {
          return (Math.abs(new Date(curr.time) - now) < Math.abs(new Date(prev.time) - now) ? curr : prev);
        });

        setCurrent(closest || processed[0]);

      } catch (err) {
        console.error(err);
        setError('Failed to load weather data.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const formatSpeed = (val) => {
    // For display in text (already converted in chartData for chart)
    // If passing raw km/h, convert.
    // But we will use this mainly for text display of raw 'current' which is still km/h.
    if (val == null) return '-';
    if (unit === 'knots') return (val * 0.539957).toFixed(1);
    return Math.round(val);
  };

  const getWindRating = (speedKmh) => {
    if (speedKmh == null) return { label: 'N/A', color: 'var(--text-secondary)', icon: <Wind /> };

    // Limits in km/h
    // < 18 km/h (approx 10 knots) -> Light
    // 18-28 km/h (10-15 knots) -> Good
    // > 28 km/h (15 knots) -> Excellent

    if (speedKmh < 18) return { label: 'Light', color: 'var(--text-secondary)', icon: <ThumbsDown /> };
    if (speedKmh < 28) return { label: 'Good', color: 'var(--accent-primary)', icon: <ThumbsUp /> };
    return { label: 'Excellent', color: 'var(--status-success)', icon: <ThumbsUp /> };
  };

  const getGearRecommendation = (speedKmh) => {
    if (!speedKmh) return { text: "No wind data", sub: "" };
    const knots = speedKmh * 0.539957;

    if (knots < 10) return { text: "Light Wind Gear", sub: "Large Foil / 6m+ Wing or Surf" };
    if (knots < 15) return { text: "5m - 6m Wing", sub: "Standard Foil" };
    if (knots < 22) return { text: "4m - 5m Wing", sub: "Small-Med Foil" };
    return { text: "3m - 4m Wing (Small)", sub: "High Wind Foil!" };
  };

  if (loading) return <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading Forecast...</div>;
  if (error) return <div className="app-container">Error: {error}</div>;

  const currentRating = current ? getWindRating(current.speed) : { label: '-', color: 'grey' };
  const gear = getGearRecommendation(current?.speed);

  // Display strings for Current Card (source is always km/h)
  const displayedSpeed = formatSpeed(current?.speed);
  const displayedGusts = formatSpeed(current?.gusts);
  const unitLabel = unit === 'knots' ? 'knots' : 'km/h';

  // Prepare Chart Data: Convert values upfront for "Logical Scale" support in Recharts
  const chartData = data.map(d => {
    const s = unit === 'knots' ? d.speed * 0.539957 : d.speed;
    const g = unit === 'knots' ? d.gusts * 0.539957 : d.gusts;
    return {
      ...d,
      chartSpeed: Number(s.toFixed(1)), // Ensure number for chart
      chartGusts: Number(g.toFixed(1))
    };
  });

  return (
    <div className="app-container">
      <header style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className="text-gradient" style={{ margin: 0, fontSize: '2.5rem', fontWeight: 800 }}>
            Melville Wing Foil
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Navigation size={16} /> -32.04, 115.80
          </p>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          {/* Unit Toggle */}
          <div className="unit-toggle">
            <button
              className={unit === 'kmh' ? 'active' : ''}
              onClick={() => setUnit('kmh')}
            >
              km/h
            </button>
            <button
              className={unit === 'knots' ? 'active' : ''}
              onClick={() => setUnit('knots')}
            >
              knots
            </button>
          </div>

          <div className="glass-panel" style={{ padding: '0.5rem 1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Calendar size={16} style={{ color: 'var(--accent-primary)' }} />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              {new Date().toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
          </div>
        </div>
      </header>

      <main style={{ display: 'grid', gap: '2rem' }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
          {/* Current Conditions Card */}
          <div className="glass-panel" style={{ padding: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 className="card-title">Current Wind</h2>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                <span className="metric-value">{displayedSpeed}</span>
                <span className="metric-label">{unitLabel}</span>
              </div>
              <div style={{ marginTop: '0.25rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Gusts: <span style={{ color: 'var(--text-primary)' }}>{displayedGusts}</span> {unitLabel}
              </div>
            </div>

            <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'end', gap: '0.5rem' }}>
              {/* Visual Direction Compass */}
              <div style={{
                position: 'relative',
                width: '60px',
                height: '60px',
                border: '2px solid var(--border-color)',
                borderRadius: '50%',
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                background: 'var(--bg-secondary)'
              }}>
                <div className="wind-compass" style={{ transform: `rotate(${current?.direction + 180}deg)` }}>
                  {/* Arrow points in direction wind is going To. Wind 'from' South (180) -> Flows North (0/360). 
                       Wait: Standard meteo: arrow points WITH the wind flow. 
                       If wind is FROM South (180deg), it blows TO North.
                       ArrowUp points Up (0deg). 
                       So rotate 180deg = Points Down.
                       If wind is 180 (South wind), we want arrow pointing North (Up)? 
                       Usually "Wind Arrow" points in the direction of the wind flow.
                       Wind from 180 (South) flows to 0 (North). 
                       So we want arrow pointing Up (0deg).
                       Rotation = 180 (Wind Dir) + 180 = 360 (Up). Correct.
                       If wind is from 90 (East), flows West (270). 
                       Rotation = 90 + 180 = 270 (Left). Correct.
                    */}
                  <ArrowUp size={32} color="var(--accent-primary)" />
                </div>
                <span style={{ position: 'absolute', bottom: '-25px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                  {current?.direction}°
                </span>
              </div>
            </div>
          </div>

          {/* Status & Gear */}
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <h3 className="card-title">Forecast Status</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <div style={{ color: currentRating.color }}>{React.cloneElement(currentRating.icon, { size: 32 })}</div>
                  <span style={{ fontSize: '1.5rem', fontWeight: 700, color: currentRating.color }}>{currentRating.label}</span>
                </div>
              </div>
            </div>

            {current?.speed > 35 && (
              <div className="alert-banner">
                <AlertTriangle size={18} />
                <span>High wind warning! Check conditions.</span>
              </div>
            )}

            <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <Anchor size={24} color="var(--accent-primary)" />
              <div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recommended Gear</div>
                <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{gear.text}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{gear.sub}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Chart */}
        <div className="glass-panel" style={{ padding: '2rem', height: '400px' }}>
          <h3 className="card-title">7-Day Forecast (Arrows show direction)</h3>
          <ResponsiveContainer width="100%" height="100%">
            {/* Use chartData which has converted units */}
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorSpeed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent-primary)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--accent-primary)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.1} vertical={false} />

              <XAxis
                dataKey="label"
                stroke="var(--text-secondary)"
                fontSize={12}
                tickMargin={10}
                minTickGap={30} // Prevent overlapping by ensuring min gap
              />

              <YAxis
                stroke="var(--text-secondary)"
                fontSize={12}
                domain={[0, 'auto']}
                allowDecimals={false} // Force integers for clean scale
                label={{
                  value: `Speed (${unitLabel})`,
                  angle: -90,
                  position: 'insideLeft',
                  style: { textAnchor: 'middle', fill: 'var(--text-secondary)' }
                }}
              />

              <Tooltip
                content={({ active, payload, label }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', padding: '10px', borderRadius: '8px' }}>
                        <p style={{ color: 'var(--accent-primary)', marginBottom: '5px', fontWeight: 600 }}>{data.displayDate} {data.label}</p>
                        <p style={{ color: 'var(--text-primary)', margin: 0 }}>
                          Speed: <strong>{data.chartSpeed}</strong> {unitLabel}
                        </p>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: 0 }}>
                          Gusts: {data.chartGusts} {unitLabel}
                        </p>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '5px', color: 'var(--text-secondary)' }}>
                          Direction: {data.direction}°
                          <ArrowUp size={14} style={{ transform: `rotate(${data.direction + 180}deg)` }} />
                        </div>
                      </div>
                    );
                  }
                  return null;
                }}
              />

              {/* Day Separators - Vertical Grid Lines at Midnight */}
              {chartData.map((d) => {
                if (d.rawDate.getHours() === 0) {
                  return (
                    <ReferenceLine
                      key={d.label}
                      x={d.label}
                      stroke="var(--border-color)"
                      strokeOpacity={0.8}
                      strokeDasharray="3 3"
                      label={{
                        value: d.rawDate.toLocaleDateString('en-US', { weekday: 'long' }),
                        position: 'insideTopRight',
                        fill: 'var(--text-secondary)',
                        fontSize: 12,
                        fontWeight: 600,
                        dy: 10 // Push label down slightly from top edge
                      }}
                    />
                  );
                }
                return null;
              })}

              {/* Ensure x matches a label exactly. 'current' comes from processed, which is in chartData. */}
              {current && (
                <ReferenceLine x={current.label} stroke="var(--accent-secondary)" strokeDasharray="3 3" isFront>
                  <Label value="NOW" position="insideTop" offset={10} fill="var(--accent-secondary)" fontSize={12} fontWeight="bold" />
                </ReferenceLine>
              )}

              <Area
                type="monotone"
                dataKey="chartSpeed"
                name="speed"
                stroke="var(--accent-primary)"
                fillOpacity={1}
                fill="url(#colorSpeed)"
                strokeWidth={2}
                dot={<CustomArrowDot />}
              />

            </ComposedChart>
          </ResponsiveContainer>
        </div>

      </main>

      <footer style={{ marginTop: '4rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
        <p>Data provided by Open-Meteo API</p>
      </footer>
    </div>
  );
}

export default App;

