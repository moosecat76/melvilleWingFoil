import React, { useState, useEffect } from 'react';
import { Wind, Navigation, Calendar, ThumbsUp, ThumbsDown, ArrowUp, AlertTriangle } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, ReferenceLine } from 'recharts';
import { getWeatherForecast, processChartData } from './services/weatherService';

function App() {
  const [data, setData] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [unit, setUnit] = useState('kmh'); // 'kmh' or 'knots'

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

  // Helper: Convert speed based on unit
  const formatSpeed = (speed) => {
    if (speed == null) return '-';
    if (unit === 'knots') return (speed * 0.539957).toFixed(1);
    return Math.round(speed); // km/h usually integer is fine, or 1 decimal
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

  if (loading) return <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading Forecast...</div>;
  if (error) return <div className="app-container">Error: {error}</div>;

  const currentRating = current ? getWindRating(current.speed) : { label: '-', color: 'grey' };
  const displayedSpeed = formatSpeed(current?.speed);
  const displayedGusts = formatSpeed(current?.gusts);
  const unitLabel = unit === 'knots' ? 'knots' : 'km/h';

  // For chart specific rendering
  const chartData = data.map(d => ({
    ...d,
    // Pre-calculate display values for tooltip if needed, or handle in formatter
    // storing raw km/h for the chart scaling usually best, format in tick/tooltip
  }));

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

          {/* Status / Insight Card */}
          <div className="glass-panel" style={{ padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
              <div>
                <h3 className="card-title">Foil Forecast</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.5rem' }}>
                  <div style={{ color: currentRating.color }}>
                    {React.cloneElement(currentRating.icon, { size: 32 })}
                  </div>
                  <span style={{ fontSize: '1.5rem', fontWeight: 700, color: currentRating.color }}>
                    {currentRating.label}
                  </span>
                </div>
              </div>
            </div>

            {current?.speed > 35 && (
              <div className="alert-banner">
                <AlertTriangle size={18} />
                <span>High wind warning! Check conditions.</span>
              </div>
            )}

            <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', lineHeight: '1.5' }}>
              Looking ahead <strong>7 days</strong>. Check the chart for trends.
            </p>
          </div>
        </div>

        {/* Main Chart */}
        <div className="glass-panel" style={{ padding: '2rem', height: '400px' }}>
          <h3 className="card-title">Wind Forecast (Next 7 Days)</h3>
          <ResponsiveContainer width="100%" height="100%">
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
                interval={23} // Show rough daily markers? 24h * 7 = 168 points. interval 23 approx 1 day
              />
              <YAxis
                stroke="var(--text-secondary)"
                fontSize={12}
                label={{
                  value: `Speed (${unitLabel})`,
                  angle: -90,
                  position: 'insideLeft',
                  style: { textAnchor: 'middle', fill: 'var(--text-secondary)' }
                }}
                tickFormatter={(val) => formatSpeed(val)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
                itemStyle={{ color: 'var(--text-primary)' }}
                labelStyle={{ color: 'var(--accent-primary)' }}
                formatter={(value, name) => [formatSpeed(value), name === 'speed' ? 'Wind Speed' : name]}
                labelFormatter={(label, payload) => {
                  if (payload && payload.length > 0) {
                    return payload[0].payload.displayDate + ' ' + label;
                  }
                  return label;
                }}
              />

              <ReferenceLine x={current?.label} stroke="var(--text-secondary)" strokeDasharray="3 3" label={{ value: "NOW", fill: "var(--text-secondary)", fontSize: 10 }} />

              <Area
                type="monotone"
                dataKey="speed"
                name="speed"
                stroke="var(--accent-primary)"
                fillOpacity={1}
                fill="url(#colorSpeed)"
                strokeWidth={2}
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

