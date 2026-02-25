import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Dashboard from '../Dashboard';
import * as weatherService from '../../services/weatherService';

// Mock the contexts
const mockLocation = {
    name: 'Melville Waters',
    latitude: -32.0,
    longitude: 115.0,
    idealWindDirection: 220
};

vi.mock('../../context/LocationContext', () => ({
    useLocation: () => ({
        currentLocation: mockLocation
    })
}));

vi.mock('../../context/AuthContext', () => ({
    useAuth: () => ({
        user: { uid: 'test-uid', displayName: 'TestUser', email: 'test@example.com', photoURL: null },
        login: vi.fn(),
        logout: vi.fn(),
        loading: false,
    })
}));

// Mock Recharts components to avoid complex SVG rendering in tests
vi.mock('recharts', async (importOriginal) => {
    const original = await importOriginal();
    return {
        ...original,
        ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
        ComposedChart: ({ children }) => <svg data-testid="composed-chart">{children}</svg>,
        LineChart: ({ children }) => <svg data-testid="line-chart">{children}</svg>,
        Line: () => <g data-testid="line" />,
        XAxis: () => <g data-testid="x-axis" />,
        YAxis: () => <g data-testid="y-axis" />,
        CartesianGrid: () => <g data-testid="cartesian-grid" />,
        Tooltip: () => <g data-testid="tooltip" />,
        Area: () => <g data-testid="area" />,
        ReferenceArea: () => <g data-testid="reference-area" />,
        Customized: () => <g data-testid="customized" />,
        ReferenceLine: ({ label, stroke, strokeDasharray, children }) => {
            console.log('Rendering ReferenceLine:', { label, stroke });
            return (
                <g
                    data-testid="reference-line"
                    data-stroke={stroke}
                    data-stroke-dasharray={strokeDasharray}
                >
                    {label && (typeof label === 'object' ? <text>{label.value}</text> : <text>{label}</text>)}
                    {children}
                </g>
            );
        },
        Label: ({ value }) => <text data-testid="label">{value}</text>
    };
});

// Mock the services
vi.mock('../../services/weatherService', () => ({
    getWeatherForecast: vi.fn(),
    getTideForecast: vi.fn(),
    getActualWeather: vi.fn(),
    processChartData: vi.fn()
}));

vi.mock('../../services/stravaService', () => ({
    initiateStravaAuth: vi.fn(),
    handleStravaCallback: vi.fn(),
    getStravaUser: vi.fn().mockResolvedValue(null),
    getActivities: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/dbService', () => ({
    migrateLocalStorageToFirestore: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/firebaseSetup', () => ({
    auth: {},
    googleProvider: {},
    db: {},
}));

vi.mock('../../services/storageService', () => ({
    exportData: vi.fn(),
    importData: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock sub-components that might cause issues or noise
vi.mock('../MapComponent', () => ({ default: () => <div data-testid="map-component">Map</div> }));
vi.mock('../Journal', () => ({ default: () => <div data-testid="journal-component">Journal</div> }));
vi.mock('../LocationManager', () => ({ default: () => <div data-testid="location-manager">LocationManager</div> }));
vi.mock('../GearSelector', () => ({ default: () => <div data-testid="gear-selector">GearSelector</div> }));
vi.mock('../BestTime', () => ({ default: () => <div data-testid="best-time">BestTime</div> }));

// Helper to generate mock chart data
const generateMockData = (startDate) => {
    const data = [];
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);

    // Generate 48 hours of data (2 days)
    for (let i = 0; i < 48; i++) {
        const d = new Date(start.getTime() + i * 3600 * 1000);
        data.push({
            index: i,
            time: d.getTime(),
            rawDate: d,
            label: d.getHours() + ':00',
            dayLabel: d.toLocaleDateString('en-US', { weekday: 'long' }),
            displayDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            speed: 10 + Math.random() * 5,
            gusts: 15 + Math.random() * 5,
            direction: 180,
            chartSpeed: 10,
            chartGusts: 15,
            tide: 0.5,
            isDayStart: i === 0 || d.getHours() === 0,
            isNoon: d.getHours() === 12
        });
    }
    return data;
};

describe('Dashboard Chart Markers', () => {
    const mockDate = new Date('2026-01-30T10:00:00'); // Friday 10AM

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(mockDate);

        // Default mock implementation
        weatherService.getWeatherForecast.mockResolvedValue({});
        weatherService.getTideForecast.mockResolvedValue({});
        weatherService.getActualWeather.mockResolvedValue(null);

        // Return mock data provided by helper
        const mockData = generateMockData(mockDate);
        weatherService.processChartData.mockReturnValue(mockData);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('renders the "NOW" reference line', async () => {
        render(<Dashboard />);
        await waitFor(() => expect(weatherService.processChartData).toHaveBeenCalled());

        // Helper to find by testId because our mock uses it
        // We use findAllByTestId because we expect multiple reference lines
        const lines = await screen.findAllByTestId('reference-line', {}, { timeout: 10000 });

        const nowLine = lines.find(l =>
            l.getAttribute('data-stroke') === '#ef4444' || l.getAttribute('data-stroke') === 'red'
        );

        if (!nowLine) {
            console.log('No NOW line found. Found lines:', lines.map(l => ({
                stroke: l.getAttribute('data-stroke'),
                text: l.textContent
            })));
        }

        expect(nowLine).toBeTruthy();

        // Check text content inside
        expect(nowLine).toHaveTextContent('NOW');
    }, 15000);

    it('renders day separators aligned at midnight', async () => {
        render(<Dashboard />);
        await waitFor(() => expect(weatherService.processChartData).toHaveBeenCalled());

        const lines = await screen.findAllByTestId('reference-line', {}, { timeout: 10000 });

        const separators = lines.filter(l =>
            l.getAttribute('data-stroke-dasharray') === '5 5' &&
            (l.getAttribute('data-stroke') === 'rgba(255, 255, 255, 0.5)' || l.getAttribute('data-stroke') === 'rgba(255, 255, 255, 0.3)')
        );

        expect(separators.length).toBeGreaterThan(0);
    }, 15000);
});
