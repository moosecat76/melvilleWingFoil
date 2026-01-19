import axios from 'axios';
import { format, isAfter, subHours } from 'date-fns';

const BASE_URL_FORECAST = 'https://api.open-meteo.com/v1/forecast';

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

// Simplified: we no longer need separate historical call/merge logic
// because Open-Meteo stitches past_days + forecast_days automatically.
export const processChartData = (data) => {
    if (!data || !data.hourly) return [];

    const { time, wind_speed_10m, wind_direction_10m, wind_gusts_10m } = data.hourly;
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

            // Helper for UI styling (dashed vs solid)
            isForecast: isFuture,
        };
    });
};
