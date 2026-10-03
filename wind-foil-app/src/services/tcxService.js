/**
 * tcxService.js
 *
 * Parses TCX (Training Center XML) and GPX files exported from
 * Google Fit / Google Health and converts them into the data format
 * consumed by SessionMap, FoilAnalysisChart, and foilAnalysisService.
 *
 * No API keys. No network calls. Pure client-side JS.
 */

// ─── Haversine distance (metres) ─────────────────────────────────────────────
const haversineM = (lat1, lng1, lat2, lng2) => {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─── Google Polyline encoder ──────────────────────────────────────────────────
const _encodeNum = (num) => {
    let n = num < 0 ? ~(num << 1) : (num << 1);
    let result = '';
    while (n >= 0x20) {
        result += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
        n >>= 5;
    }
    result += String.fromCharCode(n + 63);
    return result;
};

export const encodePolyline = (latLngPairs) => {
    if (!latLngPairs || !Array.isArray(latLngPairs)) return '';
    let result = '';
    let prevLat = 0;
    let prevLng = 0;
    for (const pt of latLngPairs) {
        if (!pt) continue;
        const lat = Array.isArray(pt) ? pt[0] : (pt.lat ?? pt.latitude);
        const lng = Array.isArray(pt) ? pt[1] : (pt.lng ?? pt.longitude);
        if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) continue;
        const dLat = Math.round((lat - prevLat) * 1e5);
        const dLng = Math.round((lng - prevLng) * 1e5);
        result += _encodeNum(dLat) + _encodeNum(dLng);
        prevLat = lat;
        prevLng = lng;
    }
    return result;
};

// ─── Google Polyline decoder ──────────────────────────────────────────────────
export const decodePolyline = (str, precision = 5) => {
    if (!str || typeof str !== 'string') return [];
    let index = 0,
        lat = 0,
        lng = 0,
        coordinates = [],
        shift = 0,
        result = 0,
        byte = null,
        latitude_change,
        longitude_change,
        factor = Math.pow(10, precision || 5);

    while (index < str.length) {
        byte = null;
        shift = 0;
        result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        shift = result = 0;
        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += latitude_change;
        lng += longitude_change;
        coordinates.push([lat / factor, lng / factor]);
    }
    return coordinates;
};

