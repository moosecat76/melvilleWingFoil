
export const getWindRating = (speedKmh, direction, idealRange) => {
    // Default range if not provided or null
    const safeIdealRange = idealRange || { min: 135, max: 270 };

    if (speedKmh == null) return { label: 'N/A', rating: 0, color: 'var(--text-secondary)' };

    const isIdealDirection = direction >= safeIdealRange.min && direction <= safeIdealRange.max;

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

export const getGearRecommendation = (speedKmh, userGear = []) => {
    if (!speedKmh) return { text: "No wind data", sub: "" };
    const knots = speedKmh * 0.539957;

    let recText = "";
    let recSub = "";

    // 1. Generic Recommendation
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
    if (userGear && userGear.length > 0) {
        const wings = userGear.filter(g => g.type === 'wing').sort((a, b) => b.size - a.size);

        if (wings.length > 0) {
            let selectedWing = null;
            // idealSize ~ 75 / knots
            const idealSize = 75 / Math.max(knots, 5);

            selectedWing = wings.reduce((prev, curr) => {
                return (Math.abs(curr.size - idealSize) < Math.abs(prev.size - idealSize) ? curr : prev);
            });

            if (selectedWing) {
                recText = `Use your ${selectedWing.size}m ${selectedWing.model}`;
                recSub = `(Personalized for ${knots.toFixed(1)} kts)`;
            }
        }
    }

    return { text: recText, sub: recSub };
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

export const getBestTimeBlocks = (hourlyForecast, userGear = [], idealRange, dailyData = null) => {
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
                // Buffer: 30 mins after sunrise, 30 mins before sunset for safety? or just strict.
                // Let's go with strict sunrise-sunset for now.
                isDaylight = date >= sunrise && date <= sunset;
            } else {
                // Fallback if day not found in daily (unlikely)
                const hour = date.getHours();
                isDaylight = hour >= 6 && hour <= 19;
            }
        } else {
            // Fallback if no daily data passed
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
            // Continuous if within 1.1 hours (allow slightly flexible scheduling slots)
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

            // Average Rating value
            const avgRatingVal = block.reduce((sum, s) => sum + s.rating.rating, 0) / block.length;

            // Gear Rec based on avg speed
            const gearRec = getGearRecommendation(avgSpeed, userGear);

            // Overall rating label matches the average speed/direction
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

export const suggestBestSessions = (hourlyForecast, userGear = [], idealRange, dailyData = null) => {
    return getBestTimeBlocks(hourlyForecast, userGear, idealRange, dailyData);
};
