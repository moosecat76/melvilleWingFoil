/**
 * recommendationService.js
 *
 * Statistical Gear & Spot Recommendation Engine (Phase 4 / AI Coach Part 1).
 * Combines physics heuristics with a personalized "Sweet Spot" matrix trained
 * on the rider's logged sessions (ratings, % foil telemetry, note sentiment,
 * and gust-to-lull spread).
 */

/**
 * Determines whether a given wind direction falls inside an ideal sector,
 * correctly handling wrap-around northerly sectors (e.g. 315° to 45°).
 */
export const isDirectionInSector = (direction, min, max) => {
    if (direction == null || min == null || max == null) return false;
    const normDir = ((Number(direction) % 360) + 360) % 360;
    const normMin = ((Number(min) % 360) + 360) % 360;
    const normMax = ((Number(max) % 360) + 360) % 360;

    if (normMin <= normMax) {
        return normDir >= normMin && normDir <= normMax;
    }
    // Wrap around 360° (e.g. min: 315, max: 45)
    return normDir >= normMin || normDir <= normMax;
};

const _signedAngleDiff = (a, b) => {
    if (a == null || b == null || isNaN(a) || isNaN(b)) return 0;
    return ((Number(b) - Number(a) + 540) % 360) - 180;
};

/**
 * Extracts power state sentiment from session notes or saved AI coach tags.
 */
export const extractNoteSentiment = (entry) => {
    if (!entry) return { powerState: 'neutral', sentimentScore: 0.75, idealWindShiftKts: 0, label: null };

    // Use saved structured coachTags if present (Phase 5 compatibility)
    if (typeof entry === 'object' && entry.coachTags?.powerState) {
        const ps = entry.coachTags.powerState;
        if (ps === 'dialed') return { powerState: 'dialed', sentimentScore: 1.0, idealWindShiftKts: 0, label: 'Dialed' };
        if (ps === 'underpowered') return { powerState: 'underpowered', sentimentScore: 0.4, idealWindShiftKts: 2.5, label: 'Underpowered' };
        if (ps === 'overpowered' || ps === 'slightly_overpowered') {
            return { powerState: 'overpowered', sentimentScore: 0.45, idealWindShiftKts: -2.5, label: 'Overpowered' };
        }
    }

    const rawText = typeof entry === 'string' ? entry : (entry.notes || '');
    const notes = rawText.toLowerCase();
    if (!notes) return { powerState: 'neutral', sentimentScore: 0.75, idealWindShiftKts: 0, label: null };

    if (/overpowered|too much wind|too big|blown out|way too windy|wish.*smaller/.test(notes)) {
        return { powerState: 'overpowered', sentimentScore: 0.4, idealWindShiftKts: -2.5, label: 'Overpowered' };
    }
    if (/underpowered|too light|not enough wind|slog|slogging|pumping hard|wish.*bigger|wish.*larger|lull/.test(notes)) {
        return { powerState: 'underpowered', sentimentScore: 0.4, idealWindShiftKts: 2.5, label: 'Underpowered' };
    }
    if (/dialed|perfect|sweet spot|lit|awesome|great session|epic|flying|stoked/.test(notes)) {
        return { powerState: 'dialed', sentimentScore: 1.0, idealWindShiftKts: 0, label: 'Dialed' };
    }

    return { powerState: 'neutral', sentimentScore: 0.75, idealWindShiftKts: 0, label: null };
};

/**
 * Computes a weighted Session Quality Score (0–100) for a historical session:
 *   - 60% Star Rating (1–5)
 *   - 30% Telemetry % Time on Foil (or rating fallback if non-GPS session)
 *   - 10% Note Power Sentiment
 */