// ─── 5-point moving-average speed smoother ────────────────────────────────────
const smoothSpeeds = (speeds, windowSize = 5) => {
    const half = Math.floor(windowSize / 2);
    return speeds.map((_, i) => {
        const start = Math.max(0, i - half);
        const end = Math.min(speeds.length, i + half + 1);
        const slice = speeds.slice(start, end);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
};

// ─── Build streams + stats from raw parsed trackpoints ────────────────────────
const buildResult = (rawPoints) => {
    if (!rawPoints || rawPoints.length < 2) {
        throw new Error('File has fewer than 2 valid time data points.');
    }

    const hasGps = rawPoints.some(p => !isNaN(p.lat) && !isNaN(p.lng));

    // Recalculate cumulative distance if GPS is present but distance is all zeros
    if (hasGps && rawPoints.every(p => p.distanceM === 0)) {
        let cum = 0;
        for (let i = 1; i < rawPoints.length; i++) {
            if (!isNaN(rawPoints[i - 1].lat) && !isNaN(rawPoints[i].lat)) {
                cum += haversineM(rawPoints[i - 1].lat, rawPoints[i - 1].lng, rawPoints[i].lat, rawPoints[i].lng);
            }
            rawPoints[i].distanceM = cum;
        }
    }

    const startMs = rawPoints[0].timeMs;
    const timeData = [];
    const latlngData = [];
    const altData = [];
    const distData = [];
    const heartData = [];
    const rawSpeeds = [];

    for (let i = 0; i < rawPoints.length; i++) {
        const p = rawPoints[i];
        timeData.push((p.timeMs - startMs) / 1000);
        if (hasGps && !isNaN(p.lat) && !isNaN(p.lng)) {
            latlngData.push([p.lat, p.lng]);
        }
        altData.push(p.altitudeM || 0);
        distData.push(p.distanceM || 0);
        heartData.push(p.heartRate || 0);

        if (hasGps) {
            if (i === 0) {
                rawSpeeds.push(0);
            } else {
                const prev = rawPoints[i - 1];
                const dt = (p.timeMs - prev.timeMs) / 1000;
                if (dt > 0 && !isNaN(prev.lat) && !isNaN(p.lat)) {
                    rawSpeeds.push(haversineM(prev.lat, prev.lng, p.lat, p.lng) / dt);
                } else {
                    rawSpeeds.push(rawSpeeds[i - 1] || 0);
                }
            }
        }
    }

    const smoothedSpeeds = hasGps ? smoothSpeeds(rawSpeeds, 5) : [];

    const streams = {
        time:            { data: timeData },
        latlng:          { data: latlngData },
        altitude:        { data: altData },
        distance:        { data: distData },
        velocity_smooth: { data: smoothedSpeeds },
        heartrate:       { data: heartData },
    };

    const durationMs = rawPoints[rawPoints.length - 1].timeMs - startMs;
    const hrs = heartData.filter(h => h > 0);

    let activityStats;
    let mapPolyline = null;

    if (hasGps && latlngData.length > 1) {
        const maxSpeedMs = Math.max(...smoothedSpeeds);
        const movingVels = smoothedSpeeds.filter(v => v > 0.3);
        const avgSpeedMs = movingVels.length > 0
            ? movingVels.reduce((a, b) => a + b, 0) / movingVels.length
            : 0;
        const totalDistM = rawPoints[rawPoints.length - 1].distanceM || 0;

        activityStats = {
            topSpeed:     (maxSpeedMs * 1.94384).toFixed(1),
            avgSpeed:     (avgSpeedMs * 1.94384).toFixed(1),
            distance:     (totalDistM / 1000).toFixed(2),
            duration:     (durationMs / 60000).toFixed(1),
            startTime:    new Date(startMs),
            heartRateAvg: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
            heartRateMax: hrs.length > 0 ? Math.max(...hrs) : null,
            hasGps:       true,
        };
        mapPolyline = encodePolyline(latlngData);
    } else {
        activityStats = {
            topSpeed:     null,
            avgSpeed:     null,
            distance:     null,
            duration:     (durationMs / 60000).toFixed(1),
            startTime:    new Date(startMs),
            heartRateAvg: hrs.length > 0 ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
            heartRateMax: hrs.length > 0 ? Math.max(...hrs) : null,
            hasGps:       false,
        };
    }

    return { streams, activityStats, mapPolyline };
};

// ─── TCX parser ───────────────────────────────────────────────────────────────
export const parseTcxFile = (xmlText) => {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) {
        throw new Error('Invalid TCX/XML file.');
    }

    const trackpoints = doc.querySelectorAll('Trackpoint');
    if (trackpoints.length === 0) throw new Error('No Trackpoints found in file.');

    const rawPoints = [];
    trackpoints.forEach(tp => {
        const lat  = parseFloat(tp.querySelector('LatitudeDegrees')?.textContent);
        const lng  = parseFloat(tp.querySelector('LongitudeDegrees')?.textContent);
        const time = tp.querySelector('Time')?.textContent;
        const alt  = parseFloat(tp.querySelector('AltitudeMeters')?.textContent) || 0;
        const dist = parseFloat(tp.querySelector('DistanceMeters')?.textContent) || 0;
        // Heart rate: <HeartRateBpm><Value>NNN</Value></HeartRateBpm>
        const hrValue = tp.querySelector('HeartRateBpm Value') || tp.querySelector('HeartRateBpm > Value');
        const hr = hrValue ? parseInt(hrValue.textContent) : 0;

        if (time) {
            const ms = new Date(time).getTime();
            if (!isNaN(ms)) {
                rawPoints.push({ lat, lng, timeMs: ms, altitudeM: alt, distanceM: dist, heartRate: hr });
            }
        }
    });

    return buildResult(rawPoints);
};

// ─── GPX parser ───────────────────────────────────────────────────────────────
export const parseGpxFile = (xmlText) => {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) {
        throw new Error('Invalid GPX/XML file.');
    }

    const trkpts = doc.querySelectorAll('trkpt');
    if (trkpts.length === 0) throw new Error('No track points found in GPX file.');

    const rawPoints = [];
    let cumDist = 0;
    trkpts.forEach((pt, i) => {
        const lat  = parseFloat(pt.getAttribute('lat'));
        const lng  = parseFloat(pt.getAttribute('lon'));
        const time = pt.querySelector('time')?.textContent;
        const alt  = parseFloat(pt.querySelector('ele')?.textContent) || 0;
        // GPX heart rate extension varies by device — try common namespaced selectors
        const hrEl = pt.querySelector('hr') || pt.querySelector('gpxdata\\:hr') ||
                     pt.querySelector('gpxtpx\\:hr') || pt.querySelector('ns3\\:hr');
        const hr = hrEl ? parseInt(hrEl.textContent) : 0;

        if (time) {
            const ms = new Date(time).getTime();
            if (!isNaN(ms)) {
                if (i > 0 && rawPoints.length > 0) {
                    const prev = rawPoints[rawPoints.length - 1];
                    if (!isNaN(prev.lat) && !isNaN(lat)) {
                        cumDist += haversineM(prev.lat, prev.lng, lat, lng);
                    }
                }
                rawPoints.push({ lat, lng, timeMs: ms, altitudeM: alt, distanceM: cumDist, heartRate: hr });
            }
        }
    });

    return buildResult(rawPoints);
};

// ─── Auto-detect format and parse ─────────────────────────────────────────────
export const parseGpsFile = async (file) => {
    const text = await file.text();
    const name = file.name.toLowerCase();

    if (name.endsWith('.gpx')) return parseGpxFile(text);
    if (name.endsWith('.tcx')) return parseTcxFile(text);

    // Content-sniff fallback
    if (text.includes('<Trackpoint') || text.includes('<TrainingCenterDatabase')) return parseTcxFile(text);
    if (text.includes('<trkpt') || text.includes('<gpx')) return parseGpxFile(text);

    throw new Error('Unsupported file format. Please use a .tcx or .gpx file exported from Google Fit / Google Health.');
};
