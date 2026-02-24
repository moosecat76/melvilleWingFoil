# Wind Foil App

A React-based web application for Wing Foiling enthusiasts at Melville Waters (and beyond!).

## Overview
This application serves as a comprehensive tool for wind foilers, combining weather forecasting, session tracking, and advanced telemetry analysis. The application recently transitioned to a robust multi-page architecture using `react-router-dom` to provide a better user experience and optimal performance.

## Core Features
1. **7-Day Wind Forecast 🌬️**
   - Interactive chart displaying wind speed, gusts, and direction for optimal planning.
   - Highlights the "NOW" time and clear day dividers.
2. **Session Journal 📓**
   - Record and list your past sessions, including notes, gear used, and ratings.
3. **Advanced Foil Telemetry Analysis 🚀**
   - Automatically detects and calculates "Time on Foil", flight count, and persistency from your GPS/telemetry data base.
   - Computes speed ranges and dynamically visualizes them on interactive maps.
4. **Session Maps & Speed Visualizations 🗺️**
   - A detailed map view for each session with color-coded paths corresponding to specific speed buckets: Stopped (<2), Crawl (2-3), Planing (3-4), Foiling (4-5), and Cranking (>5).
5. **Gear and Spot Management ⚙️**
   - Select different gear configurations and switch between different foiling locations.

## Architecture
The application is structured into clearly separated pages:
- **Forecast Page (`/`)**: Dedicated weather forecast view.
- **Sessions Page (`/sessions`)**: A fast, summary-list view of all tracked sessions.
- **Session Detail Page (`/session/:id`)**: An in-depth view of a specific session containing heavy components like the speed map and foil analysis charts.

A persistent bottom navigation bar allows for intuitive switching between the main pages.

## Getting Started

### Prerequisites
Make sure you have Node.js and npm installed.

### Installation & Execution
1. Navigate to the `wind-foil-app` directory:
   ```bash
   cd wind-foil-app
   ```
2. Install dependencies (if you haven't already):
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```

## Technologies Used
- React & Vite
- React Router (Client-Side Routing)
- Recharts (Data Visualization)
- Leaflet / React-Leaflet (Mapping)
- Tailwind CSS (Styling)

## Future Roadmap
- Integration with external APIs (like Strava) for importing telemetry data.
- Google Sign-In Authentication backend integration.
- Expanded Foil detection algorithms incorporating more granular rules.