export const computeSessionQualityScore = (entry) => {
    if (!entry) return 50;
    const rating = Math.min(5, Math.max(1, Number(entry.rating) || 3));
    const ratingNorm = rating / 5; // 0.2 .. 1.0

    const pctFoilRaw = entry.foilAnalysis?.stats?.percentFoil ?? entry.computedAnalysis?.stats?.percentFoil;
    const hasFoilTelemetry = pctFoilRaw != null && !isNaN(parseFloat(pctFoilRaw)) && parseFloat(pctFoilRaw) > 0;
    // Normalize 55%+ time on foil as a 1.0 telemetry score
    const foilNorm = hasFoilTelemetry
        ? Math.min(1.0, Math.max(0.15, parseFloat(pctFoilRaw) / 55))
        : ratingNorm;

    const { sentimentScore } = extractNoteSentiment(entry);

    const score = (0.60 * ratingNorm + 0.30 * foilNorm + 0.10 * sentimentScore) * 100;
    return Math.round(score);
};

/**
 * Formats a quiver item into its canonical string representation used in `gearUsed`.
 */
export const formatGearLabel = (gearItem) => {
    if (!gearItem) return '';
    const unit = gearItem.type === 'board' ? 'L' : gearItem.type === 'foil' ? 'cm²' : 'm';
    return `${gearItem.size}${unit} ${gearItem.model || ''}`.trim();
};

/**
 * Builds a Personal "Sweet Spot" Matrix mapping each gear item to its historically
 * proven wind window and quality metrics.
 */
export const buildPersonalSweetSpotMatrix = (sessions = [], userGear = []) => {
    const matrix = new Map();

    // Initialize with user's quiver items
    for (const item of userGear) {
        const label = formatGearLabel(item);
        matrix.set(label.toLowerCase(), {
            gearItem: item,
            label,
            type: item.type || 'wing',
            size: Number(item.size) || 0,
            sessionsCount: 0,
            windSamples: [], // { windKts, gustKts, idealWindKts, weight, qualityScore }
            qualitySum: 0,
            ratingSum: 0,
            foilPctSum: 0,
            foilPctCount: 0,
        });
    }

    // Scan historical sessions
    for (const entry of sessions) {
        if (!entry || !entry.gearUsed || typeof entry.gearUsed !== 'string') continue;
        const windKts = parseFloat(entry.windSpeed);
        const gustKts = parseFloat(entry.windGusts) || windKts;
        const qualityScore = computeSessionQualityScore(entry);
        const { idealWindShiftKts } = extractNoteSentiment(entry);
        const pctFoil = parseFloat(entry.foilAnalysis?.stats?.percentFoil ?? entry.computedAnalysis?.stats?.percentFoil);

        const usedParts = entry.gearUsed.split(/[,+]/).map(s => s.trim()).filter(Boolean);

        for (const rawPart of usedParts) {
            const key = rawPart.toLowerCase();
            let record = matrix.get(key);

            // Also try fuzzy matching against userGear if exact string slightly differs
            if (!record) {
                for (const [, candidate] of matrix.entries()) {
                    if (
                        key.includes(candidate.label.toLowerCase()) ||
                        candidate.label.toLowerCase().includes(key)
                    ) {
                        record = candidate;
                        break;
                    }
                }
            }

            // If gear was logged in a session but isn't in userGear, infer type from unit
            if (!record) {
                let inferredType = 'wing';
                let inferredSize = parseFloat(rawPart) || 5;
                if (/cm²|cm2/i.test(rawPart) || inferredSize >= 400) inferredType = 'foil';
                else if (/\d+l\b/i.test(rawPart) || (inferredSize >= 35 && inferredSize < 200)) inferredType = 'board';

                record = {
                    gearItem: { id: key, type: inferredType, size: inferredSize, model: rawPart },
                    label: rawPart,
                    type: inferredType,
                    size: inferredSize,
                    sessionsCount: 0,
                    windSamples: [],
                    qualitySum: 0,
                    ratingSum: 0,
                    foilPctSum: 0,
                    foilPctCount: 0,
                };
                matrix.set(key, record);
            }

            record.sessionsCount += 1;
            record.qualitySum += qualityScore;
            record.ratingSum += (Number(entry.rating) || 3);
            if (!isNaN(pctFoil) && pctFoil > 0) {
                record.foilPctSum += pctFoil;
                record.foilPctCount += 1;
            }

            if (!isNaN(windKts) && windKts > 0) {
                // Shift perceived ideal wind if the rider noted they were under/overpowered
                const adjustedIdealKts = Math.max(5, windKts + idealWindShiftKts);
                const weight = Math.max(0.2, (qualityScore / 100) ** 2);
                record.windSamples.push({
                    windKts,
                    gustKts: !isNaN(gustKts) ? gustKts : windKts,
                    idealWindKts: adjustedIdealKts,
                    weight,
                    qualityScore,
                });
            }
        }
    }

    // Finalize sweet spot wind windows per gear item
    const results = [];
    for (const rec of matrix.values()) {
        let sweetSpotIdealKts = null;
        let sweetSpotMinKts = null;
        let sweetSpotMaxKts = null;

        if (rec.windSamples.length > 0) {
            let wSum = 0;
            let valSum = 0;
            const ktsList = [];
            for (const s of rec.windSamples) {
                wSum += s.weight;
                valSum += s.idealWindKts * s.weight;
                ktsList.push(s.idealWindKts);
            }
            sweetSpotIdealKts = Number((valSum / wSum).toFixed(1));
            ktsList.sort((a, b) => a - b);
            sweetSpotMinKts = Number(Math.max(5, Math.min(ktsList[0], sweetSpotIdealKts - 2.5)).toFixed(1));
            sweetSpotMaxKts = Number(Math.max(ktsList[ktsList.length - 1], sweetSpotIdealKts + 2.5).toFixed(1));
        }

        results.push({
            ...rec,
            avgQualityScore: rec.sessionsCount > 0 ? Math.round(rec.qualitySum / rec.sessionsCount) : null,
            avgRating: rec.sessionsCount > 0 ? Number((rec.ratingSum / rec.sessionsCount).toFixed(1)) : null,
            avgFoilPct: rec.foilPctCount > 0 ? Number((rec.foilPctSum / rec.foilPctCount).toFixed(1)) : null,
            sweetSpotIdealKts,
            sweetSpotMinKts,
            sweetSpotMaxKts,
        });
    }

    return results;
};

