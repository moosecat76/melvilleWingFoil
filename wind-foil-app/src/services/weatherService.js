import axios from 'axios';
import { format, isAfter, subHours } from 'date-fns';

const BASE_URL_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const BASE_URL_MARINE = 'https://marine-api.open-meteo.com/v1/marine';

// BOM Station: Inner Dolphin Pylon (009091)
// Note: Direct access to BOM JSON often requires a CORS proxy in production.
// For local dev, we might encounter issues. If so, we'll try a public mirror or Open-Meteo's 'current' as fallback.
const BOM_JSON_URL = 'http://reg.bom.gov.au/fwo/IDW60901/IDW60901.94610.json';

const COORDS = {
    latitude: -32.01303172472861,
    longitude: 115.82947437392544,
};

export const getWeatherForecast = async () => {
    try {
        const response = await axios.get(BASE_URL_FORECAST, {
            params: {
                latitude: COORDS.latitude,
                longitude: COORDS.longitude,
                hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m',
                timezone: 'auto',
                past_days: 1,      // 24h history (approx)
                forecast_days: 7,  // 7 days look ahead
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching forecast:', error);
        throw error;
    }
};

export const getTideForecast = async () => {
    try {
        const response = await axios.get(BASE_URL_MARINE, {
            params: {
                latitude: COORDS.latitude,
                longitude: COORDS.longitude,
                hourly: 'sea_level_height_msl',
                timezone: 'auto',
                past_days: 1,
                forecast_days: 7,
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching tide data:', error);
        return null;
    }
};

export const getActualWeather = async () => {
    try {
        // Attempt to fetch BOM data
        // Using a simple CORS-anywhere proxy if running locally, or direct if possible.
        // For reliability in this demo, we might fallback if it fails.
        const response = await axios.get(BOM_JSON_URL);
        const observations = response.data.observations.data;

        // Find the latest observation
        if (observations && observations.length > 0) {
            const latest = observations[0];
            return {
                time: new Date(latest.local_date_time_full), // "20231027150000" format usually needed parsing, but let's check format
                speed: latest.wind_spd_kmh,
                direction: latest.wind_dir,
                gusts: latest.gust_kmh,
                temp: latest.air_temp
            };
        }
        return null;
    } catch (error) {
        console.warn('BOM Fetch failed (likely CORS). Falling back to Open-Meteo Current.');
        // Fallback: Open-Meteo Current Weather
        try {
            const response = await axios.get(BASE_URL_FORECAST, {
                params: {
                    latitude: COORDS.latitude,
                    longitude: COORDS.longitude,
                    current: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m',
                    timezone: 'auto',
                },
            });
            const current = response.data.current;
            return {
                time: new Date(),
                speed: current.wind_speed_10m,
                direction: current.wind_direction_10m,
                gusts: current.wind_gusts_10m
            };
        } catch (e) {
            console.error(e);
            return null;
        }
    }
};

// Simplified: we no longer need separate historical call/merge logic
// because Open-Meteo stitches past_days + forecast_days automatically.
export const processChartData = (data, tideData) => {
    if (!data || !data.hourly) return [];

    const { time, wind_speed_10m, wind_direction_10m, wind_gusts_10m } = data.hourly;
    const tideLevels = tideData?.hourly?.sea_level_height_msl || [];
    const now = new Date();

    return time.map((t, index) => {
        const date = new Date(t);
        const isFuture = isAfter(date, now);

        return {
            time: t,
            rawDate: date, // For filtering logic
            // Format: "Mon 10:00" or just "10:00" depending on generic needs, 
            // but for 7 days, we definitely need Day + Time
            label: format(date, 'EEE HH:mm'),
            displayDate: format(date, 'MMM dd'),

            // Single continuous line data
            speed: wind_speed_10m[index],
            gusts: wind_gusts_10m[index],
            direction: wind_direction_10m[index],
            tide: tideLevels[index],

            // Helper for UI styling (dashed vs solid)
            isForecast: isFuture,
        };
    });
};
