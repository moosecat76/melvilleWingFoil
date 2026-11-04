/**
 * quiverService.js — Canonical gear normalisation, deduplication, and rationalisation.
 *
 * Rationalises variations, formatting differences (e.g. 5.0m vs 5m), and typos
 * (e.g. Cabrihna/Cabrhina -> Cabrinha) without losing historical session telemetry.
 */

const BRAND_DICTIONARY = {
    'cabrihna': 'Cabrinha',
    'cabrhina': 'Cabrinha',
    'cabrinh': 'Cabrinha',
    'cabrina': 'Cabrinha',
    'cabrinha': 'Cabrinha',
    'neil pryde': 'Neil Pryde',
    'neilpryde': 'Neil Pryde',
    'neil-pryde': 'Neil Pryde',
    'pryde': 'Neil Pryde',
    'smik': 'Smik',
    'naish': 'Naish',
    'duotone': 'Duotone',
    'doutone': 'Duotone',
    'armstrong': 'Armstrong',
    'f-one': 'F-One',
    'fone': 'F-One',
    'fanatic': 'Fanatic',
    'starboard': 'Starboard',
    'ozone': 'Ozone',
    'north': 'North',
    'slingshot': 'Slingshot',
    'reedin': 'Reedin',
    'gong': 'Gong',
    'sabfoil': 'Sabfoil',
    'moses': 'Sabfoil',
    'axis': 'Axis',
    'kt': 'KT',
    'severne': 'Severne',
    'gofoil': 'GoFoil',
    'ensign': 'Ensign',
    'ensigns': 'Ensign',
};

/**
 * Normalises brand/model spelling and casing.
 */
export const normalizeBrandName = (rawModel) => {
    if (!rawModel || typeof rawModel !== 'string') return '';
    const trimmed = rawModel.trim();
    const lower = trimmed.toLowerCase();

    // Check exact match in dictionary
    if (BRAND_DICTIONARY[lower]) {
        return BRAND_DICTIONARY[lower];
    }

    // Check if starts with a known brand prefix (e.g. "Cabrihna Mantis" -> "Cabrinha Mantis")
    for (const [key, correct] of Object.entries(BRAND_DICTIONARY)) {
        if (lower.startsWith(key + ' ') || lower.startsWith(key + '-')) {
            const rest = trimmed.slice(key.length).trim();
            return `${correct} ${rest}`.trim();
        }
    }

    // Title-case fallback
    return trimmed
        .split(/\s+/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
};

/**
 * Normalises gear size: removes superfluous trailing zeros (e.g. 5.0 -> 5, 6.00 -> 6),
 * while preserving valid decimals (e.g. 4.5, 3.5).
 */
export const normalizeSize = (size) => {
    if (size == null || size === '') return '';
    const num = parseFloat(size);
    if (isNaN(num)) return String(size).trim();
    return num % 1 === 0 ? String(Math.round(num)) : String(num);
};

/**
 * Formats a gear item into its canonical string representation (e.g. "5m Cabrinha", "100L Smik", "1850cm² Neil Pryde").
 */
export const formatGearLabel = (gearItem) => {
    if (!gearItem) return '';
    const size = normalizeSize(gearItem.size);
    const type = gearItem.type || 'wing';
    const unit = type === 'board' ? 'L' : type === 'foil' ? 'cm²' : 'm';
    const model = normalizeBrandName(gearItem.model || '');
    return `${size}${unit} ${model}`.trim();
};

/**
 * Parses an arbitrary gear string into structured attributes { type, size, unit, model }.
 */
export const parseGearString = (rawStr) => {
    if (!rawStr || typeof rawStr !== 'string') return null;
    const clean = rawStr.trim();
    if (!clean) return null;

    // Pattern 1: Size at the start, e.g. "5.0m Cabrihna", "1850cm² Neil Pryde", "100L Smik"
    const matchPrefix = clean.match(/^(\d+(?:\.\d+)?)\s*(cm²|cm2|m²|m2|m|l|ltr)?\s*(.*)$/i);
    if (matchPrefix) {
        const rawSize = matchPrefix[1];
        const rawUnit = (matchPrefix[2] || '').toLowerCase();
        const rawModel = matchPrefix[3] || '';

        const size = normalizeSize(rawSize);
        const sizeNum = parseFloat(size);

        let type = 'wing';
        let unit = 'm';

        if (/cm²|cm2/i.test(rawUnit) || (!rawUnit && sizeNum >= 400)) {
            type = 'foil';
            unit = 'cm²';
        } else if (/l|ltr/i.test(rawUnit) || (!rawUnit && sizeNum >= 30 && sizeNum < 400)) {
            type = 'board';
            unit = 'L';
        } else {
            type = 'wing';
            unit = 'm';
        }

        return {
            type,
            size,
            unit,
            model: normalizeBrandName(rawModel),
            raw: clean,
        };
    }

    // Pattern 2: Model at start, size at end, e.g. "Neil Pryde 1850cm²", "Cabrinha 5m"
    const matchSuffix = clean.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*(cm²|cm2|m²|m2|m|l|ltr)?$/i);
    if (matchSuffix) {
        const rawModel = matchSuffix[1];
        const rawSize = matchSuffix[2];
        const rawUnit = (matchSuffix[3] || '').toLowerCase();

        const size = normalizeSize(rawSize);
        const sizeNum = parseFloat(size);

        let type = 'wing';
        let unit = 'm';

        if (/cm²|cm2/i.test(rawUnit) || (!rawUnit && sizeNum >= 400)) {
            type = 'foil';
            unit = 'cm²';
        } else if (/l|ltr/i.test(rawUnit) || (!rawUnit && sizeNum >= 30 && sizeNum < 400)) {
            type = 'board';
            unit = 'L';
        } else {
            type = 'wing';
            unit = 'm';
        }

        return {
            type,
            size,
            unit,
            model: normalizeBrandName(rawModel),
            raw: clean,
        };
    }

    // Fallback: unparseable raw string
    return {
        type: 'wing',
        size: '',
        unit: '',
        model: normalizeBrandName(clean),
        raw: clean,
    };
};