export const getWindRating = (speedKmh, direction, idealRange) => {
    const safeIdealRange = idealRange || { min: 135, max: 270 };

    if (speedKmh == null) return { label: 'N/A', rating: 0, color: 'var(--text-secondary)' };

    const isIdealDirection = isDirectionInSector(direction, safeIdealRange.min, safeIdealRange.max);

    if (speedKmh < 15) {
        return { label: 'Too Light', rating: 1, color: 'var(--text-secondary)' };
    }

    if (speedKmh < 28) {
        if (isIdealDirection) {
            return { label: 'Excellent', rating: 5, color: 'var(--status-success)' };
        }
        return { label: 'Good (Off-Axis)', rating: 3, color: 'var(--status-warning)' };
    }

    // Strong wind
    if (isIdealDirection) {
        return { label: 'Strong & Good', rating: 4, color: 'var(--status-success)' };
    }
    return { label: 'Strong (Gusty)', rating: 2, color: 'var(--status-warning)' };
};

/**
 * Recommends a complete Wing + Foil + Board setup (or generic recommendation if no quiver).
 * Supports both legacy signature `getGearRecommendation(speedKmh, userGear)` and
 * Phase 4 signature `getGearRecommendation(speedKmh, userGear, optionsOrSessions, gustsKmh)`.
 */
