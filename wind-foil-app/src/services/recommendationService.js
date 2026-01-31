
export const getWindRating = (speedKmh, direction, idealRange = { min: 135, max: 270 }) => {
    if (speedKmh == null) return { label: 'N/A', rating: 0, color: 'var(--text-secondary)' };

    const isIdealDirection = direction >= idealRange.min && direction <= idealRange.max;

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

export const suggestBestSessions = (hourlyForecast, userGear = [], idealRange) => {
    if (!hourlyForecast || hourlyForecast.length === 0) return [];

    // Filter next 24-48 hours
    const candidates = hourlyForecast.filter(slot => {
        const date = new Date(slot.time);
        const now = new Date();
        const hour = date.getHours();
        // Only daylight hours (roughly 6am to 6pm for simplicity, or use sun data if available)
        // Only future
        return date > now && hour >= 6 && hour <= 18;
    });

    const scored = candidates.map(slot => {
        const rating = getWindRating(slot.speed, slot.direction, idealRange);
        return {
            ...slot,
            rating,
            gear: getGearRecommendation(slot.speed, userGear)
        };
    });

    // Return only ones with decent rating, sorted by stats
    return scored
        .filter(s => s.rating.rating >= 3)
        .sort((a, b) => b.rating.rating - a.rating.rating); // Best first
};