/**
 * Normalises a single gear name token to its canonical display string.
 * Optionally resolves against the user's defined quiver.
 */
export const normalizeSingleGearName = (rawStr, userGear = []) => {
    if (!rawStr || typeof rawStr !== 'string') return '';
    const parsed = parseGearString(rawStr);
    if (!parsed) return rawStr.trim();

    // If user has defined gear, look for a matching item
    if (Array.isArray(userGear) && userGear.length > 0) {
        for (const item of userGear) {
            const itemSize = normalizeSize(item.size);
            const itemModelNorm = normalizeBrandName(item.model || '').toLowerCase();
            const parsedModelNorm = parsed.model.toLowerCase();

            // Match if size matches and (types match or models match)
            if (itemSize === parsed.size) {
                const itemType = item.type || (parseFloat(itemSize) >= 400 ? 'foil' : parseFloat(itemSize) >= 30 ? 'board' : 'wing');
                if (itemType === parsed.type && (itemModelNorm.includes(parsedModelNorm) || parsedModelNorm.includes(itemModelNorm))) {
                    return formatGearLabel(item);
                }
            }
        }
    }

    if (!parsed.size && !parsed.unit) {
        return parsed.model;
    }

    return `${parsed.size}${parsed.unit} ${parsed.model}`.trim();
};

/**
 * Normalises a session's `gearUsed` string (which may contain multiple comma-separated gear items).
 */
export const normalizeGearUsed = (gearUsedStr, userGear = []) => {
    if (!gearUsedStr || typeof gearUsedStr !== 'string') return '';
    const parts = gearUsedStr.split(/[,+]/).map(s => s.trim()).filter(Boolean);
    const seen = new Set();
    const normalizedParts = [];

    for (const part of parts) {
        const canonical = normalizeSingleGearName(part, userGear);
        if (canonical && !seen.has(canonical.toLowerCase())) {
            seen.add(canonical.toLowerCase());
            normalizedParts.push(canonical);
        }
    }

    return normalizedParts.join(', ');
};

/**
 * Deduplicates and canonicalises a userGear quiver list.
 */
export const deduplicateUserGear = (userGear = []) => {
    if (!Array.isArray(userGear)) return [];
    const seen = new Map();

    for (const item of userGear) {
        if (!item) continue;
        const size = normalizeSize(item.size);
        const model = normalizeBrandName(item.model || '');
        const sizeNum = parseFloat(size);
        const type = item.type || (sizeNum >= 400 ? 'foil' : sizeNum >= 30 ? 'board' : 'wing');

        const key = `${type}_${size}_${model.toLowerCase()}`;
        if (!seen.has(key)) {
            seen.set(key, {
                ...item,
                id: item.id || `gear_${type}_${size}_${model.toLowerCase().replace(/\s+/g, '_')}`,
                type,
                size,
                model,
            });
        }
    }

    return Array.from(seen.values());
};

/**
 * Analyzes sessions and userGear to identify duplicate/misspelled gear items,
 * how many sessions are affected, and generates a safe migration plan.
 */
export const analyzeQuiverRationalisation = (sessions = [], userGear = []) => {
    const cleanedUserGear = deduplicateUserGear(userGear);
    const replacements = new Map(); // original -> { canonical, count }
    const sessionUpdates = [];

    for (const s of sessions) {
        if (!s || !s.gearUsed || typeof s.gearUsed !== 'string') continue;
        const originalGearUsed = s.gearUsed.trim();
        const normalizedGearUsed = normalizeGearUsed(originalGearUsed, cleanedUserGear);

        if (originalGearUsed !== normalizedGearUsed) {
            sessionUpdates.push({
                id: s.id,
                date: s.date,
                oldGearUsed: originalGearUsed,
                newGearUsed: normalizedGearUsed,
            });

            // Track individual item replacements
            const origItems = originalGearUsed.split(/[,+]/).map(i => i.trim()).filter(Boolean);
            for (const item of origItems) {
                const canon = normalizeSingleGearName(item, cleanedUserGear);
                if (item !== canon) {
                    if (!replacements.has(item)) {
                        replacements.set(item, { original: item, canonical: canon, count: 0 });
                    }
                    replacements.get(item).count += 1;
                }
            }
        }
    }

    const replacementList = Array.from(replacements.values()).sort((a, b) => b.count - a.count);
    const userGearChanged = userGear.length !== cleanedUserGear.length;
    const hasChanges = sessionUpdates.length > 0;

    return {
        hasChanges,
        sessionUpdates,
        replacementList,
        totalAffectedSessions: sessionUpdates.length,
        cleanedUserGear,
        originalUserGearCount: userGear.length,
        cleanedUserGearCount: cleanedUserGear.length,
        userGearChanged,
    };
};