export const getGearRecommendation = (speedKmh, userGear = [], optionsOrSessions = null, maybeGustsKmh = null) => {
    if (!speedKmh) return { text: "No wind data", sub: "", setup: null, isDataDriven: false };

    let sessions = [];
    let gustsKmh = maybeGustsKmh;

    if (Array.isArray(optionsOrSessions)) {
        sessions = optionsOrSessions;
    } else if (optionsOrSessions && typeof optionsOrSessions === 'object') {
        sessions = optionsOrSessions.sessions || [];
        if (optionsOrSessions.gustsKmh != null) gustsKmh = optionsOrSessions.gustsKmh;
    }

    const knots = speedKmh * 0.539957;
    const gustKnots = gustsKmh != null ? gustsKmh * 0.539957 : knots;
    const gustSpreadKts = Math.max(0, gustKnots - knots);
    const isHighGustSpread = gustSpreadKts >= 7.5;

    // Gust-to-Lull Spread Adjustment (Phase 4.2):
    // When gust spread is high (>= 7.5 kts), size the wing toward the gusts (higher effective wind)
    // and size the foil slightly toward the lulls (lower effective wind for extra glide).
    const effectiveWingKnots = isHighGustSpread
        ? knots + (gustSpreadKts - 4) * 0.45
        : knots;
    const effectiveFoilKnots = isHighGustSpread
        ? Math.max(6, knots - (gustSpreadKts - 4) * 0.25)
        : knots;

    let recText = "";
    let recSub = "";

    // 1. Generic Baseline Recommendation
    if (effectiveWingKnots < 10) {
        recText = "Light Wind Gear";
        recSub = "Large Foil / 6m+ Wing or Surf";
    } else if (effectiveWingKnots < 15) {
        recText = "5m - 6m Wing";
        recSub = "Standard Foil";
    } else if (effectiveWingKnots < 22) {
        recText = "4m - 5m Wing";
        recSub = "Small-Med Foil";
    } else {
        recText = "3m - 4m Wing (Small)";
        recSub = "High Wind Foil!";
    }

    // 2. Personalize using User Quiver + Historical Sweet Spot Matrix
    const matrix = buildPersonalSweetSpotMatrix(sessions, userGear);
    const hasQuiver = (userGear && userGear.length > 0) || matrix.length > 0;

    if (!hasQuiver) {
        if (isHighGustSpread) {
            recSub += ` · Gusty (+${Math.round(gustSpreadKts)} kts spread)`;
        }
        return {
            text: recText,
            sub: recSub,
            setup: null,
            isDataDriven: false,
            gustSpreadKts: Number(gustSpreadKts.toFixed(1)),
            gustAdvice: isHighGustSpread ? `Gusty (+${Math.round(gustSpreadKts)} kts): size wing for gusts, foil for lulls` : null
        };
    }

    const wings = matrix.filter(m => (m.type || 'wing') === 'wing' && m.size > 0);
    const foils = matrix.filter(m => m.type === 'foil' && m.size > 0);
    const boards = matrix.filter(m => m.type === 'board' && m.size > 0);

    let selectedWing = null;
    let wingDataDriven = false;

    if (wings.length > 0) {
        // Physics heuristic target size: ~75 / effectiveWingKnots
        const heuristicWingSize = 75 / Math.max(effectiveWingKnots, 5);

        let bestWingScore = -Infinity;
        for (const w of wings) {
            // Physics score (0..100 based on size distance)
            const sizeDiff = Math.abs(w.size - heuristicWingSize);
            const physicsScore = Math.max(0, 100 - sizeDiff * 28);

            if (w.sessionsCount >= 2 && w.sweetSpotIdealKts != null) {
                const ktsDiff = Math.abs(effectiveWingKnots - w.sweetSpotIdealKts);
                const proximityScore = Math.max(0, 100 - ktsDiff * 11);
                const histScore = 0.65 * proximityScore + 0.35 * (w.avgQualityScore || 75);
                // Blend 75% personal history + 25% physics
                const combined = 0.75 * histScore + 0.25 * physicsScore;
                if (combined > bestWingScore) {
                    bestWingScore = combined;
                    selectedWing = w;
                    wingDataDriven = true;
                }
            } else {
                // Slight discount for unproven gear when comparing against proven sweet-spot gear
                const heuristicOnlyScore = physicsScore * 0.85;
                if (heuristicOnlyScore > bestWingScore) {
                    bestWingScore = heuristicOnlyScore;
                    selectedWing = w;
                    wingDataDriven = false;
                }
            }
        }
    }

    let selectedFoil = null;
    let foilDataDriven = false;

    if (foils.length > 0) {
        // Physics heuristic target area (cm²): e.g. 12 kts -> ~1350 cm², 20 kts -> ~950 cm²
        const heuristicFoilArea = Math.min(1650, Math.max(650, 1850 - effectiveFoilKnots * 42));

        let bestFoilScore = -Infinity;
        for (const f of foils) {
            const areaDiff = Math.abs(f.size - heuristicFoilArea);
            const physicsScore = Math.max(0, 100 - (areaDiff / 12));

            if (f.sessionsCount >= 2 && f.sweetSpotIdealKts != null) {
                const ktsDiff = Math.abs(effectiveFoilKnots - f.sweetSpotIdealKts);
                const proximityScore = Math.max(0, 100 - ktsDiff * 11);
                const histScore = 0.65 * proximityScore + 0.35 * (f.avgQualityScore || 75);
                const combined = 0.75 * histScore + 0.25 * physicsScore;
                if (combined > bestFoilScore) {
                    bestFoilScore = combined;
                    selectedFoil = f;
                    foilDataDriven = true;
                }
            } else {
                const heuristicOnlyScore = physicsScore * 0.85;
                if (heuristicOnlyScore > bestFoilScore) {
                    bestFoilScore = heuristicOnlyScore;
                    selectedFoil = f;
                    foilDataDriven = false;
                }
            }
        }
    }

    let selectedBoard = null;
    if (boards.length > 0) {
        selectedBoard = [...boards].sort((a, b) => (b.avgQualityScore || 0) - (a.avgQualityScore || 0) || b.sessionsCount - a.sessionsCount)[0];
    }

    const isDataDriven = wingDataDriven || foilDataDriven;

    if (selectedWing) {
        if (selectedFoil) {
            recText = `${selectedWing.label} + ${selectedFoil.label}`;
        } else {
            recText = `Use your ${selectedWing.label}`;
        }

        const subParts = [];
        if (selectedBoard) {
            subParts.push(`Board: ${selectedBoard.label}`);
        }
        if (isDataDriven) {
            const count = (selectedWing?.sessionsCount || 0) + (selectedFoil?.sessionsCount || 0);
            subParts.push(`Sweet-spot matched (${count} sessions)`);
        } else {
            subParts.push(`Personalized for ${knots.toFixed(1)} kts`);
        }
        if (isHighGustSpread) {
            subParts.push(`Gust-adjusted (+${Math.round(gustSpreadKts)} kts spread)`);
        }
        recSub = `(${subParts.join(' · ')})`;
    }

    return {
        text: recText,
        sub: recSub,
        setup: {
            wing: selectedWing?.gearItem || null,
            foil: selectedFoil?.gearItem || null,
            board: selectedBoard?.gearItem || null,
        },
        isDataDriven,
        gustSpreadKts: Number(gustSpreadKts.toFixed(1)),
        gustAdvice: isHighGustSpread
            ? `High gust spread (+${Math.round(gustSpreadKts)} kts): sized wing for ${Math.round(gustKnots)} kts gusts & foil to glide through ${Math.round(knots)} kts lulls.`
            : null,
    };
};

