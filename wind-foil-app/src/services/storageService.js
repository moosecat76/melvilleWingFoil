
const STORAGE_KEY_PREFIX = 'wind_foil_';
const KEYS_TO_BACKUP = [
    'wind_foil_journal_entries',
    'locations',
    'currentLocationId',
    'user_gear'
];

export const exportData = () => {
    const backup = {};
    KEYS_TO_BACKUP.forEach(key => {
        const data = localStorage.getItem(key);
        if (data) {
            try {
                backup[key] = JSON.parse(data);
            } catch (e) {
                console.error(`Failed to parse ${key}`, e);
                backup[key] = data;
            }
        }
    });

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wind-foil-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

export const importData = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const backup = JSON.parse(e.target.result);
                Object.keys(backup).forEach(key => {
                    if (typeof backup[key] === 'object') {
                        localStorage.setItem(key, JSON.stringify(backup[key]));
                    } else {
                        localStorage.setItem(key, backup[key]);
                    }
                });
                resolve({ success: true, count: Object.keys(backup).length });
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
};
