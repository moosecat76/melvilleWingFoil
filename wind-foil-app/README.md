# Wind Foil App

A React-based web application for Wing Foiling enthusiasts at Melville Waters (and beyond!).

## Overview
This application serves as a comprehensive tool for wind foilers, combining live weather forecasting, session tracking, and advanced telemetry analysis. The application features a robust multi-page architecture, cloud synchronization via Firebase, and direct integration with Strava for telemetry processing.

## Core Features
1. **7-Day Wind Forecast 🌬️**
   - Live BOM (Bureau of Meteorology) weather feeds with Open-Meteo fallback.
   - Interactive chart displaying wind speed, gusts, and direction tailored to your favorite locations.
2. **Session Journal & Cloud Sync 📓**
   - Record and list your past sessions, including notes, gear used, and ratings.
   - **Google Authentication**: Sign in to securely sync your sessions and gear quiver across all your devices via Firebase Firestore.
   - **Offline Support**: Using the app without an account will safely store your runs in `localStorage` until you are ready to migrate to the cloud.
3. **Strava Integration 🚴‍♂️**
   - Directly connect your Strava account.
   - Ingest GPS tracks and telemetry to automatically detect and calculate "Time on Foil", flight count, and persistency rules.
4. **Session Maps & Speed Visualizations 🗺️**
   - A detailed map view for each session with color-coded paths corresponding to specific speed buckets: Stopped (<2), Crawl (2-3), Planing (3-4), Foiling (4-5), and Cranking (>5).
5. **Gear and Spot Management ⚙️**
   - Manage a dynamic "Gear Quiver" saved to your user profile.
   - Seamlessly switch between different global foiling locations (affecting weather forecasts and tide estimations).

## Architecture & Services Used
The application relies on the following major services:
- **Frontend Framework**: React 18 & Vite
- **Routing**: React Router (Client-Side, Multi-page)
- **Database / Backend**: Google Firebase Firestore
- **Authentication**: Firebase Auth (Google Provider)
- **Mapping**: Leaflet / React-Leaflet
- **Data Visualization**: Recharts
- **Weather API**: BOM JSON feeds (Primary) & Open-Meteo API (Fallback)
- **Telemetry API**: Strava OAuth2 & Athlete Activities API

## Getting Started

### Prerequisites
Make sure you have Node.js and npm installed. Check that you have configured your environment variables.

1. Navigate to the `wind-foil-app` directory:
   ```bash
   cd wind-foil-app
   ```
2. Clone the `.env.example.txt` to `.env` and fill in your Firebase and Strava Keys.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```

## Debugging

If you are developing locally, the app will automatically display a **Debug Overlay** in the bottom-left corner. This panel will tell you:
- Your App Version.
- Your Environment Mode.
- Your Authentication Status (Logged out vs your User ID).
- The state of your Database Connection (Firestore Link Check).

*Note: You can force the Debug Overlay to appear in production by appending `?debug=true` to any URL.*

### Cloud Restore
If you have an exported backup from `localStorage` (`wind-foil-backup.json`), you can restore it directly to the cloud. Make sure you are Signed In with Google, go to the bottom of the Forecast Page, and click **Import Data**. This will directly merge the JSON file into your active Firestore database collection.

## Future Roadmap
- Expanded Foil detection algorithms incorporating more granular rules.
- Public sharing of specific sessions (Read-Only URLs).