/**
 * Analyzes historical session ratings and % Foil by wind direction for a given spot
 * to identify the rider's best-performing 25° wind corridor.
 */
export const analyzeSpotWindProfile = (sessions = [], locationId = null) => {
    if (!sessions || sessions.length === 0) return null;

    // Filter to spot if >= 2 sessions exist at that spot, otherwise use all sessions
    const spotSessions = locationId
        ? sessions.filter(s => s.locationId === locationId && s.windDirection != null && s.windDirection !== '')
        : [];
    const pool = spotSessions.length >= 2
        ? spotSessions
        : sessions.filter(s => s.windDirection != null && s.windDirection !== '');

    if (pool.length < 2) return null;

    // Evaluate 25° sliding windows every 10°
    let bestCenter = null;
    let bestScore = -1;
    let bestMatches = [];

    for (let center = 0; center < 360; center += 10) {
        const matches = pool.filter(s => Math.abs(_signedAngleDiff(center, Number(s.windDirection))) <= 15);
        if (matches.length < 2) continue;

        const avgQuality = matches.reduce((sum, s) => sum + computeSessionQualityScore(s), 0) / matches.length;
        // Slight bonus for sample size
        const weighted = avgQuality + Math.min(8, matches.length * 1.5);
        if (weighted > bestScore) {
            bestScore = weighted;
            bestCenter = center;
            bestMatches = matches;
        }
    }

    if (bestCenter === null || bestMatches.length === 0) return null;

    const minDeg = (bestCenter - 15 + 360) % 360;
    const maxDeg = (bestCenter + 15) % 360;
    const avgRating = Number((bestMatches.reduce((sum, s) => sum + (Number(s.rating) || 4), 0) / bestMatches.length).toFixed(1));

    const foilSamples = bestMatches
        .map(s => parseFloat(s.foilAnalysis?.stats?.percentFoil))
        .filter(v => !isNaN(v) && v > 0);
    const avgFoilPct = foilSamples.length > 0
        ? Math.round(foilSamples.reduce((a, b) => a + b, 0) / foilSamples.length)
        : null;

    return {
        corridorMin: minDeg,
        corridorMax: maxDeg,
        centerDeg: bestCenter,
        corridorLabel: `${minDeg}°–${maxDeg}°`,
        sessionCount: bestMatches.length,
        avgRating,
        avgFoilPct,
    };
};

