import axios from 'axios';
import { format, isAfter, subHours } from 'date-fns';

const BASE_URL_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const BASE_URL_MARINE = 'https://marine-api.open-meteo.com/v1/marine';

// BOM Station: Inner Dolphin Pylon (009091)
// Note: Direct access to BOM JSON often requires a CORS proxy in production.
// For local dev, we might encounter issues. If so, we'll try a public mirror or Open-Meteo's 'current' as fallback.
const BOM_JSON_URL = 'http://reg.bom.gov.au/fwo/IDW60901/IDW60901.94610.json';

// Keep this as a reference or default, but functions will take overrides
export const DEFAULT_COORDS = {
    latitude: -32.01303172472861,
    longitude: 115.82947437392544,
};

export const getWeatherForecast = async (lat = DEFAULT_COORDS.latitude, lon = DEFAULT_COORDS.longitude) => {
    try {
        const response = await axios.get(BASE_URL_FORECAST, {
            params: {
                latitude: lat,
                longitude: lon,
                hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m',
                timezone: 'auto',
                past_days: 7,      // 7 days history (approx)
                forecast_days: 7,  // 7 days look ahead
                daily: 'sunrise,sunset', // Request daylight info
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching forecast:', error);
        throw error;
    }
};

export const getTideForecast = async (lat = DEFAULT_COORDS.latitude, lon = DEFAULT_COORDS.longitude) => {
    try {
        const response = await axios.get(BASE_URL_MARINE, {
            params: {
                latitude: lat,
                longitude: lon,
                hourly: 'sea_level_height_msl',
                timezone: 'auto',
                past_days: 1,
                forecast_days: 7,
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching tide data:', error);
        return null; // Return null gracefully so the UI can handle "no tide data"
    }
};

export const getActualWeather = async (lat = DEFAULT_COORDS.latitude, lon = DEFAULT_COORDS.longitude) => {
    // Only use BOM if we are at the default location (Melville), otherwise strictly use Open-Meteo
    const isDefaultLocation = Math.abs(lat - DEFAULT_COORDS.latitude) < 0.0001 && Math.abs(lon - DEFAULT_COORDS.longitude) < 0.0001;

    let historicalActuals = [];

    if (isDefaultLocation) {
        try {
            const response = await axios.get(BOM_JSON_URL);
            const observations = response.data.observations.data;

            if (observations && observations.length > 0) {
                // Map all observations to a consistent format
                historicalActuals = observations.map(obs => ({
                    time: new Date(obs.local_date_time_full),
                    speed: obs.wind_spd_kmh,
                    direction: obs.wind_dir_deg, // Use degrees if available, fallback handled in process
                    gusts: obs.gust_kmh,
                    temp: obs.air_temp
                }));

                const latest = historicalActuals[0];
                return {
                    ...latest,
                    historical: historicalActuals
                };
            }
        } catch (error) {
            console.warn('BOM Fetch failed (likely CORS). Falling back to Open-Meteo Current.');
        }
    }

    // Fallback: Open-Meteo Current Weather
    try {
        const response = await axios.get(BASE_URL_FORECAST, {
            params: {
                latitude: lat,
                longitude: lon,
                current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
                timezone: 'auto',
            },
        });
        const current = response.data.current;
        return {
            time: new Date(),
            speed: current.wind_speed_10m,
            direction: current.wind_direction_10m,
            gusts: current.wind_gusts_10m,
            historical: [] // For now, Open-Meteo fallback doesn't populate historical actuals easily without another call
        };
    } catch (e) {
        console.error(e);
        return null;
    }
};

// Simplified: we no longer need separate historical call/merge logic
// because Open-Meteo stitches past_days + forecast_days automatically.
// Simplified: we no longer need separate historical call/merge logic
// because Open-Meteo stitches past_days + forecast_days automatically.
export const processChartData = (data, tideData) => {
    if (!data || !data.hourly) return [];

    const { time, wind_speed_10m, wind_direction_10m, wind_gusts_10m } = data.hourly;
    // Safety check for tide data
    const tideLevels = tideData?.hourly?.sea_level_height_msl || [];
    const now = new Date();

    return time.map((t, index) => {
        const date = new Date(t);
        const isFuture = isAfter(date, now);

        // Robust day start detection
        const prevT = index > 0 ? time[index - 1] : null;
        const isDayStart = index === 0 || format(date, 'yyyy-MM-dd') !== format(new Date(prevT), 'yyyy-MM-dd');

        return {
            index: index,
            time: date.getTime(),
            rawDate: date,
            label: format(date, 'HH:mm'),
            dayLabel: format(date, 'EEEE'),
            displayDate: format(date, 'MMM dd'),

            // Single continuous line data
            speed: wind_speed_10m[index],
            gusts: wind_gusts_10m[index],
            direction: wind_direction_10m[index],
            // Safety access for tide
            tide: tideLevels[index] !== undefined ? tideLevels[index] : null,

            // Helper for UI styling (dashed vs solid)
            isForecast: isFuture,
            isDayStart: isDayStart,
            isNoon: date.getHours() === 12,
        };
    });
};

/**
 * Specifically for the "Today" chart: merges forecast and actual historical data.
 */
export const processTodayChartData = (forecastData, actualData) => {
    if (!forecastData || forecastData.length === 0) return [];

    // Filter forecast for Today (+/- 24h roughly)
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date(startOfToday);
    endOfToday.setDate(endOfToday.getDate() + 1);
    endOfToday.setHours(23, 59, 59, 999);

    // We take the forecast for the next 24-48 hours from start of today to ensure we cover the full day
    const todayForecast = forecastData.filter(d => {
        const dDate = new Date(d.time);
        return dDate >= startOfToday && dDate <= endOfToday;
    });

    const historical = actualData?.historical || [];

    return todayForecast.map(f => {
        // Find actual data point closest to this forecast hour
        const fTime = f.time;
        // BOM historical points are every 30 mins usually
        const closestActual = historical.reduce((prev, curr) => {
            if (!prev) return curr;
            const prevDiff = Math.abs(new Date(prev.time).getTime() - fTime);
            const currDiff = Math.abs(new Date(curr.time).getTime() - fTime);
            return currDiff < prevDiff ? curr : prev;
        }, null);

        // Only use actual if it's within 45 mins of the hour
        const hasActual = closestActual && Math.abs(new Date(closestActual.time).getTime() - fTime) < 45 * 60 * 1000;

        return {
            ...f,
            actualSpeed: hasActual ? closestActual.speed : null,
            actualGusts: hasActual ? closestActual.gusts : null,
            actualDirection: hasActual ? closestActual.direction : null,
        };
    });
};
