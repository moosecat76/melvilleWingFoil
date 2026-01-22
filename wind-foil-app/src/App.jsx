import React, { useState, useEffect } from 'react';
import { format } from 'date-fns';
import { Wind, Navigation, Calendar, ThumbsUp, ThumbsDown, ArrowUp, AlertTriangle, Anchor, Waves } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, ComposedChart, ReferenceLine, Label } from 'recharts';
import { getWeatherForecast, getTideForecast, getActualWeather, processChartData } from './services/weatherService';

import MapComponent from './components/MapComponent';
import GearSelector from './components/GearSelector';

const CustomArrowDot = (props) => {
  const { cx, cy, payload, index, getWindRating } = props;
  // Show arrow every 3rd point to avoid clutter (every 3 hours)
  if (index % 3 !== 0) return null;

  const rating = getWindRating(payload.speed, payload.direction);

  return (
    <svg x={cx - 10} y={cy - 10} width={20} height={20} style={{ overflow: 'visible' }}>
      <line
        x1="10" y1="10" x2="10" y2="-5"
        stroke={rating.color}
        strokeWidth="2"
        transform={`rotate(${payload.direction + 180} 10 10)`}
      />
      <polygon
        points="10,-8 6,0 14,0"
        fill={rating.color}
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

  // Phase 4: Gear State
  const [userGear, setUserGear] = useState(() => {
    const saved = localStorage.getItem('melvill_user_gear');
    return saved ? JSON.parse(saved) : [];
  });
  const [showGearSelector, setShowGearSelector] = useState(false);

  const [unit, setUnit] = useState('knots'); // Default to knots

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        // Single call now handles both history and forecast
        const rawData = await getWeatherForecast();
        const tideData = await getTideForecast();
        const actualWeather = await getActualWeather();
        const processed = processChartData(rawData, tideData);
        setData(processed);

        // Allow 'current' to be the REAL actual weather if available, else closest forecast
        // We'll store actual in a separate state or just prefer it for the "Current" card
        if (actualWeather) {
          // Verify actualWeather is recent (e.g. within 2 hours)
          const diffHours = Math.abs(new Date() - actualWeather.time) / 36e5;
          if (diffHours < 3) {
            setCurrent({ ...actualWeather, isActual: true });
          } else {
            // Fallback to forecast if observation is stale
            console.log('Observation stale, using forecast');
            setCurrent(processed.find(p => new Date(p.time).getHours() === new Date().getHours()));
          }
        } else {
          const now = new Date();
          const closest = processed.reduce((prev, curr) => {
            return (Math.abs(new Date(curr.time) - now) < Math.abs(new Date(prev.time) - now) ? curr : prev);
          });
          setCurrent(closest || processed[0]);
        }

      } catch (err) {
        console.error(err);
        setError('Failed to load weather data.');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Save gear when updated
  useEffect(() => {
    localStorage.setItem('melvill_user_gear', JSON.stringify(userGear));
  }, [userGear]);

  const formatSpeed = (val) => {
    // For display in text (already converted in chartData for chart)
    // If passing raw km/h, convert.
    // But we will use this mainly for text display of raw 'current' which is still km/h.
    if (val == null) return '-';
    if (unit === 'knots') return (val * 0.539957).toFixed(1);
    return Math.round(val);
  };

  const getWindRating = (speedKmh, direction) => {
    if (speedKmh == null) return { label: 'N/A', color: 'var(--text-secondary)', icon: <Wind /> };

    // Ideal direction for Melville Waters: S to SW (approx 135 to 270 degrees)
    const isIdealDirection = direction >= 135 && direction <= 270;

    if (speedKmh < 18) {
      return { label: 'Light', color: 'var(--text-secondary)', icon: <ThumbsDown /> };
    }

    if (speedKmh < 28) {
      if (isIdealDirection) {
        return { label: 'Good (S/SW)', color: 'var(--status-success)', icon: <ThumbsUp /> };
      }
      return { label: 'Good (Gusty)', color: 'var(--status-warning)', icon: <ThumbsUp /> };
    }

    if (isIdealDirection) {
      return { label: 'Excellent', color: 'var(--status-success)', icon: <ThumbsUp /> };
    }
    return { label: 'Strong (Gusty)', color: 'var(--status-warning)', icon: <ThumbsUp /> };
  };

  const getGearRecommendation = (speedKmh) => {
    if (!speedKmh) return { text: "No wind data", sub: "" };
    const knots = speedKmh * 0.539957;

    let recText = "";
    let recSub = "";

    // 1. Determine generic bucket
    if (knots < 10) {
      recText = "Light Wind Gear";
      recSub = "Large Foil / 6m+ Wing or Surf";
    } else if (knots < 15) {
      recText = "5m - 6m Wing";
      recSub = "Standard Foil";
    } else if (knots < 22) {
      recText = "4m - 5m Wing";
      recSub = "Small-Med Foil";
    } else {
      recText = "3m - 4m Wing (Small)";
      recSub = "High Wind Foil!";
    }

    // 2. Personalize if user has gear
    if (userGear.length > 0) {
      // Filter for wings
      const wings = userGear.filter(g => g.type === 'wing').sort((a, b) => b.size - a.size); // Descending size

      if (wings.length > 0) {
        let selectedWing = null;

        // Simple matching logic
        if (knots < 12) selectedWing = wings[0]; // Largest
        else if (knots > 25) selectedWing = wings[wings.length - 1]; // Smallest
        else {
          // Find wing closest to ideal size for this wind
          // Rule of thumb: Speed * Size ~= constant? Or just buckets.
          // 15 knots ~= 5m. 20 knots ~= 4m.
          const idealSize = 75 / knots; // e.g. 75/15 = 5m. 75/20 = 3.75m. 75/12 = 6.25m.

          selectedWing = wings.reduce((prev, curr) => {
            return (Math.abs(curr.size - idealSize) < Math.abs(prev.size - idealSize) ? curr : prev);
          });
        }

        if (selectedWing) {
          recText = `Use your ${selectedWing.size}m ${selectedWing.model}`;
          recSub = `(Personalized for ${knots.toFixed(1)} kts)`;
        }
      }
    }

    return { text: recText, sub: recSub };
  };

  if (loading) return <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>Loading Forecast...</div>;
  if (error) return <div className="app-container">Error: {error}</div>;

  const currentRating = current ? getWindRating(current.speed, current.direction) : { label: '-', color: 'grey' };
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
            <Navigation size={16} /> -32.01, 115.83
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
                {current?.isActual && (
                  <span style={{ fontSize: '0.75rem', color: 'var(--status-success)', fontWeight: 600, border: '1px solid var(--status-success)', padding: '2px 6px', borderRadius: '4px' }}>LIVE</span>
                )}
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
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Recommended Gear</div>
                  <button
                    onClick={() => setShowGearSelector(!showGearSelector)}
                    style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', background: 'none', border: '1px solid var(--accent-primary)', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer' }}
                  >
                    {userGear.length > 0 ? 'Edit Quiver' : 'Add My Gear'}
                  </button>
                </div>
                {showGearSelector ? (
                  <div style={{ marginTop: '1rem' }}>
                    <GearSelector
                      currentGear={userGear}
                      onSave={(items) => setUserGear(items)}
                      onClose={() => setShowGearSelector(false)}
                    />
                  </div>
                ) : (
                  <>
                    <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-primary)', marginTop: '0.25rem' }}>{gear.text}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{gear.sub}</div>
                  </>
                )}
              </div>
            </div>

            {/* Tides Card */}
            <div className="glass-panel" style={{ padding: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <Waves size={24} color="var(--accent-primary)" />
                <h3 className="card-title" style={{ margin: 0 }}>Tide Info</h3>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end' }}>
                <div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Current Level</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {current?.tide ? `${current.tide.toFixed(2)} m` : '-'}
                  </div>
                </div>
                {current?.tide < 0.8 && (
                  <span style={{ color: 'var(--status-warning)', fontWeight: 600, fontSize: '0.9rem' }}>Low Tide Alert!</span>
                )}
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
                dataKey="time"
                stroke="var(--text-secondary)"
                fontSize={12}
                tickMargin={10}
                minTickGap={60}
                tickFormatter={(val) => {
                  const d = new Date(val);
                  return format(d, 'EEE HH:mm');
                }}
              />

              <YAxis
                yAxisId="wind"
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
              <YAxis
                yAxisId="tide"
                orientation="right"
                stroke="var(--accent-primary)"
                fontSize={12}
                domain={['auto', 'auto']}
                hide={false}
                tickFormatter={(val) => `${val}m`}
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
              {/* Day Separators & Labels */}
              {chartData.map((d) => {
                const hour = d.rawDate.getHours();
                // Vertical Line at Midnight
                if (hour === 0) {
                  return (
                    <ReferenceLine
                      key={`line-${d.time}`}
                      x={d.time}
                      stroke="var(--border-color)"
                      strokeOpacity={0.5}
                      strokeDasharray="3 3"
                    />
                  );
                }
                // Label at Noon in the middle of the day slot
                if (hour === 12) {
                  return (
                    <ReferenceLine
                      key={`label-${d.time}`}
                      x={d.time}
                      stroke="none"
                      label={{
                        value: d.rawDate.toLocaleDateString('en-US', { weekday: 'long' }),
                        position: 'insideTop',
                        fill: 'var(--text-secondary)',
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    />
                  );
                }
                return null;
              })}

              {/* NOW Indicator - Find closest chart time to current time/actuals */}
              {(() => {
                const nowTarget = current?.time ? new Date(current.time) : new Date();
                const closest = chartData.reduce((prev, curr) =>
                  Math.abs(curr.rawDate - nowTarget) < Math.abs(prev.rawDate - nowTarget) ? curr : prev
                  , chartData[0]);

                return closest ? (
                  <ReferenceLine x={closest.time} stroke="#ff4757" strokeDasharray="5 5" strokeWidth={2} isFront>
                    <Label value="NOW" position="insideTop" offset={25} fill="#ff4757" fontSize={12} fontWeight="bold" />
                  </ReferenceLine>
                ) : null;
              })()}

              <Area
                type="monotone"
                dataKey="chartSpeed"
                name="speed"
                stroke="var(--accent-primary)"
                fillOpacity={1}
                fill="url(#colorSpeed)"
                strokeWidth={2}
                dot={<CustomArrowDot getWindRating={getWindRating} />}
              />
              <Line
                yAxisId="tide"
                type="monotone"
                dataKey="tide"
                name="Tide Height"
                stroke="#60a5fa"
                strokeWidth={2}
                dot={false}
                strokeDasharray="5 5"
                opacity={0.6}
              />

            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Map Panel */}
        <div className="glass-panel" style={{ padding: '2rem' }}>
          <h3 className="card-title">Launch Location</h3>
          <MapComponent lat={-32.01303172472861} lng={115.82947437392544} />
        </div>

      </main>

      <footer style={{ marginTop: '4rem', textAlign: 'center', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
        <p>Data provided by Open-Meteo API & OpenStreetMap</p>
      </footer>
    </div>
  );
}

export default App;