/**
 * Finds the top N past sessions most similar to a target wind condition
 * (upcoming BestTime window or current live wind).
 */
export const findSimilarPastSessions = (targetCondition, sessions = [], locationId = null, limit = 2) => {
    if (!targetCondition || !targetCondition.speedKmh || !Array.isArray(sessions) || sessions.length === 0) {
        return [];
    }

    const targetKts = targetCondition.speedKmh * 0.539957;
    const targetGustKts = targetCondition.gustsKmh ? targetCondition.gustsKmh * 0.539957 : targetKts;
    const targetSpread = Math.max(0, targetGustKts - targetKts);
    const targetDir = targetCondition.direction != null ? Number(targetCondition.direction) : null;

    const scored = [];

    for (const entry of sessions) {
        const entryKts = parseFloat(entry.windSpeed);
        if (isNaN(entryKts) || entryKts <= 0) continue;

        const windDiff = Math.abs(entryKts - targetKts);
        // Must be within ±6 kts to be considered relevant
        if (windDiff > 6.5) continue;

        const entryGustKts = parseFloat(entry.windGusts) || entryKts;
        const entrySpread = Math.max(0, entryGustKts - entryKts);
        const spreadDiff = Math.abs(entrySpread - targetSpread);

        let dirPenalty = 0;
        if (targetDir != null && entry.windDirection != null && entry.windDirection !== '') {
            const angleDiff = Math.abs(_signedAngleDiff(targetDir, Number(entry.windDirection)));
            dirPenalty = Math.min(20, angleDiff / 6);
        }

        const sameSpotBonus = (locationId && entry.locationId === locationId) ? 10 : 0;
        const rawSimilarity = Math.max(10, Math.min(99, Math.round(100 - windDiff * 11 - spreadDiff * 2.5 - dirPenalty + sameSpotBonus)));
        const sentiment = extractNoteSentiment(entry);

        scored.push({
            entry,
            windKts: entryKts,
            gustKts: entryGustKts,
            windDiffKts: Number((entryKts - targetKts).toFixed(1)),
            similarityScore: rawSimilarity,
            qualityScore: computeSessionQualityScore(entry),
            powerLabel: sentiment.label,
        });
    }

    return scored
        .sort((a, b) => b.similarityScore - a.similarityScore || b.qualityScore - a.qualityScore)
        .slice(0, limit);
};

// Helper to average angles correctly
const averageAngles = (angles) => {
    if (!angles || angles.length === 0) return 0;
    const sum = angles.reduce((acc, a) => {
        const rad = a * Math.PI / 180;
        return { sin: acc.sin + Math.sin(rad), cos: acc.cos + Math.cos(rad) };
    }, { sin: 0, cos: 0 });
    return (Math.atan2(sum.sin / angles.length, sum.cos / angles.length) * 180 / Math.PI + 360) % 360;
};

export const getBestTimeBlocks = (hourlyForecast, userGear = [], idealRange, dailyData = null, sessions = []) => {
    if (!hourlyForecast || !Array.isArray(hourlyForecast) || hourlyForecast.length === 0) return [];

    // 1. Get Scored Candidates
    const candidates = hourlyForecast.filter(slot => {
        if (!slot || !slot.time) return false;
        const date = new Date(slot.time);
        const now = new Date();
        if (date <= now) return false;

        // Daylight Check
        let isDaylight = false;

        if (dailyData && dailyData.time && dailyData.sunrise && dailyData.sunset) {
            const dateStr = date.toISOString().split('T')[0];
            const dayIndex = dailyData.time.findIndex(t => t === dateStr);

            if (dayIndex !== -1) {
                const sunrise = new Date(dailyData.sunrise[dayIndex]);
                const sunset = new Date(dailyData.sunset[dayIndex]);
                isDaylight = date >= sunrise && date <= sunset;
            } else {
                const hour = date.getHours();
                isDaylight = hour >= 6 && hour <= 19;
            }
        } else {
            const hour = date.getHours();
            isDaylight = hour >= 6 && hour <= 19;
        }

        return isDaylight;
    }).map(slot => {
        const rating = getWindRating(slot.speed, slot.direction, idealRange);
        return { ...slot, rating };
    });

    // 2. Group into Blocks
    const blocks = [];
    let currentBlock = [];

    candidates.forEach((slot) => {
        if (!slot.rating) return;
        const isGood = slot.rating.rating >= 3;

        if (isGood) {
            const prev = currentBlock.length > 0 ? currentBlock[currentBlock.length - 1] : null;
            const isContinuous = prev && (new Date(slot.time) - new Date(prev.time) <= 4000000);

            if (currentBlock.length === 0 || isContinuous) {
                currentBlock.push(slot);
            } else {
                blocks.push(currentBlock);
                currentBlock = [slot];
            }
        } else {
            if (currentBlock.length > 0) {
                blocks.push(currentBlock);
                currentBlock = [];
            }
        }
    });
    if (currentBlock.length > 0) blocks.push(currentBlock);

    // 3. Aggregate Block Data
    return blocks
        .filter(block => block.length > 0)
        .map(block => {
            const avgSpeed = block.reduce((sum, s) => sum + (s.speed || 0), 0) / block.length;
            const avgGusts = block.reduce((sum, s) => sum + (s.gusts || 0), 0) / block.length;
            const maxGusts = Math.max(...block.map(s => s.gusts || 0));
            const avgDirection = averageAngles(block.map(s => s.direction || 0));

            const gearRec = getGearRecommendation(avgSpeed, userGear, {
                sessions,
                gustsKmh: avgGusts,
                windDirection: avgDirection
            });

            const overallRating = getWindRating(avgSpeed, avgDirection, idealRange);

            return {
                start: block[0].time,
                end: new Date(new Date(block[block.length - 1].time).getTime() + 3600000).toISOString(),
                durationHours: block.length,
                avgSpeed,
                avgGusts,
                maxGusts,
                avgDirection,
                rating: overallRating,
                gear: gearRec,
                hourlyData: block
            };
        })
        .sort((a, b) => b.rating.rating - a.rating.rating || a.start - b.start);
};

export const suggestBestSessions = (hourlyForecast, userGear = [], idealRange, dailyData = null, sessions = []) => {
    return getBestTimeBlocks(hourlyForecast, userGear, idealRange, dailyData, sessions);
};
